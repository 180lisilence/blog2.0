# 🌍 个人博客 & 作品集（登录门禁版）

一个集成了多个网页项目和游戏的个人博客系统，前面加了**登录门禁**：支持扫码登录和账号密码登录双模式，登录后才能进入博客和使用全部项目。

## ✨ 特性

- 🔐 **双模式登录**：手机扫码登录 + 电脑端账号密码登录，无需手机也能登录
- 📂 **项目中心**：登录后统一入口，卡片式展示所有项目
- 📝 **博客首页**：文章列表 + 项目展示
- 💬 **ChatRecord 会话时序实验室**：聊天记录可视化分析，支持多会话管理、自动保存、分享链接、OCR 截图识别
- 🎮 **多个内置项目**：个人工作台、钢铁前线 FPS、极智云企业门户、我的世界服务器、餐厅管理系统、Earth Online
- 📱 **移动端适配**：手机浏览器可直接访问（同一局域网下）

## 🚀 快速开始

### 环境要求

- Node.js 14+
- MySQL 5.7+（可选，未配置时用户数据走内存缓存 + users.json）
- Python 3.8+（可选，用于 ChatRecord OCR 增强识别，未安装时自动回退浏览器端 Tesseract.js）

### 启动

```bash
# 安装依赖
cd qrcode-login
npm install

# 启动服务
node server.js
```

或直接双击根目录的 `打开博客.bat`（会自动启动服务并打开登录页）。

启动后访问：
- 登录页：http://127.0.0.1:3000/
- 局域网访问：http://<你的局域网IP>:3000/

### 内置账号

- 账号：`admin`
- 密码：`123456`

可在 `qrcode-login/users.json` 中修改或删除。新用户可通过手机扫码页注册。

## 📁 项目结构

```
├── index.html                  # 登录页（扫码 + 账号密码双模式）
├── mobile-confirm.html         # 手机扫码确认/注册页
├── projects.html               # 登录后的项目中心
├── chatrecord-share.html       # ChatRecord 公开分享页（无需登录）
├── 打开博客.bat                 # 一键启动脚本
├── README.md
├── blog/                       # 博客内容（登录后才能访问）
│   ├── index.html              # 博客首页
│   ├── assets/                 # 博客静态资源
│   ├── posts/                  # 博客文章
│   ├── workbench/              # 个人工作台
│   └── projects/               # 作品集项目
│       ├── chatrecord/         # 💬 ChatRecord 会话时序实验室
│       ├── steel-frontline/    # 🎯 钢铁前线 · 狙击（FPS 游戏）
│       ├── jizhiyun-pro/       # ☁️ 极智云 · 企业门户
│       ├── jizhiyun-demo/      # 极智云测试版
│       ├── shantou/            # ⛏️ 我们的山头（Minecraft 服务器 BE 版）
│       ├── shantou2/           # 我们的山头（Java 版）
│       ├── restaurant/          # 🍽️ 餐厅学生管理系统
│       └── earth-online/        # 🌍 Earth Online
└── qrcode-login/               # 登录门禁后端
    ├── server.js               # Express 服务（登录 + 静态站点 + ChatRecord API）
    ├── users.json              # 用户数据（自动生成，已 gitignore）
    ├── data/                   # ChatRecord 会话数据（已 gitignore）
    └── package.json
```

## 💬 ChatRecord 会话时序实验室

把聊天记录变成可计算的数字表征。

### 功能

- 📥 **多种导入方式**：文本粘贴、JSON 数组、微信/QQ 截图 OCR 识别
- 📊 **8 种可视化图表**：时序波形、消息量分布、平均长度、日历热力图、发送者统计、复读指数、周×小时活跃度
- 💾 **多会话管理**：保存多个聊天记录会话，随时切换，自动保存（debounce 1.5s）
- 🔗 **分享链接**：生成只读分享链接，对方无需登录即可查看图表
- 🔍 **OCR 双引擎**：优先本地 RapidOCR（服务端自动拉起），未安装时回退浏览器端 Tesseract.js

### API

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | /api/chatrecord/sessions | 会话列表 | ✅ |
| POST | /api/chatrecord/sessions | 创建会话 | ✅ |
| GET | /api/chatrecord/sessions/:id | 获取会话 | ✅ |
| PUT | /api/chatrecord/sessions/:id | 更新会话（自动保存） | ✅ |
| DELETE | /api/chatrecord/sessions/:id | 删除会话 | ✅ |
| POST | /api/chatrecord/sessions/:id/import | 导入消息 | ✅ |
| POST | /api/chatrecord/sessions/:id/share | 生成分享链接 | ✅ |
| DELETE | /api/chatrecord/sessions/:id/share | 取消分享 | ✅ |
| GET | /api/chatrecord/share/:shareId | 公开分享数据 | ❌ |
| GET | /api/chatrecord/ocr/health | OCR 服务状态 | ✅ |
| POST | /api/chatrecord/ocr | OCR 识别（代理到 RapidOCR） | ✅ |

### OCR 增强识别

ChatRecord 的 OCR 截图识别优先使用本地 RapidOCR 服务（识别率远超 Tesseract.js）。blog 服务启动后会自动预启动 Python OCR 服务，无需手动运行。

如需手动安装 OCR 依赖：

```bash
pip install rapidocr_onnxruntime pillow numpy
```

## 🔐 登录门禁说明

- **双模式登录**：
  - 扫码登录：手机扫码 → 手机端注册/登录 → PC 端自动进入
  - 账号密码登录：在登录页二维码下方直接输入账号密码，无需手机
- 未登录访问任何受保护页面都会跳转到登录页
- 登录成功后写入登录 Cookie（7 天有效）
- 访客模式：登录页点「无法连接服务？点此直接进入博客」可以访客身份进入，但保存/分享等后端功能不可用
- 手机扫码 URL 自动使用局域网 IP（Wi-Fi 网卡优先），手机和电脑需在同一网络

## 🛠️ 技术栈

- **前端**：纯 HTML / CSS / JavaScript，ECharts 图表，Tesseract.js 浏览器端 OCR
- **后端**：Node.js + Express
- **用户存储**：MySQL（主） + 内存缓存 + users.json（兜底）
- **OCR**：RapidOCR（PaddleOCR ONNX 版，服务端） + Tesseract.js（浏览器端回退）
- **密码加密**：scrypt 加盐

## 📦 部署

登录门禁依赖 Node 后端，需部署到可运行 Node 的平台（Render / Railway / 云服务器 / 宝塔 Node 项目），将整个项目上传即可。

- 纯静态托管（GitHub Pages 等）无法运行登录门禁
- MySQL 为可选依赖，未配置时用户数据走内存缓存（重启后丢失），建议配置 MySQL 持久化

## 📄 License

MIT
