/**
 * CIDR 网段对比 — UI 交互层
 *
 * 数据流：双栏文本 / 文件加载 → CidrVsProcess.compare
 *        → 错误区 + 结果表（已覆盖/未覆盖着色）→ 复制 / xlsx
 *
 * 依赖：BocUtils、BocXlsx、CidrVsProcess
 */
var CidrVsApp = (function () {
  'use strict';

  var lastRows = [];

  function init() {
    bindFileLoader('file-a', 'input-a');
    bindFileLoader('file-b', 'input-b');
  }

  function bindFileLoader(inputId, textareaId) {
    var fileInput = document.getElementById(inputId);
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById(textareaId).value = ev.target.result;
      };
      reader.onerror = function () { alert('读取文件失败'); };
      reader.readAsText(file, 'UTF-8');
      e.target.value = '';
    });
  }

  function triggerLoad(inputId) {
    document.getElementById(inputId).click();
  }

  function clearInput(textareaId) {
    document.getElementById(textareaId).value = '';
  }

  function loadSample() {
    document.getElementById('input-a').value =
      '# 清单 A：基准覆盖网段\n' +
      '10.0.0.0/8\n' +
      '192.168.0.0/16\n' +
      '172.16.0.0/12\n' +
      '2001:db8::/32';
    document.getElementById('input-b').value =
      '# 清单 B：待检查网段\n' +
      '10.1.2.3\n' +
      '10.20.0.0/16\n' +
      '192.168.1.0/24\n' +
      '203.0.113.0/24\n' +
      '2001:db8:1::/48\n' +
      '2400:cb00::/32';
  }

  function doCompare() {
    var listA = document.getElementById('input-a').value;
    var listB = document.getElementById('input-b').value;

    var result = CidrVsProcess.compare(listA, listB);
    lastRows = result.rows;

    renderErrors(result.errorsA, result.errorsB);
    renderTable(result.rows);
    renderStats(result.stats);
  }

  function renderStats(stats) {
    document.getElementById('stat-badge').textContent =
      '基准 ' + stats.aCount + ' 条 / 待检 ' + stats.total +
      ' 条 · 已覆盖 ' + stats.covered + ' · 未覆盖 ' + stats.uncovered +
      (stats.errorCount ? ' · 错误 ' + stats.errorCount : '');
  }

  function renderErrors(errorsA, errorsB) {
    var box = document.getElementById('error-box');
    var parts = [];
    function fmt(prefix, errs) {
      return errs.map(function (e) {
        return prefix + '第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text) +
          ' — ' + BocUtils.escHtml(e.reason);
      });
    }
    parts = parts.concat(fmt('A 清单 ', errorsA)).concat(fmt('B 清单 ', errorsB));
    if (parts.length) {
      box.classList.add('visible');
      box.innerHTML = '<b>以下行无法解析，已跳过：</b><br>' + parts.join('<br>');
    } else {
      box.classList.remove('visible');
      box.innerHTML = '';
    }
  }

  function renderTable(rows) {
    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6"><span class="empty-hint">没有可对比的数据</span></td></tr>';
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tr = document.createElement('tr');
      tr.className = r.covered ? 'row-covered' : 'row-uncovered';
      tr.appendChild(td(String(r.lineNo)));
      tr.appendChild(td(r.raw));
      tr.appendChild(td(r.normalized));
      tr.appendChild(td(r.family));
      var statusTd = td(r.covered ? '已覆盖' : '未覆盖');
      statusTd.className = r.covered ? 'td-status covered' : 'td-status uncovered';
      tr.appendChild(statusTd);
      tr.appendChild(td(r.matched || '—'));
      tbody.appendChild(tr);
    }
  }

  function td(text) {
    var cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function copyResult() {
    if (!lastRows.length) { alert('请先执行对比'); return; }
    var lines = ['行号\tB原始\tB规范化\t协议\t覆盖状态\t匹配A网段'];
    lastRows.forEach(function (r) {
      lines.push([r.lineNo, r.raw, r.normalized, r.family,
        r.covered ? '已覆盖' : '未覆盖', r.matched].join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  function exportXlsx() {
    if (!lastRows.length) { alert('请先执行对比'); return; }
    var bytes = BocXlsx.generate(lastRows, {
      sheetName: 'CIDR对比',
      headers: ['行号', 'B原始输入', 'B规范化', '协议', '覆盖状态', '匹配A网段'],
      colWidths: [8, 28, 26, 8, 12, 28],
      rowMapper: function (r) {
        return [
          { col: 'A', value: r.lineNo, type: 'n' },
          { col: 'B', value: r.raw, style: 2 },
          { col: 'C', value: r.normalized, style: 2 },
          { col: 'D', value: r.family, style: 2 },
          { col: 'E', value: r.covered ? '已覆盖' : '未覆盖', style: 2 },
          { col: 'F', value: r.matched, style: 2 }
        ];
      }
    });
    BocUtils.downloadBlob(
      bytes,
      'CIDR对比_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  return {
    init: init,
    triggerLoad: triggerLoad,
    clearInput: clearInput,
    loadSample: loadSample,
    doCompare: doCompare,
    copyResult: copyResult,
    exportXlsx: exportXlsx
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  CidrVsApp.init();
});
