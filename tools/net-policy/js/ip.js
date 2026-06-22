/**
 * 网络策略工具 — IP/CIDR 解析与聚合（本工具专用，比 BocIpCidr 更轻量）
 *
 * 职责：将 IP 字符串解析为 { base, prefix, family }，并按用户指定的
 * 聚合前缀（IPv4 默认 /24、IPv6 默认 /64）向下取整网段。
 * 地址内部用 BigInt（v6）或 32 位整数（v4）表示，便于掩码运算。
 *
 * 导出：NetPolicyIp
 */
var NetPolicyIp = (function () {
  'use strict';

  function parseIPv4Int(str) {
    var p = str.split('.').map(Number);
    if (p.length !== 4 || p.some(function (x) { return !Number.isInteger(x) || x < 0 || x > 255; })) return null;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }

  function ipv4FromBigInt(n) {
    var v = Number(n);
    return [(v >>> 24), (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
  }

  function parseIPv6BigInt(str) {
    str = str.trim().toLowerCase();
    var groups;

    if (str.includes('::')) {
      var halves = str.split('::');
      if (halves.length !== 2) return null;
      var left  = halves[0] ? halves[0].split(':') : [];
      var right = halves[1] ? halves[1].split(':') : [];

      if (right.length > 0 && right[right.length - 1].includes('.')) {
        var v4 = parseIPv4Int(right[right.length - 1]);
        if (v4 === null) return null;
        right = right.slice(0, -1).concat([
          ((v4 >>> 16) & 0xffff).toString(16),
          (v4 & 0xffff).toString(16),
        ]);
      }

      var total = left.length + right.length;
      if (total > 8) return null;
      var zeros = Array(8 - total).fill('0');
      groups = left.concat(zeros, right);
    } else {
      groups = str.split(':');
      if (groups.length > 0 && groups[groups.length - 1].indexOf('.') !== -1) {
        var tailV4 = parseIPv4Int(groups[groups.length - 1]);
        if (tailV4 === null) return null;
        groups = groups.slice(0, -1).concat([
          ((tailV4 >>> 16) & 0xffff).toString(16),
          (tailV4 & 0xffff).toString(16)
        ]);
      }
    }

    if (groups.length !== 8) return null;

    var result = 0n;
    for (var i = 0; i < groups.length; i++) {
      var n = parseInt(groups[i], 16);
      if (isNaN(n) || n < 0 || n > 0xffff) return null;
      result = (result << 16n) | BigInt(n);
    }
    return result;
  }

  function ipv6FromBigInt(n) {
    var groups = [];
    var tmp = n;
    for (var i = 0; i < 8; i++) {
      groups.unshift(Number(tmp & 0xffffn).toString(16));
      tmp >>= 16n;
    }

    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (var j = 0; j <= 8; j++) {
      if (j < 8 && groups[j] === '0') {
        if (curStart === -1) { curStart = j; curLen = 1; }
        else curLen++;
      } else {
        if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
        curStart = -1; curLen = 0;
      }
    }

    if (bestLen < 2) return groups.join(':');

    var left  = groups.slice(0, bestStart).join(':');
    var right = groups.slice(bestStart + bestLen).join(':');
    if (!left && !right) return '::';
    if (!left)  return '::' + right;
    if (!right) return left + '::';
    return left + '::' + right;
  }

  function makeMask(prefix, bits) {
    if (prefix === 0) return 0n;
    var hostBits = bits - prefix;
    return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(hostBits)) - 1n);
  }

  function parseCIDR(str) {
    str = str.trim();
    var ipStr = str;
    var prefix = null;

    var slashIdx = str.lastIndexOf('/');
    if (slashIdx !== -1) {
      var prefixStr = str.slice(slashIdx + 1);
      var pNum = parseInt(prefixStr, 10);
      if (!isNaN(pNum) && String(pNum) === prefixStr.trim()) {
        prefix = pNum;
        ipStr  = str.slice(0, slashIdx);
      }
    }

    if (ipStr.includes(':')) {
      var v6 = parseIPv6BigInt(ipStr);
      if (v6 === null) return null;
      if (prefix === null) prefix = 128;
      if (prefix < 0 || prefix > 128) return null;
      return { base: makeMask(prefix, 128) & v6, prefix: prefix, family: 6 };
    }

    if (ipStr.includes('.')) {
      var v4 = parseIPv4Int(ipStr);
      if (v4 === null) return null;
      if (prefix === null) prefix = 32;
      if (prefix < 0 || prefix > 32) return null;
      return { base: makeMask(prefix, 32) & BigInt(v4), prefix: prefix, family: 4 };
    }

    return null;
  }

  function formatCIDR(cidr) {
    if (cidr.family === 4) return ipv4FromBigInt(cidr.base) + '/' + cidr.prefix;
    return ipv6FromBigInt(cidr.base) + '/' + cidr.prefix;
  }

  /** 将 CIDR 向下聚合到 aggPrefix（掩码变短、网段变大） */
  function aggregateCIDR(cidr, aggPrefixV4, aggPrefixV6) {
    var aggPrefix = cidr.family === 4 ? aggPrefixV4 : aggPrefixV6;
    var maxBits   = cidr.family === 4 ? 32 : 128;
    if (cidr.prefix <= aggPrefix) return formatCIDR(cidr);
    var newBase = makeMask(aggPrefix, maxBits) & cidr.base;
    return formatCIDR({ base: newBase, prefix: aggPrefix, family: cidr.family });
  }

  function compareCIDRStr(a, b) {
    var ca = parseCIDR(a), cb = parseCIDR(b);
    if (!ca || !cb) return a.localeCompare(b);
    if (ca.family !== cb.family) return ca.family - cb.family;
    if (ca.base < cb.base) return -1;
    if (ca.base > cb.base) return 1;
    return ca.prefix - cb.prefix;
  }

  return {
    parseCIDR: parseCIDR,
    aggregateCIDR: aggregateCIDR,
    compareCIDRStr: compareCIDRStr,
    formatCIDR: formatCIDR,
  };
})();
