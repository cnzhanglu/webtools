/**
 * Excel 切换 JSON — 域名与 IP 校验层
 * 移植自 Python validators/domain_validator.py、ip_validator.py
 */
var Excel2JsonValidate = (function () {
  'use strict';

  /* 域名正则：每段 [a-zA-Z0-9]、中间可含连字符、末尾至少 2 字母 TLD */
  var DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  /* 非法字符（换行、空格、逗号、中文标点等） */
  var DOMAIN_ILLEGAL = /[\s,，、；;。""''《》【】\u4e00-\u9fa5]/;

  /* IPv4 段：0-255 */
  function validOctet(s) {
    if (s === '' || s.length > 3) return false;
    var n = Number(s);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === s;
  }

  function isIPv4(s) {
    var parts = s.split('.');
    if (parts.length !== 4) return false;
    return parts.every(validOctet);
  }

  /**
   * RFC 4291 IPv6 地址校验（支持 :: 缩写，不支持 zone ID）
   */
  function isIPv6(s) {
    if (s.indexOf(':') === -1) return false;
    /* 最多一个 :: */
    if ((s.match(/::/g) || []).length > 1) return false;

    var halves = s.split('::');
    if (halves.length > 2) return false;

    function validGroups(part) {
      if (!part) return [];
      return part.split(':');
    }

    var left  = validGroups(halves[0]);
    var right = halves.length === 2 ? validGroups(halves[1]) : [];

    /* 右半段最后一组可能是 IPv4 映射（如 ::ffff:192.168.1.1） */
    var ipv4Tail = false;
    if (right.length && isIPv4(right[right.length - 1])) {
      right = right.slice(0, -1).concat(['0', '0']); /* IPv4 占 2 个 16-bit 组 */
      ipv4Tail = true;
    }

    var groups = left.concat(right);
    var totalGroups = groups.length;

    if (halves.length === 1) {
      /* 无 :: 必须恰好 8 组 */
      if (totalGroups !== 8) return false;
    } else {
      /* 有 :: 两侧加起来不超过 8 组 */
      if (totalGroups > 8) return false;  /* :: 至少代表 1 组 */
    }

    /* 每组 1-4 位十六进制 */
    var HEX = /^[0-9a-fA-F]{1,4}$/;
    return groups.every(function (g) { return HEX.test(g); });
  }

  /**
   * 校验单个域名字符串（不含换行）
   * @returns null | string (错误消息)
   */
  function checkDomain(fqdn, rowIndex) {
    if (!fqdn || !fqdn.trim()) return '域名为空';
    var s = fqdn.trim();
    /* FQDN 可带尾部点，去掉后再校验 */
    var bare = s.replace(/\.$/, '');
    if (DOMAIN_ILLEGAL.test(bare)) return '域名含非法字符（空格/换行/标点）';
    if (!DOMAIN_RE.test(bare)) return '域名格式不合法（不符合 FQDN 规范）';
    return null;
  }

  /**
   * 校验"多行 IP"字段（E/F 列动态类型）
   * 允许空字符串（返回空数组）
   * @returns { ips: string[], error: string|null }
   */
  function validateMultipleIPs(raw, rowIndex, colLetter) {
    if (!raw || !raw.trim()) return { ips: [], error: null };
    var lines = raw.split(/\n/);
    var ips = [];
    for (var i = 0; i < lines.length; i++) {
      var ip = lines[i].trim();
      if (!ip) continue;
      if (!isIPv4(ip) && !isIPv6(ip)) {
        return { ips: [], error: '[行 ' + rowIndex + ' 列 ' + colLetter + '] IP 地址格式非法：' + ip };
      }
      ips.push(ip);
    }
    return { ips: ips, error: null };
  }

  /**
   * 校验"静态单行 IP"字段（E/F 列静态类型）
   * 空字符串合法（对应 T32/T63 — 允许一侧为空）
   * 含换行则报错
   * @returns { ip: string, error: string|null }
   */
  function validateSingleIP(raw, rowIndex, colLetter) {
    if (!raw || !raw.trim()) return { ip: '', error: null };
    if (/\n/.test(raw)) {
      return { ip: '', error: '[行 ' + rowIndex + ' 列 ' + colLetter + '] 静态类型 IP 字段含换行符，应为单个 IP' };
    }
    var ip = raw.trim();
    if (!isIPv4(ip) && !isIPv6(ip)) {
      return { ip: '', error: '[行 ' + rowIndex + ' 列 ' + colLetter + '] IP 地址格式非法：' + ip };
    }
    return { ip: ip, error: null };
  }

  return {
    checkDomain: checkDomain,
    validateMultipleIPs: validateMultipleIPs,
    validateSingleIP: validateSingleIP
  };
}());
