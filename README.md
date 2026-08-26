# 🌍 个人博客 & 作品集

一个纯静态个人博客，集成了多个网页项目和游戏，无需后端，双击即可运行。

## 🚀 快速开始

双击 `打开博客.bat`，或直接用浏览器打开 `index.html`。

## 📁 项目结构

```
├── index.html              # 博客首页
├── 打开博客.bat             # 一键启动脚本
├── assets/
│   └── css/blog.css        # 博客全局样式
├── posts/                  # 博客文章
│   ├── hello-world.html
│   ├── workbench-intro.html
│   └── data-local-first.html
├── workbench/              # 个人工作台（Electron应用的网页版）
│   ├── index.html
│   ├── styles.css
│   └── renderer/           # 16个JS模块
└── projects/               # 作品集项目
    ├── shantou/            # 我们的山头 - Minecraft服务器（BE版）
    ├── shantou2/           # 我们的山头 - Java版
    ├── restaurant/         # 餐厅学生管理系统
    ├── jizhiyun-pro/       # 极智云企业版
    ├── jizhiyun-demo/      # 极智云测试版
    ├── earth-online/       # Earth Online 模拟人生游戏
    └── steel-frontline/    # 钢铁前线（介绍页）
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

## 🛠️ 技术栈

- 纯 HTML / CSS / JavaScript
- 无框架依赖（部分项目使用 Tailwind CSS CDN）
- 数据存储：localStorage
- 无需后端服务器，静态托管即可运行

## 📦 部署

将整个文件夹上传到任意静态托管服务即可：
- GitHub Pages
- Vercel
- Netlify
- 阿里云 OSS / 腾讯云 COS

## 📝 说明

- 所有项目数据存储在浏览器 localStorage 中，清除浏览器数据会重置
- Earth Online 的 Mock API 在 `projects/earth-online/earth-mock-api.js`
- 餐厅管理系统的公共函数在 `projects/restaurant/js/common.js`
