# 工具箱（webtools）

纯静态前端工具集（HTML + CSS + 原生 JS），所有数据在浏览器本地处理，不上传、不依赖外部 CDN。

## 项目目标

- 本地双击可用（`file://`）
- Cloudflare Pages 可部署、可离线缓存（PWA）
- 各工具独立目录，按需复用 `shared/` 公共模块

## 当前工具分组

首页按两组展示：

- **公共工具**：网络/编解码等通用能力
- **定制工具**：业务场景定制（当前为 `excel2json`）

> 分组数据在 `shared/js/tools-registry.js` 中维护。

## 目录结构

```
/
├── index.html
├── README.md
├── manifest.webmanifest
├── sw.js
├── shared/
│   ├── css/common.css
│   └── js/
│       ├── utils.js
│       ├── xlsx.js
│       ├── xlsx-read.js
│       ├── ipcidr.js
│       ├── pwa.js
│       └── tools-registry.js
└── tools/
    ├── net-policy/
    ├── subnet-calc/
    ├── cidr-vs/
    ├── net-summary/
    ├── bgp-as/
    ├── base64-tool/
    ├── punycode-tool/
    ├── url-codec/
    ├── gslb-json-export/
    ├── gslb-json-compare/
    ├── iptables-gen/
    ├── text-join/
    └── excel2json/
```

## 工具清单

| 工具 | 路径 | 简述 | 模块文档 |
|---|---|---|---|
| 网络策略聚合 | `tools/net-policy/` | IP/端口聚合、分组输出、xlsx 导出 | [tools/net-policy/README.md](tools/net-policy/README.md) |
| 子网掩码计算器 | `tools/subnet-calc/` | IPv4/IPv6 网络参数计算 | [tools/subnet-calc/README.md](tools/subnet-calc/README.md) |
| CIDR 网段对比 | `tools/cidr-vs/` | 检查 B 清单是否被 A 覆盖 | [tools/cidr-vs/README.md](tools/cidr-vs/README.md) |
| 网段汇总合并 | `tools/net-summary/` | 清单标准化与网段最小化汇总 | [tools/net-summary/README.md](tools/net-summary/README.md) |
| BGP AS 号转换 | `tools/bgp-as/` | ASPlain / ASDOT 互转 | [tools/bgp-as/README.md](tools/bgp-as/README.md) |
| Base64 编解码 | `tools/base64-tool/` | 文本/文件 Base64 编解码 | [tools/base64-tool/README.md](tools/base64-tool/README.md) |
| Punycode 域名编解码 | `tools/punycode-tool/` | Unicode 域名与 `xn--` 互转 | [tools/punycode-tool/README.md](tools/punycode-tool/README.md) |
| URL 编解码 | `tools/url-codec/` | 单行/批量 URL 编解码 + diff | [tools/url-codec/README.md](tools/url-codec/README.md) |
| GSLB JSON 导出 | `tools/gslb-json-export/` | 字段选择、预览过滤、关系图、CSV/TXT 导出 | [tools/gslb-json-export/README.md](tools/gslb-json-export/README.md) |
| GSLB 多文件对比 | `tools/gslb-json-compare/` | 多文件状态横向对比与 Excel 导出 | [tools/gslb-json-compare/README.md](tools/gslb-json-compare/README.md) |
| iptables 规则生成 | `tools/iptables-gen/` | 模板化规则生成、校验、导入导出 | [tools/iptables-gen/README.md](tools/iptables-gen/README.md) |
| 字符拼接工具 | `tools/text-join/` | 占位符模版批量拼接文本 | [tools/text-join/README.md](tools/text-join/README.md) |
| Excel 切换 JSON（定制） | `tools/excel2json/` | Excel 解析并生成切换/回切 JSON | [tools/excel2json/README.md](tools/excel2json/README.md) |

## 公共模块逻辑

### `shared/js/utils.js`
- 统一下载、复制、HTML 转义等基础能力。
- 各工具通过 `BocUtils.downloadBlob / copyText / escHtml` 复用。

### `shared/js/xlsx.js`
- 纯 JS 写 xlsx（无外部依赖）。
- 流程：`rows -> XML -> ZIP(STORED) -> Uint8Array`。

### `shared/js/xlsx-read.js`
- 纯 JS 读 xlsx（新增于 excel2json）。
- 流程：`ArrayBuffer -> ZIP 读取 -> inflate -> sharedStrings/sheet XML -> rows`。
- 支持 `mergeCells` 回填，保证 A 列合并单元格可继承值。

### `shared/js/ipcidr.js`
- IPv4/IPv6 解析、CIDR/范围转换、包含关系判断。
- `cidr-vs`、`net-summary` 等网络工具复用。

### `shared/js/tools-registry.js`
- 首页工具分组元数据（公共/定制）。
- `index.html` 按分组渲染卡片，不在首页手写工具条目。

## 本地运行

### 方式一：Go 单二进制（推荐，无需 Python/Node）

从 [webtools-goBuild Releases](https://github.com/cnzhanglu/webtools-goBuild/releases) 下载对应平台的 `webtools` 可执行文件，运行后访问 `http://127.0.0.1:8080`。

```bash
./webtools              # 默认 127.0.0.1:8080（端口占用时自动递增）
./webtools --open       # 启动并打开浏览器
./webtools --host 0.0.0.0 --port 9000   # 局域网可访问
```

Go 构建源码在独立仓库 [cnzhanglu/webtools-goBuild](https://github.com/cnzhanglu/webtools-goBuild)。详见 [docs/local-server.md](docs/local-server.md)。

### 方式二：简易 HTTP 服务

```bash
python3 -m http.server 8080
# 或
npx serve .
```

访问 `http://localhost:8080`。

### 方式三：本地双击

直接打开根目录 `index.html`（`file://` 协议，PWA 不启用）。

## 开发约定

- 仅使用原生脚本加载（不使用 ES Module）
- 禁止外部 CDN
- 新增工具时：
  1. 创建 `tools/<id>/`
  2. 在 `shared/js/tools-registry.js` 注册
  3. 在 `sw.js` 增加预缓存并递增 `CACHE_VERSION`
  4. 为该工具补充 `tools/<id>/README.md`
- **发布前**运行检查：

```bash
node tests/run-tests.js
python3 scripts/check-precache-registry.py
python3 scripts/check-compat.py
```

## 分支

- `dev`：开发分支
- `main`：主线分支

