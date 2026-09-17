# GSLB JSON 导出（gslb-json-export）

## 功能
- 导入 GSLB JSON，按域名/地址池/成员字段自由导出
- 支持方案记忆、预览过滤、关系图可视化
- 支持 CSV 导出、域名聚合列表 CSV/TXT 导出
- 支持导出未被域名引用的地址池、未被地址池引用的服务成员
- 支持按搜索过滤结果生成 `create gslb ...` CLI 创建命令（datacenter / service-member / pool / pool-member / rrs），可复制或下载 TXT
- 支持当前域名的 RRS 成员启停命令，可在当前类型与 A+AAAA 联合范围之间切换

## 模块逻辑
1. `app.js/onFileSelected` 读取 JSON
2. `process.js/collectAvailableFields` 扫描可用字段
3. `transfer.js/TransferGroup` 管理字段穿梭与排序
4. `process.js/buildAddRows` 生成明细数据
5. `graph.js/buildTopology + render` 构建并渲染关系图
6. `process.js/buildCsvContent/buildDomainListRows` 导出数据
7. `process.js/buildOrphanGpoolRows/buildOrphanGmemberRows` 导出孤儿资源
8. `commands.js/buildCommandsForDomains` 按过滤域名收集资源并生成创建命令
9. `commands.js/collectRrsMembersForScope/buildRrsMemberCommandsForScope` 按当前类型或同名 A+AAAA 收集成员、统一匹配 IP 并生成启停命令；原单记录入口及返回结构保持兼容

## 生成创建命令操作步骤
1. 导入 JSON → 点击「预览」
2. （可选）在搜索框过滤，缩小域名范围
3. 点击「⚙ 生成创建命令」
4. 弹窗展示命令文本；若算法映射有异常则顶部显示黄色警告条
5. 点击「复制全部」或「下载 TXT」保存命令

## RRS 成员启停操作步骤
1. 导入 JSON → 点击「预览」→ 单击一行选中域名 → 点击「成员启停命令」
2. 每次打开默认「当前类型」；选择「A+AAAA 联合」可同时列出同名记录的两组成员，每组显示类型、zone、IP、DC、VS 及当前启停状态
3. 勾选成员或手工混合输入 IPv4/IPv6，选择 enable / disable，点击「生成命令」后复制；联合输出先 A 后 AAAA，各自使用真实 zone（数组形态 ADD 沿用 `@`）
4. 成员来自完整 JSON，不受主表过滤影响；缺少 A 或 AAAA 时提示并继续处理已有记录
5. 切换范围会清空勾选、手工输入和旧命令；修改勾选、IP 或目标状态后也须重新生成才能复制。重新打开弹窗回到当前类型

勾选与手工 IP 取并集；同 IP 的多个 DC/VS 均会命中。命令按 zone、域名、类型和成员 ID 去重，同记录内跨池重复成员只输出一次。联合模式不自动配对 IPv4/IPv6，设备仍逐条执行命令，沿用原来的 `force` 参数。
