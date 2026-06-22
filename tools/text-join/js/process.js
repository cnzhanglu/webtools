/**
 * 字符拼接工具 — 核心逻辑层
 *
 * 数据流：
 *   原始文本（每行一条）
 *     → 按分隔符拆分为字段数组
 *     → 用 $1 $2… 占位符替换模版文本
 *     → 逐行输出转换结果
 *
 * 占位符规则：$n 对应第 n 个字段（1-based），越界保留原占位符。
 *
 * 导出：TextJoinProcess
 */
var TextJoinProcess = (function () {
  'use strict';

  var PLACEHOLDER_RE = /\$(\d+)/g;

  /**
   * 规范化分隔符：去除首尾无意义空白，但保留纯空白分隔符（空格、Tab）
   * @param {string} separator 用户输入的分隔符
   */
  function normalizeSeparator(separator) {
    var raw = String(separator || '');
    if (!raw.length) return '';
    var trimmed = raw.trim();
    // 用户明确输入了分隔符，但 strip 后为空（如单个空格、Tab），仍按原字符拆分
    if (!trimmed.length) return raw;
    return trimmed;
  }

  /**
   * 将单行按分隔符拆分为字段
   * @param {string} line 原始行文本（保留字段内首尾空格）
   * @param {string} separator 规范化后的分隔符；空串时不拆分
   */
  function splitFields(line, separator) {
    if (!separator) return [line];
    return line.split(separator);
  }

  /**
   * 用字段数组替换模版中的 $n 占位符
   * @param {string} pattern 模版文本
   * @param {string[]} fields 字段数组
   */
  function applyPattern(pattern, fields) {
    return pattern.replace(PLACEHOLDER_RE, function (match, numStr) {
      var index = parseInt(numStr, 10) - 1;
      if (index >= 0 && index < fields.length) return fields[index];
      return match;
    });
  }

  /**
   * 批量转换
   * @param {string} rawText 原始多行文本
   * @param {string} separator 分隔符（支持空格、Tab 等纯空白字符）
   * @param {string} pattern 模版文本
   * @returns {{ lines: string[], lineCount: number }}
   */
  function process(rawText, separator, pattern) {
    var trimmedPattern = String(pattern || '').trim();
    if (!trimmedPattern) {
      return { lines: [], lineCount: 0 };
    }

    var sep = normalizeSeparator(separator);
    var rawLines = String(rawText || '').split(/\r?\n/);
    var lines = [];

    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (!line.trim()) continue;

      var fields = splitFields(line, sep);
      lines.push(applyPattern(trimmedPattern, fields));
    }

    return { lines: lines, lineCount: lines.length };
  }

  return {
    process: process,
    splitFields: splitFields,
    applyPattern: applyPattern,
    normalizeSeparator: normalizeSeparator
  };
})();
