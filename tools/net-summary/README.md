# 网段汇总合并（net-summary）

## 功能
- 输入 IP/CIDR/范围清单并标准化
- 三种汇总模式：
  - **严格**：仅合并等长、对齐、连续的兄弟 CIDR
  - **宽松**：区间并集后精确拆分为最小 CIDR 集
  - **压缩**：允许超集覆盖，优先用大块对齐网段（IPv4 最细 /25、IPv6 最细 /64）提高压缩率
- 生成来源映射、报告与 xlsx 导出

## 压缩模式示例
- 输入 `10.0.0.1-10.0.0.100` → 输出 `10.0.0.0/25`（含少量额外地址）
- 输入 `2001:db8::1-2001:db8::ffff` → 按 /64 对齐大块覆盖

## 模块逻辑
1. `app.js/doSummarize` 获取原始文本与模式
2. `process.js/parseList` 解析条目
3. `process.js/summarize` 聚合并生成映射统计
4. `BocIpCidr.mergeCompress` 执行压缩模式算法
5. `app.js/renderReport/renderTable` 展示
6. `app.js/exportXlsx` 导出
