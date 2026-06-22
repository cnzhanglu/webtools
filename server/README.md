# 工具箱本地服务（Go）

将仓库根目录静态站点嵌入单二进制，本地启动 HTTP 服务，无需 Python/Node。

## 用户运行（Release）

从 [GitHub Releases](https://github.com/cnzhanglu/webtools/releases) 下载对应平台文件，解压后执行：

```bash
# Linux / macOS
./webtools

# Windows
webtools.exe
```

浏览器访问 `http://127.0.0.1:8080`。常用参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `--host` | `127.0.0.1` | 监听地址；局域网共享可设为 `0.0.0.0` |
| `--port` | `8080` | 监听端口 |
| `--open` | 关闭 | 启动后打开系统默认浏览器 |
| `--version` | — | 打印版本 |

健康检查：`GET /api/health` → `{"status":"ok","version":"..."}`

## 开发者构建

需要 **Go 1.22+**。

```bash
cd server
bash scripts/build.sh webtools
./webtools
```

`build.sh` 会先执行 `sync-static.sh`，将仓库根静态文件同步到 `internal/static/site/` 再编译。

### 手动步骤

```bash
bash server/scripts/sync-static.sh
cd server
CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.1.0" -o webtools ./cmd/webtools
```

### 交叉编译示例

```bash
bash server/scripts/sync-static.sh
cd server
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -ldflags "-s -w -X main.version=0.1.0" -o webtools.exe ./cmd/webtools
```

## 目录说明

| 路径 | 职责 |
|------|------|
| `cmd/webtools/` | CLI 入口 |
| `internal/app/` | HTTP 服务、静态托管、优雅退出 |
| `internal/api/` | `/api/*` 路由（现仅 health） |
| `internal/service/` | 后台 Service 注册表（预留） |
| `internal/static/` | `go:embed` 静态资源 |
| `scripts/` | 同步与构建脚本 |

## 发布

推送 tag `server-v*`（如 `server-v0.1.0`）触发 [`.github/workflows/release-server.yml`](../.github/workflows/release-server.yml)，自动构建六平台二进制并创建 GitHub Release。

也可在 Actions 中手动 **workflow_dispatch** 试构建。

## 扩展后台服务

1. 在 `internal/service/` 实现 `BackgroundService` 接口
2. 在 `cmd/webtools/main.go` 中 `registry.Register(yourService)`
3. 在 `internal/api/` 增加 HTTP 路由

详见 [`docs/local-server.md`](../docs/local-server.md)。
