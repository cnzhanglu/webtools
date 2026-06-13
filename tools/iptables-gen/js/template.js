/**
 * iptables / ip6tables 规则模板（无外部依赖）
 *
 * 规则以「不含命令名」的片段存储（即 `-A INPUT ...`），生成时再按地址族
 * 加上 `iptables ` 或 `ip6tables ` 前缀。
 *
 * 白名单定义（whitelistDefs）使用占位符：
 *   {src}  —— 有 IP 时替换为 ` -s <ip>`，留空时替换为 ``（对所有源开放）。
 *
 * 导出：IptablesTemplate
 */
var IptablesTemplate = (function () {
  'use strict';

  /** 模板版本：修改默认模板内容后递增，便于旧文件升级提示 */
  var TEMPLATE_VERSION = 1;
  /** 数据结构版本 */
  var SCHEMA_VERSION = 1;

  /** iptables multiport 模块单条最多端口数 */
  var MULTIPORT_MAX = 15;
  /** --comment 注释最大长度 */
  var COMMENT_MAX = 256;

  var WHITELIST_IDS = ['dns', 'internal', 'snmp', 'mgmt'];

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function genId(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** 公共白名单定义（v4 / v6 文本一致，命令名在生成时区分） */
  function defaultWhitelistDefs() {
    return [
      {
        id: 'dns',
        name: 'DNS 白名单',
        lines: [
          '-A INPUT{src} -p udp --dport 53 -j ACCEPT -m comment --comment "DNS UDP whitelist"',
          '-A INPUT{src} -p tcp --dport 53 -j ACCEPT -m comment --comment "DNS TCP whitelist"'
        ]
      },
      {
        id: 'internal',
        name: '集群内部白名单',
        lines: [
          '-A INPUT{src} -j ACCEPT -m comment --comment "Cluster internal whitelist"'
        ]
      },
      {
        id: 'snmp',
        name: 'SNMP 白名单',
        lines: [
          '-A INPUT{src} -p udp --dport 161 -j ACCEPT -m comment --comment "SNMP whitelist"'
        ]
      },
      {
        id: 'mgmt',
        name: 'mgmt 白名单',
        lines: [
          '-A INPUT{src} -p tcp -m multiport --dport 22,443,20120 -j ACCEPT -m comment --comment "Mgmt whitelist"'
        ]
      }
    ];
  }

  /** 公共固定前缀策略（v4 / v6 文本一致） */
  function defaultPrefixRules() {
    return [
      { id: 'p_lo', enabled: true, text: '-A INPUT -i lo -j ACCEPT -m comment --comment "localhost"' },
      { id: 'p_dns_resp_udp', enabled: true, text: '-A INPUT -p udp --sport 53 -j ACCEPT -m comment --comment "Forwarding the response."' },
      { id: 'p_dns_resp_tcp', enabled: true, text: '-A INPUT -p tcp --sport 53 -j ACCEPT -m comment --comment "Forwarding the response."' },
      { id: 'p_ospf', enabled: true, text: '-A INPUT -p ospf -j ACCEPT -m comment --comment "OSPF protocol"' },
      { id: 'p_bgp', enabled: true, text: '-A INPUT -p tcp --dport 179 -j ACCEPT -m comment --comment "BGP protocol"' }
    ];
  }

  /** IPv4 默认模板 */
  function defaultV4() {
    return {
      prefixRules: defaultPrefixRules(),
      whitelistDefs: defaultWhitelistDefs(),
      suffixRules: [
        { id: 's_icmp13', enabled: true, text: '-A INPUT -p icmp -m icmp --icmp-type 13 -j DROP -m comment --comment "Time-based attacks"' },
        { id: 's_icmp14', enabled: true, text: '-A INPUT -p icmp -m icmp --icmp-type 14 -j DROP -m comment --comment "Time-based attacks"' },
        { id: 's_tcp_drop', enabled: true, text: '-A INPUT -p tcp -m multiport --dport 20120,22,53,4100,4573,4578,4579,4582,4583,4584,4585,5435,5450,8056,8826 -j DROP -m comment --comment "DROP TCP all"' },
        { id: 's_udp_drop', enabled: true, text: '-A INPUT -p udp -m multiport --dport 53,161 -j DROP -m comment --comment "DROP UDP ports"' }
      ]
    };
  }

  /**
   * IPv6 默认模板（由 IPv4 翻译）。
   * ICMP type 13/14（timestamp）在 ICMPv6 无对应类型，默认省略这两条 DROP；
   * 如需可在模板编辑器中自行添加 `-p ipv6-icmp` 规则。
   */
  function defaultV6() {
    return {
      prefixRules: defaultPrefixRules(),
      whitelistDefs: defaultWhitelistDefs(),
      suffixRules: [
        { id: 's_tcp_drop', enabled: true, text: '-A INPUT -p tcp -m multiport --dport 20120,22,53,4100,4573,4578,4579,4582,4583,4584,4585,5435,5450,8056,8826 -j DROP -m comment --comment "DROP TCP all"' },
        { id: 's_udp_drop', enabled: true, text: '-A INPUT -p udp -m multiport --dport 53,161 -j DROP -m comment --comment "DROP UDP ports"' }
      ]
    };
  }

  function defaultTemplate(stack) {
    return stack === 'v6' ? defaultV6() : defaultV4();
  }

  function defaultTemplates() {
    return { v4: defaultV4(), v6: defaultV6() };
  }

  function cmdName(stack) {
    return stack === 'v6' ? 'ip6tables' : 'iptables';
  }

  function familyOf(stack) {
    return stack === 'v6' ? 6 : 4;
  }

  return {
    TEMPLATE_VERSION: TEMPLATE_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MULTIPORT_MAX: MULTIPORT_MAX,
    COMMENT_MAX: COMMENT_MAX,
    WHITELIST_IDS: WHITELIST_IDS,
    clone: clone,
    genId: genId,
    defaultTemplate: defaultTemplate,
    defaultTemplates: defaultTemplates,
    defaultPrefixRules: defaultPrefixRules,
    defaultWhitelistDefs: defaultWhitelistDefs,
    cmdName: cmdName,
    familyOf: familyOf
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IptablesTemplate;
}
