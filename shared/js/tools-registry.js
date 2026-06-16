/**
 * 工具箱注册表（分组）
 * - publicTools: 公共工具
 * - specialTools: 专用工具
 */
var BocToolRegistry = {
  publicTools: [
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
      id: 'cidr-vs',
      name: 'CIDR 网段对比',
      description: '对比两份 IP/CIDR 清单（IPv4/IPv6），判断 B 清单网段是否被 A 清单覆盖，支持粘贴或文件加载、可视化结果与 xlsx 导出。',
      tags: ['网络', 'IPv4', 'IPv6', 'CIDR'],
      path: 'tools/cidr-vs/index.html',
      status: 'ready',
    },
    {
      id: 'net-summary',
      name: '网段汇总合并',
      description: '输入 IP/CIDR/范围（IPv4/IPv6），按严格或宽松模式精确合并为最小网段集，提供汇总报告、来源映射与 xlsx 导出。',
      tags: ['网络', 'IPv4', 'IPv6', 'CIDR'],
      path: 'tools/net-summary/index.html',
      status: 'ready',
    },
    {
      id: 'bgp-as',
      name: 'BGP AS 号转换',
      description: '将 BGP AS 号在十进制与带点格式（ASDOT / ASDOT+）之间互转，支持 2 字节与 4 字节 AS，批量处理并标注 AS 号用途范围。',
      tags: ['网络', 'BGP', 'AS'],
      path: 'tools/bgp-as/index.html',
      status: 'ready',
    },
    {
      id: 'base64-tool',
      name: 'Base64 编解码',
      description: '文本与文件 Base64 编解码，支持 5 MB 以上大文件；编码结果可下载为 .txt，Base64 内容可还原为任意格式文件。',
      tags: ['编解码', 'Base64'],
      path: 'tools/base64-tool/index.html',
      status: 'ready',
    },
    {
      id: 'punycode-tool',
      name: 'Punycode 域名编解码',
      description: '国际化域名（IDN）在 Unicode（中文/多语言）与 ACE（xn-- 格式）之间互转，符合 RFC 3492，支持批量与自动方向识别。',
      tags: ['域名', 'Punycode', 'IDN'],
      path: 'tools/punycode-tool/index.html',
      status: 'ready',
    },
    {
      id: 'url-codec',
      name: 'URL 编解码',
      description: '支持 encodeURIComponent / encodeURI / 表单编码三种模式，提供单行和批量编解码，并高亮显示编解码前后差异。',
      tags: ['编解码', 'URL'],
      path: 'tools/url-codec/index.html',
      status: 'ready',
    }
  ],
  specialTools: [
    {
      id: 'gslb-json-export',
      name: 'GSLB JSON 导出',
      description: '解析 GSLB 配置 JSON（域名、地址池、成员），按方案选择字段并排序，全量预览与过滤，点击域名查看引用关系图，导出带中文表头的 CSV（UTF-8 BOM）。',
      tags: ['GSLB', 'JSON', 'CSV', '关系图'],
      path: 'tools/gslb-json-export/index.html',
      status: 'ready',
    },
    {
      id: 'excel2json',
      name: 'Excel 切换 JSON',
      description: '上传域名/IP 切换 Excel，校验 D/E/F/G 列，按应用名生成切换与回切 JSON，支持动态/静态两种类型，全部在本地浏览器完成。',
      tags: ['GSLB', 'Excel', 'JSON', '切换'],
      path: 'tools/excel2json/index.html',
      status: 'ready',
    },
    {
      id: 'gslb-json-compare',
      name: 'GSLB 多文件对比',
      description: '上传多个 GSLB JSON，按“域名名称+域名类型+所属数据中心+成员名称+成员IP”横向对比状态，支持可选对比列、过滤预览与 Excel 导出。',
      tags: ['GSLB', 'JSON', '对比', 'Excel'],
      path: 'tools/gslb-json-compare/index.html',
      status: 'ready',
    },
    {
      id: 'iptables-gen',
      name: 'iptables 规则生成',
      description: '固定前缀策略 + 白名单（DNS/集群内部/SNMP/mgmt）+ 结尾拒绝，三段式生成 iptables/ip6tables 规则字符串；IPv4/IPv6 分离，支持合法性校验、现有规则导入识别、可编辑模板与单文件多设备本地存储。',
      tags: ['安全', 'iptables', '防火墙'],
      path: 'tools/iptables-gen/index.html',
      status: 'ready',
    }
  ]
};
