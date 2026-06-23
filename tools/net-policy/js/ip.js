/**
 * 网络策略工具 — IP/CIDR 解析与聚合
 *
 * 基于共享库 BocIpCidr 解析与格式化，本模块仅保留工具所需的
 * 聚合前缀归并与 CIDR 字符串比较。
 *
 * 导出：NetPolicyIp
 */
var NetPolicyIp = (function () {
  'use strict';

  /** 解析单 IP 或 CIDR（不支持范围），失败返回 null */
  function parseCIDR(str) {
    str = String(str || '').trim();
    if (!str) return null;
    if (str.indexOf('-') !== -1) return null;

    try {
      var entry = BocIpCidr.parseEntry(str);
      if (entry.kind === 'range') return null;
      var bits = BocIpCidr.bitsOf(entry.family);
      var prefix = entry.prefix !== null && entry.prefix !== undefined ? entry.prefix : bits;
      var base = BocIpCidr.makeMask(prefix, bits) & entry.start;
      return { base: base, prefix: prefix, family: entry.family };
    } catch (e) {
      return null;
    }
  }

  /** 将 CIDR 向下聚合到 aggPrefix（掩码变短、网段变大） */
  function aggregateCIDR(cidr, aggPrefixV4, aggPrefixV6) {
    var aggPrefix = cidr.family === 4 ? aggPrefixV4 : aggPrefixV6;
    var maxBits = BocIpCidr.bitsOf(cidr.family);
    if (cidr.prefix <= aggPrefix) {
      return BocIpCidr.formatCidr(cidr.base, cidr.prefix, cidr.family);
    }
    var newBase = BocIpCidr.makeMask(aggPrefix, maxBits) & cidr.base;
    return BocIpCidr.formatCidr(newBase, aggPrefix, cidr.family);
  }

  function compareCIDRStr(a, b) {
    var ca = parseCIDR(a);
    var cb = parseCIDR(b);
    if (!ca || !cb) return a.localeCompare(b);
    if (ca.family !== cb.family) return ca.family - cb.family;
    if (ca.base < cb.base) return -1;
    if (ca.base > cb.base) return 1;
    return ca.prefix - cb.prefix;
  }

  function formatCIDR(cidr) {
    return BocIpCidr.formatCidr(cidr.base, cidr.prefix, cidr.family);
  }

  return {
    parseCIDR: parseCIDR,
    aggregateCIDR: aggregateCIDR,
    compareCIDRStr: compareCIDRStr,
    formatCIDR: formatCIDR,
  };
})();
