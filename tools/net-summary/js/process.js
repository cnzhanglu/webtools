/**
 * 网段汇总 — 输入解析与合并（核心逻辑层）
 *
 * 数据流：多行 IP/CIDR/范围 → BocIpCidr.parseEntry
 *        → mergeStrict（等长连续 CIDR 向上合并）或 mergeLoose（区间并集再拆 CIDR）
 *        → 带来源映射的汇总行 + 超集校验（合并前后地址总数应一致）
 *
 * 依赖：BocIpCidr
 * 导出：NetSummaryProcess
 */
var NetSummaryProcess = (function () {
  'use strict';

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

  function sourceText(entry) {
    if (entry.kind === 'range') {
      return BocIpCidr.ipFromBigInt(entry.start, entry.family) + '-' +
        BocIpCidr.ipFromBigInt(entry.end, entry.family);
    }
    return BocIpCidr.formatCidr(entry.start, entry.prefix, entry.family);
  }

  /**
   * 汇总主入口。
   * @param {string} raw 输入文本
   * @param {string} mode 'strict' | 'loose'
   * @returns 汇总结果对象
   */
  function summarize(raw, mode) {
    var parsed = parseList(raw);
    var entries = parsed.entries;

    var merged = mode === 'loose'
      ? BocIpCidr.mergeLoose(entries)   // 区间并集后拆成最小 CIDR
      : BocIpCidr.mergeStrict(entries); // 仅合并等长、对齐、相邻的兄弟块

    var rows = merged.map(function (r, idx) {
      var sources = (r.sources || []).map(function (s) {
        return { lineNo: s.lineNo, text: sourceText(s) };
      });
      return {
        index: idx + 1,
        cidr: BocIpCidr.formatCidr(r.base, r.prefix, r.family),
        family: familyLabel(r.family),
        familyNum: r.family,
        count: (r.end - r.start + 1n).toString(),
        sourceCount: sources.length,
        sources: sources,
        start: r.start,
        end: r.end
      };
    });

    // 超集校验：合并前后地址并集应一致
    var origTotal = BocIpCidr.totalAddresses(entries);
    var mergedAsEntries = merged.map(function (r) {
      return { family: r.family, start: r.start, end: r.end };
    });
    var mergedTotal = BocIpCidr.totalAddresses(mergedAsEntries);

    var v4In = 0, v6In = 0;
    entries.forEach(function (e) { if (e.family === 4) v4In++; else v6In++; });
    var v4Out = 0, v6Out = 0;
    merged.forEach(function (r) { if (r.family === 4) v4Out++; else v6Out++; });

    var inputCount = entries.length;
    var outputCount = merged.length;
    var ratio = inputCount > 0
      ? Math.round((1 - outputCount / inputCount) * 1000) / 10
      : 0;

    return {
      rows: rows,
      errors: parsed.errors,
      stats: {
        inputCount: inputCount,
        outputCount: outputCount,
        ratio: ratio,
        errorCount: parsed.errors.length,
        v4In: v4In, v6In: v6In,
        v4Out: v4Out, v6Out: v6Out,
        origTotal: origTotal.toString(),
        mergedTotal: mergedTotal.toString(),
        supersetExact: origTotal === mergedTotal
      }
    };
  }

  return {
    parseList: parseList,
    summarize: summarize
  };
})();
