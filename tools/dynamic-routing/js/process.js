/**
 * 动态路由工具 — 核心转换逻辑
 *
 * 模块职责：
 *   BGP 部分：ASPlain（十进制）↔ ASDOT（X.Y，高16位.低16位）互转，
 *             识别输入格式、标注号段用途范围，支持批量按行处理。
 *   OSPF 部分：Area ID 纯整数（0~4294967295）↔ 点分十进制（w.x.y.z）互转，
 *             与 IPv4↔整数换算规则完全一致，支持批量按行处理。
 *
 * 依赖：无（纯计算，Node.js / 浏览器均可运行）
 * 导出：DynamicRoutingProcess（浏览器 var）
 *
 * 数据流：
 *   BGP:  raw 文本 → convertBgpLines(raw, mode) → [{ lineNo, raw, decimal, dot, display, kind, note }]
 *   OSPF: raw 文本 → convertOspfLines(raw) → [{ lineNo, raw, integer, dotted, kind, note }]
 */

var DynamicRoutingProcess = (function () {
  'use strict';

  /* ================================================================
   * BGP AS 号转换
   * ================================================================ */

  var BGP_MAX_AS = 4294967295;       // 2^32 - 1
  var ASDOT_THRESHOLD = 65536;       // 2^16，ASDOT+ 仅对 ≥ 此值才显示点格式

  /**
   * 解析单个 AS 号字符串。
   * 支持纯十进制（如 65536）与带点格式（如 1.0，X 与 Y 均为 0~65535）。
   * @returns {{ value: number, kind: 'decimal'|'asdot' } | null}
   */
  function parseAS(str) {
    str = str.trim();
    if (!str) return null;

    // 带点格式 X.Y（两段，不含多余点）
    var parts = str.split('.');
    if (parts.length === 2) {
      var xStr = parts[0], yStr = parts[1];
      if (!/^\d+$/.test(xStr) || !/^\d+$/.test(yStr)) return null;
      var x = parseInt(xStr, 10);
      var y = parseInt(yStr, 10);
      if (x < 0 || x > 65535 || y < 0 || y > 65535) return null;
      return { value: x * 65536 + y, kind: 'asdot' };
    }

    // 纯十进制（单段）
    if (parts.length === 1) {
      if (!/^\d+$/.test(str)) return null;
      var v = parseInt(str, 10);
      if (v < 0 || v > BGP_MAX_AS) return null;
      return { value: v, kind: 'decimal' };
    }

    return null;
  }

  /** 将 AS 号整数值转为 ASDOT 格式 X.Y（始终返回点格式） */
  function asToDot(value) {
    var x = Math.floor(value / 65536);
    var y = value % 65536;
    return x + '.' + y;
  }

  /**
   * 按 mode 决定 ASDOT 显示格式。
   * asdot: 全部显示点格式；
   * asdotplus: 仅 ≥ 65536 显示点格式，低值直接显示十进制。
   */
  function toDisplayDot(value, mode) {
    if (mode === 'asdot') return asToDot(value);
    return value >= ASDOT_THRESHOLD ? asToDot(value) : String(value);
  }

  /** 标注 AS 号用途范围（RFC 保留/私有/文档/公有） */
  function asRange(value) {
    if (value === 0)                                    return 'Reserved';
    if (value === 23456)                                return 'AS_TRANS (RFC 6793)';
    if (value >= 64496 && value <= 64511)               return 'Documentation (RFC 5398)';
    if (value >= 64512 && value <= 65534)               return '2字节私有 AS';
    if (value === 65535)                                return 'Reserved';
    if (value >= 65536 && value <= 65551)               return 'Documentation (RFC 5398)';
    if (value >= 4200000000 && value <= 4294967294)     return '4字节私有 AS';
    if (value === 4294967295)                           return 'Reserved';
    if (value < 65536)                                  return '2字节公有 AS';
    return '4字节公有 AS';
  }

  /**
   * 批量处理 BGP AS 输入。
   * @param {string} raw   多行文本
   * @param {string} mode  'asdot' | 'asdotplus'
   * @returns {{ rows: Array, errors: Array }}
   */
  function convertBgpLines(raw, mode) {
    var lines = raw.split(/\r?\n/);
    var rows = [], errors = [];

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text || text[0] === '#') continue;

      var parsed = parseAS(text);
      if (!parsed) {
        errors.push({ lineNo: lineNo, text: lines[i] });
        continue;
      }

      var v = parsed.value;
      rows.push({
        lineNo: lineNo,
        raw: text,
        decimal: v,
        dot: asToDot(v),
        display: toDisplayDot(v, mode),
        kind: parsed.kind === 'asdot' ? '点格式输入' : '十进制输入',
        note: asRange(v)
      });
    }

    return { rows: rows, errors: errors };
  }

  /* ================================================================
   * OSPF Area ID 转换
   * ================================================================
   *
   * Area ID 本质是 32 位无符号整数，两种等价写法：
   *   纯整数：area 0 ~ area 4294967295
   *   点分十进制：w.x.y.z（与 IPv4 地址格式完全一致）
   *
   * 换算公式（与 IPv4 ↔ 整数完全一致）：
   *   点分 → 整数：N = w*16777216 + x*65536 + y*256 + z
   *   整数 → 点分：w = N>>24, x = (N>>16)&255, y = (N>>8)&255, z = N&255
   */

  var OSPF_MAX = 4294967295;         // 2^32 - 1

  /**
   * 解析单个 OSPF Area ID 字符串。
   * 接受：
   *   - 纯整数：0 ~ 4294967295
   *   - 四段点分：w.x.y.z，每段 0~255
   * 明确拒绝两段 X.Y（BGP AS 格式，提示用户换 Tab）。
   * @returns {{ value: number, kind: 'integer'|'dotted' } | { error: string } | null}
   */
  function parseArea(str) {
    str = str.trim();
    if (!str) return null;

    var parts = str.split('.');

    // 两段 X.Y → 提示是 BGP 格式
    if (parts.length === 2) {
      return { error: '格式错误：两段点分（X.Y）是 BGP AS 格式，请切换到 BGP AS 标签' };
    }

    // 四段点分 w.x.y.z
    if (parts.length === 4) {
      for (var i = 0; i < 4; i++) {
        if (!/^\d+$/.test(parts[i])) return { error: '点分格式每段须为纯数字' };
        var seg = parseInt(parts[i], 10);
        if (seg < 0 || seg > 255) return { error: '点分格式每段须在 0~255 范围内' };
      }
      var w = parseInt(parts[0], 10);
      var x = parseInt(parts[1], 10);
      var y = parseInt(parts[2], 10);
      var z = parseInt(parts[3], 10);
      var n = w * 16777216 + x * 65536 + y * 256 + z;
      return { value: n, kind: 'dotted' };
    }

    // 其他段数（1 段以上非四段，或三段等）
    if (parts.length > 1) {
      return { error: '格式错误：Area ID 须为纯整数或四段点分（w.x.y.z）' };
    }

    // 纯整数
    if (!/^\d+$/.test(str)) return { error: '格式错误：须为纯整数或四段点分' };
    var val = parseInt(str, 10);
    // parseInt 对超大数可能失真，用字符串比较辅助校验
    if (val > OSPF_MAX || String(val) !== str.replace(/^0+(?=\d)/, '')) {
      // 允许输入 "0" 本身，但不允许前导零如 "01"
      if (str.length > 1 && str[0] === '0') {
        return { error: '不允许前导零' };
      }
      if (val > OSPF_MAX) return { error: 'Area ID 超出范围（0~4294967295）' };
    }
    if (str.length > 1 && str[0] === '0') {
      return { error: '不允许前导零' };
    }
    return { value: val, kind: 'integer' };
  }

  /** 将 32 位整数转为四段点分十进制字符串 */
  function areaToOspfDotted(n) {
    var w = Math.floor(n / 16777216);
    var x = Math.floor(n / 65536) % 256;
    var y = Math.floor(n / 256) % 256;
    var z = n % 256;
    return w + '.' + x + '.' + y + '.' + z;
  }

  /** 标注 OSPF Area 说明 */
  function areaNote(n) {
    if (n === 0) return '骨干区域（Backbone Area）';
    return '普通区域';
  }

  /**
   * 批量处理 OSPF Area ID 输入。
   * @param {string} raw 多行文本
   * @returns {{ rows: Array, errors: Array }}
   */
  function convertOspfLines(raw) {
    var lines = raw.split(/\r?\n/);
    var rows = [], errors = [];

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text || text[0] === '#') continue;

      var parsed = parseArea(text);
      if (!parsed) continue;
      if (parsed.error) {
        errors.push({ lineNo: lineNo, text: lines[i], msg: parsed.error });
        continue;
      }

      var v = parsed.value;
      rows.push({
        lineNo: lineNo,
        raw: text,
        integer: v,
        dotted: areaToOspfDotted(v),
        kind: parsed.kind === 'dotted' ? '点分输入' : '整数输入',
        note: areaNote(v)
      });
    }

    return { rows: rows, errors: errors };
  }

  /* ================================================================
   * 公开接口
   * ================================================================ */
  return {
    // BGP
    parseAS: parseAS,
    asToDot: asToDot,
    toDisplayDot: toDisplayDot,
    asRange: asRange,
    convertBgpLines: convertBgpLines,
    // OSPF
    parseArea: parseArea,
    areaToOspfDotted: areaToOspfDotted,
    areaNote: areaNote,
    convertOspfLines: convertOspfLines
  };
})();
