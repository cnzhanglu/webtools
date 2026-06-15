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
2. 在 `shared/js/tools-registry.js` 注册
3. 首页自动展示

## 脚本加载

使用普通 `<script src="...">` 按依赖顺序引入，不使用 ES Module，以确保 `file://` 协议下正常工作。

## 共享模块

- `BocUtils` — 工具函数（复制、下载、HTML 转义）
- `BocXlsx` — xlsx 导出
- `BocIpCidr` — IPv4/IPv6 地址、CIDR、范围解析与网段合并算法
- `BocToolRegistry` — 工具列表数组

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
