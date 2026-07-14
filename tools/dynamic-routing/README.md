# 动态路由工具（dynamic-routing）

## 功能

- **BGP AS 号转换**：ASPlain（十进制）↔ ASDOT（X.Y）互转，支持 2/4 字节 AS，批量处理并标注号段用途范围
- **OSPF Area ID 转换**：纯整数（0~4294967295）↔ 点分十进制（w.x.y.z）互转，骨干区域自动标注

## 模块逻辑

1. `js/process.js`：核心转换逻辑（BGP + OSPF），无 UI 依赖，可单独测试
   - `convertBgpLines(raw, mode)` — 批量转换 AS 号
   - `convertOspfLines(raw)` — 批量转换 Area ID
2. `js/app.js`：Tab 切换、事件绑定、渲染、复制
3. `css/tool.css`：工具专属样式（Tab 栏、设置栏、结果表）

## OSPF Area ID 换算规则

与 IPv4 地址 ↔ 整数转换完全一致：

- 点分 → 整数：`N = w×16777216 + x×65536 + y×256 + z`
- 整数 → 点分：`w = N//16777216, x = (N//65536)%256, y = (N//256)%256, z = N%256`

示例：`0.0.0.1` ↔ `1`；`0.0.1.0` ↔ `256`；`192.168.1.0` ↔ `3232235776`
