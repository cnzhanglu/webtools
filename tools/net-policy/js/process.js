/**
 * 网络策略 — 输入解析与聚合处理（核心逻辑层）
 *
 * 数据流：
 *   原始文本（每行「IP/CIDR + 端口」）
 *     → parseInput 拆行、校验
 *     → 按端口分组，同端口内 CIDR 聚合去重
 *     → 按输出模式（按端口 / 压缩一行）与 maxAddr 拆分行
 *
 * 导出：NetPolicyProcess
 */
var NetPolicyProcess = (function () {
  'use strict';

  function comparePort(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  }

  /** 解析多行输入，每行格式：地址 + 空白/逗号 + 端口 */
  function parseInput(raw) {
    var rows = [], errors = [];
    raw.split('\n').forEach(function (line, idx) {
      var trimmed = line.trim();
      if (!trimmed) return;

      var m = trimmed.match(/^([^\s,]+)[\s,]+(.+)$/);
      if (!m) {
        errors.push({ line: idx + 1, text: trimmed });
        return;
      }
      var cidr = NetPolicyIp.parseCIDR(m[1]);
      if (!cidr) {
        errors.push({ line: idx + 1, text: trimmed });
        return;
      }
      rows.push({ cidr: cidr, port: m[2].trim() });
    });
    return { rows: rows, errors: errors };
  }

  /**
   * 聚合主入口
   * @param oneLineMode true 时所有端口合并为一行，地址与端口各自去重排序
   */
  function process(rawText, aggPrefixV4, aggPrefixV6, maxAddr, oneLineMode) {
    var parsed = parseInput(rawText);
    var rows   = parsed.rows;
    var errors = parsed.errors;

    var portMap = new Map();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      // 先聚合到用户指定的前缀，再按端口归入 Set 自动去重
      var aggCIDR = NetPolicyIp.aggregateCIDR(row.cidr, aggPrefixV4, aggPrefixV6);
      if (!portMap.has(row.port)) portMap.set(row.port, new Set());
      portMap.get(row.port).add(aggCIDR);
    }

    var resultRows = [];

    // —— 模式一：全部压缩为一行，地址与端口各自全局去重 ——
    if (oneLineMode) {
      var allAddrs = new Set();
      portMap.forEach(function (s) { s.forEach(function (a) { allAddrs.add(a); }); });
      var sortedAddrs = Array.from(allAddrs).sort(NetPolicyIp.compareCIDRStr);
      var portStr     = Array.from(portMap.keys()).sort(comparePort);

      if (maxAddr > 0 && sortedAddrs.length > maxAddr) {
        for (var j = 0; j < sortedAddrs.length; j += maxAddr) {
          resultRows.push({ addrs: sortedAddrs.slice(j, j + maxAddr), ports: portStr });
        }
      } else {
        resultRows.push({ addrs: sortedAddrs, ports: portStr });
      }
    } else {
      // —— 模式二：按端口分组，每组内地址排序；超 maxAddr 时纵向拆行 ——
      var sortedPorts = Array.from(portMap.keys()).sort(comparePort);
      for (var p = 0; p < sortedPorts.length; p++) {
        var port  = sortedPorts[p];
        var addrs = Array.from(portMap.get(port)).sort(NetPolicyIp.compareCIDRStr);
        if (maxAddr > 0 && addrs.length > maxAddr) {
          for (var k = 0; k < addrs.length; k += maxAddr) {
            resultRows.push({ addrs: addrs.slice(k, k + maxAddr), ports: [port] });
          }
        } else {
          resultRows.push({ addrs: addrs, ports: [port] });
        }
      }
    }

    return { resultRows: resultRows, errors: errors };
  }

  return { parseInput: parseInput, process: process };
})();
