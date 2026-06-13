/**
 * CIDR 网段对比 — 输入解析与覆盖判定
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

  /**
   * 对比：判断 B 列表中每条是否被 A 列表覆盖。
   * 返回 { rows, stats }，rows = { lineNo, raw, normalized, family, covered, matched }
   */
  function compare(listA, listB) {
    var aResult = parseList(listA);
    var bResult = parseList(listB);
    var aEntries = aResult.entries;

    var rows = [];
    var coveredCount = 0;
    for (var i = 0; i < bResult.entries.length; i++) {
      var b = bResult.entries[i];
      var best = null;
      for (var j = 0; j < aEntries.length; j++) {
        var a = aEntries[j];
        if (a.family !== b.family) continue;
        if (BocIpCidr.subnetContains(a, b)) {
          // 取最具体匹配：区间最小者
          if (best === null) {
            best = a;
          } else {
            var bestSize = best.end - best.start;
            var curSize = a.end - a.start;
            if (curSize < bestSize) best = a;
          }
        }
      }
      var covered = best !== null;
      if (covered) coveredCount++;
      rows.push({
        lineNo: b.lineNo,
        raw: b.text,
        normalized: normalizeText(b),
        family: familyLabel(b.family),
        covered: covered,
        matched: best ? normalizeText(best) : ''
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
