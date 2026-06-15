/**
 * Punycode 域名编解码 — RFC 3492 Bootstring 实现（核心逻辑层）
 *
 * 按域名标签（点分隔）独立编码/解码；含非 ASCII 的标签加 xn-- 前缀。
 * autoConvert 根据是否含 xn-- 或非 ASCII 自动判断编码或解码方向。
 *
 * 导出：BocPunycode
 */
var BocPunycode = (function () {
  'use strict';

  /* Bootstring 常数 */
  var BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700;
  var INITIAL_BIAS = 72, INITIAL_N = 128;
  var DELIMITER = 0x2D; // '-'

  /* 将 Unicode 字符串转为码点数组（处理代理对） */
  function toCodePoints(str) {
    var result = [];
    for (var i = 0; i < str.length; ) {
      var cp = str.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          i += 2;
        } else i++;
      } else i++;
      result.push(cp);
    }
    return result;
  }

  /* 码点数组 → 字符串 */
  function fromCodePoints(cps) {
    var result = '';
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (cp < 0x10000) {
        result += String.fromCharCode(cp);
      } else {
        cp -= 0x10000;
        result += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return result;
  }

  function adaptBias(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    var k = 0;
    while (delta > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
      delta = Math.floor(delta / (BASE - TMIN));
      k += BASE;
    }
    return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }

  function digitToChar(d) {
    return String.fromCharCode(d < 26 ? d + 0x61 : d - 26 + 0x30);
  }

  function charToDigit(c) {
    var cc = typeof c === 'number' ? c : c.charCodeAt(0);
    if (cc - 0x30 < 0x0A) return cc - 0x30 + 26;
    if (cc - 0x61 < 0x1A) return cc - 0x61;
    if (cc - 0x41 < 0x1A) return cc - 0x41;
    return BASE; // invalid
  }

  /**
   * 编码单个 ACE 标签（不含 xn-- 前缀）。
   * @param {number[]} codepoints 单个域名标签的码点数组
   */
  function encodeLabel(codepoints) {
    var n = INITIAL_N;
    var delta = 0;
    var bias = INITIAL_BIAS;
    var output = [];

    // 输出所有基本码点
    var b = 0;
    for (var i = 0; i < codepoints.length; i++) {
      if (codepoints[i] < 0x80) {
        output.push(String.fromCharCode(codepoints[i]));
        b++;
      }
    }

    var h = b;
    if (b > 0 && b < codepoints.length) output.push('-');

    while (h < codepoints.length) {
      // 找本轮最小非基本码点
      var m = 0x7FFFFFFF;
      for (var j = 0; j < codepoints.length; j++) {
        if (codepoints[j] >= n && codepoints[j] < m) m = codepoints[j];
      }

      if (m - n > Math.floor((0x7FFFFFFF - delta) / (h + 1))) throw new Error('Overflow');
      delta += (m - n) * (h + 1);
      n = m;

      for (var j = 0; j < codepoints.length; j++) {
        if (codepoints[j] < n) {
          if (++delta === 0) throw new Error('Overflow');
        }
        if (codepoints[j] === n) {
          var q = delta;
          for (var k = BASE; ; k += BASE) {
            var t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
            if (q < t) break;
            output.push(digitToChar(t + (q - t) % (BASE - t)));
            q = Math.floor((q - t) / (BASE - t));
          }
          output.push(digitToChar(q));
          bias = adaptBias(delta, h + 1, h === b);
          delta = 0;
          h++;
        }
      }
      delta++;
      n++;
    }

    return output.join('');
  }

  /**
   * 解码单个 ACE 标签（不含 xn-- 前缀）。
   */
  function decodeLabel(input) {
    var n = INITIAL_N;
    var i = 0;
    var bias = INITIAL_BIAS;
    var output = [];

    var basic = input.lastIndexOf('-');
    if (basic < 0) basic = -1;

    for (var j = 0; j <= basic - 1; j++) {
      var c = input.charCodeAt(j);
      if (c >= 0x80) throw new Error('非法字符（非 ASCII）');
      output.push(c);
    }
    // 如果 basic === 0，则 output 为空（全为非基本字符）
    // 如果 basic < 0，则 output 为空

    var inIdx = basic >= 0 ? basic + 1 : 0;

    while (inIdx < input.length) {
      var oldi = i;
      var w = 1;
      for (var k = BASE; ; k += BASE) {
        if (inIdx >= input.length) throw new Error('输入不完整');
        var digit = charToDigit(input.charCodeAt(inIdx++));
        if (digit >= BASE) throw new Error('无效字符');
        if (digit > Math.floor((0x7FFFFFFF - i) / w)) throw new Error('Overflow');
        i += digit * w;
        var t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
        if (digit < t) break;
        if (w > Math.floor(0x7FFFFFFF / (BASE - t))) throw new Error('Overflow');
        w *= (BASE - t);
      }

      var outLen = output.length + 1;
      bias = adaptBias(i - oldi, outLen, oldi === 0);
      if (Math.floor(i / outLen) > 0x7FFFFFFF - n) throw new Error('Overflow');
      n += Math.floor(i / outLen);
      i %= outLen;
      output.splice(i, 0, n);
      i++;
    }

    return fromCodePoints(output);
  }

  /* ---- 公共 API ---- */

  /**
   * 编码域名（Unicode → ACE / xn--）
   * 每个标签独立处理，纯 ASCII 标签保持不变，区分大小写原样保留。
   */
  function encodeDomain(domain) {
    return domain.split('.').map(function (label) {
      if (!label) return label;
      // 如果已经是 ACE 标签，保持不变
      if (/^xn--/i.test(label)) return label.toLowerCase();
      // 纯 ASCII（含字母数字连字符）→ 不编码，转小写
      if (/^[A-Za-z0-9-]*$/.test(label)) return label.toLowerCase();
      // 含非 ASCII → 编码
      try {
        var cps = toCodePoints(label.toLowerCase());
        return 'xn--' + encodeLabel(cps);
      } catch (e) {
        throw new Error('编码标签 "' + label + '" 失败：' + e.message);
      }
    }).join('.');
  }

  /**
   * 解码域名（ACE / xn-- → Unicode）
   */
  function decodeDomain(domain) {
    return domain.split('.').map(function (label) {
      if (!label) return label;
      if (!/^xn--/i.test(label)) return label;
      try {
        return decodeLabel(label.slice(4).toLowerCase());
      } catch (e) {
        throw new Error('解码标签 "' + label + '" 失败：' + e.message);
      }
    }).join('.');
  }

  /**
   * 自动检测输入方向并双向转换
   * 返回 { encoded, decoded, direction }
   */
  function autoConvert(input) {
    var t = input.trim().toLowerCase();
    // 含 xn-- → 认为是 ACE，解码
    if (/xn--/.test(t)) {
      return { direction: 'decode', result: decodeDomain(input.trim()) };
    }
    // 含非 ASCII → 编码
    if (/[^\x00-\x7F]/.test(input)) {
      return { direction: 'encode', result: encodeDomain(input.trim()) };
    }
    // 纯 ASCII → 尝试编码（仍为纯 ASCII，原样返回）
    return { direction: 'encode', result: encodeDomain(input.trim()) };
  }

  return {
    encodeDomain: encodeDomain,
    decodeDomain: decodeDomain,
    autoConvert: autoConvert
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BocPunycode;
}
