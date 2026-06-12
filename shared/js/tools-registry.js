/**
 * 工具箱注册表 — 新增工具时在此追加条目即可
 */
var BocToolRegistry = [
  {
    id: 'net-policy',
    name: '网络策略聚合',
    description: '输入 IP 端口数据，自动聚合 IPv4/IPv6 网段，按端口分组或压缩为一行，支持 xlsx 导出。所有计算在本地浏览器完成。',
    tags: ['网络', 'IPv4', 'IPv6'],
    path: 'tools/net-policy/index.html',
    status: 'ready',
  },
  {
    id: 'subnet-calc',
    name: '子网掩码计算器',
    description: '输入 IPv4/IPv6 地址与掩码，自动计算网络地址、广播地址、可用主机数、首尾主机地址等，支持 CIDR、点分掩码与滑动调节前缀。',
    tags: ['网络', 'IPv4', 'IPv6'],
    path: 'tools/subnet-calc/index.html',
    status: 'ready',
  },
  {
    id: 'gslb-json-export',
    name: 'GSLB JSON 导出',
    description: '解析 GSLB 配置 JSON（域名、地址池、成员），按运维巡检/排障分析/全量导出方案选择字段并排序，预览后导出带中文表头的 CSV（UTF-8 BOM）。',
    tags: ['GSLB', 'JSON', 'CSV'],
    path: 'tools/gslb-json-export/index.html',
    status: 'ready',
  },
];
