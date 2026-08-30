/**
 * 配置管理
 * 统一管理环境变量、路径、常量
 */
const path = require("path");
const os = require("os");

// 项目根目录
const ROOT_DIR = path.join(__dirname, "..");
const BLOG_ROOT = path.join(ROOT_DIR, "..");
const BLOG_CONTENT = path.join(BLOG_ROOT, "blog");

// 自动探测局域网 IP
function getLanIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      candidates.push({ name, address: iface.address });
    }
  }
  // 1. 优先选 Wi-Fi / 以太网
  const real = candidates.find(c => /wlan|wi-?fi|ethernet|以太网/i.test(c.name));
  if (real) return real.address;
  // 2. 其次选私有网段且非虚拟网卡
  const priv = candidates.find(c =>
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3)\./.test(c.address) &&
    !/vmnet|vmware|virtual|radmin|vethernet|hyper-v/i.test(c.name)
  );
  if (priv) return priv.address;
  return candidates.length ? candidates[0].address : "127.0.0.1";
}

const config = {
  // 服务
  port: Number(process.env.PORT) || 3000,
  lanIP: process.env.LAN_IP || getLanIP(),
  get baseURL() { return `http://${this.lanIP}:${this.port}`; },

  // 路径
  rootDir: ROOT_DIR,
  blogRoot: BLOG_ROOT,
  blogContent: BLOG_CONTENT,
  usersFile: path.join(ROOT_DIR, "users.json"),
  projectsFile: path.join(ROOT_DIR, "projects.json"),

  // 会话超时
  qrExpireMs: 120 * 1000,
  webTokenExpireMs: 7 * 24 * 3600 * 1000,

  // MySQL
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "123456",
    database: process.env.DB_NAME || "myself_blog2",
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4"
  },

  // 默认管理员
  defaultAdmin: { username: "admin", password: "123456" },

  // ChatRecord
  chatrecord: {
    dataDir: path.join(ROOT_DIR, "data", "chatrecord"),
    ocrPort: 8765,
    ocrScript: path.join(BLOG_CONTENT, "projects", "chatrecord", "backend", "ocr_server.py")
  },

  // 项目中心
  projects: {
    dir: path.join(BLOG_CONTENT, "projects"),
    validColors: ["c1", "c2", "c3", "c4", "c5", "c6"]
  }
};

module.exports = config;
