/**
 * iptables / ip6tables 规则合法性校验（尽力而为，无外部依赖）
 *
 * 说明：真正的语法校验需要内核（`iptables-restore --test`），浏览器端无法运行；
 * 也没有符合本框架「零外部依赖 / 零 CDN」约束、可离线使用的 JS 校验库。
 * 因此这里做结构化的尽力校验：
 *   - IP / CIDR 与地址族（复用 BocIpCidr）
 *   - 端口范围 1-65535、multiport 端口数 ≤ 15
 *   - `-A <链>` 与 `-j <目标>` 结构
 *   - `--comment` 引号闭合与长度 ≤ 256
 *
 * 导出：IptablesValidate（依赖 BocIpCidr、IptablesTemplate）
 */
var IptablesValidate = (function () {
  'use strict';

  var MULTIPORT_MAX = IptablesTemplate.MULTIPORT_MAX;
  var COMMENT_MAX = IptablesTemplate.COMMENT_MAX;

  /**
   * 校验单个白名单 IP（接受单 IP 或 CIDR，不接受范围 a-b）。
   * @returns {ok:boolean, error?:string, family?:number}
   */
  function validateIp(str, expectFamily) {
    var text = String(str).trim();
    if (!text) return { ok: false, error: '空地址' };
    var entry;
    try {
      entry = BocIpCidr.parseEntry(text);
    } catch (e) {
      return { ok: false, error: '无效的 IP / CIDR：' + (e && e.message ? e.message : text) };
    }
    if (entry.kind === 'range') {
      return { ok: false, error: 'iptables -s 不支持地址范围（a-b），请改用 CIDR' };
    }
    if (expectFamily && entry.family !== expectFamily) {
      return {
        ok: false,
        error: '地址族不匹配：当前为 IPv' + expectFamily + '，但「' + text + '」是 IPv' + entry.family
      };
    }
    return { ok: true, family: entry.family };
  }

  /**
   * 校验一个白名单 IP 列表，返回逐项错误。
   * @returns {issues:Array<{line:number,text:string,error:string}>}
   */
  function validateIpList(list, expectFamily, label) {
    var issues = [];
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i]).trim();
      if (!raw) continue;
      var r = validateIp(raw, expectFamily);
      if (!r.ok) {
        issues.push({ line: i + 1, text: raw, error: (label ? '[' + label + '] ' : '') + r.error });
      }
    }
    return issues;
  }

  function checkPorts(portStr, multiport, issues, context) {
    var ports = portStr.split(',');
    if (multiport && ports.length > MULTIPORT_MAX) {
      issues.push({
        level: 'error',
        msg: context + 'multiport 端口数为 ' + ports.length + '，超过上限 ' + MULTIPORT_MAX
      });
    }
    for (var i = 0; i < ports.length; i++) {
      var p = ports[i].trim();
      if (p === '') {
        issues.push({ level: 'error', msg: context + '存在空端口' });
        continue;
      }
      // 支持端口范围 a:b
      var parts = p.split(':');
      for (var j = 0; j < parts.length; j++) {
        var v = parts[j].trim();
        if (!/^\d+$/.test(v)) {
          issues.push({ level: 'error', msg: context + '端口「' + p + '」非法' });
          break;
        }
        var n = parseInt(v, 10);
        if (n < 0 || n > 65535) {
          issues.push({ level: 'error', msg: context + '端口「' + p + '」超出 0-65535' });
          break;
        }
      }
    }
  }

  /**
   * 结构化校验一条规则片段（不含命令名，如 `-A INPUT ...` 或带命令名的整行）。
   * @returns {issues:Array<{level:'error'|'warn',msg:string}>}
   */
  function validateRuleLine(line, expectFamily) {
    var issues = [];
    var text = String(line).trim();
    if (!text || text.charAt(0) === '#') return issues;

    var ctx = '「' + (text.length > 60 ? text.slice(0, 60) + '…' : text) + '」：';

    // 去掉可能的命令名前缀
    var frag = text.replace(/^\s*(iptables|ip6tables)\s+/, '');

    // -A <链>
    var chainMatch = frag.match(/(^|\s)(-A|--append|-I|--insert)\s+(\S+)/);
    if (!chainMatch) {
      issues.push({ level: 'error', msg: ctx + '缺少链定义（-A <chain>）' });
    }

    // -j <目标>
    if (!/(^|\s)(-j|--jump|-g|--goto)\s+\S+/.test(frag)) {
      issues.push({ level: 'error', msg: ctx + '缺少跳转目标（-j <target>）' });
    }

    // 引号闭合（comment）
    var quoteCount = (frag.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      issues.push({ level: 'error', msg: ctx + '引号未闭合' });
    }

    // comment 长度
    var cm = frag.match(/--comment\s+"([^"]*)"/);
    if (cm && cm[1].length > COMMENT_MAX) {
      issues.push({ level: 'error', msg: ctx + 'comment 长度 ' + cm[1].length + ' 超过 ' + COMMENT_MAX });
    }

    // 源地址族
    var srcMatch = frag.match(/(^|\s)(-s|--source|-d|--destination)\s+(\S+)/);
    if (srcMatch) {
      var r = validateIp(srcMatch[3], expectFamily);
      if (!r.ok) issues.push({ level: 'error', msg: ctx + r.error });
    }

    // 端口
    var multiportUsed = /-m\s+multiport/.test(frag) || /multiport/.test(frag);
    var dport = frag.match(/--dport[s]?\s+(\S+)/);
    if (dport) checkPorts(dport[1], multiportUsed, issues, ctx);
    var sport = frag.match(/--sport[s]?\s+(\S+)/);
    if (sport) checkPorts(sport[1], multiportUsed, issues, ctx);

    // multiport 必须配合 -p tcp/udp（提醒）
    if (multiportUsed && !/-p\s+(tcp|udp|sctp|dccp)/.test(frag)) {
      issues.push({ level: 'warn', msg: ctx + 'multiport 通常需配合 -p tcp/udp' });
    }

    return issues;
  }

  /**
   * 批量校验整段规则文本（已含命令名的多行）。
   * @returns {issues:Array, errorCount, warnCount}
   */
  function validateRulesText(text, expectFamily) {
    var lines = String(text).split(/\r?\n/);
    var all = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln || ln.charAt(0) === '#') continue;
      var issues = validateRuleLine(ln, expectFamily);
      for (var k = 0; k < issues.length; k++) {
        issues[k].lineNo = i + 1;
        all.push(issues[k]);
      }
    }
    return summarize(all);
  }

  function summarize(issues) {
    var errorCount = 0, warnCount = 0;
    for (var i = 0; i < issues.length; i++) {
      if (issues[i].level === 'error') errorCount++;
      else warnCount++;
    }
    return { issues: issues, errorCount: errorCount, warnCount: warnCount };
  }

  return {
    validateIp: validateIp,
    validateIpList: validateIpList,
    validateRuleLine: validateRuleLine,
    validateRulesText: validateRulesText,
    summarize: summarize
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IptablesValidate;
}
