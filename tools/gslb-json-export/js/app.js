/**
 * GSLB JSON 导出 — UI 交互层
 *
 * 数据流：
 *   加载 JSON 文件 → 解析并扫描字段 → 穿梭框选列 → 虚拟滚动预览表
 *   → 点击查询/回车过滤（始终匹配域名名称与类型）→ 点击表格行在下方实时渲染关系图 / CSV 导出（UTF-8 BOM）
 *   → 点击「生成创建命令」→ 按过滤域名生成 CLI 命令 → 弹窗展示 / 复制 / 下载
 *   → 选中单个域名 → 勾选或输入成员 IP → 生成逐 ID 的 RRS 成员启停命令
 *
 * 布局：表格始终可见，关系图固定显示在表格下方；重新查询/清除过滤时关系图自动清空
 * 唯一键：域名名称 + 域名类型（name+type），与 commands.js 保持一致
 *
 * 模块分工：GslbFields（方案）、GslbTransfer（选列）、GslbProcess（行数据）、
 *          GslbGraph（拓扑图）、GslbCommands（命令生成）、BocUtils（下载）
 */
var GslbApp = (function () {
  'use strict';

  var jsonData = null;
  var pref = null;
  var availableFields = { domain: [], pool: [], member: [] };
  var dcMemberIndex = {};
  var previewColumns = [];
  var previewRows = [];
  var displayRows = [];
  /** 当前选中的域名唯一键；name+type 共同确定一条域名记录 */
  var selectedDomainKey = { name: '', type: '' };
  var selectedRowIndices = {};
  var filterState = { query: '', scope: 'all', match: 'contains' };
  var currentRrsMemberText = '';

  var groupDomain = null;
  var groupPool = null;
  var groupMember = null;

  /** 虚拟滚动：默认行高（首次渲染后按实测值修正） */
  var ROW_HEIGHT = 34;
  var measuredRowHeight = 0;
  var VIRTUAL_OVERSCAN = 6;
  var scrollRaf = null;

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
    document.getElementById('btn-export-domain-list').addEventListener('click', exportDomainListCsv);
    document.getElementById('btn-export-domain-list-txt').addEventListener('click', exportDomainListTxt);
    document.getElementById('btn-export-orphan-pool').addEventListener('click', exportOrphanPoolCsv);
    document.getElementById('btn-export-orphan-member').addEventListener('click', exportOrphanMemberCsv);
    document.getElementById('btn-help').addEventListener('click', showHelp);
    document.getElementById('btn-reset').addEventListener('click', resetAllGroups);
    document.getElementById('btn-close-help').addEventListener('click', hideHelp);
    document.getElementById('help-overlay').addEventListener('click', function (e) {
      if (e.target === this) hideHelp();
    });

    document.getElementById('btn-gen-cmds').addEventListener('click', generateCreateCommands);
    document.getElementById('btn-close-cmds').addEventListener('click', hideCmdsModal);
    document.getElementById('cmds-overlay').addEventListener('click', function (e) {
      if (e.target === this) hideCmdsModal();
    });
    document.getElementById('btn-cmds-copy').addEventListener('click', copyCmds);
    document.getElementById('btn-cmds-download').addEventListener('click', downloadCmdsTxt);
    document.getElementById('btn-rrs-member').addEventListener('click', showRrsMemberModal);
    document.getElementById('btn-rrs-member-generate').addEventListener('click', generateRrsMemberCommands);
    document.getElementById('btn-rrs-member-copy').addEventListener('click', copyRrsMemberCommands);
    document.getElementById('btn-close-rrs-member').addEventListener('click', hideRrsMemberModal);
    document.getElementById('rrs-member-overlay').addEventListener('click', function (e) {
      if (e.target === this) hideRrsMemberModal();
    });

    schemeSelect.addEventListener('change', function () {
      pref.last_scheme = schemeSelect.value;
      GslbFields.savePref(pref);
      refreshFieldLists();
    });

    document.getElementById('btn-filter-query').addEventListener('click', onFilterQuery);
    document.getElementById('filter-query').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onFilterQuery();
      }
    });
    document.getElementById('btn-clear-filter').addEventListener('click', clearFilter);

    document.getElementById('btn-view-graph').addEventListener('click', viewSelectedDomainGraph);
    document.getElementById('btn-graph-zoom-in').addEventListener('click', function () {
      GslbGraph.zoomIn();
    });
    document.getElementById('btn-graph-zoom-out').addEventListener('click', function () {
      GslbGraph.zoomOut();
    });
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
    updateRrsMemberButton();
    updateGenCmdsButton();
    bindVirtualScroll();
    setStatus('状态：尚未加载 JSON');
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  function updateViewGraphButton() {
    var btn = document.getElementById('btn-view-graph');
    if (!btn) return;
    btn.disabled = !selectedDomainKey.name;
    if (selectedDomainKey.name) {
      var label = selectedDomainKey.name + (selectedDomainKey.type ? ' (' + selectedDomainKey.type + ')' : '');
      btn.title = '查看域名「' + label + '」的引用关系图';
    } else {
      btn.title = '请先在表格中点击一行选择域名';
    }
  }

  /** 成员启停严格绑定当前单选域名，没有域名选择时禁用入口。 */
  function updateRrsMemberButton() {
    var btn = document.getElementById('btn-rrs-member');
    if (!btn) return;
    btn.disabled = !jsonData || !selectedDomainKey.name;
    btn.title = selectedDomainKey.name
      ? '生成域名「' + selectedDomainKey.name + ' (' + selectedDomainKey.type + ')」的成员启停命令'
      : '请先在表格中点击一行选择域名';
  }

  /** 从输入框读取条件并执行过滤（点击查询或回车触发）；过滤后清空关系图与行选中 */
  function onFilterQuery() {
    filterState.query = document.getElementById('filter-query').value;
    filterState.match = document.getElementById('filter-match').value;
    filterState.scope = document.getElementById('filter-scope').value;
    clearSelectionAndGraph();
    applyFilterAndRender();
  }

  function clearFilter() {
    filterState.query = '';
    filterState.scope = 'all';
    filterState.match = 'contains';
    document.getElementById('filter-query').value = '';
    document.getElementById('filter-match').value = 'contains';
    document.getElementById('filter-scope').value = 'all';
    clearSelectionAndGraph();
    applyFilterAndRender();
  }

  /** 清空行选中状态与关系图，重新查询时调用 */
  function clearSelectionAndGraph() {
    selectedDomainKey = { name: '', type: '' };
    selectedRowIndices = {};
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    GslbGraph.render(null, null, '');
  }

  function syncFilterFromInputs() {
    filterState.query = document.getElementById('filter-query').value;
    filterState.match = document.getElementById('filter-match').value;
    filterState.scope = document.getElementById('filter-scope').value;
  }

  function bindVirtualScroll() {
    var scrollEl = document.getElementById('preview-scroll');
    if (!scrollEl || scrollEl._vsBound) return;
    scrollEl._vsBound = true;
    scrollEl.addEventListener('scroll', onPreviewScroll);
  }

  function onPreviewScroll() {
    if (!displayRows.length) return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = null;
      renderVirtualSlice();
    });
  }

  function resetPreviewScroll() {
    var scrollEl = document.getElementById('preview-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;
  }

  /**
   * 渲染关系图。
   * @param {string} name  域名名称
   * @param {string} type  域名类型（A/AAAA 等）
   */
  function renderDomainGraph(name, type) {
    if (!jsonData || !name) {
      GslbGraph.render(null, null, '');
      return;
    }
    // 构建展示标签：有类型时显示 "name (type)"
    var displayLabel = name + (type ? ' (' + type + ')' : '');
    var topology = GslbProcess.buildTopology(jsonData, dcMemberIndex, name, type);
    GslbGraph.render(topology, null, displayLabel);
  }

  /** 点击「查看关系图」按钮时，直接在下方渲染（表格始终可见，无需切 tab） */
  function viewSelectedDomainGraph() {
    if (!selectedDomainKey.name) {
      alert('请先在表格中点击一行选择域名。');
      return;
    }
    renderDomainGraph(selectedDomainKey.name, selectedDomainKey.type);
  }

  /**
   * 按查询条件过滤行。
   * @param {string} match  'contains'（包含，大小写不敏感）或 'equals'（精确等于，大小写不敏感）
   *
   * 当 scope 为 all 或 domain 时，始终先匹配行的 _domainName / _domainType 元数据，
   * 不依赖「域名名称」或「域名类型」列是否已勾选。
   */
  function filterRows(rows, query, scope, columns, match) {
    if (!query) return rows;
    var q = query.toLowerCase();
    var exactMatch = (match === 'equals');
    var filtered = [];
    var r, c, col, val, valStr;

    function hit(str) {
      if (!str) return false;
      var s = String(str).toLowerCase();
      return exactMatch ? s === q : s.indexOf(q) !== -1;
    }

    for (r = 0; r < rows.length; r++) {
      var row = rows[r];
      var matched = false;

      // 1. 先匹配域名元数据（不依赖勾选列）
      if (scope === 'all' || scope === 'domain') {
        matched = hit(row._domainName) || hit(row._domainType);
      }

      // 2. 再扫预览列
      if (!matched) {
        for (c = 0; c < columns.length; c++) {
          col = columns[c];
          if (scope === 'domain' && col.indexOf('domain.') !== 0) continue;
          if (scope === 'pool' && col.indexOf('pool.') !== 0) continue;
          if (scope === 'member' && col.indexOf('member.') !== 0) continue;
          val = row[col];
          if (val === null || val === undefined) continue;
          valStr = String(val).toLowerCase();
          if (exactMatch ? valStr === q : valStr.indexOf(q) !== -1) {
            matched = true;
            break;
          }
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

  function buildTableRow(row, columns, rowIndex) {
    var tr = document.createElement('tr');
    var domainName = row._domainName || row['domain.name'] || '';
    var domainType = row._domainType !== undefined ? row._domainType : (row['domain.type'] || '');
    if (domainName) {
      tr.setAttribute('data-domain', domainName);
      tr.setAttribute('data-domain-type', domainType);
    }
    if (rowIndex !== undefined && rowIndex !== null) {
      tr.setAttribute('data-row-index', String(rowIndex));
      if (selectedRowIndices[String(rowIndex)]) tr.classList.add('selected');
    }
    var c;
    for (c = 0; c < columns.length; c++) {
      var td = document.createElement('td');
      var val = row[columns[c]];
      td.textContent = val === null || val === undefined ? '' : String(val);
      td.title = td.textContent;
      tr.appendChild(td);
    }
    return tr;
  }

  function appendSpacerRow(height, colSpan) {
    var tr = document.createElement('tr');
    tr.className = 'virtual-spacer';
    tr.setAttribute('aria-hidden', 'true');
    var td = document.createElement('td');
    td.colSpan = colSpan;
    td.style.height = height + 'px';
    tr.appendChild(td);
    return tr;
  }

  /** 首次有数据时测量真实行高，供虚拟滚动计算可视窗口 */
  function ensureRowHeight(columns, sampleRow) {
    if (measuredRowHeight > 0) return;
    var tbody = document.getElementById('preview-body');
    var tr = buildTableRow(sampleRow, columns);
    tr.style.visibility = 'hidden';
    tbody.appendChild(tr);
    measuredRowHeight = tr.offsetHeight || ROW_HEIGHT;
    tbody.removeChild(tr);
  }

  /** 按滚动位置仅渲染可视区行 + 上下占位，避免全量 DOM */
  function renderVirtualSlice() {
    var scrollEl = document.getElementById('preview-scroll');
    var tbody = document.getElementById('preview-body');
    var columns = previewColumns;
    var rows = displayRows;
    var total = rows.length;
    var rowHeight = measuredRowHeight || ROW_HEIGHT;
    var scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    var viewHeight = scrollEl ? scrollEl.clientHeight : 420;
    var start = Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN;
    var visibleCount;
    var end;
    var frag;
    var topHeight;
    var bottomHeight;
    var i;

    if (start < 0) start = 0;
    visibleCount = Math.ceil(viewHeight / rowHeight) + VIRTUAL_OVERSCAN * 2;
    end = start + visibleCount;
    if (end > total) end = total;

    frag = document.createDocumentFragment();
    topHeight = start * rowHeight;
    if (topHeight > 0) frag.appendChild(appendSpacerRow(topHeight, columns.length));

    for (i = start; i < end; i++) {
      frag.appendChild(buildTableRow(rows[i], columns, i));
    }

    bottomHeight = (total - end) * rowHeight;
    if (bottomHeight > 0) frag.appendChild(appendSpacerRow(bottomHeight, columns.length));

    tbody.innerHTML = '';
    tbody.appendChild(frag);
    restoreRowSelection();
  }

  function renderPreviewTable() {
    var columns = previewColumns;
    var rows = displayRows;
    var thead = document.getElementById('preview-head');
    var tbody = document.getElementById('preview-body');
    var trHead;
    var i;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!columns.length) {
      tbody.innerHTML = '<tr><td><span class="empty-hint">未选择任何字段</span></td></tr>';
      updatePreviewBadge(0, previewRows.length);
      return;
    }

    trHead = document.createElement('tr');
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
      emptyTd.innerHTML = '<span class="empty-hint">无匹配数据，请调整过滤条件后点击查询</span>';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      updatePreviewBadge(0, previewRows.length);
      return;
    }

    ensureRowHeight(columns, rows[0]);
    renderVirtualSlice();
    updatePreviewBadge(rows.length, previewRows.length);
  }

  function restoreRowSelection() {
    if (!selectedDomainKey.name) return;
    var tbody = document.getElementById('preview-body');
    var trs = tbody.querySelectorAll('tr[data-domain]');
    var i;
    for (i = 0; i < trs.length; i++) {
      if (trs[i].getAttribute('data-domain') === selectedDomainKey.name &&
          trs[i].getAttribute('data-domain-type') === selectedDomainKey.type) {
        trs[i].classList.add('selected');
        break;
      }
    }
  }

  function selectDomainFromRow(tr) {
    var domainName = tr.getAttribute('data-domain') || '';
    if (!domainName) return;

    selectedDomainKey = { name: domainName, type: tr.getAttribute('data-domain-type') || '' };
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();

    var tbody = document.getElementById('preview-body');
    var rows = tbody.querySelectorAll('tr.selected');
    var i;
    for (i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
    tr.classList.add('selected');

    renderDomainGraph(selectedDomainKey.name, selectedDomainKey.type);
  }

  function applyFilterAndRender() {
    if (!previewColumns.length) {
      displayRows = [];
      renderPreviewTable();
      return;
    }
    if (!previewRows.length) {
      displayRows = [];
      renderPreviewTable();
      return;
    }
    displayRows = filterRows(previewRows, filterState.query, filterState.scope, previewColumns, filterState.match);
    resetPreviewScroll();
    renderPreviewTable();
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
      displayRows = [];
      measuredRowHeight = 0;
      selectedDomainKey = { name: '', type: '' };
      updateViewGraphButton();
      updateRrsMemberButton();
      resetRrsMemberModal();
      updateGenCmdsButton();
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
    measuredRowHeight = 0;
    selectedDomainKey = { name: '', type: '' };
    selectedRowIndices = {};
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    updateGenCmdsButton();

    syncFilterFromInputs();
    applyFilterAndRender();
    GslbGraph.render(null, null, '');
  }

  function copySelection() {
    if (!previewColumns.length || !displayRows.length) return;

    var rowsToCopy = [];
    var keys = Object.keys(selectedRowIndices);
    var i;

    if (keys.length) {
      keys.sort(function (a, b) { return Number(a) - Number(b); });
      for (i = 0; i < keys.length; i++) {
        rowsToCopy.push(displayRows[Number(keys[i])]);
      }
    } else if (selectedDomainKey.name) {
      for (i = 0; i < displayRows.length; i++) {
        var dn = displayRows[i]._domainName || displayRows[i]['domain.name'] || '';
        var dt = displayRows[i]._domainType !== undefined ? displayRows[i]._domainType : (displayRows[i]['domain.type'] || '');
        if (dn === selectedDomainKey.name && dt === selectedDomainKey.type) rowsToCopy.push(displayRows[i]);
      }
    } else {
      var active = document.activeElement;
      if (active && active.tagName === 'TD' && active.parentElement) {
        var idx = active.parentElement.getAttribute('data-row-index');
        if (idx !== null) rowsToCopy.push(displayRows[Number(idx)]);
      }
    }

    if (!rowsToCopy.length) return;

    var headers = previewColumns.map(function (c) { return GslbFields.keyToCn(c); });
    var lines = [headers.join('\t')];
    for (i = 0; i < rowsToCopy.length; i++) {
      var row = rowsToCopy[i];
      var line = previewColumns.map(function (c) {
        var val = row[c];
        return val === null || val === undefined ? '' : String(val);
      });
      lines.push(line.join('\t'));
    }
    BocUtils.copyText(lines.join('\n'));
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

  function exportDomainListCsv() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var columns = ['domain.name', 'domain.type', 'domain.algorithm', 'member.ip'];
    var rows = GslbProcess.buildDomainListRows(jsonData);
    if (!rows.length) {
      alert('未找到可导出的域名列表数据。');
      return;
    }
    var csvContent = GslbProcess.buildCsvContent(columns, rows);
    var filename = 'gslb_domain_list_' + new Date().toISOString().slice(0, 10) + '.csv';
    BocUtils.downloadBlob('\uFEFF' + csvContent, filename, 'text/csv;charset=utf-8');
    alert('已导出域名列表 CSV：' + filename);
  }

  function exportDomainListTxt() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var rows = GslbProcess.buildDomainListRows(jsonData);
    if (!rows.length) {
      alert('未找到可导出的域名列表数据。');
      return;
    }
    var lines = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      lines.push([
        rows[i]['domain.name'] || '',
        rows[i]['domain.type'] || '',
        rows[i]['domain.algorithm'] || '',
        rows[i]['member.ip'] || ''
      ].join(' '));
    }
    var txtContent = lines.join('\n');
    var filename = 'gslb_domain_list_' + new Date().toISOString().slice(0, 10) + '.txt';
    BocUtils.downloadBlob(txtContent, filename, 'text/plain;charset=utf-8');
    alert('已导出域名列表 TXT：' + filename);
  }

  function exportOrphanPoolCsv() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var orders = getOrdersFromGroups();
    var columns = orders.pool.concat(orders.member);
    if (!columns.length) {
      alert('未选择任何地址池或成员字段，无法导出。');
      return;
    }

    var rows = GslbProcess.buildOrphanGpoolRows(jsonData, orders, dcMemberIndex);
    if (!rows.length) {
      alert('未找到未被域名引用的地址池。');
      return;
    }
    var csvContent = GslbProcess.buildCsvContent(columns, rows);
    var filename = 'gslb_orphan_pool_' + new Date().toISOString().slice(0, 10) + '.csv';
    BocUtils.downloadBlob('\uFEFF' + csvContent, filename, 'text/csv;charset=utf-8');
    alert('已导出未引用地址池 CSV：' + filename);
  }

  function exportOrphanMemberCsv() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }

    var orders = getOrdersFromGroups();
    var columns = orders.member.slice();
    if (!columns.length) {
      alert('未选择任何成员字段，无法导出。');
      return;
    }

    var rows = GslbProcess.buildOrphanGmemberRows(jsonData, orders, dcMemberIndex);
    if (!rows.length) {
      alert('未找到未被地址池引用的服务成员。');
      return;
    }
    var csvContent = GslbProcess.buildCsvContent(columns, rows);
    var filename = 'gslb_orphan_member_' + new Date().toISOString().slice(0, 10) + '.csv';
    BocUtils.downloadBlob('\uFEFF' + csvContent, filename, 'text/csv;charset=utf-8');
    alert('已导出未引用的服务成员 CSV：' + filename);
  }

  /** 当前命令弹窗的文本内容（用于复制/下载） */
  var currentCmdsText = '';

  /** 从 displayRows 提取去重的域名记录键（name + type），返回 [{name, type}, ...] */
  function getFilteredDomainKeys() {
    var seen = {};
    var keys = [];
    var i, row, name, type, k;
    for (i = 0; i < displayRows.length; i++) {
      row = displayRows[i];
      name = row['domain.name'] || row._domainName || '';
      type = row['domain.type'] || '';
      if (!name) continue;
      k = name + '\0' + type;
      if (!seen[k]) {
        seen[k] = true;
        keys.push({ name: name, type: type });
      }
    }
    return keys;
  }

  /** 更新「生成创建命令」按钮可用状态 */
  function updateGenCmdsButton() {
    var btn = document.getElementById('btn-gen-cmds');
    if (!btn) return;
    btn.disabled = !jsonData || !previewRows.length;
  }

  /** 按过滤后域名记录生成 CLI 命令并弹窗展示 */
  function generateCreateCommands() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }
    if (!previewRows.length) {
      alert('请先点击「预览」加载数据。');
      return;
    }

    var domainKeys = getFilteredDomainKeys();
    if (!domainKeys.length) {
      alert('当前过滤结果中未找到域名记录，请检查搜索条件或先点击「预览」。');
      return;
    }

    var result = GslbCommands.buildCommandsForDomains(jsonData, domainKeys, dcMemberIndex);
    var lines = result.lines;
    var warnings = result.warnings;

    currentCmdsText = lines.join('\n');

    // 显示警告条
    var warningBar = document.getElementById('cmds-warning-bar');
    if (warnings.length) {
      warningBar.textContent = '⚠ ' + warnings.join('\n⚠ ');
      warningBar.style.display = '';
    } else {
      warningBar.style.display = 'none';
    }

    // 元信息
    var meta = document.getElementById('cmds-meta');
    var domainCount = domainKeys.length;
    var cmdCount = lines.filter(function (l) { return l.indexOf('create ') === 0; }).length;
    var matchLabel = filterState.match === 'equals' ? '等于' : '包含';
    meta.textContent = '共 ' + domainCount + ' 条域名记录，生成 ' + cmdCount + ' 条命令'
      + (filterState.query ? '（过滤：' + matchLabel + ' "' + filterState.query + '"）' : '（全部预览域名）');

    // 命令文本
    document.getElementById('cmds-pre').textContent = currentCmdsText;

    document.getElementById('cmds-overlay').classList.add('visible');
  }

  function hideCmdsModal() {
    document.getElementById('cmds-overlay').classList.remove('visible');
  }

  function copyCmds() {
    if (!currentCmdsText) return;
    BocUtils.copyText(currentCmdsText);
  }

  function downloadCmdsTxt() {
    if (!currentCmdsText) return;
    var filename = 'gslb_create_cmds_' + new Date().toISOString().slice(0, 10) + '.txt';
    BocUtils.downloadBlob(currentCmdsText, filename, 'text/plain;charset=utf-8');
  }

  /** 清空并关闭旧成员命令，避免重新筛选、导入或切换域名后误用。 */
  function resetRrsMemberModal() {
    currentRrsMemberText = '';
    var overlay = document.getElementById('rrs-member-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    document.getElementById('rrs-member-list').innerHTML = '';
    document.getElementById('rrs-member-manual-ips').value = '';
    document.getElementById('rrs-member-warning').style.display = 'none';
    document.getElementById('rrs-member-warning').textContent = '';
    document.getElementById('rrs-member-pre').textContent = '';
    document.getElementById('btn-rrs-member-copy').disabled = true;
  }

  /** 打开弹窗时从完整导出 JSON 收集当前域名成员，不依赖预览列是否包含 IP。 */
  function showRrsMemberModal() {
    if (!jsonData || !selectedDomainKey.name) {
      alert('请先在表格中点击一行选择域名。');
      return;
    }

    resetRrsMemberModal();
    var collected = GslbCommands.collectRrsMembers(jsonData, selectedDomainKey, dcMemberIndex);
    var list = document.getElementById('rrs-member-list');
    var seenIps = {};
    var ipCounts = {};
    var i;

    for (i = 0; i < collected.members.length; i++) {
      if (collected.members[i].ip) {
        ipCounts[collected.members[i].ip] = (ipCounts[collected.members[i].ip] || 0) + 1;
      }
    }
    for (i = 0; i < collected.members.length; i++) {
      var ip = collected.members[i].ip;
      if (!ip || seenIps[ip]) continue;
      seenIps[ip] = true;
      var label = document.createElement('label');
      label.className = 'rrs-member-option';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = ip;
      checkbox.className = 'rrs-member-checkbox';
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(ip + (ipCounts[ip] > 1 ? '（' + ipCounts[ip] + ' 个成员 ID）' : '')));
      list.appendChild(label);
    }
    if (!list.children.length) {
      list.innerHTML = '<div class="rrs-member-empty">当前域名未找到可用的成员 IP，可在右侧手工输入后尝试匹配。</div>';
    }

    document.getElementById('rrs-member-meta').textContent =
      '域名：' + selectedDomainKey.name + '　类型：' + selectedDomainKey.type
      + '　zone：' + collected.zoneName;
    renderRrsMemberWarnings(collected.warnings);
    document.getElementById('rrs-member-overlay').classList.add('visible');
  }

  function hideRrsMemberModal() {
    document.getElementById('rrs-member-overlay').classList.remove('visible');
  }

  function renderRrsMemberWarnings(warnings, error) {
    var box = document.getElementById('rrs-member-warning');
    var messages = [];
    if (error) messages.push('错误：' + error);
    for (var i = 0; i < (warnings || []).length; i++) messages.push('⚠ ' + warnings[i]);
    box.textContent = messages.join('\n');
    box.style.display = messages.length ? '' : 'none';
  }

  function generateRrsMemberCommands() {
    var checkboxes = document.querySelectorAll('#rrs-member-list .rrs-member-checkbox:checked');
    var selectedIps = [];
    for (var i = 0; i < checkboxes.length; i++) selectedIps.push(checkboxes[i].value);

    var result = GslbCommands.buildRrsMemberCommands(
      jsonData,
      selectedDomainKey,
      selectedIps,
      document.getElementById('rrs-member-manual-ips').value,
      document.getElementById('rrs-member-status').value,
      dcMemberIndex
    );
    currentRrsMemberText = result.lines.join('\n');
    document.getElementById('rrs-member-pre').textContent = currentRrsMemberText;
    document.getElementById('btn-rrs-member-copy').disabled = !currentRrsMemberText;
    renderRrsMemberWarnings(result.warnings, result.error);
  }

  function copyRrsMemberCommands() {
    if (!currentRrsMemberText) return;
    BocUtils.copyText(currentRrsMemberText);
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
        var rowIdx = tr.getAttribute('data-row-index');
        if (rowIdx !== null) {
          if (selectedRowIndices[rowIdx]) delete selectedRowIndices[rowIdx];
          else selectedRowIndices[rowIdx] = true;
        }
        tr.classList.toggle('selected');
        if (tr.classList.contains('selected')) {
          selectDomainFromRow(tr);
        } else if (selectedDomainKey.name === tr.getAttribute('data-domain') &&
                   selectedDomainKey.type === (tr.getAttribute('data-domain-type') || '')) {
          selectedDomainKey = { name: '', type: '' };
          updateViewGraphButton();
          updateRrsMemberButton();
          resetRrsMemberModal();
          GslbGraph.render(null, null, '');
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
    exportCsv: exportCsv,
    exportDomainListCsv: exportDomainListCsv,
    exportDomainListTxt: exportDomainListTxt,
    exportOrphanPoolCsv: exportOrphanPoolCsv,
    exportOrphanMemberCsv: exportOrphanMemberCsv
  };
})();
