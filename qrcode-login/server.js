const express = require('express');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= 配置 ================= */
const PORT = Number(process.env.PORT) || 3000;
// 博客站点根目录（myself-blog）：登录页 index.html、手机确认页等与启动脚本同目录
const BLOG_ROOT = path.join(__dirname, "..");
const BLOG_CONTENT = path.join(BLOG_ROOT, "blog");   // 博客内容（需登录访问）

// 自动探测局域网 IP（用于生成手机扫码的 URL），也可用环境变量 LAN_IP 覆盖
function getLanIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      candidates.push({ name, address: iface.address });
    }
  }
  // 1. 优先选 Wi-Fi / 以太网等真实网卡（手机通常和它们同网段）
  const real = candidates.find(c => /wlan|wi-?fi|ethernet|以太网/i.test(c.name));
  if (real) return real.address;
  // 2. 其次选私有网段且非虚拟网卡
  const priv = candidates.find(c =>
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(c.address) &&
    !/vmnet|vmware|virtual|radmin|vethernet|hyper-v/i.test(c.name));
  if (priv) return priv.address;
  // 3. 最后取第一个非内部地址
  return candidates.length ? candidates[0].address : "127.0.0.1";
}
const LAN_IP = process.env.LAN_IP || getLanIP();
const BASE_URL = `http://${LAN_IP}:${PORT}`;

const QR_EXPIRE_MS = 120 * 1000;            // 二维码 120 秒有效
const WEB_TOKEN_EXPIRE_MS = 7 * 24 * 3600 * 1000; // 登录态 7 天有效

/* ================= 用户存储（JSON 文件持久化） ================= */
const USERS_FILE = path.join(__dirname, "users.json");
let users = {}; // { username: { salt, hash, createdAt, builtin? } }

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("读取 users.json 失败：", e.message);
    users = {};
  }
}
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.error("保存 users.json 失败：", e.message);
  }
}
loadUsers();

