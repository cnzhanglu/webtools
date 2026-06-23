# 框架说明

本文档与 [`.cursor/rules/webtools-framework.mdc`](../.cursor/rules/webtools-framework.mdc) 保持一致，供人工查阅；Cursor Agent 会自动读取规则文件。

## 项目信息

| 项 | 值 |
|----|-----|
| 产品名 | 工具箱 |
| GitHub | https://github.com/cnzhanglu/webtools |
| 部署 | Cloudflare Pages（静态，无构建） |

## 核心原则

1. **纯静态、零依赖**：不引用任何外部 CDN 或网络框架
2. **本地 + 线上双兼容**：双击本地可用，Cloudflare 部署可用
3. **模块化可扩展**：共享资源在 `shared/`，各工具在 `tools/<id>/`
4. **数据不出浏览器**：所有处理在客户端完成

## 目录结构

见 [README.md](../README.md#目录结构)。

## 新增工具

1. 创建 `tools/<tool-id>/index.html` 及 JS/CSS
2. 在 `shared/js/tools-registry.js` 的 `publicTools` 或 `specialTools` 注册
3. 首页按“公共工具 / 定制工具”自动分区展示

## 脚本加载

使用普通 `<script src="...">` 按依赖顺序引入，不使用 ES Module，以确保 `file://` 协议下正常工作。

## 共享模块

- `BocUtils` — 工具函数（复制、下载、HTML 转义）
- `BocXlsx` — xlsx 导出
- `BocIpCidr` — IPv4/IPv6 地址、CIDR、范围解析与网段合并算法
- `BocToolRegistry` — 工具分组注册表（`publicTools` / `specialTools`）

## 代码注释规范

与 [`.cursor/rules/webtools-framework.mdc`](../.cursor/rules/webtools-framework.mdc) 中「代码注释规范」章节一致。要点：

- 所有 JS 用**中文**注释说明实现逻辑
- 每个文件头写清：职责、依赖、数据流（输入 → 处理 → 输出）
- 工具按 `process`（核心逻辑）与 `app`（UI 交互）分层注释
- 算法、正则、位运算等非显而易见处须说明意图
- 新增或修改代码时同步更新注释

## Git 分支与工作流

- **main**：生产主线，仅接收已验证的合并，不直接开发
- **dev**：唯一开发分支，所有功能修改、修复、新工具均先提交并推送到 dev

日常开发：

```bash
git checkout dev
git pull origin dev
# 开发、提交
git push origin dev
```

验证通过后发布到主线：

```bash
git checkout main
git pull origin main
git merge dev
git push origin main
git checkout dev
```

禁止在 main 上直接开发，禁止创建额外长期功能分支（统一使用 dev）。

## 单元测试与 CI

### 必须遵守

1. **所有工具与共享模块的核心逻辑须有单元测试**（放在 `tests/` 目录，Node.js 运行，无外部依赖）。
2. 新增工具或修改 `process.js` / `shared/js/` 算法时，**同步补充或更新**对应测试用例。
3. 在 `shared/js/tools-registry.js` 注册新工具后，须在 `sw.js` 的 `PRECACHE_URLS` 追加资源并递增 `CACHE_VERSION`。

### 本地执行

```bash
node tests/run-tests.js
python3 scripts/check-precache-registry.py
python3 scripts/check-compat.py --baseline chrome86,go-webview-linux
```

### CI

推送到 `dev` / `main` 或 PR 时，GitHub Actions（`compat-check.yml`）自动运行上述三项检查。

Go 本地服务构建已迁移至独立仓库 [webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild)，本仓库 CI 不包含 Go build。

## 浏览器 / WebView 兼容性

见 [browser-compat.md](browser-compat.md)。发布前执行：

```bash
python3 scripts/check-compat.py
```
