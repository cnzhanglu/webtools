# 浏览器与本地运行环境兼容性

本文说明工具箱的目标运行环境、[webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild) 本地 HTTP 服务注意点，以及发布前兼容性检查方式。

## 目标环境

| 环境 | 内核 | 功能 | 界面 |
|------|------|------|------|
| Chrome 86+ | Chromium | ✅ | ✅（`accent-color` 为系统默认色） |
| Chrome 80–85 | Chromium | ✅ | ⚠️ Flex `gap` 无效，间距偏挤 |
| webtools-goBuild · Windows | WebView2（Chromium evergreen） | ✅ | 同 Chrome 90+ |
| webtools-goBuild · macOS | WKWebView（系统 WebKit） | ✅ 建议 macOS 11+ | ⚠️ 旧系统无 Flex gap |
| webtools-goBuild · Linux | WebKitGTK 2.32+ | ✅ | ⚠️ 2.30 以下无 Flex gap / BigInt |
| `file://` 本地双击 | 各桌面浏览器 | ✅ | 同对应内核 |
| Cloudflare Pages + PWA | 现代 Chromium | ✅ | ✅ |

## webtools-goBuild 本地服务与 WebView

[webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild) 将静态站点嵌入 Go 二进制，通过本地 HTTP 提供页面（默认 `http://127.0.0.1:8080`），行为与 Cloudflare Pages 的 HTTP 环境一致，可注册 PWA。

若将页面嵌入第三方 Go WebView 壳（[Wails](https://wails.io)、[webview](https://github.com/webview/webview) 等），引擎仍依赖系统 WebView：

| 平台 | 引擎 | 版本特点 |
|------|------|----------|
| Windows | Microsoft Edge **WebView2** | 默认 Evergreen，随系统更新，通常等价于较新 Chromium（≥ 90） |
| macOS | **WKWebView** / WebKit | 与 macOS / Safari 版本绑定 |
| Linux | **WebKitGTK** 4.0/4.1 | 随发行版，Ubuntu 20.04≈2.30，22.04≈2.36+ |

### 与本项目的契合点

1. **纯静态 + 相对路径**：适合 `file://` 或通过 Go 内置 HTTP / AssetServer 提供页面。
2. **无外部 CDN**：离线 WebView 无需外网。
3. **`pwa.js` 在 `file://` 跳过 SW 注册**：避免 WebView 自定义协议下 SW 失败。
4. **剪贴板有 `execCommand` 降级**：部分 WebView 限制 Clipboard API 时仍可用。
5. **BigInt**：网络工具核心依赖；需 WebKitGTK ≥ 2.32（2020 年中）或 Chromium 67+。

### Go WebView 特有风险

| 话题 | 说明 | 本项目现状 |
|------|------|------------|
| 自定义协议 `wails://` | Service Worker **仅支持 `http(s):`**，自定义 scheme 无法注册 SW | `pwa.js` 已跳过非 HTTP；嵌入时离线靠本地资源，不依赖 SW |
| `file://` 子资源 | 部分壳禁止 `file://` 互访或禁止加载本地图片 | 工具箱资源均为相对路径同目录加载，无跨盘 `file://` 图片 |
| PWA 安装 | WebView 内通常不提供「安装应用」 | 可忽略 |
| `localStorage` | 一般可用；SW 内不可同步访问 | 仅页面脚本使用，无问题 |
| Windows 固定版 WebView2 | 企业可锁定旧 Chromium | 若锁定过旧，按对应 Chromium 版本对照上表 |

**结论**：在 **Windows WebView2（Evergreen）** 与 **macOS 11+ / Ubuntu 20.04+ WebKitGTK** 上，工具箱**功能可完整运行**；最老环境的主要差异仍是 **Flex `gap` 布局** 与 **`accent-color` 装饰**，与桌面 Chrome 80 类似。

## 发布前检查

### 内置脚本（推荐，零依赖）

```bash
# 默认：chrome86 + go-webview-linux，仅 error 阻断
python3 scripts/check-compat.py

# 对照 Chrome 80 全量警告
python3 scripts/check-compat.py --baseline chrome80 --fail-on warn

# 列出所有基线
python3 scripts/check-compat.py --list-baselines
```

检查项包括：

- JS：可选链、`??`、ES Module、`export` 等破坏性语法
- CSS：Flex `gap`、`accent-color`、`:has()` 等
- 策略：外部 CDN、`type="module"`
- 提示：BigInt 硬性依赖（旧 WebKitGTK）

### 可选外部工具（需 Node 生态）

若团队已使用 npm，可叠加：

| 工具 | 用途 |
|------|------|
| [eslint-plugin-compat](https://github.com/amilajack/eslint-plugin-compat) + [Browserslist](https://github.com/browserslist/browserslist) | JS API 兼容性 |
| [stylelint-no-unsupported-browser-features](https://github.com/RJWadley/stylelint-no-unsupported-browser-features) | CSS 特性 |
| [es-check](https://github.com/yowainwright/es-check) | 校验产物 ES 版本 |
| [caniuse-lite](https://www.npmjs.com/package/caniuse-lite) | 查特性支持表 |

本仓库为**无构建纯静态**项目，内置 `scripts/check-compat.py` 即可覆盖日常发布门禁，无需引入打包链。

## 合并与发布建议

1. 在 `dev` 开发完成后运行 `python3 scripts/check-compat.py`。
2. 合并 `main` / 部署 Cloudflare 前再次执行（CI 已配置则自动运行）。
3. 若需支持 Chrome 80 或旧 WebKitGTK 的**完美布局**，需将 Flex `gap` 改为 margin 方案（当前为已知视觉降级，非功能缺陷）。
