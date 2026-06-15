/**
 * 子网计算器 — IPv4/IPv6 地址解析
 *
 * 职责：解析用户输入的网络表示（CIDR、点分掩码、空格分隔 IP+掩码），
 * 输出统一的 { addr, prefix, family } 供 SubnetCalcCore.calc 计算。
 * 掩码合法性通过「取反后为 2 的幂」校验（连续 1 前缀）。
 *
 * 导出：SubnetCalcIp
 */
var SubnetCalcIp = (function () {
  'use strict';

  function parseIPv4Int(str) {
    var p = str.split('.').map(Number);
    if (p.length !== 4 || p.some(function (x) { return !Number.isInteger(x) || x < 0 || x > 255; })) return null;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }

  function ipv4FromInt(n) {
    var v = Number(n) >>> 0;
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
    if (prefix <= 0) return 0n;
    if (prefix >= bits) return (1n << BigInt(bits)) - 1n;
    var hostBits = bits - prefix;
    return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(hostBits)) - 1n);
  }

  function prefixFromDottedMask(maskStr) {
    var n = parseIPv4Int(maskStr);
    if (n === null) return null;
    var inverted = (~n) >>> 0;
    if (inverted !== 0 && (inverted & (inverted + 1)) !== 0) return null;
    var bits = 0;
    var m = n;
    while (m) { bits += m & 1; m >>>= 1; }
    return bits;
  }

  function prefixFromIpv6Mask(maskStr) {
    var m = parseIPv6BigInt(maskStr);
    if (m === null) return null;
    var inverted = ((1n << 128n) - 1n) ^ m;
    if (inverted !== 0n && (inverted & (inverted + 1n)) !== 0n) return null;
    var bits = 0;
    var tmp = m;
    while (tmp) { if (tmp & 1n) bits++; tmp >>= 1n; }
    return bits;
  }

  function dottedMaskFromPrefix(prefix) {
    var mask = Number(makeMask(prefix, 32));
    return ipv4FromInt(mask);
  }

  function detectFamily(ipStr) {
    if (ipStr.includes(':')) return 6;
    if (ipStr.includes('.')) return 4;
    return null;
  }

  /**
   * 解析用户输入，支持：
   *   192.168.1.0/24
   *   192.168.1.0 255.255.255.0
   *   192.168.1.0/255.255.255.0
   *   2001:db8::1/64
   */
  function parseNetworkInput(str, fallbackPrefix) {
    str = (str || '').trim();
    if (!str) return null;

    var ipStr = str;
    var maskStr = null;

    var slashIdx = str.lastIndexOf('/');
    if (slashIdx !== -1) {
      maskStr = str.slice(slashIdx + 1).trim();
      ipStr = str.slice(0, slashIdx).trim();
    }

    var spaceParts = ipStr.split(/\s+/);
    if (spaceParts.length > 1) {
      ipStr = spaceParts[0];
      if (!maskStr) maskStr = spaceParts.slice(1).join(' ');
    }

    var family = detectFamily(ipStr);
    if (family === null) return null;

    var prefix = fallbackPrefix;
    var addr;

    if (family === 4) {
      var v4 = parseIPv4Int(ipStr);
      if (v4 === null) return null;
      addr = BigInt(v4);

      if (maskStr) {
        if (maskStr.includes('.')) {
          var p4 = prefixFromDottedMask(maskStr);
          if (p4 === null) return { error: '无效的 IPv4 子网掩码：' + maskStr };
          prefix = p4;
        } else {
          var pn = parseInt(maskStr, 10);
          if (isNaN(pn) || String(pn) !== maskStr || pn < 0 || pn > 32) {
            return { error: '无效的前缀长度：' + maskStr };
          }
          prefix = pn;
        }
      } else if (prefix === undefined || prefix === null) {
        prefix = 24;
      }
      if (prefix < 0 || prefix > 32) return { error: 'IPv4 前缀长度须在 0–32 之间' };
    } else {
      var v6 = parseIPv6BigInt(ipStr);
      if (v6 === null) return null;
      addr = v6;

      if (maskStr) {
        if (maskStr.includes(':')) {
          var p6 = prefixFromIpv6Mask(maskStr);
          if (p6 === null) return { error: '无效的 IPv6 子网掩码：' + maskStr };
          prefix = p6;
        } else if (maskStr.includes('.')) {
          return { error: 'IPv6 不支持点分十进制掩码' };
        } else {
          var pn6 = parseInt(maskStr, 10);
          if (isNaN(pn6) || String(pn6) !== maskStr || pn6 < 0 || pn6 > 128) {
            return { error: '无效的前缀长度：' + maskStr };
          }
          prefix = pn6;
        }
      } else if (prefix === undefined || prefix === null) {
        prefix = 64;
      }
      if (prefix < 0 || prefix > 128) return { error: 'IPv6 前缀长度须在 0–128 之间' };
    }

    return { addr: addr, prefix: prefix, family: family, ipStr: ipStr };
  }

  return {
    parseIPv4Int: parseIPv4Int,
    ipv4FromInt: ipv4FromInt,
    parseIPv6BigInt: parseIPv6BigInt,
    ipv6FromBigInt: ipv6FromBigInt,
    makeMask: makeMask,
    dottedMaskFromPrefix: dottedMaskFromPrefix,
    parseNetworkInput: parseNetworkInput,
    detectFamily: detectFamily,
  };
})();
