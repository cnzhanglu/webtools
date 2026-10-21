/**
 * 域名区汇总工具 — 核心逻辑层
 *
 * 数据流：逐行区名称 → 规范化与校验 → 大小写不敏感去重
 *   → 在输入集合中查找最短父区 → 输出保留区及子区归属明细。
 *
 * 合并只使用输入中明确存在的父区，不推导共同父区，避免扩大实际 DNS 管理范围。
 * 依赖：无
 * 导出：DnsZoneSummaryProcess
 */
var DnsZoneSummaryProcess = (function () {
  'use strict';

  /**
   * 规范化并校验单个区名称。
   * DNS 名称大小写不敏感；末尾根标签“.”不影响区名称，因此统一移除。
   *
   * @param {string} raw 原始区名称
   * @returns {{valid: boolean, value: string, reason: string}}
   */
  function normalizeZone(raw) {
    var value = String(raw || '').trim().toLowerCase();
    // 合法绝对域名最多只有一个末尾根标签；只移除一个点，保留多余点供后续校验。
    if (value.endsWith('.')) value = value.slice(0, -1);

    if (!value) {
      return { valid: false, value: '', reason: '区名称为空' };
    }
    if (value.length > 253) {
      return { valid: false, value: value, reason: '区名称超过 253 个字符' };
    }

    var labels = value.split('.');
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (!label) {
        return { valid: false, value: value, reason: '包含空标签或连续的点' };
      }
      if (label.length > 63) {
        return { valid: false, value: value, reason: '单个标签超过 63 个字符' };
      }
      // 区名称允许常见的下划线标签（如 _msdcs），但不接受通配符、空格和 URL 字符。
      if (!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label)) {
        return { valid: false, value: value, reason: '标签包含非法字符或以连字符开头/结尾' };
      }
    }

    return { valid: true, value: value, reason: '' };
  }

  /**
   * 从输入集合中查找当前区的最短父区。
   * 从最靠近根的后缀开始查找，确保多级父区同时存在时选择标签数最少者。
   *
   * @param {string} zone 已规范化区名称
   * @param {Object<string, boolean>} zoneSet 输入区集合
   * @returns {string} 父区；不存在时返回空串
   */
  function findShortestParent(zone, zoneSet) {
    var labels = zone.split('.');
    for (var i = labels.length - 1; i >= 1; i--) {
      var candidate = labels.slice(i).join('.');
      if (zoneSet[candidate]) return candidate;
    }
    return '';
  }

  /**
   * 汇总多行区名称。
   *
   * @param {string} rawText 每行一个区名称
   * @returns {{
   *   inputCount: number,
   *   validCount: number,
   *   uniqueCount: number,
   *   duplicateCount: number,
   *   mergedCount: number,
   *   zones: string[],
   *   mappings: {source: string, target: string}[],
   *   invalidLines: {line: number, value: string, reason: string}[]
   * }}
   */
  function process(rawText) {
    var rawLines = String(rawText || '').split(/\r?\n/);
    var uniqueZones = [];
    var zoneSet = Object.create(null);
    var invalidLines = [];
    var inputCount = 0;
    var validCount = 0;

    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i];
      if (!raw.trim()) continue;
      inputCount++;

      var normalized = normalizeZone(raw);
      if (!normalized.valid) {
        invalidLines.push({
          line: i + 1,
          value: raw.trim(),
          reason: normalized.reason
        });
        continue;
      }

      validCount++;
      if (!zoneSet[normalized.value]) {
        zoneSet[normalized.value] = true;
        uniqueZones.push(normalized.value);
      }
    }

    var zones = [];
    var mappings = [];
    for (var j = 0; j < uniqueZones.length; j++) {
      var zone = uniqueZones[j];
      var parent = findShortestParent(zone, zoneSet);
      if (parent) {
        mappings.push({ source: zone, target: parent });
      } else {
        zones.push(zone);
      }
    }

    return {
      inputCount: inputCount,
      validCount: validCount,
      uniqueCount: uniqueZones.length,
      duplicateCount: validCount - uniqueZones.length,
      mergedCount: mappings.length,
      zones: zones,
      mappings: mappings,
      invalidLines: invalidLines
    };
  }

  return {
    normalizeZone: normalizeZone,
    findShortestParent: findShortestParent,
    process: process
  };
})();
