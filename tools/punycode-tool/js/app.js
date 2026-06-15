/**
 * Punycode 域名编解码 — UI 交互层
 *
 * 数据流：多行域名 → BocPunycode.autoConvert / encodeDomain / decodeDomain
 *        → 结果表；支持将输出回填输入区便于链式转换。
 *
 * 依赖：BocUtils、BocPunycode
 */
var PunycodeApp = (function () {
  'use strict';

  var lastRows = [];

  function processInput() {
    var raw = document.getElementById('input-area').value;
    var lines = raw.split(/\r?\n/);
    var rows = [];
    var errors = [];

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text || text[0] === '#') continue;

      try {
        var r = BocPunycode.autoConvert(text);
        rows.push({
          lineNo: lineNo,
          input: text,
          output: r.result,
          direction: r.direction === 'encode' ? 'Unicode → ACE' : 'ACE → Unicode'
        });
      } catch (e) {
        errors.push({ lineNo: lineNo, text: lines[i], reason: e.message });
      }
    }

    lastRows = rows;
    renderErrors(errors);
    renderTable(rows);
    document.getElementById('stat-badge').textContent =
      '共 ' + rows.length + ' 条' + (errors.length ? '，错误 ' + errors.length : '');
  }

  function encodeAll() {
    applyAll('encode');
  }

  function decodeAll() {
    applyAll('decode');
  }

  function applyAll(direction) {
    var raw = document.getElementById('input-area').value;
    var lines = raw.split(/\r?\n/);
    var rows = [];
    var errors = [];

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text || text[0] === '#') continue;
      try {
        var result = direction === 'encode'
          ? BocPunycode.encodeDomain(text)
          : BocPunycode.decodeDomain(text);
        rows.push({
          lineNo: lineNo,
          input: text,
          output: result,
          direction: direction === 'encode' ? 'Unicode → ACE' : 'ACE → Unicode'
        });
      } catch (e) {
        errors.push({ lineNo: lineNo, text: lines[i], reason: e.message });
      }
    }

    lastRows = rows;
    renderErrors(errors);
    renderTable(rows);
    document.getElementById('stat-badge').textContent =
      '共 ' + rows.length + ' 条' + (errors.length ? '，错误 ' + errors.length : '');
  }

  function renderErrors(errors) {
    var box = document.getElementById('error-box');
    if (!errors.length) { box.classList.remove('visible'); box.innerHTML = ''; return; }
    box.classList.add('visible');
    box.innerHTML = '<b>以下行转换失败：</b><br>' + errors.map(function (e) {
      return '第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text) + ' — ' + BocUtils.escHtml(e.reason);
    }).join('<br>');
  }

  function renderTable(rows) {
    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4"><span class="empty-hint">输入域名后点击「自动转换」</span></td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [String(r.lineNo), r.input, r.output, r.direction].forEach(function (t, i) {
        var td = document.createElement('td');
        td.textContent = t;
        if (i === 1 || i === 2) td.className = 'td-domain';
        if (i === 3) td.className = 'td-dir';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function fillOutputToInput() {
    if (!lastRows.length) return;
    document.getElementById('input-area').value = lastRows.map(function (r) { return r.output; }).join('\n');
  }

  function copyOutput() {
    if (!lastRows.length) { alert('请先转换'); return; }
    BocUtils.copyText(lastRows.map(function (r) { return r.output; }).join('\n'));
  }

  function loadSample() {
    document.getElementById('input-area').value =
      '中文.com\n' +
      'xn--fiq228c.com\n' +
      '日本語.jp\n' +
      'münchen.de\n' +
      'xn--wgv71a119e.jp\n' +
      '中国互联网络信息中心.中国\n' +
      'example.com';
  }

  function clearInput() {
    document.getElementById('input-area').value = '';
    document.getElementById('error-box').classList.remove('visible');
    document.getElementById('result-body').innerHTML =
      '<tr><td colspan="4"><span class="empty-hint">输入域名后点击「自动转换」</span></td></tr>';
    document.getElementById('stat-badge').textContent = '—';
  }

  return {
    processInput: processInput,
    encodeAll: encodeAll,
    decodeAll: decodeAll,
    fillOutputToInput: fillOutputToInput,
    copyOutput: copyOutput,
    loadSample: loadSample,
    clearInput: clearInput
  };
})();
