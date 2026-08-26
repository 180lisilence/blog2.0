# 🌍 个人博客 & 作品集（扫码登录门禁版）

一个个人博客，集成了多个网页项目和游戏，前面加了**扫码登录门禁**：打开站点先看到登录页，手机扫码 + 注册账号登录后才能进入博客和使用全部项目。

## 🚀 快速开始

1. 双击 `打开博客.bat`（会自动启动后台服务并打开登录页），或手动运行 `qrcode-login/server.js`（端口 3000）
2. 浏览器打开 `http://127.0.0.1:3000/` 会看到**扫码登录页**
3. 用手机扫码 → 在手机页**注册自己的账号**或用已注册账号登录
4. 登录成功后进入博客，可访问工作台和所有项目

- 内置账号：`admin / 123456`（可在 `qrcode-login/users.json` 中修改或删除）
- 用户数据（已注册账号）存储在 `qrcode-login/users.json`

## 📁 项目结构

```
├── index.html              # ★ 扫码登录页（最外层入口，与启动脚本同目录）
├── mobile-confirm.html     # 手机扫码确认/注册页
├── projects.html           # 登录后的项目中心
├── 打开博客.bat            # 一键启动脚本（启动服务 + 打开登录页）
├── blog/                   # 博客内容（登录后才能访问）
│   ├── index.html          # 博客首页
│   ├── assets/css/blog.css # 博客全局样式
│   ├── posts/              # 博客文章
│   ├── workbench/          # 个人工作台（Electron应用的网页版）
│   └── projects/           # 作品集项目
│       ├── shantou/            # 我们的山头 - Minecraft服务器（BE版）
│       ├── shantou2/           # 我们的山头 - Java版
│       ├── restaurant/         # 餐厅学生管理系统
│       ├── jizhiyun-pro/       # 极智云企业版
│       ├── jizhiyun-demo/      # 极智云测试版
│       ├── earth-online/       # Earth Online 模拟人生游戏
│       └── steel-frontline/    # 钢铁前线（介绍页）
└── qrcode-login/           # 扫码登录后台服务
    ├── server.js           # Express 服务（登录门禁 + 静态站点）
    ├── users.json          # 用户数据（自动生成）
    └── package.json
```

## 🎮 项目介绍

### 个人工作台
个人效率工作台，包含首页总览、今日计划、自媒体、开发工作、咨询工作、健身等模块。

### 餐厅学生管理系统
纯前端餐厅管理系统，支持学生端（点餐、购物车、订单、建议）和管理员端（菜品、订单、学生管理）。数据存储在 localStorage。

- 默认账号：学生 `student`/`123456`，管理员 `admin`/`admin123`

### Earth Online
模拟人生类网页游戏，包含角色创建、6种职业、商店系统、地图探索、NPC社交、婚姻生子、成就系统等完整玩法。纯前端 Mock API 实现，无需后端。

### 我们的山头
Minecraft 服务器宣传网站，赛博朋克风格 UI。

### 极智云
企业管理系统界面（企业版/测试版）。

## 🔐 登录门禁说明

- 未登录访问站点任何页面都会跳转到登录页
- 登录成功后在浏览器写入登录 Cookie（7 天有效），凭此放行博客全部页面
- 手机扫码 URL 自动使用局域网 IP（Wi-Fi 网卡优先），手机和电脑需在同一网络
- 如需手动指定 IP：启动时设置环境变量 `LAN_IP`，如 `LAN_IP=192.168.1.100 node server.js`

## 🛠️ 技术栈

- 纯 HTML / CSS / JavaScript（博客部分）
- Node.js + Express（登录门禁服务）
- 用户密码使用 scrypt 加盐加密存储

## 📦 部署

登录门禁依赖 Node 后端，需部署到可运行 Node 的平台（如 Render / Railway / 云服务器 / 宝塔 Node 项目），将整个 `myself-blog` 上传即可。
- 纯静态托管（GitHub Pages 等）无法运行登录门禁，如需上线需配合可运行 Node 的后端。
