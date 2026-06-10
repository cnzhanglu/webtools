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
  // 后续新工具在此追加，例如：
  // {
  //   id: 'subnet-calc',
  //   name: '子网计算器',
  //   description: '...',
  //   tags: ['网络'],
  //   path: 'tools/subnet-calc/index.html',
  //   status: 'ready',
  // },
];
