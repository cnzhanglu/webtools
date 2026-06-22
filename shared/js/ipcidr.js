/**
 * 共享 IP / CIDR 库（无外部依赖）
 *
 * 统一以 BigInt 表示地址，family = 4 (IPv4, 32 bit) 或 6 (IPv6, 128 bit)。
 * 支持三种输入格式：单 IP、CIDR、IP 范围（a-b）。
 * 提供覆盖判定（subnetContains）与严格 / 宽松 / 压缩三种网段合并算法。
 *
 * 被 cidr-vs、net-summary、iptables-gen 等工具复用。
 * 导出：BocIpCidr
 */
var BocIpCidr = (function () {
  'use strict';

  function bitsOf(family) {
    return family === 4 ? 32 : 128;
  }

  function parseIPv4(str) {
    str = String(str).trim();
    var p = str.split('.');
    if (p.length !== 4) return null;
    var val = 0n;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i])) return null;
      var n = parseInt(p[i], 10);
      if (n < 0 || n > 255) return null;
      val = (val << 8n) | BigInt(n);
    }
    return val;
  }

  function parseIPv6(str) {
    str = String(str).trim().toLowerCase();
    if (str.indexOf(':') === -1) return null;

    var groups;
    if (str.indexOf('::') !== -1) {
      var halves = str.split('::');
      if (halves.length !== 2) return null;
      var left = halves[0] ? halves[0].split(':') : [];
      var right = halves[1] ? halves[1].split(':') : [];

      if (right.length > 0 && right[right.length - 1].indexOf('.') !== -1) {
        var v4 = parseIPv4(right[right.length - 1]);
        if (v4 === null) return null;
        var n4 = Number(v4);
        right = right.slice(0, -1).concat([
          ((n4 >>> 16) & 0xffff).toString(16),
          (n4 & 0xffff).toString(16)
        ]);
      }

      var total = left.length + right.length;
      if (total > 8) return null;
      var zeros = [];
      for (var z = 0; z < 8 - total; z++) zeros.push('0');
      groups = left.concat(zeros, right);
    } else {
      groups = str.split(':');
      if (groups.length > 0 && groups[groups.length - 1].indexOf('.') !== -1) {
        var tailV4 = parseIPv4(groups[groups.length - 1]);
        if (tailV4 === null) return null;
        var t4 = Number(tailV4);
        groups = groups.slice(0, -1).concat([
          ((t4 >>> 16) & 0xffff).toString(16),
          (t4 & 0xffff).toString(16)
        ]);
      }
    }

    if (groups.length !== 8) return null;

    var result = 0n;
    for (var i = 0; i < groups.length; i++) {
      if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
      var g = parseInt(groups[i], 16);
      if (isNaN(g) || g < 0 || g > 0xffff) return null;
      result = (result << 16n) | BigInt(g);
    }
    return result;
  }

  function ipv4FromBigInt(n) {
    var v = Number(n & 0xffffffffn) >>> 0;
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
  }

  function ipv6FromBigInt(n) {
    var groups = [];
    var tmp = n;
    for (var i = 0; i < 8; i++) {
      groups.unshift(Number(tmp & 0xffffn).toString(16));
      tmp >>= 16n;
    }

    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (var j = 0; j <= 8; j++) {
      if (j < 8 && groups[j] === '0') {
        if (curStart === -1) { curStart = j; curLen = 1; }
        else curLen++;
      } else {
        if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
        curStart = -1; curLen = 0;
      }
    }

    if (bestLen < 2) return groups.join(':');

    var left = groups.slice(0, bestStart).join(':');
    var right = groups.slice(bestStart + bestLen).join(':');
    if (!left && !right) return '::';
    if (!left) return '::' + right;
    if (!right) return left + '::';
    return left + '::' + right;
  }

  function ipFromBigInt(value, family) {
    return family === 4 ? ipv4FromBigInt(value) : ipv6FromBigInt(value);
  }

  function makeMask(prefix, bits) {
    if (prefix <= 0) return 0n;
    var hostBits = bits - prefix;
    return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(hostBits)) - 1n);
  }

  /** CIDR (base, prefix) → { start, end } */
  function cidrToRange(base, prefix, family) {
    var bits = bitsOf(family);
    var mask = makeMask(prefix, bits);
    var start = base & mask;
    var hostBits = bits - prefix;
    var end = start | ((1n << BigInt(hostBits)) - 1n);
    return { start: start, end: end };
  }

  /** 解析单个 IP（无前缀），返回 { family, value } 或 null */
  function parseSingleIp(str) {
    str = String(str).trim();
    if (str.indexOf(':') !== -1) {
      var v6 = parseIPv6(str);
      if (v6 === null) return null;
      return { family: 6, value: v6 };
    }
    if (str.indexOf('.') !== -1) {
      var v4 = parseIPv4(str);
      if (v4 === null) return null;
      return { family: 4, value: v4 };
    }
    return null;
  }

  /**
   * 统一解析一行输入，识别单 IP / CIDR / 范围三种格式。
   * 返回 { family, start, end, prefix(单 IP/CIDR 时), kind, text } 或抛出 Error。
   */
  function parseEntry(str) {
    var text = stripInlineComment(String(str).trim());
    if (!text) throw new Error('空内容');

    // 范围：a-b（IPv6 含冒号，连字符仍可区分，因为 IPv6 不含 '-'）
    var dashIdx = text.indexOf('-');
    if (dashIdx !== -1) {
      var aStr = text.slice(0, dashIdx).trim();
      var bStr = text.slice(dashIdx + 1).trim();
      var a = parseSingleIp(aStr);
      var b = parseSingleIp(bStr);
      if (!a || !b) throw new Error('无效的 IP 范围');
      if (a.family !== b.family) throw new Error('范围两端协议族不一致');
      if (a.value > b.value) throw new Error('范围起始地址大于结束地址');
      return {
        family: a.family,
        start: a.value,
        end: b.value,
        prefix: null,
        kind: 'range',
        text: text
      };
    }

    // CIDR
    var slashIdx = text.lastIndexOf('/');
    if (slashIdx !== -1) {
      var ipStr = text.slice(0, slashIdx).trim();
      var prefixStr = text.slice(slashIdx + 1).trim();
      if (!/^(0|[1-9]\d*)$/.test(prefixStr)) throw new Error('无效的前缀长度');
      var prefix = parseInt(prefixStr, 10);
      var ip = parseSingleIp(ipStr);
      if (!ip) throw new Error('无效的 IP 地址');
      var bits = bitsOf(ip.family);
      if (prefix < 0 || prefix > bits) throw new Error('前缀长度超出范围');
      var base = makeMask(prefix, bits) & ip.value;
      var range = cidrToRange(base, prefix, ip.family);
      return {
        family: ip.family,
        start: range.start,
        end: range.end,
        prefix: prefix,
        kind: 'cidr',
        text: text
      };
    }

    // 单个 IP
    var single = parseSingleIp(text);
    if (!single) throw new Error('无法识别的格式');
    var fullPrefix = bitsOf(single.family);
    return {
      family: single.family,
      start: single.value,
      end: single.value,
      prefix: fullPrefix,
      kind: 'ip',
      text: text
    };
  }

  /** 将区间 [start, end] 拆分为最小 CIDR 列表（精确覆盖，不溢出） */
  function rangeToCidrs(start, end, family) {
    var bits = bitsOf(family);
    var cidrs = [];
    var cur = start;
    while (cur <= end) {
      // 当前地址对齐允许的最大块
      var maxSizeByAlign = bits;
      if (cur !== 0n) {
        var lowBit = cur & (-cur);
        maxSizeByAlign = bits - log2(lowBit);
      } else {
        maxSizeByAlign = 0;
      }
      // 受剩余区间长度限制
      var remaining = end - cur + 1n;
      var maxSizeByCount = bits - log2Floor(remaining);
      var prefix = Math.max(maxSizeByAlign, maxSizeByCount);
      if (prefix < 0) prefix = 0;
      if (prefix > bits) prefix = bits;
      cidrs.push({ base: cur, prefix: prefix, family: family });
      var blockSize = 1n << BigInt(bits - prefix);
      cur += blockSize;
      if (cur === 0n && prefix === 0) break; // 防止 0.0.0.0/0 溢出
    }
    return cidrs;
  }

  function log2(value) {
    // value 为 2 的幂的 BigInt，返回其指数
    var n = 0;
    var v = value;
    while (v > 1n) { v >>= 1n; n++; }
    return n;
  }

  function log2Floor(value) {
    // floor(log2(value))，value >= 1
    var n = 0;
    var v = value;
    while (v > 1n) { v >>= 1n; n++; }
    return n;
  }

  function stripInlineComment(text) {
    return String(text)
      .replace(/\s+#.*$/, '')
      .replace(/\s+\/\/.*$/, '')
      .trim();
  }

  /** 合并重叠/相邻区间 */
  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    var sorted = intervals.slice().sort(function (a, b) {
      if (a.start < b.start) return -1;
      if (a.start > b.start) return 1;
      if (a.end < b.end) return -1;
      if (a.end > b.end) return 1;
      return 0;
    });
    var out = [{ start: sorted[0].start, end: sorted[0].end }];
    for (var i = 1; i < sorted.length; i++) {
      var cur = sorted[i];
      var last = out[out.length - 1];
      if (cur.start <= last.end + 1n) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        out.push({ start: cur.start, end: cur.end });
      }
    }
    return out;
  }

  /** 判断 [start,end] 是否被区间并集完全覆盖 */
  function isRangeCoveredByUnion(start, end, union) {
    if (!union.length) return false;
    var cur = start;
    var idx = 0;
    while (cur <= end) {
      while (idx < union.length && union[idx].end < cur) idx++;
      if (idx >= union.length || union[idx].start > cur) return false;
      cur = union[idx].end + 1n;
    }
    return true;
  }

  /** 判断 inner 网段是否完全被 outer 覆盖（同族区间包含） */
  function subnetContains(outer, inner) {
    if (outer.family !== inner.family) return false;
    return outer.start <= inner.start && inner.end <= outer.end;
  }

  /** 移除被其他块完全包含的冗余 CIDR（严格合并后去重） */
  function removeContainedBlocks(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var inner = blocks[i];
      var contained = false;
      for (var j = 0; j < blocks.length; j++) {
        if (i === j) continue;
        if (subnetContains(blocks[j], inner)) {
          contained = true;
          break;
        }
      }
      if (!contained) out.push(inner);
    }
    return out;
  }

  /** 排序比较：family → start → prefix（窄到宽） */
  function compareEntry(a, b) {
    if (a.family !== b.family) return a.family - b.family;
    if (a.start < b.start) return -1;
    if (a.start > b.start) return 1;
    var pa = a.prefix === null || a.prefix === undefined ? -1 : a.prefix;
    var pb = b.prefix === null || b.prefix === undefined ? -1 : b.prefix;
    return pa - pb;
  }

  function formatCidr(base, prefix, family) {
    return ipFromBigInt(base, family) + '/' + prefix;
  }

  function entryAddressCount(entry) {
    return entry.end - entry.start + 1n;
  }

  /**
   * 严格模式：仅合并相同前缀长度、地址对齐且连续的 CIDR 网段为上一级。
   * 输入 entries：已 parseEntry 的对象数组（范围型会先转成 CIDR 列表）。
   * 返回 { results, } —— results 为 { base, prefix, family, start, end, sources[] }
   */
  function mergeStrict(entries) {
    var blocks = expandToCidrBlocks(entries);

    var changed = true;
    while (changed) {
      changed = false;
      blocks.sort(function (a, b) {
        if (a.family !== b.family) return a.family - b.family;
        if (a.base < b.base) return -1;
        if (a.base > b.base) return 1;
        return a.prefix - b.prefix;
      });

      var merged = [];
      var used = new Array(blocks.length).fill(false);
      for (var i = 0; i < blocks.length; i++) {
        if (used[i]) continue;
        var cur = blocks[i];
        var partnered = false;
        if (i + 1 < blocks.length && !used[i + 1]) {
          var nxt = blocks[i + 1];
          if (cur.family === nxt.family && cur.prefix === nxt.prefix && cur.prefix > 0) {
            var bits = bitsOf(cur.family);
            var parentPrefix = cur.prefix - 1;
            var parentMask = makeMask(parentPrefix, bits);
            // 两个块必须同父，且 cur 为低半区（base 即父 base）
            if ((cur.base & parentMask) === (nxt.base & parentMask) &&
                (cur.base & parentMask) === cur.base &&
                nxt.base === cur.base + (1n << BigInt(bits - cur.prefix))) {
              var parentBase = cur.base & parentMask;
              var range = cidrToRange(parentBase, parentPrefix, cur.family);
              merged.push({
                base: parentBase,
                prefix: parentPrefix,
                family: cur.family,
                start: range.start,
                end: range.end,
                sources: cur.sources.concat(nxt.sources)
              });
              used[i] = true;
              used[i + 1] = true;
              partnered = true;
              changed = true;
            }
          }
        }
        if (!partnered) {
          used[i] = true;
          merged.push(cur);
        }
      }
      blocks = merged;
    }

    return dedupeAndSort(blocks);
  }

  /**
   * 压缩模式：单个连续区间输出一条能完整覆盖它的最长 CIDR。
   * maxPrefix 是允许输出的最长「聚合」掩码；默认 IPv4 /30、IPv6 /126，勾选允许 /31 时为 /31、/127。
   *
   * 关键约定：单地址（/32 · /128）始终允许，maxPrefix 只约束「合并 2 个及以上地址」的块。
   * 因此从最细 /bits 开始向粗尝试，跳过 maxPrefix 与 /bits 之间被禁用的掩码长度，
   * 保证 10.0.0.1-10.0.0.1 这类单地址输出 /32 而非被强行套上 /31。
   * 若更细掩码无法覆盖完整区间，则逐步放宽到更粗掩码（如 /24）。
   */
  function coverIntervalCompress(start, end, family, maxPrefix) {
    var bits = bitsOf(family);
    maxPrefix = Math.max(0, Math.min(bits, maxPrefix));

    for (var p = bits; p >= 0; p--) {
      // /bits 为精确单地址，恒允许；其余掩码须不长于 maxPrefix（禁用 /31·/127 时跳过）
      if (p !== bits && p > maxPrefix) continue;
      var mask = makeMask(p, bits);
      var base = start & mask;
      var rng = cidrToRange(base, p, family);
      if (rng.start <= start && rng.end >= end) {
        return [{
          base: base,
          prefix: p,
          family: family,
          start: rng.start,
          end: rng.end
        }];
      }
    }

    return [];
  }

  /**
   * 压缩汇总：区间并集后，每个连续区间输出单条最长覆盖 CIDR（允许输出地址多于输入）。
   * @param {Object[]} entries 已 parseEntry 的条目
   * @param {Object} opts allowPrefix31（默认 true）、maxPrefixV4、maxPrefixV6；兼容旧参数名
   */
  function mergeCompress(entries, opts) {
    opts = opts || {};
    var allowPrefix31 = opts.allowPrefix31 !== false;
    var defaultMaxV4 = allowPrefix31 ? 31 : 30;
    var defaultMaxV6 = allowPrefix31 ? 127 : 126;
    var maxPrefixV4 = opts.maxPrefixV4 !== undefined ? opts.maxPrefixV4
      : (opts.maxAggPrefixV4 !== undefined ? opts.maxAggPrefixV4
        : (opts.aggPrefixV4 !== undefined ? opts.aggPrefixV4
          : (opts.minPrefixV4 !== undefined ? opts.minPrefixV4 : defaultMaxV4)));
    var maxPrefixV6 = opts.maxPrefixV6 !== undefined ? opts.maxPrefixV6
      : (opts.maxAggPrefixV6 !== undefined ? opts.maxAggPrefixV6
        : (opts.aggPrefixV6 !== undefined ? opts.aggPrefixV6
          : (opts.minPrefixV6 !== undefined ? opts.minPrefixV6 : defaultMaxV6)));
    var maxByFamily = { 4: maxPrefixV4, 6: maxPrefixV6 };

    var byFamily = { 4: [], 6: [] };
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      byFamily[e.family].push({ start: e.start, end: e.end, source: e });
    }

    var results = [];
    [4, 6].forEach(function (fam) {
      var arr = byFamily[fam];
      if (!arr.length) return;
      arr.sort(function (a, b) {
        if (a.start < b.start) return -1;
        if (a.start > b.start) return 1;
        if (a.end < b.end) return -1;
        if (a.end > b.end) return 1;
        return 0;
      });

      var mergedRanges = [];
      var cur = { start: arr[0].start, end: arr[0].end, sources: [arr[0].source] };
      for (var k = 1; k < arr.length; k++) {
        var seg = arr[k];
        if (seg.start <= cur.end + 1n) {
          if (seg.end > cur.end) cur.end = seg.end;
          cur.sources.push(seg.source);
        } else {
          mergedRanges.push(cur);
          cur = { start: seg.start, end: seg.end, sources: [seg.source] };
        }
      }
      mergedRanges.push(cur);

      var maxP = maxByFamily[fam];
      mergedRanges.forEach(function (mr) {
        var cidrs = coverIntervalCompress(mr.start, mr.end, fam, maxP);
        cidrs.forEach(function (c) {
          results.push({
            base: c.base,
            prefix: c.prefix,
            family: fam,
            start: c.start,
            end: c.end,
            sources: mr.sources.slice()
          });
        });
      });
    });

    return dedupeAndSort(results);
  }

  /**
   * 宽松模式：所有条目转区间并集，再用 rangeToCidrs 拆为最小 CIDR 集（允许不等长合并）。
   * 结果是原集合的精确超集。
   */
  function mergeLoose(entries) {
    var byFamily = { 4: [], 6: [] };
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      byFamily[e.family].push({ start: e.start, end: e.end, source: e });
    }

    var results = [];
    [4, 6].forEach(function (fam) {
      var arr = byFamily[fam];
      if (!arr.length) return;
      arr.sort(function (a, b) {
        if (a.start < b.start) return -1;
        if (a.start > b.start) return 1;
        if (a.end < b.end) return -1;
        if (a.end > b.end) return 1;
        return 0;
      });

      // 合并重叠 / 相邻区间，记录来源
      var mergedRanges = [];
      var cur = { start: arr[0].start, end: arr[0].end, sources: [arr[0].source] };
      for (var k = 1; k < arr.length; k++) {
        var seg = arr[k];
        if (seg.start <= cur.end + 1n) {
          if (seg.end > cur.end) cur.end = seg.end;
          cur.sources.push(seg.source);
        } else {
          mergedRanges.push(cur);
          cur = { start: seg.start, end: seg.end, sources: [seg.source] };
        }
      }
      mergedRanges.push(cur);

      mergedRanges.forEach(function (mr) {
        var cidrs = rangeToCidrs(mr.start, mr.end, fam);
        cidrs.forEach(function (c) {
          var range = cidrToRange(c.base, c.prefix, fam);
          results.push({
            base: c.base,
            prefix: c.prefix,
            family: fam,
            start: range.start,
            end: range.end,
            sources: mr.sources.slice()
          });
        });
      });
    });

    return dedupeAndSort(results);
  }

  /** 把 entries（含 range 型）展开为 CIDR 块，保留 sources 引用 */
  function expandToCidrBlocks(entries) {
    var blocks = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.kind === 'range') {
        var cidrs = rangeToCidrs(e.start, e.end, e.family);
        for (var j = 0; j < cidrs.length; j++) {
          var range = cidrToRange(cidrs[j].base, cidrs[j].prefix, e.family);
          blocks.push({
            base: cidrs[j].base,
            prefix: cidrs[j].prefix,
            family: e.family,
            start: range.start,
            end: range.end,
            sources: [e]
          });
        }
      } else {
        blocks.push({
          base: e.start,
          prefix: e.prefix,
          family: e.family,
          start: e.start,
          end: e.end,
          sources: [e]
        });
      }
    }
    return blocks;
  }

  /** 去重（同 base/prefix/family 合并 sources）并排序 */
  function dedupeAndSort(blocks) {
    var map = {};
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var key = b.family + '|' + b.base.toString() + '/' + b.prefix;
      if (!map[key]) {
        map[key] = {
          base: b.base,
          prefix: b.prefix,
          family: b.family,
          start: b.start,
          end: b.end,
          sources: b.sources.slice()
        };
      } else {
        map[key].sources = map[key].sources.concat(b.sources);
      }
    }
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (a, b) {
      if (a.family !== b.family) return a.family - b.family;
      if (a.start < b.start) return -1;
      if (a.start > b.start) return 1;
      return a.prefix - b.prefix;
    });
    // sources 去重（按行号/文本）
    out.forEach(function (r) {
      var seen = {};
      r.sources = r.sources.filter(function (s) {
        var sk = (s.lineNo !== undefined ? s.lineNo + ':' : '') + s.text;
        if (seen[sk]) return false;
        seen[sk] = true;
        return true;
      });
    });
    return out;
  }

  /** 计算多个区间的地址总数并集（用于超集校验） */
  function totalAddresses(entries) {
    var byFamily = { 4: [], 6: [] };
    for (var i = 0; i < entries.length; i++) {
      byFamily[entries[i].family].push({ start: entries[i].start, end: entries[i].end });
    }
    var total = 0n;
    [4, 6].forEach(function (fam) {
      var arr = byFamily[fam];
      if (!arr.length) return;
      arr.sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });
      var s = arr[0].start, e = arr[0].end;
      for (var k = 1; k < arr.length; k++) {
        if (arr[k].start <= e + 1n) {
          if (arr[k].end > e) e = arr[k].end;
        } else {
          total += e - s + 1n;
          s = arr[k].start; e = arr[k].end;
        }
      }
      total += e - s + 1n;
    });
    return total;
  }

  return {
    parseIPv4: parseIPv4,
    parseIPv6: parseIPv6,
    parseSingleIp: parseSingleIp,
    parseEntry: parseEntry,
    ipFromBigInt: ipFromBigInt,
    makeMask: makeMask,
    cidrToRange: cidrToRange,
    rangeToCidrs: rangeToCidrs,
    subnetContains: subnetContains,
    compareEntry: compareEntry,
    formatCidr: formatCidr,
    entryAddressCount: entryAddressCount,
    mergeStrict: mergeStrict,
    mergeLoose: mergeLoose,
    mergeCompress: mergeCompress,
    coverIntervalCompress: coverIntervalCompress,
    mergeIntervals: mergeIntervals,
    isRangeCoveredByUnion: isRangeCoveredByUnion,
    removeContainedBlocks: removeContainedBlocks,
    totalAddresses: totalAddresses,
    bitsOf: bitsOf
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BocIpCidr;
}
