# 本地服务（Go 单二进制）

工具箱除 `file://` 双击、Cloudflare Pages 在线访问外，提供 **Go 单二进制** 本地分发方式：下载即可运行，无需安装 Python 或 Node。

> Go 构建与发布已独立至仓库 **[webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild)**。本仓库（webtools）仅维护静态前端；**本地增强功能**（如 DNS 拨测）仅在 goBuild 仓库实现。

## 适用场景

- 内网/离线环境快速部署工具箱
- 不想配置 `python3 -m http.server` 或 `npx serve`
- 需要本机 DNS 拨测等 `/api/*` 能力（仅 goBuild 二进制提供）

## 获取与运行

### 方式一：GitHub Release（推荐）

1. 打开 [webtools-goBuild Releases](https://github.com/cnzhanglu/webtools-goBuild/releases)，下载对应平台文件
2. 解压后运行可执行文件
3. 浏览器访问 **http://127.0.0.1:8080**（首页为**门户**，可选择静态工具箱或本地增强工具）

### 方式二：自行编译

见 [webtools-goBuild README](https://github.com/cnzhanglu/webtools-goBuild/blob/main/README.md)。

## URL 结构（goBuild 门户）

| 路径 | 说明 |
|------|------|
| `/` | 门户选择页 |
| `/webtools/` | 与线上一致的静态工具箱（原整站挂载于此） |
| `/local/` | 本地增强工具列表 |
| `/local/dns-probe/` | DNS 拨测（依赖 `/api/dns/*`） |
| `/webtools/sw.js` | 工具箱子站 Service Worker |
| `GET /api/health` | 健康检查 |
| `GET /api/capabilities` | 版本与能力协商 |
| `POST /api/dns/query` | DNS 单次查询 |
| `POST /api/dns/compare` | 双 DNS 对比 |

API 契约见 [webtools-goBuild docs/api-dns.md](https://github.com/cnzhanglu/webtools-goBuild/blob/main/docs/api-dns.md)。

## CLI 参数

```
webtools [flags]

  --host string     监听地址（默认 127.0.0.1）
  --port int        端口（默认 8080；被占用时自动尝试后续端口）
  --open            nogui：启动后打开系统默认浏览器
  --service         gui 构建：仅 HTTP，不打开内嵌窗口
  --version         打印版本并退出
```

可选 **webtools-gui** 构建提供内嵌 WebView 窗口，默认加载门户首页。

## 发布流程（维护者）

1. 合并 webtools 前端变更到 `main`
2. 在 **webtools-goBuild** 仓库同步静态资源并打 tag：`git tag v0.2.0 && git push origin v0.2.0`

## 与其他本地运行方式对比

| 方式 | 额外运行时 | 浏览器 | DNS API |
|------|------------|--------|---------|
| Release 二进制 | 无 | 需要 | 有 |
| `python3 -m http.server` | Python | 需要 | 无 |
| `file://` 双击 | 无 | 需要 | 无 |
| Cloudflare Pages | 无 | 需要 | 无 |
