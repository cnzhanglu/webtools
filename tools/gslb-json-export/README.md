# GSLB JSON 导出（gslb-json-export）

## 功能
- 导入 GSLB JSON，按域名/地址池/成员字段自由导出
- 支持方案记忆、预览过滤、关系图可视化
- 支持 CSV 导出、域名聚合列表 CSV/TXT 导出

## 模块逻辑
1. `app.js/onFileSelected` 读取 JSON
2. `process.js/collectAvailableFields` 扫描可用字段
3. `transfer.js/TransferGroup` 管理字段穿梭与排序
4. `process.js/buildAddRows` 生成明细数据
5. `graph.js/buildTopology + render` 构建并渲染关系图
6. `process.js/buildCsvContent/buildDomainListRows` 导出数据

