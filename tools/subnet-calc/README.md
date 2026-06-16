# 子网掩码计算器（subnet-calc）

## 功能
- IPv4/IPv6 网络地址、广播地址（IPv4）、主机范围、可用主机数计算
- 支持 CIDR、点分掩码、滑块联动

## 模块逻辑
1. `app.js/doCalc` 收集输入与前缀
2. `ip.js/parseNetworkInput` 解析地址族与前缀
3. `calc.js/calc` 计算网络参数与统计
4. `app.js/renderResults` 渲染结果，`copyResults` 支持复制

