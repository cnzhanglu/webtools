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
- `BocToolRegistry` — 工具列表数组
