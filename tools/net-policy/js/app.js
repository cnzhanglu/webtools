/**
 * 网络策略工具 — UI 交互层
 *
 * 数据流：用户输入 → NetPolicyProcess.process() 聚合
 *        → 渲染表格 + 错误提示 → lastResult 缓存 → 复制 / xlsx 导出
 *
 * 依赖：BocUtils、BocXlsx、NetPolicyProcess、NetPolicyIp
 */
var NetPolicyApp = (function () {
  'use strict';

  var lastResult = [];

  function init() {
    BocUtils.bindSepToggle('sep-preset', 'sep-custom-group');
    BocUtils.bindSepToggle('port-sep-preset', 'port-sep-custom-group');
  }

  function doProcess() {
    var raw = document.getElementById('input-area').value;
    if (!raw.trim()) return;

    var aggPrefixV4 = parseInt(document.getElementById('agg-mask').value, 10);
    var aggPrefixV6 = parseInt(document.getElementById('agg-mask6').value, 10);
    var maxAddr     = parseInt(document.getElementById('max-addr').value, 10) || 0;
    var addrSep     = BocUtils.getSep('sep-preset', 'sep-custom');
    var portSep     = BocUtils.getSep('port-sep-preset', 'port-sep-custom');
    var oneLineMode = document.getElementById('output-mode').value === 'one-line';

    var result = NetPolicyProcess.process(raw, aggPrefixV4, aggPrefixV6, maxAddr, oneLineMode);
    var resultRows = result.resultRows;
    var errors     = result.errors;

    var errBox = document.getElementById('error-box');
    if (errors.length) {
      errBox.classList.add('visible');
      errBox.innerHTML = '<b>以下行无法解析，已跳过：</b><br>' +
        errors.map(function (e) {
          return '第 ' + e.line + ' 行：' + BocUtils.escHtml(e.text);
        }).join('<br>');
    } else {
      errBox.classList.remove('visible');
      errBox.textContent = '';
    }

    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';

    if (!resultRows.length) {
      tbody.innerHTML = '<tr><td colspan="3"><span class="empty-hint">没有可聚合的数据</span></td></tr>';
      document.getElementById('stat-badge').textContent = '0 行';
      lastResult = [];
      return;
    }

    lastResult = resultRows.map(function (r) {
      return {
        addrs: r.addrs,
        port: r.ports.join(portSep),
        addrSep: addrSep,
        portSep: portSep,
      };
    });

    resultRows.forEach(function (row) {
      var portText = row.ports.join(portSep);
      var tr = document.createElement('tr');

      var addrCell = document.createElement('td');
      addrCell.style.whiteSpace = addrSep === '\n' ? 'pre' : 'pre-wrap';
      addrCell.textContent = row.addrs.join(addrSep);

      var portCell = document.createElement('td');
      portCell.className = 'td-port';
      portCell.style.whiteSpace = portSep === '\n' ? 'pre' : 'pre-wrap';
      portCell.textContent = portText;

      var countCell = document.createElement('td');
      countCell.className = 'td-count';
      countCell.textContent = row.addrs.length;

      tr.appendChild(addrCell);
      tr.appendChild(portCell);
      tr.appendChild(countCell);
      tbody.appendChild(tr);
    });

    var total = resultRows.reduce(function (s, r) { return s + r.addrs.length; }, 0);
    document.getElementById('stat-badge').textContent =
      '共 ' + resultRows.length + ' 行 / ' + total + ' 个地址';
  }

  function clearInput() {
    document.getElementById('input-area').value = '';
    document.getElementById('error-box').classList.remove('visible');
  }

  function loadSample() {
    document.getElementById('input-area').value =
      '10.1.1.5    80\n' +
      '10.1.1.8    80\n' +
      '10.1.1.200  80\n' +
      '10.0.0.1    80\n' +
      '10.0.0.2    80\n' +
      '10.1.2.5,443\n' +
      '10.1.2.6\t443\n' +
      '10.1.3.0/24 443\n' +
      '192.168.1.100  8080-8090\n' +
      '192.168.1.101  8080-8090\n' +
      '192.168.2.50   tcp/22\n' +
      '192.168.2.51   tcp/22\n' +
      '2409:8c00:1234::1   443\n' +
      '2409:8c00:1234::2   443\n' +
      '2409:8c00:5678::1   443\n' +
      '2409:8c00:5678::ff  8080-8090\n' +
      '::1                 80\n' +
      'fe80::1             tcp/22';
  }

  function copyResult() {
    if (!lastResult.length) return;
    var lines = lastResult.map(function (r) {
      return r.addrs.join(r.addrSep) + '\t' + r.port;
    });
    BocUtils.copyText(lines.join('\n'));
  }

  function exportXlsx() {
    if (!lastResult.length) { alert('请先执行聚合'); return; }

    var bytes = BocXlsx.generate(lastResult, {
      sheetName: '网络策略',
      headers: ['目标地址', '端口/服务', '地址数'],
      colWidths: [55, 30, 10],
      rowMapper: function (r) {
        return [
          { col: 'A', value: r.addrs.join(r.addrSep), style: 2 },
          { col: 'B', value: r.port, style: 2 },
          { col: 'C', value: r.addrs.length, type: 'n' },
        ];
      },
    });

    BocUtils.downloadBlob(
      bytes,
      '网络策略_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  return {
    init: init,
    doProcess: doProcess,
    clearInput: clearInput,
    loadSample: loadSample,
    copyResult: copyResult,
    exportXlsx: exportXlsx,
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  NetPolicyApp.init();
});
