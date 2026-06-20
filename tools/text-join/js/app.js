/**
 * 字符拼接工具 — UI 交互层
 *
 * 数据流：读取原始文本 / 分隔符 / 模式
 *   → TextJoinProcess.process() 转换
 *   → 渲染结果区 → 复制
 *
 * 实时转换使用 300ms 防抖，与桌面版 NimbleText Lite 一致。
 *
 * 依赖：BocUtils、TextJoinProcess
 * 导出：TextJoinApp
 */
var TextJoinApp = (function () {
  'use strict';

  var DEBOUNCE_MS = 300;
  var convertTimer = null;
  var lastResultText = '';

  function $(id) {
    return document.getElementById(id);
  }

  function isRealtimeEnabled() {
    return $('realtime-check').checked;
  }

  function scheduleConvert() {
    if (!isRealtimeEnabled()) return;
    if (convertTimer) clearTimeout(convertTimer);
    convertTimer = setTimeout(function () {
      convertTimer = null;
      doConvert();
    }, DEBOUNCE_MS);
  }

  function doConvert() {
    var raw = $('raw-input').value;
    var pattern = $('pattern-input').value;
    var separator = $('separator').value;

    if (!raw.trim() || !pattern.trim()) {
      $('result-output').value = '';
      lastResultText = '';
      $('stat-badge').textContent = '—';
      return;
    }

    var result = TextJoinProcess.process(raw, separator, pattern);
    lastResultText = result.lines.join('\n');
    $('result-output').value = lastResultText;
    $('stat-badge').textContent = result.lineCount ? '共 ' + result.lineCount + ' 条' : '—';
  }

  function setSeparator(value) {
    $('separator').value = value;
    if (isRealtimeEnabled()) {
      scheduleConvert();
    } else {
      doConvert();
    }
  }

  function clearAll() {
    $('raw-input').value = '';
    $('pattern-input').value = '';
    $('result-output').value = '';
    $('separator').value = ',';
    lastResultText = '';
    $('stat-badge').textContent = '—';
  }

  function copyResult() {
    if (!lastResultText) {
      alert('没有可复制的结果');
      return;
    }
    BocUtils.copyText(lastResultText);
  }

  function loadSample() {
    $('raw-input').value =
      '10.1.1.1,80\n' +
      '10.1.1.2,443\n' +
      '192.168.1.10,8080';
    $('pattern-input').value = 'create ip $1 port $2;';
    $('separator').value = ',';
    doConvert();
  }

  function init() {
    $('raw-input').addEventListener('input', scheduleConvert);
    $('pattern-input').addEventListener('input', scheduleConvert);
    $('separator').addEventListener('input', scheduleConvert);
    $('realtime-check').addEventListener('change', function () {
      if (this.checked) scheduleConvert();
    });
  }

  return {
    doConvert: doConvert,
    setSeparator: setSeparator,
    clearAll: clearAll,
    copyResult: copyResult,
    loadSample: loadSample,
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  TextJoinApp.init();
});
