const express = require('express');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= 配置 ================= */
const PORT = Number(process.env.PORT) || 3000;
// 博客站点根目录（myself-blog2.0）：登录页 index.html、手机确认页等与启动脚本同目录
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

/* ================= MySQL 数据库 ================= */
const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "myself_blog2",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4"
};
const pool = mysql.createPool(DB_CONFIG);

/* ================= 用户存储（MySQL 持久化，内存缓存） ================= */
const USERS_FILE = path.join(__dirname, "users.json"); // 仅用于旧数据迁移
let users = {}; // { username: { salt, hash, createdAt, builtin? } }

// 启动时：从 MySQL 加载用户；若 DB 为空且存在旧 users.json，则自动迁移
async function initUsersFromDB() {
  try {
    const [rows] = await pool.query("SELECT username, salt, hash, created_at, is_builtin FROM users");
    users = {};
    for (const r of rows) {
      users[r.username] = { salt: r.salt, hash: r.hash, createdAt: Number(r.created_at), builtin: !!r.is_builtin };
    }
    if (rows.length === 0 && fs.existsSync(USERS_FILE)) {
      try {
        const old = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
        for (const name of Object.keys(old)) {
          const u = old[name];
          await pool.execute(
            "INSERT INTO users (username, salt, hash, created_at, is_builtin) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE salt=VALUES(salt), hash=VALUES(hash)",
            [name, u.salt, u.hash, u.createdAt || Date.now(), u.builtin ? 1 : 0]
          );
          users[name] = { salt: u.salt, hash: u.hash, createdAt: u.createdAt || Date.now(), builtin: !!u.builtin };
        }
        console.log(`已从 users.json 迁移 ${Object.keys(old).length} 个账号到 MySQL`);
      } catch (e) {
        console.error("迁移 users.json 失败：", e.message);
      }
    }
  } catch (e) {
    console.error("从 MySQL 加载用户失败：", e.message);
  }
}

