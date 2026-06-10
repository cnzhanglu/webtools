/**
 * 网络策略：输入解析与聚合处理
 */
var NetPolicyProcess = (function () {
  'use strict';

  function comparePort(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  }

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

  function process(rawText, aggPrefixV4, aggPrefixV6, maxAddr, oneLineMode) {
    var parsed = parseInput(rawText);
    var rows   = parsed.rows;
    var errors = parsed.errors;

    var portMap = new Map();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var aggCIDR = NetPolicyIp.aggregateCIDR(row.cidr, aggPrefixV4, aggPrefixV6);
      if (!portMap.has(row.port)) portMap.set(row.port, new Set());
      portMap.get(row.port).add(aggCIDR);
    }

    var resultRows = [];

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
