/**
 * 字符拼接工具 — 核心逻辑层
 *
 * 数据流：
 *   原始文本（每行一条）
 *     → 按分隔符拆分为字段数组
 *     → 用 $1 $2… 占位符替换模式模板
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
   * 将单行按分隔符拆分为字段
   * @param {string} line 已 trim 的行文本
   * @param {string} separator 经 trim 后的分隔符；空串时不拆分
   */
  function splitFields(line, separator) {
    if (!separator) return [line];
    return line.split(separator);
  }

  /**
   * 用字段数组替换模式中的 $n 占位符
   * @param {string} pattern 转换模式
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
   * @param {string} separator 分隔符（调用方传入原始值，内部会 trim）
   * @param {string} pattern 转换模式
   * @returns {{ lines: string[], lineCount: number }}
   */
  function process(rawText, separator, pattern) {
    var trimmedPattern = String(pattern || '').trim();
    if (!trimmedPattern) {
      return { lines: [], lineCount: 0 };
    }

    var sep = String(separator || '').trim();
    var rawLines = String(rawText || '').split(/\r?\n/);
    var lines = [];

    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i].trim();
      if (!line) continue;

      var fields = splitFields(line, sep);
      lines.push(applyPattern(trimmedPattern, fields));
    }

    return { lines: lines, lineCount: lines.length };
  }

  return {
    process: process,
    splitFields: splitFields,
    applyPattern: applyPattern
  };
})();
