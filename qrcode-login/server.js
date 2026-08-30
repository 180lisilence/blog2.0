/**
 * 项目中心服务入口
 * 模块化架构：config / core / db / middleware / modules
 */
const express = require("express");
const cors = require("cors");
const path = require("path");

const config = require("./config");
const logger = require("./core/logger");
const { errorHandler } = require("./core/errors");
const pool = require("./db/pool");
const { initDatabase } = require("./db/init");
const { createAuthGate } = require("./middleware/auth");
const { forceHttps, securityHeaders, createRateLimiter } = require("./middleware/security");

const authRoutes = require("./modules/auth/routes");
const authModel = require("./modules/auth/model");
const authSession = require("./modules/auth/session");
const chatrecordRoutes = require("./modules/chatrecord/routes");
const projectsRoutes = require("./modules/projects/routes");

const app = express();

// ========== 全局中间件 ==========
app.use(forceHttps);           // 生产环境强制 HTTPS
app.use(securityHeaders);      // 安全响应头
app.use(createRateLimiter(300, 60000)); // 频率限制：每分钟 300 次
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 请求日志
app.use((req, res, next) => {
  logger.debug("http", `${req.method} ${req.url}`);
  next();
});

// ========== API 路由 ==========
app.use("/api", authRoutes);
app.use("/api/chatrecord", chatrecordRoutes);
app.use("/api/projects", projectsRoutes);

// ========== 认证守卫 ==========
const authGate = createAuthGate(authSession.webSessions);

// ========== 公开页面（无需登录） ==========
app.get(["/", "/index.html", "/login", "/login.html"], (req, res) => {
  res.sendFile(path.join(config.blogRoot, "index.html"));
});
app.get("/mobile-confirm.html", (req, res) => {
  res.sendFile(path.join(config.blogRoot, "mobile-confirm.html"));
});
app.get("/chatrecord-share.html", (req, res) => {
  res.sendFile(path.join(config.blogRoot, "chatrecord-share.html"));
});
app.get("/architecture.html", (req, res) => {
  res.sendFile(path.join(config.blogRoot, "architecture.html"));
});

// ========== 需登录页面 ==========
app.get("/projects.html", authGate, (req, res) => {
  res.sendFile(path.join(config.blogRoot, "projects.html"));
});
app.get("/settings.html", authGate, (req, res) => {
  res.sendFile(path.join(config.blogRoot, "settings.html"));
});

// 博客内容（需登录）
app.use("/blog", authGate, express.static(config.blogContent));

// 构建方法示例（需登录）
app.use("/build-methods", authGate, express.static(path.join(config.blogRoot, "build-methods")));

// ========== 全局错误处理 ==========
app.use(errorHandler);

// 404 处理
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, msg: "接口不存在" });
  }
  res.status(404).send("404 - 页面不存在");
});

// ========== 启动 ==========
async function start() {
  logger.info("startup", "========================================");
  logger.info("startup", "项目中心服务启动中...");

  // 1. 初始化数据库（建库建表、迁移、内置管理员）
  logger.info("startup", "初始化数据库...");
  const dbOk = await initDatabase(pool);
  if (!dbOk) {
    logger.warn("startup", "数据库初始化失败，将使用内存模式（用户数据可能丢失）");
  }

  // 2. 加载用户数据到内存
  try {
    await authModel.loadAll();
  } catch (e) {
    logger.error("startup", "加载用户数据失败", e);
  }

  // 3. 启动会话清理定时器
  authSession.startCleanup();

  // 4. 启动服务
  app.listen(config.port, () => {
    logger.info("startup", `服务启动: http://127.0.0.1:${config.port}`);
    logger.info("startup", `局域网地址: ${config.baseURL}`);
    logger.info("startup", `登录页: http://127.0.0.1:${config.port}/`);
    logger.info("startup", `数据库: MySQL ${config.db.host}:${config.db.port}/${config.db.database}`);
    logger.info("startup", "========================================");
  });
}

start().catch(err => {
  logger.error("startup", "服务启动失败", err);
  process.exit(1);
});

// 优雅关闭
process.on("SIGTERM", async () => {
  logger.info("startup", "收到 SIGTERM，正在关闭...");
  await pool.end().catch(() => {});
  process.exit(0);
});
