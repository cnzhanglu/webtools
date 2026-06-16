# 网段汇总合并（net-summary）

## 功能
- 输入 IP/CIDR/范围清单并标准化
- 严格/宽松模式汇总为最小网段集
- 生成来源映射、报告与 xlsx 导出

## 模块逻辑
1. `app.js/doSummarize` 获取原始文本与模式
2. `process.js/parseList` 解析条目
3. `process.js/summarize` 聚合并生成映射统计
4. `app.js/renderReport/renderTable` 展示
5. `app.js/exportXlsx` 导出

