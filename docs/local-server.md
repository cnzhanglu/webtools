# 本地服务（Go 单二进制）

工具箱除 `file://` 双击、Cloudflare Pages 在线访问外，提供 **Go 单二进制** 本地分发方式：下载即可运行，无需安装 Python 或 Node。

> Go 构建与发布已独立至仓库 **[webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild)**。本仓库（webtools）仅维护静态前端。

## 适用场景

- 内网/离线环境快速部署工具箱
- 不想配置 `python3 -m http.server` 或 `npx serve`

## 获取与运行

### 方式一：GitHub Release（推荐）

1. 打开 [webtools-goBuild Releases](https://github.com/cnzhanglu/webtools-goBuild/releases)，下载对应平台文件
2. 解压后运行可执行文件
3. 浏览器访问 **http://127.0.0.1:8080**

### 方式二：自行编译

见 [webtools-goBuild README](https://github.com/cnzhanglu/webtools-goBuild/blob/main/README.md)。

## CLI 参数

```
webtools [flags]

  --host string   监听地址（默认 127.0.0.1）
  --port int      端口（默认 8080；被占用时自动尝试后续端口）
  --open          启动后打开系统默认浏览器
  --version       打印版本并退出
```

## HTTP 接口

| 路径 | 说明 |
|------|------|
| `/`、`/tools/<id>/` | 静态页面 |
| `/sw.js` | Service Worker |
| `GET /api/health` | 健康检查 |

## 发布流程（维护者）

1. 合并 webtools 前端变更到 `main`
2. 在 **webtools-goBuild** 仓库打 tag：`git tag v0.1.0 && git push origin v0.1.0`

## 与其他本地运行方式对比

| 方式 | 额外运行时 | 浏览器 |
|------|------------|--------|
| Release 二进制 | 无 | 需要 |
| `python3 -m http.server` | Python | 需要 |
| `file://` 双击 | 无 | 需要 |
