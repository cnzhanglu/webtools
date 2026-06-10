# Cloudflare Pages 部署指南

本工具箱是纯静态站点，零后端，适合 Cloudflare Pages 免费托管。

## 你需要准备

| 项目 | 必需 | 说明 |
|------|------|------|
| GitHub 账号 | 是 | 存放代码仓库 |
| Cloudflare 账号 | 是 | [免费注册](https://dash.cloudflare.com/sign-up) |
| 自有域名 | 否 | `*.pages.dev` 在国内可能不稳定，绑定自有域名可改善 |

## 推荐方式：GitHub + Cloudflare 自动部署

### 1. 推送代码到 GitHub

```bash
cd 中行小工具
git init
git add .
git commit -m "init: 工具箱"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 2. 在 Cloudflare 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 授权 GitHub，选择刚推送的仓库
4. 构建设置：

| 配置项 | 值 |
|--------|-----|
| Production branch | `main` |
| Build command | （留空） |
| Build output directory | `/` |

5. 点击 **Save and Deploy**

部署完成后访问：`https://<项目名>.pages.dev`

之后每次 `git push` 自动触发新版本部署。

### 3. 绑定自定义域名（可选）

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入域名（如 `tools.example.com`）
3. 若 DNS 已托管在 Cloudflare，会自动添加 CNAME 记录

## 其他部署方式

### 控制台拖拽上传

Cloudflare Dashboard → Workers & Pages → Create → Pages → **Upload assets**

将整个仓库根目录（含 `index.html`、`shared/`、`tools/`）拖入上传。

### 命令行部署

```bash
npx wrangler pages deploy . --project-name=boc-tools
```

首次运行会弹出浏览器授权 Cloudflare 登录。

## 访问控制（可选）

若需限制访问范围，可在 Cloudflare Zero Trust → Access 中为应用添加邮箱验证策略（免费额度 50 用户）。

## 注意事项

- 所有工具计算均在用户浏览器本地完成，服务器只托管静态 HTML/JS/CSS 文件
- 不引用任何外部 CDN（Google Fonts、Bootstrap 等），内网离线环境同样可用
- Cloudflare Pages 免费计划：每月 500 次部署、无限带宽、1 个自定义域名
