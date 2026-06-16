# 网络策略聚合（net-policy）

## 功能
- 解析 IP/CIDR/端口输入（IPv4/IPv6 混合）
- 按端口分组聚合网段（IPv4 默认 /24，IPv6 默认 /64，可配置）
- 支持单行压缩输出、每条最大地址数切分、xlsx 导出

## 模块逻辑
1. `app.js/doProcess` 读取输入与选项
2. `process.js/parseInput` 解析为 `{cidr, port}` 列表
3. `ip.js/parseCIDR + aggregateCIDR` 做前缀归并
4. `process.js/process` 生成文本结果与导出行
5. `app.js/exportXlsx` 调用 `BocXlsx.generate` 导出

