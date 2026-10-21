/**
 * 域名区汇总工具 — UI 交互层
 *
 * 数据流：读取多行区名称 → DnsZoneSummaryProcess.process() 汇总
 *   → 渲染保留区、统计、归属明细与无效输入 → 复制结果。
 *
 * 依赖：BocUtils、DnsZoneSummaryProcess
 * 导出：DnsZoneSummaryApp
 */
var DnsZoneSummaryApp = (function () {
  'use strict';

  var lastResultText = '';

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    $(id).textContent = String(value);
  }

  /** 使用 DOM 节点渲染用户输入，避免区名称进入 innerHTML。 */
  function renderMappings(mappings) {
    var body = $('mapping-body');
    body.textContent = '';

    if (!mappings.length) {
      var emptyRow = document.createElement('tr');
      emptyRow.className = 'empty-row';
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 2;
      emptyCell.textContent = '暂无合并项';
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }

    for (var i = 0; i < mappings.length; i++) {
      var row = document.createElement('tr');
      var sourceCell = document.createElement('td');
      var targetCell = document.createElement('td');
      sourceCell.textContent = mappings[i].source;
      targetCell.textContent = mappings[i].target;
      targetCell.className = 'mapping-arrow';
      row.appendChild(sourceCell);
      row.appendChild(targetCell);
      body.appendChild(row);
    }
  }

  /** 展示行号、原值与原因，便于用户直接定位并修正。 */
  function renderInvalidLines(invalidLines) {
    var panel = $('invalid-panel');
    var list = $('invalid-list');
    list.textContent = '';
    panel.hidden = invalidLines.length === 0;
    setText('invalid-badge', invalidLines.length + ' 条');

    for (var i = 0; i < invalidLines.length; i++) {
      var item = document.createElement('li');
      var value = document.createElement('span');
      value.className = 'invalid-value';
      value.textContent = invalidLines[i].value;
      item.appendChild(document.createTextNode('第 ' + invalidLines[i].line + ' 行：'));
      item.appendChild(value);
      item.appendChild(document.createTextNode(' — ' + invalidLines[i].reason));
      list.appendChild(item);
    }
  }

  function doSummarize() {
    var result = DnsZoneSummaryProcess.process($('zone-input').value);
    lastResultText = result.zones.join('\n');
    $('zone-output').value = lastResultText;

    setText('input-count', result.inputCount);
    setText('unique-count', result.uniqueCount);
    setText('merged-count', result.mergedCount);
    setText('result-count', result.zones.length);
    setText('mapping-badge', result.mergedCount + ' 条');

    var note = '有效 ' + result.validCount + ' 条';
    if (result.duplicateCount) note += '，忽略重复 ' + result.duplicateCount + ' 条';
    if (result.invalidLines.length) note += '，无效 ' + result.invalidLines.length + ' 条';
    $('result-note').textContent = result.inputCount ? note : '等待输入';

    renderMappings(result.mappings);
    renderInvalidLines(result.invalidLines);
  }

  function copyResult() {
    if (!lastResultText) {
      alert('没有可复制的汇总结果');
      return;
    }
    BocUtils.copyText(lastResultText, '汇总结果已复制到剪贴板！');
  }

  function loadSample() {
    $('zone-input').value =
      'Example.COM.\n' +
      'api.example.com\n' +
      'v2.api.example.com\n' +
      'example.net\n' +
      'shop.example.net\n' +
      'a.internal.local\n' +
      'b.internal.local\n' +
      'invalid zone';
    doSummarize();
  }

  function clearAll() {
    $('zone-input').value = '';
    lastResultText = '';
    doSummarize();
    $('zone-input').focus();
  }

  function init() {
    $('zone-input').addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        doSummarize();
      }
    });
  }

  return {
    doSummarize: doSummarize,
    copyResult: copyResult,
    loadSample: loadSample,
    clearAll: clearAll,
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  DnsZoneSummaryApp.init();
});
