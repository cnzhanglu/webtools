/**
 * iptables / ip6tables 规则生成（无外部依赖）
 *
 * 生成顺序（每个 stack 独立）：
 *   固定前缀策略 → 白名单规则 → 自定义附加规则 → 结尾拒绝
 *
 * 白名单留空（且该类启用）时生成不带 -s 的规则，即对所有源开放
 * （IPv4 等价 0.0.0.0/0，IPv6 等价 ::/0）。
 *
 * 导出：IptablesGen（依赖 IptablesTemplate）
 */
var IptablesGen = (function () {
  'use strict';

  function splitLines(str) {
    return String(str || '').split(/\r?\n/);
  }

  function nonEmptyTrimmed(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var t = String(arr[i]).trim();
      if (t) out.push(t);
    }
    return out;
  }

  /** 规范化自定义规则行：补全命令名前缀 */
  function normalizeExtra(line, cmd) {
    var t = String(line).trim();
    if (!t) return null;
    if (t.charAt(0) === '#') return t; // 注释原样保留
    if (/^(iptables|ip6tables)\b/.test(t)) {
      // 命令名替换为当前 stack 对应命令
      return t.replace(/^(iptables|ip6tables)\b/, cmd);
    }
    if (t.charAt(0) === '-') return cmd + ' ' + t;
    return t;
  }

  /**
   * 生成单个 stack 的规则行数组。
   * @param stackData 设备某 stack 的数据
   * @param template  有效模板（已解析继承/覆盖）
   * @param stack     'v4' | 'v6'
   */
  function generateStack(stackData, template, stack) {
    var cmd = IptablesTemplate.cmdName(stack);
    var lines = [];
    var disabled = {};
    (stackData.disabledPrefixIds || []).forEach(function (id) { disabled[id] = true; });

    // 1. 固定前缀策略
    (template.prefixRules || []).forEach(function (rule) {
      if (rule.enabled === false) return;
      if (disabled[rule.id]) return;
      lines.push(cmd + ' ' + rule.text);
    });

    // 2. 白名单规则
    var enabledMap = stackData.whitelistEnabled || {};
    (template.whitelistDefs || []).forEach(function (def) {
      if (enabledMap[def.id] === false) return;
      var ips = nonEmptyTrimmed((stackData.whitelists && stackData.whitelists[def.id]) || []);
      if (ips.length === 0) {
        // 留空 = 对所有源开放（不带 -s）
        def.lines.forEach(function (tpl) {
          lines.push(cmd + ' ' + tpl.replace('{src}', ''));
        });
      } else {
        ips.forEach(function (ip) {
          def.lines.forEach(function (tpl) {
            lines.push(cmd + ' ' + tpl.replace('{src}', ' -s ' + ip));
          });
        });
      }
    });

    // 3. 自定义附加规则
    nonEmptyTrimmed(splitLines((stackData.extraRules || []).join('\n'))).forEach(function (l) {
      var n = normalizeExtra(l, cmd);
      if (n) lines.push(n);
    });

    // 4. 结尾拒绝
    (template.suffixRules || []).forEach(function (rule) {
      if (rule.enabled === false) return;
      if (disabled[rule.id]) return;
      lines.push(cmd + ' ' + rule.text);
    });

    return lines;
  }

  function linesToText(lines) {
    return lines.join('\n');
  }

  return {
    generateStack: generateStack,
    linesToText: linesToText,
    normalizeExtra: normalizeExtra
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IptablesGen;
}