// 内置默认账号（首次启动自动写入 MySQL）
const DEFAULT_ADMIN = { username: "admin", password: "123456" };
async function ensureBuiltinAdmin() {
  if (!users[DEFAULT_ADMIN.username]) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(DEFAULT_ADMIN.password, salt, 64).toString("hex");
    users[DEFAULT_ADMIN.username] = { salt, hash, createdAt: Date.now(), builtin: true };
    try {
      await pool.execute(
        "INSERT INTO users (username, salt, hash, created_at, is_builtin) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE salt=VALUES(salt), hash=VALUES(hash)",
        [DEFAULT_ADMIN.username, salt, hash, Date.now()]
      );
      console.log(`已创建内置账号：${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
    } catch (e) {
      console.error("写入内置账号失败：", e.message);
    }
  }
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

// 返回当前登录用户名（仅真实登录用户，访客返回 null）
function getAuthedUser(req) {
  if (parseCookies(req).web_guest === "1") return null; // 访客无用户数据
  const token = getTokenFromReq(req);
  if (!token) return null;
  const ws = webSessions.get(token);
  if (!ws || Date.now() > ws.expireAt) return null;
  return ws.username;
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

// 4、注册账号（写入 MySQL）
app.post('/api/register', async (req, res) => {
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
  try {
    await pool.execute(
      "INSERT INTO users (username, salt, hash, created_at, is_builtin) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE salt=VALUES(salt), hash=VALUES(hash)",
      [username, salt, hash, Date.now()]
    );
  } catch (e) {
    console.error("写入用户到 MySQL 失败：", e.message);
  }
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

// 5.5、电脑端账号密码直接登录（无需手机扫码）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) return res.status(400).json({ ok: false, msg: '请输入账号和密码' });
  const user = users[u];
  if (!user) return res.status(400).json({ ok: false, msg: '账号不存在，请先注册' });
  if (hashPassword(p, user.salt) !== user.hash) return res.status(400).json({ ok: false, msg: '账号或密码错误' });
  const webToken = `SELF-LOGIN-${uuidv4()}`;
  webSessions.set(webToken, { username: u, createAt: Date.now(), expireAt: Date.now() + WEB_TOKEN_EXPIRE_MS });
  res.json({ ok: true, webToken, username: u });
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

/* ================= 用户业务数据存储（MySQL，按用户隔离） ================= */
async function loadUserDataDB(username) {
  try {
    const [rows] = await pool.query("SELECT data_key, data_value FROM user_data WHERE username = ?", [username]);
    const data = {};
    for (const r of rows) {
      try { data[r.data_key] = JSON.parse(r.data_value); }
      catch (e) { data[r.data_key] = null; }
    }
    return data;
  } catch (e) {
    console.error("读取用户业务数据失败:", e.message);
    return {};
  }
}
async function saveUserDataDB(username, data) {
  try {
    const now = Date.now();
    await pool.query("DELETE FROM user_data WHERE username = ?", [username]);
    const keys = Object.keys(data || {});
    for (const k of keys) {
      await pool.query(
        "INSERT INTO user_data (username, data_key, data_value, updated_at) VALUES (?,?,?,?)",
        [username, k, JSON.stringify(data[k]), now]
      );
    }
    return true;
  } catch (e) {
    console.error("保存用户业务数据失败:", e.message);
    return false;
  }
}
// 读取当前登录用户的全部业务数据
app.get("/api/data/all", async (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, code: "UNAUTHORIZED", msg: "请先登录" });
  const data = await loadUserDataDB(u);
  res.json({ ok: true, username: u, data });
});
// 保存当前登录用户的全部业务数据
app.put("/api/data/all", async (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, code: "UNAUTHORIZED", msg: "请先登录" });
  const body = req.body || {};
  const data = (body.data && typeof body.data === "object" && !Array.isArray(body.data)) ? body.data : {};
  const ok = await saveUserDataDB(u, data);
  if (!ok) return res.status(500).json({ ok: false, msg: "保存失败" });
  res.json({ ok: true });
});

// 7、退出登录
app.post('/api/logout', (req, res) => {
  let token = (req.body && req.body.token) || "";
  token = String(token).replace(/^Bearer\s+/i, "").trim();
  webSessions.delete(token);
  res.json({ ok: true });
});

/* ================= ChatRecord 会话时序实验室后端 ================= */
const CR_DATA_DIR = path.join(__dirname, "data", "chatrecord");
const CR_OCR_PORT = 8765;
const CR_OCR_SCRIPT = path.join(BLOG_ROOT, "blog", "projects", "chatrecord", "backend", "ocr_server.py");

function crEnsureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
crEnsureDir(CR_DATA_DIR);

function crUserDir(username) {
  const safe = String(username).replace(/[^\w\u4e00-\u9fa5@.\-]/g, "_");
  const dir = path.join(CR_DATA_DIR, safe);
  crEnsureDir(path.join(dir, "sessions"));
  return dir;
}
function crReadJSON(fp, def) {
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (e) { return def; }
}
function crWriteJSON(fp, data) {
  crEnsureDir(path.dirname(fp));
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}
function crLoadIndex(username) { return crReadJSON(path.join(crUserDir(username), "index.json"), []); }
function crSaveIndex(username, list) { crWriteJSON(path.join(crUserDir(username), "index.json"), list); }
function crLoadSession(username, id) { return crReadJSON(path.join(crUserDir(username), "sessions", id + ".json"), null); }
function crSaveSession(username, sess) { crWriteJSON(path.join(crUserDir(username), "sessions", sess.id + ".json"), sess); }
function crDeleteSession(username, id) {
  const fp = path.join(crUserDir(username), "sessions", id + ".json");
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}
function crUpdateIndexMeta(username, sess) {
  const list = crLoadIndex(username);
  const idx = list.findIndex(s => s.id === sess.id);
  const meta = {
    id: sess.id, name: sess.name,
    createdAt: sess.createdAt, updatedAt: sess.updatedAt,
    messageCount: (sess.messages || []).length,
    shareId: sess.shareId || null
  };
  if (idx >= 0) list[idx] = meta; else list.unshift(meta);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  crSaveIndex(username, list);
}

// 会话列表
app.get("/api/chatrecord/sessions", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  res.json({ ok: true, sessions: crLoadIndex(u) });
});
// 创建会话
app.post("/api/chatrecord/sessions", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const { name, messages, stats } = req.body || {};
  const now = Date.now();
  const sess = {
    id: uuidv4(),
    name: String(name || "未命名会话").slice(0, 100),
    messages: Array.isArray(messages) ? messages : [],
    stats: stats || null,
    createdAt: now, updatedAt: now, shareId: null
  };
  crSaveSession(u, sess);
  crUpdateIndexMeta(u, sess);
  res.json({ ok: true, session: sess });
});
// 获取单个会话
app.get("/api/chatrecord/sessions/:id", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  res.json({ ok: true, session: sess });
});
// 更新会话（名称/消息/统计缓存）
app.put("/api/chatrecord/sessions/:id", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  const { name, messages, stats } = req.body || {};
  if (name !== undefined) sess.name = String(name).slice(0, 100);
  if (messages !== undefined) sess.messages = Array.isArray(messages) ? messages : [];
  if (stats !== undefined) sess.stats = stats;
  sess.updatedAt = Date.now();
  crSaveSession(u, sess);
  crUpdateIndexMeta(u, sess);
  res.json({ ok: true, session: sess });
});
// 删除会话
app.delete("/api/chatrecord/sessions/:id", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  crDeleteSession(u, req.params.id);
  crSaveIndex(u, crLoadIndex(u).filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

// 导入消息（text/json 格式，解析后追加到会话）
app.post("/api/chatrecord/sessions/:id/import", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  const { format, data } = req.body || {};
  let imported = [];
  if (format === "json") {
    try {
      const arr = JSON.parse(String(data || ""));
      if (!Array.isArray(arr)) throw new Error("JSON 必须是数组");
      imported = arr.map((it, i) => {
        const raw = it.ts ?? it.time ?? it.timestamp ?? it.date;
        const ts = new Date(raw).getTime();
        return {
          id: Date.now() + i, ts: isNaN(ts) ? Date.now() : ts,
          sender: String(it.sender || it.from || it.user || it.name || "未知"),
          text: String(it.text || it.content || it.msg || "")
        };
      }).filter(m => !isNaN(m.ts));
    } catch (e) { return res.status(400).json({ ok: false, msg: "JSON 解析失败: " + e.message }); }
  } else {
    const lines = String(data || "").split(/\r?\n/);
    let lastDate = null, id = Date.now();
    const reFull = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s+([^:：]+)[:：]\s*(.*)$/;
    const reShort = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:：]+)[:：]\s*(.*)$/;
    for (const raw of lines) {
      const s = raw.trim();
      if (!s) continue;
      let m = s.match(reFull);
      if (m) {
        const dp = m[1].split("-").map(Number), tp = m[2].split(":").map(Number);
        const ts = new Date(dp[0], dp[1]-1, dp[2], tp[0]||0, tp[1]||0, tp[2]||0).getTime();
        if (!isNaN(ts)) { imported.push({ id: id++, ts, sender: m[3].trim(), text: m[4].trim() }); lastDate = m[1]; }
        continue;
      }
      m = s.match(reShort);
      if (m && lastDate) {
        const dp = lastDate.split("-").map(Number), tp = m[1].split(":").map(Number);
        const ts = new Date(dp[0], dp[1]-1, dp[2], tp[0]||0, tp[1]||0, tp[2]||0).getTime();
        if (!isNaN(ts)) imported.push({ id: id++, ts, sender: m[2].trim(), text: m[3].trim() });
      }
    }
  }
  if (!imported.length) return res.status(400).json({ ok: false, msg: "没有解析到有效消息" });
  imported.sort((a, b) => a.ts - b.ts);
  sess.messages = (sess.messages || []).concat(imported).sort((a, b) => a.ts - b.ts);
  sess.updatedAt = Date.now();
  sess.stats = null;
  crSaveSession(u, sess);
  crUpdateIndexMeta(u, sess);
  res.json({ ok: true, imported: imported.length, total: sess.messages.length, session: sess });
});

/* ---------- 分享链接 ---------- */
const crShares = new Map();
(function crRebuildShares() {
  try {
    for (const username of fs.readdirSync(CR_DATA_DIR)) {
      const list = crReadJSON(path.join(CR_DATA_DIR, username, "index.json"), []);
      for (const s of list) if (s.shareId) crShares.set(s.shareId, { username, sessionId: s.id });
    }
  } catch (e) {}
})();

app.post("/api/chatrecord/sessions/:id/share", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  if (!sess.shareId) {
    sess.shareId = crypto.randomBytes(8).toString("hex");
    crShares.set(sess.shareId, { username: u, sessionId: sess.id });
  }
  sess.updatedAt = Date.now();
  crSaveSession(u, sess);
  crUpdateIndexMeta(u, sess);
  res.json({ ok: true, shareId: sess.shareId, shareUrl: `${BASE_URL}/chatrecord-share.html?sid=${sess.shareId}` });
});
app.delete("/api/chatrecord/sessions/:id/share", (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const sess = crLoadSession(u, req.params.id);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  if (sess.shareId) { crShares.delete(sess.shareId); sess.shareId = null; sess.updatedAt = Date.now(); crSaveSession(u, sess); crUpdateIndexMeta(u, sess); }
  res.json({ ok: true });
});
// 公开分享数据（无需登录）
app.get("/api/chatrecord/share/:shareId", (req, res) => {
  const ref = crShares.get(req.params.shareId);
  if (!ref) return res.status(404).json({ ok: false, msg: "分享不存在或已取消" });
  const sess = crLoadSession(ref.username, ref.sessionId);
  if (!sess) return res.status(404).json({ ok: false, msg: "会话不存在" });
  res.json({ ok: true, name: sess.name, messages: sess.messages, stats: sess.stats, createdAt: sess.createdAt });
});

/* ---------- OCR 服务端化（代理到 Python RapidOCR） ---------- */
let crOcrProcess = null;
function crOcrHealth() {
  return new Promise((resolve) => {
    const r = http.get(`http://127.0.0.1:${CR_OCR_PORT}/health`, { timeout: 2000 }, (resp) => { resolve(resp.statusCode === 200); resp.resume(); });
    r.on("error", () => resolve(false));
    r.on("timeout", () => { r.destroy(); resolve(false); });
  });
}
async function crEnsureOcr() {
  if (await crOcrHealth()) return true;
  try {
    const py = process.env.PYTHON || "python";
    crOcrProcess = require("child_process").spawn(py, [CR_OCR_SCRIPT], { detached: false, stdio: "ignore", windowsHide: true });
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await crOcrHealth()) return true;
    }
    return false;
  } catch (e) { console.error("启动 OCR 服务失败:", e.message); return false; }
}
app.get("/api/chatrecord/ocr/health", async (req, res) => {
  const ok = await crOcrHealth();
  res.json({ ok, engine: ok ? "rapidocr" : "unavailable" });
});
app.post("/api/chatrecord/ocr", async (req, res) => {
  const u = getAuthedUser(req);
  if (!u) return res.status(401).json({ ok: false, msg: "请先登录" });
  const ready = await crEnsureOcr();
  if (!ready) return res.status(503).json({ ok: false, msg: "OCR 服务未就绪，请检查 Python 环境或运行 start-ocr.bat" });
  const body = JSON.stringify(req.body || {});
  const proxyReq = http.request({
    hostname: "127.0.0.1", port: CR_OCR_PORT, path: "/ocr", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, { "Content-Type": proxyRes.headers["content-type"] || "application/json" });
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (e) => res.status(502).json({ ok: false, msg: "OCR 代理失败: " + e.message }));
  proxyReq.write(body);
  proxyReq.end();
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
// ChatRecord 公开分享页（无需登录）
app.get("/chatrecord-share.html", (req, res) => {
  res.sendFile(path.join(BLOG_ROOT, "chatrecord-share.html"));
});
// ChatRecord 分享页公开资源（echarts/charts.js，无需登录）
app.use("/share-assets/chatrecord", express.static(path.join(BLOG_CONTENT, "projects", "chatrecord")));

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

/* ================= 启动 ================= */
async function start() {
  try {
    await initUsersFromDB();
    await ensureBuiltinAdmin();
  } catch (e) {
    console.error("数据库初始化失败：", e.message);
  }
  app.listen(PORT, () => {
    console.log(`服务启动：http://127.0.0.1:${PORT}`);
    console.log(`局域网地址：${BASE_URL}`);
    console.log(`站点入口（登录页，与启动脚本同目录）：http://127.0.0.1:${PORT}/`);
    console.log(`登录后进入博客：http://127.0.0.1:${PORT}/blog/`);
    console.log(`数据库：MySQL ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    // 异步预启动 ChatRecord OCR 服务（不阻塞主服务，首次使用无需等待）
    setTimeout(async () => {
      const ok = await crEnsureOcr();
      console.log(`ChatRecord OCR: ${ok ? '✅ RapidOCR 已就绪（增强识别）' : '⚠️  未就绪，将使用浏览器端 Tesseract.js 回退'}`);
    }, 2000);
  });
}
start();