// 内置默认账号（首次启动自动写入，可在 users.json 中修改或删除后重启）
const DEFAULT_ADMIN = { username: "admin", password: "123456" };
if (!users[DEFAULT_ADMIN.username]) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(DEFAULT_ADMIN.password, salt, 64).toString("hex");
  users[DEFAULT_ADMIN.username] = { salt, hash, createdAt: Date.now(), builtin: true };
  saveUsers();
  console.log(`已创建内置账号：${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

/* ================= 会话存储（内存） ================= */
const loginSessions = new Map(); // qid -> { status, createAt, expireAt, webToken, username }
const webSessions = new Map();   // webToken -> { username, createAt, expireAt }

/* ================= Cookie 解析与登录态判断 ================= */
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// 从 Cookie / query / Authorization 中取 web_token
function getTokenFromReq(req) {
  let t = parseCookies(req).web_token || req.query.token || "";
  if (!t && req.headers.authorization) {
    t = String(req.headers.authorization).replace(/^Bearer\s+/i, "").trim();
  }
  return t.trim();
}

function isAuthed(req) {
  // 访客模式：登录页点了"直接进入博客"后，跳过登录门禁
  if (parseCookies(req).web_guest === "1") return true;
  const token = getTokenFromReq(req);
  if (!token) return false;
  const ws = webSessions.get(token);
  if (!ws) return false;
  if (Date.now() > ws.expireAt) {
    webSessions.delete(token);
    return false;
  }
  return true;
}

// 门禁中间件：未登录访问博客页面 → 跳转登录页
function authGate(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path === "/" || /\.html?$/i.test(req.path)) {
    return res.redirect("/login.html");
  }
  return res.status(401).end();
}

/* ================= 接口 ================= */

// 1、生成登录二维码
app.get('/api/qrcode/generate', async (req, res) => {
  const qid = uuidv4();
  const now = Date.now();
  loginSessions.set(qid, {
    status: 'pending', // pending / scanned / confirmed / expired
    createAt: now,
    expireAt: now + QR_EXPIRE_MS,
    webToken: null,
    username: null
  });
  const scanUrl = `${BASE_URL}/mobile-confirm.html?qid=${qid}`;
  const qrBase64 = await qrcode.toDataURL(scanUrl, { width: 320, margin: 1 });
  res.json({ qid, qrBase64, expireSeconds: QR_EXPIRE_MS / 1000 });
});

// 2、PC 轮询查询二维码状态
app.get('/api/qrcode/check', (req, res) => {
  const { qid } = req.query;
  const session = loginSessions.get(qid);
  const now = Date.now();
  if (!session) return res.json({ status: 'invalid' });
  if (now > session.expireAt) {
    loginSessions.delete(qid);
    return res.json({ status: 'expired' });
  }
  res.json({
    status: session.status,
    webToken: session.webToken,
    username: session.username
  });
});

// 3、手机扫码后通知：标记为已扫描
app.get("/api/qrcode/scanned", (req, res) => {
  const { qid } = req.query;
  const session = loginSessions.get(qid);
  if (!session || Date.now() > session.expireAt) {
    return res.json({ ok: false, msg: "会话过期，请刷新 PC 页面重新获取二维码" });
  }
  if (session.status === "pending") {
    session.status = "scanned";
  }
  return res.json({ ok: true });
});

// 4、注册账号
app.post('/api/register', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || "").trim();
  if (!/^[\w\u4e00-\u9fa5@.\-]{2,20}$/.test(username)) {
    return res.status(400).json({ ok: false, msg: "账号需为 2-20 位字母、数字、中文或 @._- 组合" });
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 32) {
    return res.status(400).json({ ok: false, msg: "密码长度需为 6-32 位" });
  }
  if (users[username]) {
    return res.status(400).json({ ok: false, msg: "该账号已被注册，请直接登录" });
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  users[username] = { salt, hash, createdAt: Date.now() };
  saveUsers();
  res.json({ ok: true, msg: "注册成功，请返回使用该账号登录" });
});

// 5、手机确认登录（校验已注册账号）
app.post('/api/qrcode/confirm', (req, res) => {
  const { qid, username, password } = req.body || {};
  const session = loginSessions.get(qid);
  if (!session || Date.now() > session.expireAt) {
    return res.status(400).json({ ok: false, msg: "会话失效，请刷新二维码后重试" });
  }
  if (session.status === "confirmed") {
    return res.status(400).json({ ok: false, msg: "二维码已经使用过" });
  }
  const user = users[username];
  if (!user) {
    return res.status(400).json({ ok: false, msg: "账号不存在，请先注册" });
  }
  if (hashPassword(password, user.salt) !== user.hash) {
    return res.status(400).json({ ok: false, msg: "账号或密码错误" });
  }
  session.status = "confirmed";
  session.username = username;
  const webToken = `SELF-LOGIN-${uuidv4()}`;
  session.webToken = webToken;
  webSessions.set(webToken, {
    username,
    createAt: Date.now(),
    expireAt: Date.now() + WEB_TOKEN_EXPIRE_MS
  });
  res.json({ ok: true, webToken, username });
});

// 6、校验 PC 端登录态（供受保护页面鉴权，支持 Cookie / query / Authorization）
app.get('/api/me', (req, res) => {
  const token = getTokenFromReq(req);
  const ws = webSessions.get(token);
  if (!ws) return res.status(401).json({ ok: false, code: "UNAUTHORIZED", msg: "未登录或登录已过期" });
  if (Date.now() > ws.expireAt) {
    webSessions.delete(token);
    return res.status(401).json({ ok: false, code: "UNAUTHORIZED", msg: "登录已过期" });
  }
  res.json({ ok: true, username: ws.username });
});

// 7、退出登录
app.post('/api/logout', (req, res) => {
  let token = (req.body && req.body.token) || "";
  token = String(token).replace(/^Bearer\s+/i, "").trim();
  webSessions.delete(token);
  res.json({ ok: true });
});

/* ================= 公开页面（无需登录） ================= */
// 站点根 / 登录页：登录页就是最外层入口（与启动脚本同目录的 index.html）
app.get(["/", "/index.html", "/login", "/login.html"], (req, res) => {
  res.sendFile(path.join(BLOG_ROOT, "index.html"));
});
// 手机扫码确认页
app.get("/mobile-confirm.html", (req, res) => {
  res.sendFile(path.join(BLOG_ROOT, "mobile-confirm.html"));
});

/* ================= 博客站点（需登录后才能访问） ================= */
// 项目中心页（需登录）
app.get("/projects.html", authGate, (req, res) => {
  res.sendFile(path.join(BLOG_ROOT, "projects.html"));
});

// 博客整体位于 blog/ 子目录，需登录后才可访问
app.use("/blog", authGate, express.static(BLOG_CONTENT));

// 兜底：未登录跳登录页
app.use((req, res) => {
  if (!isAuthed(req)) return res.redirect("/login.html");
  res.status(404).send("Not Found");
});

/* ================= 定时清理过期会话 ================= */
setInterval(() => {
  const now = Date.now();
  for (const [qid, s] of loginSessions.entries()) {
    if (now > s.expireAt) loginSessions.delete(qid);
  }
  for (const [token, s] of webSessions.entries()) {
    if (now > s.expireAt) webSessions.delete(token);
  }
}, 10 * 1000);

app.listen(PORT, () => {
  console.log(`服务启动：http://127.0.0.1:${PORT}`);
  console.log(`局域网地址：${BASE_URL}`);
  console.log(`站点入口（登录页，与启动脚本同目录）：http://127.0.0.1:${PORT}/`);
  console.log(`登录后进入博客：http://127.0.0.1:${PORT}/blog/`);
});
