/**
 * 导入现有 iptables / ip6tables 规则并自动识别归类（无外部依赖）
 *
 * 支持输入：
 *   - 完整命令行：`iptables -A INPUT ...` / `ip6tables -A INPUT ...`
 *   - iptables-save 片段：`-A INPUT ...`（无命令名，归入指定的默认 stack）
 *
 * 自动识别：
 *   - 命令名 → v4 / v6
 *   - 命中默认前缀 / 结尾策略 → 跳过（模板已生成，避免重复）
 *   - 命中白名单（按 comment 优先，其次结构）→ 抽取 IP 归入 dns/internal/snmp/mgmt
 *   - 其余 ACCEPT/DROP 等 → 自定义附加规则
 *
 * 导出：IptablesParse（依赖 IptablesTemplate）
 */
var IptablesParse = (function () {
  'use strict';

  function normFrag(frag) {
    return String(frag).replace(/^\s*(iptables|ip6tables)\s+/, '').replace(/\s+/g, ' ').trim();
  }

  /** 构建默认前缀 + 结尾规则的规范化集合（v4 + v6 合并） */
  function buildKnownSet() {
    var set = {};
    ['v4', 'v6'].forEach(function (stack) {
      var t = IptablesTemplate.defaultTemplate(stack);
      t.prefixRules.forEach(function (r) { set[normFrag(r.text)] = true; });
      t.suffixRules.forEach(function (r) { set[normFrag(r.text)] = true; });
    });
    return set;
  }

  var COMMENT_BUCKET = {
    'dns udp whitelist': 'dns',
    'dns tcp whitelist': 'dns',
    'cluster internal whitelist': 'internal',
    'snmp whitelist': 'snmp',
    'mgmt whitelist': 'mgmt'
  };

  function emptyStack() {
    return {
      whitelists: { dns: [], internal: [], snmp: [], mgmt: [] },
      whitelistTouched: {},
      extraRules: []
    };
  }

  function pushUnique(arr, val) {
    if (val && arr.indexOf(val) === -1) arr.push(val);
  }

  function getComment(frag) {
    var m = frag.match(/--comment\s+"([^"]*)"/);
    return m ? m[1].trim().toLowerCase() : null;
  }

  function getSrc(frag) {
    var m = frag.match(/(^|\s)-s\s+(\S+)/) || frag.match(/(^|\s)--source\s+(\S+)/);
    return m ? m[2] : null;
  }

  /** 结构化推断白名单类型 */
  function structuralBucket(frag) {
    if (!/-j\s+ACCEPT/.test(frag)) return null;
    var hasUdp = /-p\s+udp/.test(frag);
    var hasTcp = /-p\s+tcp/.test(frag);
    if (/--dport[s]?\s+(\S*\b)?53\b/.test(frag) && (hasUdp || hasTcp)) return 'dns';
    if (/--dport[s]?\s+\S*161\b/.test(frag) && hasUdp) return 'snmp';
    if (/multiport/.test(frag) && /22/.test(frag) && /443/.test(frag)) return 'mgmt';
    var src = getSrc(frag);
    if (src && !/-p\s/.test(frag) && !/--dport/.test(frag)) return 'internal';
    return null;
  }

  /**
   * 解析整段文本。
   * @param text 输入文本
   * @param defaultStack 无命令名行归入的 stack（'v4' | 'v6'）
   * @returns {byStack:{v4,v6}, stats, warnings}
   */
  function parseRules(text, defaultStack) {
    defaultStack = defaultStack === 'v6' ? 'v6' : 'v4';
    var known = buildKnownSet();
    var byStack = { v4: emptyStack(), v6: emptyStack() };
    var stats = { total: 0, known: 0, whitelist: 0, extra: 0, skipped: 0 };
    var warnings = [];

    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') { continue; }
      // 跳过 iptables-save 控制行
      if (/^[*:]/.test(raw) || /^COMMIT$/i.test(raw)) { stats.skipped++; continue; }

      stats.total++;

      // 确定 stack
      var stack = defaultStack;
      if (/^ip6tables\b/.test(raw)) stack = 'v6';
      else if (/^iptables\b/.test(raw)) stack = 'v4';

      var frag = normFrag(raw);

      // 命中默认前缀 / 结尾
      if (known[frag]) { stats.known++; continue; }

      // 仅处理 INPUT 相关追加规则；其余直接进 extra
      var bucket = null;
      var comment = getComment(frag);
      if (comment && COMMENT_BUCKET[comment]) bucket = COMMENT_BUCKET[comment];
      if (!bucket) bucket = structuralBucket(frag);

      if (bucket) {
        var src = getSrc(frag);
        var st = byStack[stack];
        st.whitelistTouched[bucket] = true;
        if (src) {
          pushUnique(st.whitelists[bucket], src);
        }
        // 无 src 表示对所有源开放，留空即可（whitelistTouched 标记已启用）
        stats.whitelist++;
      } else {
        // 自定义附加规则：保留为不含命令名的片段
        byStack[stack].extraRules.push(frag);
        stats.extra++;
      }
    }

    return { byStack: byStack, stats: stats, warnings: warnings };
  }

  return {
    parseRules: parseRules,
    normFrag: normFrag
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IptablesParse;
}
