# 本地服务（Go 单二进制）

工具箱除 `file://` 双击、Cloudflare Pages 在线访问外，提供 **Go 单二进制** 本地分发方式：下载即可运行，无需安装 Python 或 Node。

> Go 构建与发布已独立至仓库 **[webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild)**。本仓库（webtools）仅维护静态前端。

## 适用场景

- 内网/离线环境快速部署工具箱
- 不想配置 `python3 -m http.server` 或 `npx serve`
- 后续需要在本地增加 HTTP API 或后台任务（架构已预留）

## 获取与运行

### 方式一：GitHub Release（推荐）

1. 打开 [webtools-goBuild Releases](https://github.com/cnzhanglu/webtools-goBuild/releases)，下载对应平台文件，例如：
   - `webtools-1.0.0-linux-amd64`
   - `webtools-1.0.0-windows-amd64.exe`
   - `webtools-1.0.0-darwin-arm64`
2. 解压（如有），在终端或资源管理器中运行可执行文件
3. 浏览器访问 **http://127.0.0.1:8080**

### 方式二：自行编译

见 [webtools-goBuild README](https://github.com/cnzhanglu/webtools-goBuild/blob/main/README.md)。

本地联调示例（两个仓库相邻 checkout）：

```bash
cd webtools-goBuild
WEBTOOLS_SRC=../webtools bash scripts/build.sh webtools
./webtools
```

## CLI 参数

```
webtools [flags]

  --host string   监听地址（默认 127.0.0.1）
  --port int      端口（默认 8080）
  --open          启动后打开系统默认浏览器
  --version       打印版本并退出
```

示例：

```bash
# 仅本机
./webtools

# 局域网内其他设备可访问
./webtools --host 0.0.0.0 --port 9000

# 启动并打开浏览器
./webtools --open
```

## HTTP 接口

| 路径 | 说明 |
|------|------|
| `/`、`/tools/<id>/` | 静态页面（目录 URL 与 Cloudflare 一致） |
| `/sw.js` | Service Worker（本地 HTTP 下 PWA 可注册） |
| `GET /api/health` | 健康检查，返回 JSON 版本信息 |
| 其他 `/api/*` | 预留，当前返回 404 JSON |

## 与 PWA / 静态站的关系

| 运行方式 | Service Worker | 说明 |
|----------|----------------|------|
| `file://` 双击 | 不注册 | `pwa.js` 自动跳过 |
| Go 本地服务 | 可注册 | 与线上一致的 HTTP 环境 |
| Cloudflare Pages | 可注册 | 生产部署 |

静态资源在**编译时嵌入**二进制；更新工具页面需重新构建并发布新版本二进制（见 webtools-goBuild 仓库）。

## 架构预留：后台服务

Go 服务端扩展说明见 [webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild) 仓库的 `internal/service/` 与 `internal/api/`。

## 发布流程（维护者）

1. 合并 webtools 前端变更到 `main`
2. 在 **webtools-goBuild** 仓库打 tag：`git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions 从 webtools `main`（或指定 ref）同步静态资源，构建六平台产物并创建 Release

也可在 webtools-goBuild 的 Actions 页面手动运行 **Release** workflow 试构建。

## 依赖说明

| 组件 | 依赖 |
|------|------|
| `webtools` 可执行文件 | 无（静态链接 Go 二进制） |
| 使用工具界面 | 需要现代浏览器（Chrome / Edge / Firefox / Safari） |

## 与其他本地运行方式对比

| 方式 | 额外运行时 | 浏览器 |
|------|------------|--------|
| Release 二进制 | 无 | 需要 |
| `python3 -m http.server` | Python | 需要 |
| `file://` 双击 | 无 | 需要 |
