/**
 * 子网计算器 — 核心计算逻辑
 *
 * 根据解析后的网络地址与前缀，计算：
 *   网络地址、广播地址、掩码、通配符掩码、可用主机数、首尾主机、CIDR
 * IPv4 /31、/32 与 IPv6 /127、/128 按 RFC 特殊规则处理主机范围。
 *
 * 依赖：SubnetCalcIp
 * 导出：SubnetCalcCore
 */
var SubnetCalcCore = (function () {
  'use strict';

  var Ip = SubnetCalcIp;

  function formatBigInt(n) {
    var s = n.toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function hostCount(family, prefix) {
    var bits = family === 4 ? 32 : 128;
    var hostBits = bits - prefix;

    if (family === 4) {
      if (prefix === 32) return { count: 1n, display: '1' };
      if (prefix === 31) return { count: 2n, display: '2' };
      if (prefix <= 0) return { count: null, display: '4,294,967,296（全部 IPv4 地址）' };
      if (hostBits > 53) {
        var c = 1n << BigInt(hostBits);
        return { count: c - 2n, display: formatBigInt(c - 2n) };
      }
      var num = Math.pow(2, hostBits) - 2;
      return { count: BigInt(num), display: formatBigInt(BigInt(num)) };
    }

    if (prefix === 128) return { count: 1n, display: '1' };
    if (prefix === 127) return { count: 2n, display: '2' };
    if (prefix <= 0) {
      var allHosts = 1n << BigInt(hostBits);
      return { count: allHosts, display: formatBigInt(allHosts) };
    }
    if (hostBits > 100) {
      return { count: null, display: '2^' + hostBits + '（约 ' + formatBigInt(1n << BigInt(Math.min(hostBits, 60))) + (hostBits > 60 ? '…' : '') + '）' };
    }
    var c6 = 1n << BigInt(hostBits);
    if (prefix === bits - 1) return { count: 2n, display: '2' };
    return { count: c6 - 2n, display: formatBigInt(c6 - 2n) };
  }

  /** 由地址与前缀计算网络边界、主机范围等展示字段 */
  function calc(parsed) {
    if (!parsed || parsed.error) return parsed;

    var family = parsed.family;
    var prefix = parsed.prefix;
    var bits   = family === 4 ? 32 : 128;
    var mask   = Ip.makeMask(prefix, bits);
    var network = parsed.addr & mask;
    var broadcast = network | ((1n << BigInt(bits)) - 1n ^ mask);

    var result = {
      family: family,
      prefix: prefix,
      inputIp: parsed.ipStr,
      network: '',
      broadcast: '',
      mask: '',
      maskPrefix: '/' + prefix,
      wildcard: '',
      hostCount: '',
      firstHost: '',
      lastHost: '',
      cidr: '',
    };

    if (family === 4) {
      var net4  = Number(network);
      var bcast4 = Number(broadcast);
      result.network   = Ip.ipv4FromInt(net4);
      result.broadcast = Ip.ipv4FromInt(bcast4);
      result.mask      = Ip.dottedMaskFromPrefix(prefix);
      result.wildcard  = Ip.ipv4FromInt(~Number(mask) >>> 0);

      var hc = hostCount(4, prefix);
      result.hostCount = hc.display;

      if (prefix === 32) {
        result.firstHost = result.network;
        result.lastHost  = result.network;
      } else if (prefix === 31) {
        result.firstHost = Ip.ipv4FromInt(net4);
        result.lastHost  = Ip.ipv4FromInt(bcast4);
      } else if (prefix === 0) {
        result.firstHost = '0.0.0.1';
        result.lastHost  = '255.255.255.254';
      } else {
        result.firstHost = Ip.ipv4FromInt(net4 + 1);
        result.lastHost  = Ip.ipv4FromInt(bcast4 - 1);
      }

      result.cidr = result.network + '/' + prefix;
    } else {
      result.network   = Ip.ipv6FromBigInt(network);
      result.broadcast = '—（IPv6 无广播地址）';
      result.mask      = Ip.ipv6FromBigInt(mask) + ' (/' + prefix + ')';
      result.wildcard  = Ip.ipv6FromBigInt((1n << 128n) - 1n ^ mask);

      var hc6 = hostCount(6, prefix);
      result.hostCount = hc6.display;

      if (prefix === 128) {
        result.firstHost = result.network;
        result.lastHost  = result.network;
      } else if (prefix === 127) {
        result.firstHost = Ip.ipv6FromBigInt(network);
        result.lastHost  = Ip.ipv6FromBigInt(broadcast);
      } else if (prefix === 0) {
        result.firstHost = '::1';
        result.lastHost  = 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe';
      } else {
        result.firstHost = Ip.ipv6FromBigInt(network + 1n);
        result.lastHost  = Ip.ipv6FromBigInt(broadcast - 1n);
      }

      result.cidr = result.network + '/' + prefix;
    }

    return result;
  }

  return {
    calc: calc,
    hostCount: hostCount,
  };
})();
