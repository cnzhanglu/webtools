/**
 * BGP AS 号格式转换 — 逻辑与 UI 合一
 *
 * 支持十进制 ↔ ASDOT（X.Y，高 16 位.低 16 位）互转；
 * parseAS 识别输入格式，asRange 标注 RFC 保留/私有/文档用 AS 号段。
 * 批量模式按行处理，# 开头为注释行。
 *
 * 依赖：BocUtils
 * 导出：BgpAsApp
 */
var BgpAsApp = (function () {
  'use strict';

  var MAX_AS = 4294967295; // 2^32 - 1
  var ASDOT_THRESHOLD = 65536; // 2^16

  var lastRows = [];

  /** 解析单个 AS 号字符串，返回 { value, kind } 或 null */
  function parseAS(str) {
    str = str.trim();
    if (!str) return null;

    // 带点格式 X.Y
    var dotIdx = str.indexOf('.');
    if (dotIdx !== -1) {
      var xStr = str.slice(0, dotIdx);
      var yStr = str.slice(dotIdx + 1);
      if (!/^\d+$/.test(xStr) || !/^\d+$/.test(yStr)) return null;
      var x = parseInt(xStr, 10);
      var y = parseInt(yStr, 10);
      if (x < 0 || x > 65535 || y < 0 || y > 65535) return null;
      return { value: x * 65536 + y, kind: 'asdot' };
    }

    // 纯十进制
    if (!/^\d+$/.test(str)) return null;
    var v = parseInt(str, 10);
    if (v < 0 || v > MAX_AS) return null;
    return { value: v, kind: 'decimal' };
  }

  function toDot(value) {
    var x = Math.floor(value / 65536);
    var y = value % 65536;
    return x + '.' + y;
  }

  function toDisplayDot(value, mode) {
    if (mode === 'asdot') return toDot(value);
    return value >= ASDOT_THRESHOLD ? toDot(value) : String(value);
  }

  function asRange(value) {
    if (value === 0) return 'Reserved';
    if (value === 23456) return 'AS_TRANS (RFC 6793)';
    if (value >= 64496 && value <= 64511) return 'Documentation (RFC 5398)';
    if (value >= 64512 && value <= 65534) return '2字节私有 AS';
    if (value === 65535) return 'Reserved';
    if (value >= 65536 && value <= 65551) return 'Documentation (RFC 5398)';
    if (value >= 4200000000 && value <= 4294967294) return '4字节私有 AS';
    if (value === 4294967295) return 'Reserved';
    if (value < 65536) return '2字节公有 AS';
    return '4字节公有 AS';
  }

  function doConvert() {
    var raw = document.getElementById('input-area').value;
    var mode = document.getElementById('asdot-mode').value;
    var lines = raw.split(/\r?\n/);
    var rows = [];
    var errors = [];

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var text = lines[i].trim();
      if (!text || text[0] === '#') continue;

      var parsed = parseAS(text);
      if (!parsed) {
        errors.push({ lineNo: lineNo, text: lines[i] });
        continue;
      }

      var v = parsed.value;
      rows.push({
        lineNo: lineNo,
        raw: text,
        decimal: v,
        dot: toDot(v),
        display: toDisplayDot(v, mode),
        kind: parsed.kind === 'asdot' ? '点格式输入' : '十进制输入',
        note: asRange(v)
      });
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
    box.innerHTML = '<b>以下行无法解析：</b><br>' + errors.map(function (e) {
      return '第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text);
    }).join('<br>');
  }

  function renderTable(rows) {
    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6"><span class="empty-hint">没有可转换的数据</span></td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [String(r.lineNo), r.raw, String(r.decimal), r.dot, r.kind, r.note].forEach(function (t, i) {
        var td = document.createElement('td');
        td.textContent = t;
        if (i === 2 || i === 3) td.className = 'td-mono';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function loadSample() {
    document.getElementById('input-area').value =
      '# 2字节 AS\n1\n64512\n65535\n' +
      '# 4字节 AS (十进制)\n65536\n131072\n4200000001\n4294967295\n' +
      '# 带点格式\n1.0\n1.1\n64086.59904\n0.65535';
  }

  function clearInput() {
    document.getElementById('input-area').value = '';
    document.getElementById('error-box').classList.remove('visible');
  }

  function copyResult() {
    if (!lastRows.length) { alert('请先执行转换'); return; }
    var lines = ['行号\t原始输入\t十进制\tASDOT(X.Y)\t类型\t说明'];
    lastRows.forEach(function (r) {
      lines.push([r.lineNo, r.raw, r.decimal, r.dot, r.kind, r.note].join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  return { doConvert: doConvert, loadSample: loadSample, clearInput: clearInput, copyResult: copyResult };
})();

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('asdot-mode').addEventListener('change', function () {
    if (document.getElementById('result-body').querySelector('.empty-hint')) return;
    BgpAsApp.doConvert();
  });
});
