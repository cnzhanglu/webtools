# 工具箱

纯前端离线工具集，零后端、零外部 CDN 依赖。所有计算在浏览器本地完成，数据不上传。

## 目录结构

```
中行小工具/
├── index.html                  # 工具箱首页（索引页）
├── README.md
├── docs/
│   └── deploy-cloudflare.md    # Cloudflare Pages 部署指南
├── shared/                     # 跨工具共享资源
│   ├── css/
│   │   └── common.css          # 公共样式（布局、按钮、卡片等）
│   └── js/
│       ├── utils.js            # 公共工具函数（复制、下载等）
│       ├── xlsx.js             # xlsx 导出（纯 JS，无依赖）
│       └── tools-registry.js   # 工具注册表（首页索引数据源）
└── tools/                      # 各独立工具
    └── net-policy/             # 网络策略聚合工具
        ├── index.html
        ├── css/tool.css
        └── js/
            ├── ip.js           # IPv4/IPv6 解析与聚合
            ├── process.js      # 输入解析与分组逻辑
            └── app.js          # UI 交互
```

## 本地使用

**方式 1：直接打开**

双击 `index.html` 即可在浏览器中使用（macOS 可右键 → 打开方式 → Chrome/Safari）。

**方式 2：本地 HTTP 服务（推荐）**

部分浏览器对 `file://` 协议限制较严，用本地服务更稳定：

```bash
# Python 3
python3 -m http.server 8080

# 或 Node.js
npx serve .
```

然后访问 `http://localhost:8080`

## 新增工具

1. 在 `tools/` 下创建新目录，例如 `tools/my-tool/`
2. 编写 `index.html`，引用 `../../shared/css/common.css` 和所需共享 JS
3. 在 `shared/js/tools-registry.js` 中追加一条注册条目
4. 首页会自动显示新工具卡片

## 框架与开发约定

详见 [docs/framework.md](docs/framework.md)。Cursor 规则位于 `.cursor/rules/webtools-framework.mdc`。

## 部署到 Cloudflare Pages

详见 [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)。

仓库：`https://github.com/cnzhanglu/webtools` — 在 Cloudflare Pages 关联该仓库，构建输出目录填 `/`，无需构建命令。
