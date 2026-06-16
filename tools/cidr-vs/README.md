# CIDR 网段对比（cidr-vs）

## 功能
- 对比 A/B 两份网段清单
- 判断 B 的每条是否被 A 覆盖
- 支持错误提示、结果复制与 xlsx 导出

## 模块逻辑
1. `app.js/doCompare` 读取 A/B 输入
2. `process.js/parseList` 解析文本为 CIDR/范围
3. `process.js/compare` 调用 `BocIpCidr.subnetContains` 判定覆盖
4. `app.js/renderTable/renderStats` 展示
5. `app.js/exportXlsx` 导出

