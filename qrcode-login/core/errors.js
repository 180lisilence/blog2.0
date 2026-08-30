/**
 * 统一错误处理
 * - AppError: 业务错误类，携带状态码和消息
 * - asyncHandler: 自动捕获 async 路由错误
 * - errorHandler: 全局错误中间件
 */
const logger = require("./logger");

class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

// 常用错误工厂
const errors = {
  badRequest(msg, details) { return new AppError(400, msg, details); },
  unauthorized(msg = "请先登录") { return new AppError(401, msg); },
  forbidden(msg = "无权限访问") { return new AppError(403, msg); },
  notFound(msg = "资源不存在") { return new AppError(404, msg); },
  conflict(msg) { return new AppError(409, msg); },
  internal(msg = "服务器内部错误") { return new AppError(500, msg); }
};

// 包装 async 路由，自动捕获异常
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 统一成功响应
function ok(res, data, msg) {
  const body = { ok: true };
  if (msg !== undefined) body.msg = msg;
  if (data !== undefined) Object.assign(body, data);
  res.json(body);
}

// 统一失败响应
function fail(res, statusCode, msg, details) {
  const body = { ok: false, msg };
  if (details) body.details = details;
  res.status(statusCode).json(body);
}

// 全局错误处理中间件
function errorHandler(err, req, res, _next) {
  // 业务错误
  if (err instanceof AppError) {
    logger.warn("errorHandler", `[${err.statusCode}] ${req.method} ${req.url} - ${err.message}`);
    return fail(res, err.statusCode, err.message, err.details);
  }
  // 未知错误
  logger.error("errorHandler", `未捕获异常 ${req.method} ${req.url}`, err);
  fail(res, 500, "服务器内部错误");
}

module.exports = { AppError, errors, asyncHandler, ok, fail, errorHandler };
