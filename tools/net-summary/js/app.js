/**
 * 网段汇总 — UI 交互层
 *
 * 数据流：文本/文件输入 → NetSummaryProcess.summarize
 *        → 汇总表 + 报告区 + 来源明细折叠 → 复制 / xlsx
 *
 * 依赖：BocUtils、BocXlsx、NetSummaryProcess
 */
var NetSummaryApp = (function () {
  'use strict';

  var lastRows = [];

  function init() {
    document.getElementById('file-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById('input-area').value = ev.target.result;
      };
      reader.onerror = function () { alert('读取文件失败'); };
      reader.readAsText(file, 'UTF-8');
      e.target.value = '';
    });
  }

  function triggerLoad() {
    document.getElementById('file-input').click();
  }

  function resetResults() {
    lastRows = [];
    document.getElementById('result-body').innerHTML =
      '<tr><td colspan="5"><span class="empty-hint">输入网段后点击「开始汇总」</span></td></tr>';
    document.getElementById('report-box').innerHTML = '';
    document.getElementById('stat-badge').textContent = '—';
    document.getElementById('error-box').classList.remove('visible');
    document.getElementById('error-box').innerHTML = '';
  }

  function clearInput() {
    document.getElementById('input-area').value = '';
    resetResults();
  }

  function loadSample() {
    document.getElementById('input-area').value =
      '# 支持单 IP / CIDR / 范围，IPv4 与 IPv6\n' +
      '192.168.0.0/24\n' +
      '192.168.1.0/24\n' +
      '192.168.2.0/25\n' +
      '192.168.2.128/25\n' +
      '10.0.0.1-10.0.0.100\n' +
      '10.0.1.0/24\n' +
      '// 单个地址\n' +
      '172.16.5.5\n' +
      '2001:db8::/48\n' +
      '2001:db8:1::/48';
  }

  function doSummarize() {
    var raw = document.getElementById('input-area').value;
    var mode = document.getElementById('mode-select').value;
    var result = NetSummaryProcess.summarize(raw, mode);
    lastRows = result.rows;

    renderErrors(result.errors);
    renderTable(result.rows);
    renderStats(result.stats);
    renderReport(result.stats, mode);
  }

  function renderStats(stats) {
    document.getElementById('stat-badge').textContent =
      '输入 ' + stats.inputCount + ' 条 → 汇总 ' + stats.outputCount +
      ' 条 · 压缩 ' + stats.ratio + '%' +
      (stats.errorCount ? ' · 错误 ' + stats.errorCount : '');
  }

  function renderReport(stats, mode) {
    var box = document.getElementById('report-box');
    var modeLabel = {
      strict: '严格模式（仅合并等长连续网段）',
      loose: '宽松模式（允许不等长合并，精确覆盖）',
      compress: '压缩模式（允许超集覆盖，IPv4 最细 /25 · IPv6 最细 /64 大块对齐）'
    }[mode] || mode;
    var superset;
    if (mode === 'compress') {
      superset = stats.supersetExact
        ? '<span class="ok">输出地址与输入一致（无额外覆盖）</span>'
        : '<span class="warn">允许超集：额外覆盖 ' + stats.overflowTotal + ' 个地址</span>';
    } else {
      superset = stats.supersetExact
        ? '<span class="ok">精确超集校验通过（地址总数一致）</span>'
        : '<span class="warn">注意：合并前后地址总数不一致</span>';
    }
    box.innerHTML =
      '<div class="report-line"><b>汇总模式：</b>' + modeLabel + '</div>' +
      '<div class="report-line"><b>原始条目：</b>' + stats.inputCount +
        '（IPv4 ' + stats.v4In + ' · IPv6 ' + stats.v6In + '）</div>' +
      '<div class="report-line"><b>汇总条目：</b>' + stats.outputCount +
        '（IPv4 ' + stats.v4Out + ' · IPv6 ' + stats.v6Out + '）</div>' +
      '<div class="report-line"><b>压缩率：</b>' + stats.ratio + '%</div>' +
      '<div class="report-line"><b>原始地址总数：</b>' + stats.origTotal + '</div>' +
      '<div class="report-line"><b>覆盖地址总数：</b>' + stats.mergedTotal + '</div>' +
      '<div class="report-line">' + superset + '</div>';
  }

  function renderErrors(errors) {
    var box = document.getElementById('error-box');
    if (errors.length) {
      box.classList.add('visible');
      box.innerHTML = '<b>以下行无法解析，已跳过：</b><br>' +
        errors.map(function (e) {
          return '第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text) +
            ' — ' + BocUtils.escHtml(e.reason);
        }).join('<br>');
    } else {
      box.classList.remove('visible');
      box.innerHTML = '';
    }
  }

  function renderTable(rows) {
    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6"><span class="empty-hint">没有可汇总的数据</span></td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(td(String(r.index)));
      var cidrTd = td(r.cidr);
      cidrTd.className = 'td-cidr';
      tr.appendChild(cidrTd);
      tr.appendChild(td(r.family));
      tr.appendChild(td(r.count));

      var srcCountTd = document.createElement('td');
      if (r.sources.length) {
        var btn = document.createElement('button');
        btn.className = 'src-toggle';
        btn.textContent = r.sourceCount + ' 条 ▸';
        var detail = document.createElement('div');
        detail.className = 'src-detail';
        detail.style.display = 'none';
        detail.textContent = r.sources.map(function (s) {
          return (s.lineNo ? '第' + s.lineNo + '行 ' : '') + s.text;
        }).join('\n');
        btn.addEventListener('click', function () {
          var open = detail.style.display !== 'none';
          detail.style.display = open ? 'none' : 'block';
          btn.textContent = r.sourceCount + (open ? ' 条 ▸' : ' 条 ▾');
        });
        srcCountTd.appendChild(btn);
        srcCountTd.appendChild(detail);
      } else {
        srcCountTd.textContent = '0';
      }
      tr.appendChild(srcCountTd);
      tbody.appendChild(tr);
    });
  }

  function td(text) {
    var cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function copyResult() {
    if (!lastRows.length) { alert('请先执行汇总'); return; }
    var lines = ['序号\t汇总网段\t协议\t地址数\t来源条目数\t来源明细'];
    lastRows.forEach(function (r) {
      var src = r.sources.map(function (s) {
        return (s.lineNo ? 'L' + s.lineNo + ':' : '') + s.text;
      }).join('; ');
      lines.push([r.index, r.cidr, r.family, r.count, r.sourceCount, src].join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  function exportXlsx() {
    if (!lastRows.length) { alert('请先执行汇总'); return; }
    var bytes = BocXlsx.generate(lastRows, {
      sheetName: '网段汇总',
      headers: ['序号', '汇总网段', '协议', '地址数', '来源条目数', '来源明细'],
      colWidths: [8, 30, 8, 20, 12, 50],
      rowMapper: function (r) {
        var src = r.sources.map(function (s) {
          return (s.lineNo ? 'L' + s.lineNo + ':' : '') + s.text;
        }).join('\n');
        return [
          { col: 'A', value: r.index, type: 'n' },
          { col: 'B', value: r.cidr, style: 2 },
          { col: 'C', value: r.family, style: 2 },
          { col: 'D', value: r.count, style: 2 },
          { col: 'E', value: r.sourceCount, type: 'n' },
          { col: 'F', value: src, style: 2 }
        ];
      }
    });
    BocUtils.downloadBlob(
      bytes,
      '网段汇总_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  return {
    init: init,
    triggerLoad: triggerLoad,
    clearInput: clearInput,
    loadSample: loadSample,
    doSummarize: doSummarize,
    copyResult: copyResult,
    exportXlsx: exportXlsx
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  NetSummaryApp.init();
});
