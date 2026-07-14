# GSLB JSON 导出（gslb-json-export）

## 功能
- 导入 GSLB JSON，按域名/地址池/成员字段自由导出
- 支持方案记忆、预览过滤、关系图可视化
- 支持 CSV 导出、域名聚合列表 CSV/TXT 导出
- 支持导出未被域名引用的地址池、未被地址池引用的服务成员
- 支持按搜索过滤结果生成 `create gslb ...` CLI 创建命令（datacenter / service-member / pool / pool-member / rrs），可复制或下载 TXT

## 模块逻辑
1. `app.js/onFileSelected` 读取 JSON
2. `process.js/collectAvailableFields` 扫描可用字段
3. `transfer.js/TransferGroup` 管理字段穿梭与排序
4. `process.js/buildAddRows` 生成明细数据
5. `graph.js/buildTopology + render` 构建并渲染关系图
6. `process.js/buildCsvContent/buildDomainListRows` 导出数据
7. `process.js/buildOrphanGpoolRows/buildOrphanGmemberRows` 导出孤儿资源
8. `commands.js/buildCommandsForDomains` 按过滤域名收集资源并生成创建命令

## 生成创建命令操作步骤
1. 导入 JSON → 点击「预览」
2. （可选）在搜索框过滤，缩小域名范围
3. 点击「⚙ 生成创建命令」
4. 弹窗展示命令文本；若算法映射有异常则顶部显示黄色警告条
5. 点击「复制全部」或「下载 TXT」保存命令

