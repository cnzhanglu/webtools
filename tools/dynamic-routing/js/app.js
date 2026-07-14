/**
 * 动态路由工具 — UI 交互层
 *
 * 数据流：
 *   BGP:  用户输入 → DynamicRoutingProcess.convertBgpLines() → 渲染表格 → 复制
 *   OSPF: 用户输入 → DynamicRoutingProcess.convertOspfLines() → 渲染表格 → 复制
 *
 * Tab 切换：两个 Tab 各自维护独立的 textarea / 结果缓存，切换时不清空数据。
 *
 * 依赖：BocUtils（复制）、DynamicRoutingProcess
 * 导出：DynamicRoutingApp（仅供 HTML 内联调用）
 */
var DynamicRoutingApp = (function () {
  'use strict';

  // 各 Tab 的结果缓存（用于复制）
  var lastBgpRows = [];
  var lastOspfRows = [];

  /* ================================================================
   * Tab 切换
   * ================================================================ */

  /** 切换到指定 Tab，更新按钮激活态与面板显示 */
  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });
  }

  /* ================================================================
   * 公共渲染辅助
   * ================================================================ */

  /** 渲染错误提示到指定 error-box 元素 */
  function renderErrors(boxId, errors, hasMsg) {
    var box = document.getElementById(boxId);
    if (!errors.length) {
      box.classList.remove('visible');
      box.innerHTML = '';
      return;
    }
    box.classList.add('visible');
    box.innerHTML = '<b>以下行无法解析：</b><br>' + errors.map(function (e) {
      var suffix = hasMsg && e.msg ? '（' + BocUtils.escHtml(e.msg) + '）' : '';
      return '第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text) + suffix;
    }).join('<br>');
  }

  /** 向 tbody 写入行数据，cells 为字符串数组，monoIdxs 为等宽列索引集合 */
  function renderRows(tbodyId, emptyColspan, emptyHint, rows, getCells, monoIdxs) {
    var tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="' + emptyColspan + '"><span class="empty-hint">' + emptyHint + '</span></td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      getCells(r).forEach(function (t, i) {
        var td = document.createElement('td');
        td.textContent = t;
        if (monoIdxs && monoIdxs.indexOf(i) !== -1) td.className = 'td-mono';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  /* ================================================================
   * BGP AS Tab
   * ================================================================ */

  function bgpConvert() {
    var raw = document.getElementById('bgp-input').value;
    var mode = document.getElementById('bgp-asdot-mode').value;
    var result = DynamicRoutingProcess.convertBgpLines(raw, mode);

    lastBgpRows = result.rows;
    renderErrors('bgp-error-box', result.errors, false);
    renderRows(
      'bgp-result-body', 6, '输入 AS 号后点击「转换」',
      result.rows,
      function (r) { return [String(r.lineNo), r.raw, String(r.decimal), r.display, r.kind, r.note]; },
      [2, 3]
    );
    document.getElementById('bgp-stat-badge').textContent =
      '共 ' + result.rows.length + ' 条' + (result.errors.length ? '，错误 ' + result.errors.length : '');
  }

  function bgpLoadSample() {
    document.getElementById('bgp-input').value =
      '# 2字节 AS\n1\n64512\n65535\n' +
      '# 4字节 AS（十进制）\n65536\n131072\n4200000001\n4294967295\n' +
      '# 带点格式\n1.0\n1.1\n64086.59904\n0.65535';
  }

  function bgpClear() {
    document.getElementById('bgp-input').value = '';
    document.getElementById('bgp-error-box').classList.remove('visible');
    lastBgpRows = [];
    document.getElementById('bgp-result-body').innerHTML =
      '<tr><td colspan="6"><span class="empty-hint">输入 AS 号后点击「转换」</span></td></tr>';
    document.getElementById('bgp-stat-badge').textContent = '—';
  }

  function bgpCopy() {
    if (!lastBgpRows.length) { alert('请先执行转换'); return; }
    var lines = ['行号\t原始输入\t十进制\tASDOT(X.Y)\t类型\t说明'];
    lastBgpRows.forEach(function (r) {
      lines.push([r.lineNo, r.raw, r.decimal, r.display, r.kind, r.note].join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  /* ================================================================
   * OSPF AREA Tab
   * ================================================================ */

  function ospfConvert() {
    var raw = document.getElementById('ospf-input').value;
    var result = DynamicRoutingProcess.convertOspfLines(raw);

    lastOspfRows = result.rows;
    renderErrors('ospf-error-box', result.errors, true);
    renderRows(
      'ospf-result-body', 6, '输入 Area ID 后点击「转换」',
      result.rows,
      function (r) { return [String(r.lineNo), r.raw, String(r.integer), r.dotted, r.kind, r.note]; },
      [2, 3]
    );
    document.getElementById('ospf-stat-badge').textContent =
      '共 ' + result.rows.length + ' 条' + (result.errors.length ? '，错误 ' + result.errors.length : '');
  }

  function ospfLoadSample() {
    document.getElementById('ospf-input').value =
      '# 骨干区域\n0\n0.0.0.0\n' +
      '# 普通区域（整数输入）\n1\n256\n3232235776\n' +
      '# 普通区域（点分输入）\n0.0.0.1\n0.0.1.0\n192.168.1.0';
  }

  function ospfClear() {
    document.getElementById('ospf-input').value = '';
    document.getElementById('ospf-error-box').classList.remove('visible');
    lastOspfRows = [];
    document.getElementById('ospf-result-body').innerHTML =
      '<tr><td colspan="6"><span class="empty-hint">输入 Area ID 后点击「转换」</span></td></tr>';
    document.getElementById('ospf-stat-badge').textContent = '—';
  }

  function ospfCopy() {
    if (!lastOspfRows.length) { alert('请先执行转换'); return; }
    var lines = ['行号\t原始输入\t纯整数\t点分十进制\t类型\t说明'];
    lastOspfRows.forEach(function (r) {
      lines.push([r.lineNo, r.raw, r.integer, r.dotted, r.kind, r.note].join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  /* ================================================================
   * 初始化
   * ================================================================ */

  document.addEventListener('DOMContentLoaded', function () {
    // Tab 点击事件委托
    document.getElementById('tab-bar').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });

    // BGP ASDOT 模式变化时自动重算（若已有结果）
    document.getElementById('bgp-asdot-mode').addEventListener('change', function () {
      var hint = document.getElementById('bgp-result-body').querySelector('.empty-hint');
      if (!hint) bgpConvert();
    });
  });

  return {
    switchTab: switchTab,
    bgpConvert: bgpConvert,
    bgpLoadSample: bgpLoadSample,
    bgpClear: bgpClear,
    bgpCopy: bgpCopy,
    ospfConvert: ospfConvert,
    ospfLoadSample: ospfLoadSample,
    ospfClear: ospfClear,
    ospfCopy: ospfCopy
  };
})();
