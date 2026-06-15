/**
 * GSLB JSON 导出 — UI 交互层
 *
 * 数据流：
 *   加载 JSON 文件 → 解析并扫描字段 → 穿梭框选列 → 预览表（分批渲染）
 *   → 可选关系图 / CSV 导出（UTF-8 BOM）
 *
 * 模块分工：GslbFields（方案）、GslbTransfer（选列）、GslbProcess（行数据）、
 *          GslbGraph（拓扑图）、BocUtils（下载）
 */
var GslbApp = (function () {
  'use strict';

  var jsonData = null;
  var pref = null;
  var availableFields = { domain: [], pool: [], member: [] };
  var dcMemberIndex = {};
  var previewColumns = [];
  var previewRows = [];
  var selectedDomainName = '';
  var filterState = { query: '', scope: 'all' };
  var activeView = 'table';
  var renderToken = 0;
  var filterTimer = null;

  var groupDomain = null;
  var groupPool = null;
  var groupMember = null;

  var BATCH_SIZE = 180;

  function init() {
    pref = GslbFields.loadPref();

    var schemeSelect = document.getElementById('scheme-select');
    var names = GslbFields.getSchemeNames();
    var i;
    for (i = 0; i < names.length; i++) {
      var opt = document.createElement('option');
      opt.value = names[i];
      opt.textContent = names[i];
      schemeSelect.appendChild(opt);
    }
    schemeSelect.value = pref.last_scheme || '运维巡检';

    groupDomain = new GslbTransfer.TransferGroup(
      document.getElementById('transfer-domain'),
      '域名字段',
      function (vals) { onGroupChange('domain', vals); }
    );
    groupPool = new GslbTransfer.TransferGroup(
      document.getElementById('transfer-pool'),
      '地址池字段',
      function (vals) { onGroupChange('pool', vals); }
    );
    groupMember = new GslbTransfer.TransferGroup(
      document.getElementById('transfer-member'),
      '服务成员及地址池成员字段',
      function (vals) { onGroupChange('member', vals); }
    );

    document.getElementById('file-input').addEventListener('change', onFileSelected);
    document.getElementById('btn-load').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-preview').addEventListener('click', preview);
    document.getElementById('btn-export').addEventListener('click', exportCsv);
    document.getElementById('btn-help').addEventListener('click', showHelp);
    document.getElementById('btn-reset').addEventListener('click', resetAllGroups);
    document.getElementById('btn-close-help').addEventListener('click', hideHelp);
    document.getElementById('help-overlay').addEventListener('click', function (e) {
      if (e.target === this) hideHelp();
    });

    schemeSelect.addEventListener('change', function () {
      pref.last_scheme = schemeSelect.value;
      GslbFields.savePref(pref);
      refreshFieldLists();
    });

    document.getElementById('filter-query').addEventListener('input', onFilterInput);
    document.getElementById('filter-scope').addEventListener('change', onFilterChange);
    document.getElementById('btn-clear-filter').addEventListener('click', clearFilter);

    document.getElementById('tab-table').addEventListener('click', function () { setActiveView('table'); });
    document.getElementById('tab-graph').addEventListener('click', function () { setActiveView('graph'); });
    document.getElementById('btn-view-graph').addEventListener('click', viewSelectedDomainGraph);
    document.getElementById('btn-graph-reset').addEventListener('click', function () {
      GslbGraph.resetView();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        var table = document.getElementById('preview-table');
        if (document.activeElement && table.contains(document.activeElement)) {
          copySelection();
          e.preventDefault();
        }
      }
    });

    refreshFieldLists();
    updateViewGraphButton();
    setStatus('状态：尚未加载 JSON');
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  function updateViewGraphButton() {
    var btn = document.getElementById('btn-view-graph');
    if (!btn) return;
    btn.disabled = !selectedDomainName;
    if (selectedDomainName) {
      btn.title = '查看域名「' + selectedDomainName + '」的引用关系图';
    } else {
      btn.title = '请先在表格中点击一行选择域名';
    }
  }

  function onFilterInput() {
    filterState.query = document.getElementById('filter-query').value;
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function () {
      applyFilterAndRender();
    }, 200);
  }

  function onFilterChange() {
    filterState.scope = document.getElementById('filter-scope').value;
    applyFilterAndRender();
  }

  function clearFilter() {
    filterState.query = '';
    filterState.scope = 'all';
    document.getElementById('filter-query').value = '';
    document.getElementById('filter-scope').value = 'all';
    applyFilterAndRender();
  }

  function setActiveView(view) {
    activeView = view;
    document.getElementById('tab-table').classList.toggle('active', view === 'table');
    document.getElementById('tab-graph').classList.toggle('active', view === 'graph');
    document.getElementById('view-table').classList.toggle('hidden', view !== 'table');
    document.getElementById('view-graph').classList.toggle('hidden', view !== 'graph');
    if (view === 'graph') {
      renderDomainGraph(selectedDomainName);
    }
  }

  function renderDomainGraph(domainName) {
    if (!jsonData || !domainName) {
      GslbGraph.render(null, null, domainName);
      return;
    }
    var topology = GslbProcess.buildTopology(jsonData, dcMemberIndex, domainName);
    GslbGraph.render(topology, null, domainName);
  }

  function viewSelectedDomainGraph() {
    if (!selectedDomainName) {
      alert('请先在表格中点击一行选择域名。');
      return;
    }
    setActiveView('graph');
  }

  function filterRows(rows, query, scope, columns) {
    if (!query) return rows;
    var q = query.toLowerCase();
    var filtered = [];
    var r, c, col, val;

    for (r = 0; r < rows.length; r++) {
      var row = rows[r];
      var matched = false;
      for (c = 0; c < columns.length; c++) {
        col = columns[c];
        if (scope === 'domain' && col.indexOf('domain.') !== 0) continue;
        if (scope === 'pool' && col.indexOf('pool.') !== 0) continue;
        if (scope === 'member' && col.indexOf('member.') !== 0) continue;
        val = row[col];
        if (val !== null && val !== undefined && String(val).toLowerCase().indexOf(q) !== -1) {
          matched = true;
          break;
        }
      }
      if (matched) filtered.push(row);
    }
    return filtered;
  }

  function updatePreviewBadge(shown, total) {
    var badge = document.getElementById('preview-badge');
    if (!badge) return;
    if (filterState.query && shown !== total) {
      badge.textContent = '显示 ' + shown + ' / 共 ' + total + ' 行';
    } else {
      badge.textContent = '共 ' + total + ' 行';
    }
  }

  function appendTableRow(tbody, row, columns) {
    var tr = document.createElement('tr');
    var domainName = row._domainName || row['domain.name'] || '';
    if (domainName) tr.setAttribute('data-domain', domainName);
    var c;
    for (c = 0; c < columns.length; c++) {
      var td = document.createElement('td');
      var val = row[columns[c]];
      td.textContent = val === null || val === undefined ? '' : String(val);
      td.title = td.textContent;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  function renderPreviewTable(rows) {
    var columns = previewColumns;
    var thead = document.getElementById('preview-head');
    var tbody = document.getElementById('preview-body');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!columns.length) {
      tbody.innerHTML = '<tr><td><span class="empty-hint">未选择任何字段</span></td></tr>';
      updatePreviewBadge(0, previewRows.length);
      return;
    }

    var trHead = document.createElement('tr');
    var i;
    for (i = 0; i < columns.length; i++) {
      var th = document.createElement('th');
      th.textContent = GslbFields.keyToCn(columns[i]);
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);

    if (!rows.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = columns.length;
      emptyTd.innerHTML = '<span class="empty-hint">无匹配数据，请调整过滤条件</span>';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      updatePreviewBadge(0, previewRows.length);
      return;
    }

    var token = ++renderToken;
    var idx = 0;

    function renderBatch() {
      if (token !== renderToken) return;
      var end = Math.min(idx + BATCH_SIZE, rows.length);
      for (; idx < end; idx++) {
        appendTableRow(tbody, rows[idx], columns);
      }
      if (idx < rows.length) {
        requestAnimationFrame(renderBatch);
      } else {
        restoreRowSelection();
      }
    }

    if (rows.length <= BATCH_SIZE) {
      for (i = 0; i < rows.length; i++) {
        appendTableRow(tbody, rows[i], columns);
      }
      restoreRowSelection();
    } else {
      requestAnimationFrame(renderBatch);
    }

    updatePreviewBadge(rows.length, previewRows.length);
  }

  function restoreRowSelection() {
    if (!selectedDomainName) return;
    var tbody = document.getElementById('preview-body');
    var trs = tbody.querySelectorAll('tr[data-domain]');
    var i;
    for (i = 0; i < trs.length; i++) {
      if (trs[i].getAttribute('data-domain') === selectedDomainName) {
        trs[i].classList.add('selected');
        break;
      }
    }
  }

  function selectDomainFromRow(tr) {
    var domainName = tr.getAttribute('data-domain') || '';
    if (!domainName) return;

    selectedDomainName = domainName;
    updateViewGraphButton();

    var tbody = document.getElementById('preview-body');
    var rows = tbody.querySelectorAll('tr.selected');
    var i;
    for (i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
    tr.classList.add('selected');

    if (activeView === 'graph') {
      renderDomainGraph(selectedDomainName);
    }
  }

  function applyFilterAndRender() {
    if (!previewRows.length) return;
    var filtered = filterRows(previewRows, filterState.query, filterState.scope, previewColumns);
    renderPreviewTable(filtered);
  }

  function onFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        jsonData = JSON.parse(ev.target.result);
      } catch (err) {
        alert('读取 JSON 失败：' + err.message);
        jsonData = null;
        return;
      }
      dcMemberIndex = GslbProcess.buildDcMemberIndex(jsonData);
      availableFields = GslbProcess.collectAvailableFields(jsonData, dcMemberIndex);
      previewRows = [];
      selectedDomainName = '';
      updateViewGraphButton();
      GslbGraph.render(null, null, '');
      setStatus('状态：已加载文件 ' + file.name);
      refreshFieldLists();
    };
    reader.onerror = function () {
      alert('读取文件失败');
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  }

  function currentSchemeOrders() {
    var scheme = document.getElementById('scheme-select').value;
    var saved = (pref.orders && pref.orders[scheme]) || { domain: [], pool: [], member: [] };
    var hasAny = saved.domain.length || saved.pool.length || saved.member.length;

    if (!hasAny && scheme !== '全量导出') {
      var base = GslbFields.BASE_SCHEMES[scheme] || { domain: [], pool: [], member: [] };
      return {
        domain: base.domain.slice(),
        pool: base.pool.slice(),
        member: base.member.slice()
      };
    }
    return {
      domain: (saved.domain || []).slice(),
      pool: (saved.pool || []).slice(),
      member: (saved.member || []).slice()
    };
  }

  function refreshFieldLists() {
    var scheme = document.getElementById('scheme-select').value;
    var orders = currentSchemeOrders();
    var changed = false;
    var grp;

    if (scheme === '全量导出') {
      var groups = ['domain', 'pool', 'member'];
      for (grp = 0; grp < groups.length; grp++) {
        var g = groups[grp];
        if (!orders[g].length && availableFields[g].length) {
          orders[g] = availableFields[g].slice();
          if (!pref.orders[scheme]) {
            pref.orders[scheme] = { domain: [], pool: [], member: [] };
          }
          pref.orders[scheme][g] = orders[g].slice();
          changed = true;
        }
      }
      if (changed) GslbFields.savePref(pref);
    }

    function setGroup(widget, groupKey) {
      var all = GslbFields.mergeFieldPool(groupKey, availableFields[groupKey]);
      var selected = orders[groupKey];
      var left = [];
      var i;
      for (i = 0; i < all.length; i++) {
        if (selected.indexOf(all[i]) === -1) left.push(all[i]);
      }
      widget.setValues(left, selected);
    }

    setGroup(groupDomain, 'domain');
    setGroup(groupPool, 'pool');
    setGroup(groupMember, 'member');
  }

  function onGroupChange(groupKey, rightKeys) {
    var scheme = document.getElementById('scheme-select').value;
    if (!pref.orders) pref.orders = {};
    if (!pref.orders[scheme]) {
      pref.orders[scheme] = { domain: [], pool: [], member: [] };
    }
    pref.orders[scheme][groupKey] = rightKeys.slice();
    GslbFields.savePref(pref);
  }

  function resetAllGroups() {
    var name = document.getElementById('scheme-select').value;
    var base = GslbFields.BASE_SCHEMES[name] || { domain: [], pool: [], member: [] };
    pref.orders[name] = {
      domain: name !== '全量导出' ? base.domain.slice() : [],
      pool: name !== '全量导出' ? base.pool.slice() : [],
      member: name !== '全量导出' ? base.member.slice() : []
    };
    GslbFields.savePref(pref);
    refreshFieldLists();
  }

  function getOrdersFromGroups() {
    return {
      domain: groupDomain.getSelectedKeys(),
      pool: groupPool.getSelectedKeys(),
      member: groupMember.getSelectedKeys()
    };
  }

  function preview() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var orders = getOrdersFromGroups();
    var rows = GslbProcess.buildAddRows(jsonData, orders, dcMemberIndex);
    var columns = orders.domain.concat(orders.pool).concat(orders.member);

    previewColumns = columns;
    previewRows = rows;
    selectedDomainName = '';
    updateViewGraphButton();

    applyFilterAndRender();
    setActiveView('table');
    GslbGraph.render(null, null, '');
  }

  function copySelection() {
    var table = document.getElementById('preview-table');
    var selected = table.querySelectorAll('tbody tr.selected');
    if (!selected.length) {
      var active = document.activeElement;
      if (active && active.tagName === 'TD' && active.parentElement) {
        selected = [active.parentElement];
      } else {
        return;
      }
    }

    var headers = [];
    var ths = table.querySelectorAll('thead th');
    var i, r, c, row, cells, line, lines;
    for (i = 0; i < ths.length; i++) {
      headers.push(ths[i].textContent);
    }
    lines = [headers.join('\t')];

    for (r = 0; r < selected.length; r++) {
      row = selected[r];
      cells = row.querySelectorAll('td');
      line = [];
      for (c = 0; c < cells.length; c++) {
        line.push(cells[c].textContent);
      }
      lines.push(line.join('\t'));
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lines.join('\n')).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = lines.join('\n');
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  function exportCsv() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var orders = getOrdersFromGroups();
    var columns = orders.domain.concat(orders.pool).concat(orders.member);
    if (!columns.length) {
      alert('未选择任何字段，无法导出。');
      return;
    }

    var rows = GslbProcess.buildAddRows(jsonData, orders, dcMemberIndex);
    var csvContent = GslbProcess.buildCsvContent(columns, rows);
    var filename = 'gslb_export_' + new Date().toISOString().slice(0, 10) + '.csv';
    BocUtils.downloadBlob('\uFEFF' + csvContent, filename, 'text/csv;charset=utf-8');
    alert('已导出 CSV：' + filename);
  }

  function showHelp() {
    document.getElementById('help-overlay').classList.add('visible');
  }

  function hideHelp() {
    document.getElementById('help-overlay').classList.remove('visible');
  }

  function bindRowSelection() {
    var tbody = document.getElementById('preview-body');
    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || !tbody.contains(tr) || !tr.getAttribute('data-domain')) return;

      if (e.ctrlKey || e.metaKey) {
        tr.classList.toggle('selected');
        if (tr.classList.contains('selected')) {
          selectDomainFromRow(tr);
        } else if (selectedDomainName === tr.getAttribute('data-domain')) {
          selectedDomainName = '';
          updateViewGraphButton();
          if (activeView === 'graph') GslbGraph.render(null, null, '');
        }
        return;
      }

      selectDomainFromRow(tr);
    });

    tbody.addEventListener('dblclick', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || !tbody.contains(tr) || !tr.getAttribute('data-domain')) return;
      selectDomainFromRow(tr);
      viewSelectedDomainGraph();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    bindRowSelection();
  });

  return {
    init: init,
    preview: preview,
    exportCsv: exportCsv
  };
})();
