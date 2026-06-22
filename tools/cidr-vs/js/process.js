/**
 * CIDR 网段对比 — 输入解析与覆盖判定（核心逻辑层）
 *
 * 算法：清单 A 为「基准覆盖集」，清单 B 为「待检集」。
 * 对 B 中每条记录，先找单条 A 完全包含；若无，再判断 A 的区间并集是否覆盖 B。
 *
 * 依赖：BocIpCidr（parseEntry、subnetContains、mergeIntervals、isRangeCoveredByUnion）
 * 导出：CidrVsProcess
 */
var CidrVsProcess = (function () {
  'use strict';

  /** 解析多行文本为条目列表，返回 { entries, errors } */
  function parseList(raw) {
    var lines = String(raw || '').split(/\r?\n/);
    var entries = [];
    var errors = [];
    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text) continue;
      if (text.indexOf('#') === 0 || text.indexOf('//') === 0) continue;
      try {
        var entry = BocIpCidr.parseEntry(text);
        entry.lineNo = lineNo;
        entries.push(entry);
      } catch (err) {
        errors.push({ lineNo: lineNo, text: lines[i], reason: err.message });
      }
    }
    return { entries: entries, errors: errors };
  }

  function familyLabel(family) {
    return family === 4 ? 'IPv4' : 'IPv6';
  }

  function normalizeText(entry) {
    if (entry.kind === 'range') {
      return BocIpCidr.ipFromBigInt(entry.start, entry.family) + '-' +
        BocIpCidr.ipFromBigInt(entry.end, entry.family);
    }
    return BocIpCidr.formatCidr(entry.start, entry.prefix, entry.family);
  }

  /** 按协议族构建 A 清单的区间并集 */
  function buildUnionByFamily(aEntries) {
    var byFamily = { 4: [], 6: [] };
    var i;
    for (i = 0; i < aEntries.length; i++) {
      var e = aEntries[i];
      byFamily[e.family].push({ start: e.start, end: e.end });
    }
    return {
      4: BocIpCidr.mergeIntervals(byFamily[4]),
      6: BocIpCidr.mergeIntervals(byFamily[6])
    };
  }

  /** 查找覆盖 B 的 A 条目：单条最具体匹配，或并集覆盖时的多条贡献者 */
  function findCoverage(b, aEntries, unionByFamily) {
    var best = null;
    var j;
    for (j = 0; j < aEntries.length; j++) {
      var a = aEntries[j];
      if (a.family !== b.family) continue;
      if (BocIpCidr.subnetContains(a, b)) {
        if (best === null) {
          best = a;
        } else {
          var bestSize = best.end - best.start;
          var curSize = a.end - a.start;
          if (curSize < bestSize) best = a;
        }
      }
    }
    if (best) {
      return { covered: true, matched: normalizeText(best) };
    }

    var union = unionByFamily[b.family] || [];
    if (!BocIpCidr.isRangeCoveredByUnion(b.start, b.end, union)) {
      return { covered: false, matched: '' };
    }

    var parts = [];
    for (j = 0; j < aEntries.length; j++) {
      var ae = aEntries[j];
      if (ae.family !== b.family) continue;
      if (ae.start <= b.end && b.start <= ae.end) {
        parts.push(normalizeText(ae));
      }
    }
    return { covered: true, matched: parts.join(', ') };
  }

  /**
   * 对比：判断 B 列表中每条是否被 A 列表覆盖。
   * 返回 { rows, stats }，rows = { lineNo, raw, normalized, family, covered, matched }
   */
  function compare(listA, listB) {
    var aResult = parseList(listA);
    var bResult = parseList(listB);
    var aEntries = aResult.entries;
    var unionByFamily = buildUnionByFamily(aEntries);

    var rows = [];
    var coveredCount = 0;
    for (var i = 0; i < bResult.entries.length; i++) {
      var b = bResult.entries[i];
      var cov = findCoverage(b, aEntries, unionByFamily);
      if (cov.covered) coveredCount++;
      rows.push({
        lineNo: b.lineNo,
        raw: b.text,
        normalized: normalizeText(b),
        family: familyLabel(b.family),
        covered: cov.covered,
        matched: cov.matched
      });
    }

    return {
      rows: rows,
      errorsA: aResult.errors,
      errorsB: bResult.errors,
      stats: {
        total: bResult.entries.length,
        covered: coveredCount,
        uncovered: bResult.entries.length - coveredCount,
        aCount: aEntries.length,
        errorCount: aResult.errors.length + bResult.errors.length
      }
    };
  }

  return {
    parseList: parseList,
    compare: compare
  };
})();
