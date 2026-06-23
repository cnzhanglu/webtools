/**
 * 子网计算器 — IPv4/IPv6 地址解析
 *
 * IP 解析与掩码位运算委托 BocIpCidr；本模块保留点分掩码解析、
 * 空格分隔 IP+掩码 等子网计算器专用输入格式。
 *
 * 导出：SubnetCalcIp
 */
var SubnetCalcIp = (function () {
  'use strict';

  function parseIPv4Int(str) {
    var v = BocIpCidr.parseIPv4(str);
    if (v === null) return null;
    return Number(v) >>> 0;
  }

  function ipv4FromInt(n) {
    return BocIpCidr.ipFromBigInt(BigInt(n >>> 0), 4);
  }

  function parseIPv6BigInt(str) {
    return BocIpCidr.parseIPv6(str);
  }

  function ipv6FromBigInt(n) {
    return BocIpCidr.ipFromBigInt(n, 6);
  }

  function makeMask(prefix, bits) {
    return BocIpCidr.makeMask(prefix, bits);
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
    if (ipStr.indexOf(':') !== -1) return 6;
    if (ipStr.indexOf('.') !== -1) return 4;
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
        if (maskStr.indexOf('.') !== -1) {
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
        if (maskStr.indexOf(':') !== -1) {
          var p6 = prefixFromIpv6Mask(maskStr);
          if (p6 === null) return { error: '无效的 IPv6 子网掩码：' + maskStr };
          prefix = p6;
        } else if (maskStr.indexOf('.') !== -1) {
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
