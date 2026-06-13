/**
 * URL 编解码工具
 */
var UrlCodecApp = (function () {
  'use strict';

  var currentMode = 'component'; // 'component' | 'full' | 'form'

  /* ---- 核心编解码 ---- */

  function encode(input, mode) {
    if (mode === 'full') return encodeURI(input);
    if (mode === 'form') return encodeURIComponent(input).replace(/%20/g, '+');
    return encodeURIComponent(input); // component（默认）
  }

  function decode(input, mode) {
    if (mode === 'form') return decodeURIComponent(input.replace(/\+/g, '%20'));
    if (mode === 'full') return decodeURI(input);
    return decodeURIComponent(input); // component
  }

  /* ---- 单行处理 ---- */

  function doProcess(direction) {
    var input = document.getElementById('main-input').value;
    if (!input) return;
    var mode = document.querySelector('input[name="codec-mode"]:checked').value;

    try {
      var output = direction === 'encode' ? encode(input, mode) : decode(input, mode);
      document.getElementById('main-output').value = output;
      renderDiff(input, output, direction);
      document.getElementById('status-text').textContent = direction === 'encode' ? '编码完成' : '解码完成';
    } catch (e) {
      document.getElementById('main-output').value = '';
      document.getElementById('status-text').textContent = '失败：' + e.message;
      document.getElementById('diff-area').innerHTML = '';
    }
  }

  function swapInputOutput() {
    var a = document.getElementById('main-input').value;
    var b = document.getElementById('main-output').value;
    document.getElementById('main-input').value = b;
    document.getElementById('main-output').value = a;
    document.getElementById('diff-area').innerHTML = '';
    document.getElementById('status-text').textContent = '';
  }

  function clearAll() {
    document.getElementById('main-input').value = '';
    document.getElementById('main-output').value = '';
    document.getElementById('diff-area').innerHTML = '';
    document.getElementById('status-text').textContent = '';
  }

  function copyOutput() {
    var val = document.getElementById('main-output').value;
    if (!val) return;
    BocUtils.copyText(val);
  }

  /* ---- 差异高亮 ---- */

  function renderDiff(original, result, direction) {
    var box = document.getElementById('diff-area');
    if (original === result) {
      box.innerHTML = '<span class="diff-same">（编解码前后内容相同）</span>';
      return;
    }
    var label = direction === 'encode' ? '编码前' : '解码前';
    var labelOut = direction === 'encode' ? '编码后' : '解码后';
    box.innerHTML =
      '<div class="diff-row"><span class="diff-label">' + label + '</span><span class="diff-val diff-before">' +
      BocUtils.escHtml(original) + '</span></div>' +
      '<div class="diff-row"><span class="diff-label">' + labelOut + '</span><span class="diff-val diff-after">' +
      BocUtils.escHtml(result) + '</span></div>';
  }

  /* ---- 批量模式 ---- */

  function batchProcess(direction) {
    var raw = document.getElementById('batch-input').value;
    var mode = document.querySelector('input[name="codec-mode"]:checked').value;
    var lines = raw.split(/\r?\n/);
    var results = [];
    var errors = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { results.push(''); continue; }
      try {
        results.push(direction === 'encode' ? encode(line, mode) : decode(line, mode));
      } catch (e) {
        results.push('[错误：' + e.message + ']');
        errors++;
      }
    }
    document.getElementById('batch-output').value = results.join('\n');
    document.getElementById('batch-stat').textContent =
      lines.length + ' 行' + (errors ? '，错误 ' + errors + ' 行' : '，全部成功');
  }

  function batchSwap() {
    var a = document.getElementById('batch-input').value;
    var b = document.getElementById('batch-output').value;
    document.getElementById('batch-input').value = b;
    document.getElementById('batch-output').value = a;
  }

  function copyBatchOutput() {
    var val = document.getElementById('batch-output').value;
    if (!val) return;
    BocUtils.copyText(val);
  }

  /* ---- 标签切换 ---- */

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(function (pane) {
      pane.classList.toggle('active', pane.id === 'tab-' + tab);
    });
  }

  /* ---- 加载示例 ---- */

  function loadSample() {
    var tab = document.querySelector('.tab-btn.active').dataset.tab;
    if (tab === 'single') {
      document.getElementById('main-input').value = 'https://example.com/搜索?q=你好 世界&page=1#section 2';
    } else {
      document.getElementById('batch-input').value =
        'https://example.com/path?name=张三\nhello world\nfoo=bar&baz=qux\n中文参数值';
    }
  }

  /* ---- 初始化 ---- */

  function init() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    // 实时预览（单行模式输入时）
    document.getElementById('main-input').addEventListener('input', function () {
      if (!this.value) {
        document.getElementById('diff-area').innerHTML = '';
        document.getElementById('status-text').textContent = '';
      }
    });
  }

  return {
    init: init,
    doProcess: doProcess,
    swapInputOutput: swapInputOutput,
    clearAll: clearAll,
    copyOutput: copyOutput,
    batchProcess: batchProcess,
    batchSwap: batchSwap,
    copyBatchOutput: copyBatchOutput,
    loadSample: loadSample
  };
})();

document.addEventListener('DOMContentLoaded', function () { UrlCodecApp.init(); });
