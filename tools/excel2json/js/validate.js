/**
 * Excel 切换 JSON — 域名与 IP 校验层
 * 移植自 Python validators/domain_validator.py、ip_validator.py
 * IP 解析与规范化委托 BocIpCidr。
 */
var Excel2JsonValidate = (function () {
  'use strict';

  /* 域名正则：每段 [a-zA-Z0-9]、中间可含连字符、末尾至少 2 字母 TLD */
  var DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  /* 非法字符（换行、空格、逗号、中文标点等） */
  var DOMAIN_ILLEGAL = /[\s,，、；;。""''《》【】\u4e00-\u9fa5]/;

  function isIPv4(s) {
    return BocIpCidr.parseIPv4(s) !== null;
  }

  function isIPv6(s) {
    return BocIpCidr.parseIPv6(s) !== null;
  }

  /**
   * 将合法 IP 规范化为 BocIpCidr 标准文本（用于 E/F 列差分比较）
   * @returns string|null
   */
  function normalizeIp(ip) {
    var p = BocIpCidr.parseSingleIp(String(ip || '').trim());
    if (!p) return null;
    return BocIpCidr.ipFromBigInt(p.value, p.family);
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
      var norm = normalizeIp(ip);
      if (!norm) {
        return { ips: [], error: '[行 ' + rowIndex + ' 列 ' + colLetter + '] IP 地址格式非法：' + ip };
      }
      ips.push(norm);
    }
    /* 去重（规范化后可能重复） */
    var seen = {};
    ips = ips.filter(function (v) {
      if (seen[v]) return false;
      seen[v] = true;
      return true;
    });
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
    var norm = normalizeIp(ip);
    if (!norm) {
      return { ip: '', error: '[行 ' + rowIndex + ' 列 ' + colLetter + '] IP 地址格式非法：' + ip };
    }
    return { ip: norm, error: null };
  }

  return {
    checkDomain: checkDomain,
    validateMultipleIPs: validateMultipleIPs,
    validateSingleIP: validateSingleIP,
    normalizeIp: normalizeIp,
    isIPv4: isIPv4,
    isIPv6: isIPv6
  };
}());
