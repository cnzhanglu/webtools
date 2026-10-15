/**
 * GSLB JSON 导出 — UI 交互层
 *
 * 数据流：
 *   加载 JSON 文件 → 解析并扫描字段 → 穿梭框选列 → AG Grid 预览
 *   → 列头过滤图标打开该列自己的匹配菜单（多列 AND）→ 单击行选中域名
 *   → 双击行或「查看关系图」打开近全屏弹窗 / 全量 CSV 或预览显示 CSV 导出（UTF-8 BOM）
 *   → 点击「生成创建命令」→ 按过滤域名生成 CLI 命令 → 弹窗展示 / 复制 / 下载
 *   → 选中单个域名 → 当前类型 / A+AAAA 联合 → 勾选成员或输入 IP → 生成逐 ID 的 RRS 成员启停命令
 *
 * 布局：表格始终可见；关系图仅在双击行或点击「查看关系图」时以弹窗打开，仅 × 关闭
 * 过滤：匹配方式由 AG Grid 文本过滤器提供，平时只显示列头图标
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
  /** Ctrl/Cmd 点选后为 true，复制只取这些行；普通单击复制该域名全部可见行 */
  var explicitRowSelection = false;
  var currentRrsMemberText = '';
  var gridOptions = null;
  var gridApi = null;
  var gridColumnApi = null;

  var groupDomain = null;
  var groupPool = null;
  var groupMember = null;

  /** 每列过滤器只暴露组件自带的文本匹配，不另写比较规则。 */
  var GRID_FILTER_OPTIONS = ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith'];
  var GRID_LOCALE = {
    applyFilter: '应用',
    clearFilter: '清除',
    resetFilter: '重置',
    cancelFilter: '取消',
    textFilter: '文本过滤',
    filterOoo: '过滤…',
    empty: '请选择',
    equals: '等于',
    notEqual: '不等于',
    contains: '包含',
    notContains: '不包含',
    startsWith: '开头是',
    endsWith: '结尾是',
    andCondition: '并且',
    orCondition: '或者'
  };

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
    document.getElementById('btn-export-display').addEventListener('click', exportDisplayCsv);
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
    document.getElementById('rrs-member-scope').addEventListener('change', renderRrsMemberScope);
    document.getElementById('rrs-member-list').addEventListener('change', clearRrsMemberCommands);
    document.getElementById('rrs-member-manual-ips').addEventListener('input', clearRrsMemberCommands);
    document.getElementById('rrs-member-status').addEventListener('change', clearRrsMemberCommands);
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

    document.getElementById('btn-clear-filter').addEventListener('click', clearFilter);

    document.getElementById('btn-view-graph').addEventListener('click', viewSelectedDomainGraph);
    // 关系图仅允许标题栏 × 关闭，不绑定遮罩点击。
    document.getElementById('btn-close-graph').addEventListener('click', hideGraphModal);
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
        var sel = window.getSelection();
        if (sel && String(sel).length) return;
        var active = document.activeElement;
        var gridEl = document.getElementById('preview-grid');
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
        if (active && gridEl && gridEl.contains(active)) {
          copySelection();
          e.preventDefault();
        }
      }
    });

    refreshFieldLists();
    updateViewGraphButton();
    updateRrsMemberButton();
    updateGenCmdsButton();
    updateExportDisplayButton();
    ensurePreviewGrid();
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

  function noRowsHtml(text) {
    return '<span class="gslb-grid-empty">' + text + '</span>';
  }

  /** 创建一次预览网格；列过滤、虚拟滚动和列宽拖动都交给 AG Grid。 */
  function ensurePreviewGrid() {
    var el;
    if (gridApi) return;
    el = document.getElementById('preview-grid');
    gridOptions = {
      suppressFieldDotNotation: true,
      suppressMenuHide: true,
      suppressDragLeaveHidesColumns: true,
      enableCellTextSelection: true,
      ensureDomOrder: true,
      enableBrowserTooltips: true,
      tooltipShowDelay: 300,
      animateRows: false,
      headerHeight: 36,
      rowHeight: 32,
      rowSelection: 'multiple',
      suppressRowClickSelection: true,
      suppressLoadingOverlay: true,
      overlayNoRowsTemplate: noRowsHtml('导入 JSON 并点击「预览」查看数据'),
      localeText: GRID_LOCALE,
      icons: {
        menu: '<span class="ag-icon ag-icon-filter" unselectable="on"></span>'
      },
      defaultColDef: {
        resizable: true,
        sortable: false,
        filter: 'agTextColumnFilter',
        menuTabs: ['filterMenuTab'],
        minWidth: 96,
        filterParams: {
          filterOptions: GRID_FILTER_OPTIONS,
          defaultOption: 'contains',
          debounceMs: 200
        },
        tooltipValueGetter: previewCellTooltip
      },
      columnDefs: [],
      rowData: [],
      rowClassRules: {
        'gslb-disabled-row': function (params) {
          return !!(params.data && params.data._disabled);
        }
      },
      onFilterChanged: onGridFilterChanged,
      onRowClicked: onGridRowClicked,
      onRowDoubleClicked: onGridRowDoubleClicked
    };
    new agGrid.Grid(el, gridOptions);
    gridApi = gridOptions.api;
    gridColumnApi = gridOptions.columnApi;
  }

  function previewCellTooltip(params) {
    var data = params.data || {};
    var text = params.value === null || params.value === undefined ? '' : String(params.value);
    var reason;
    if (!data._disabled) return text;
    reason = (data._disabledReasons || []).join('；');
    return text ? ('禁用：' + reason + '\n' + text) : ('禁用：' + reason);
  }

  function buildPreviewColumnDefs(columns) {
    var defs = [];
    var i;
    for (i = 0; i < columns.length; i++) {
      defs.push({
        colId: columns[i],
        field: columns[i],
        headerName: GslbFields.keyToCn(columns[i]),
        headerTooltip: '过滤'
      });
    }
    return defs;
  }

  /** 字段重选后只保留仍显示列的过滤模型，列与列之间仍由组件按 AND 组合。 */
  function pruneFilterModel(model, columns) {
    var next = {};
    var i;
    var key;
    model = model || {};
    for (i = 0; i < columns.length; i++) {
      key = columns[i];
      if (model[key]) next[key] = model[key];
    }
    return next;
  }

  function domainOfRow(row) {
    row = row || {};
    return {
      name: row._domainName || row['domain.name'] || '',
      type: row._domainType !== undefined ? row._domainType : (row['domain.type'] || '')
    };
  }

  function selectDomainFromData(row) {
    var domain = domainOfRow(row);
    if (!domain.name) return;
    selectedDomainKey = domain;
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
  }

  function onGridRowClicked(event) {
    var mouse;
    var selected;
    if (!event.data || !event.node) return;
    mouse = event.event;
    if (mouse && (mouse.ctrlKey || mouse.metaKey)) {
      selected = !event.node.isSelected();
      event.node.setSelected(selected);
      explicitRowSelection = true;
      if (selected) {
        selectDomainFromData(event.data);
      } else if (domainOfRow(event.data).name === selectedDomainKey.name &&
                 domainOfRow(event.data).type === selectedDomainKey.type) {
        selectedDomainKey = { name: '', type: '' };
        updateViewGraphButton();
        updateRrsMemberButton();
        resetRrsMemberModal();
        hideGraphModal();
      }
      return;
    }
    explicitRowSelection = false;
    gridApi.deselectAll();
    event.node.setSelected(true);
    selectDomainFromData(event.data);
  }

  function onGridRowDoubleClicked(event) {
    if (!event.data) return;
    explicitRowSelection = false;
    gridApi.deselectAll();
    event.node.setSelected(true);
    selectDomainFromData(event.data);
    viewSelectedDomainGraph();
  }

  function onGridFilterChanged() {
    if (!gridApi) return;
    explicitRowSelection = false;
    selectedDomainKey = { name: '', type: '' };
    gridApi.deselectAll();
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    hideGraphModal();
    syncDisplayRows();
  }

  function clearFilter() {
    clearSelectionAndGraph();
    if (gridApi) gridApi.setFilterModel(null);
    syncDisplayRows();
  }

  /** 清空行选中状态并关闭关系图弹窗 */
  function clearSelectionAndGraph() {
    selectedDomainKey = { name: '', type: '' };
    explicitRowSelection = false;
    if (gridApi) gridApi.deselectAll();
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    hideGraphModal();
  }

  function hasActiveColumnFilters() {
    var model;
    var k;
    var item;
    if (!gridApi) return false;
    model = gridApi.getFilterModel() || {};
    for (k in model) {
      if (!Object.prototype.hasOwnProperty.call(model, k)) continue;
      item = model[k];
      if (!item) continue;
      if (item.operator || item.condition1 || item.conditions) return true;
      if (String(item.filter || '').length) return true;
    }
    return false;
  }

  /** 过滤后的可见行供徽标、显示 CSV 和创建命令共用。 */
  function syncDisplayRows() {
    var rows = [];
    if (gridApi && previewColumns.length) {
      gridApi.forEachNodeAfterFilter(function (node) {
        if (node.data) rows.push(node.data);
      });
    }
    displayRows = rows;
    updatePreviewBadge(rows.length, previewRows.length);
    updateExportDisplayButton();
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

  /** 单击只选中域名；双击或「查看关系图」才打开弹窗渲染 */
  function viewSelectedDomainGraph() {
    if (!selectedDomainKey.name) {
      alert('请先在表格中点击一行选择域名。');
      return;
    }
    showGraphModal();
    renderDomainGraph(selectedDomainKey.name, selectedDomainKey.type);
  }

  function showGraphModal() {
    document.body.classList.add('graph-modal-open');
    document.getElementById('graph-overlay').classList.add('visible');
  }

  function hideGraphModal() {
    var overlay = document.getElementById('graph-overlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('graph-modal-open');
    GslbGraph.render(null, null, '');
  }

  function updatePreviewBadge(shown, total) {
    var badge = document.getElementById('preview-badge');
    if (!badge) return;
    if (hasActiveColumnFilters() && shown !== total) {
      badge.textContent = '显示 ' + shown + ' / 共 ' + total + ' 行';
    } else {
      badge.textContent = '共 ' + total + ' 行';
    }
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
      previewColumns = [];
      previewRows = [];
      displayRows = [];
      selectedDomainKey = { name: '', type: '' };
      explicitRowSelection = false;
      if (gridApi) {
        gridApi.setFilterModel(null);
        gridApi.deselectAll();
        gridApi.setColumnDefs([]);
        gridApi.setRowData([]);
        gridOptions.overlayNoRowsTemplate = noRowsHtml('导入 JSON 并点击「预览」查看数据');
        gridApi.showNoRowsOverlay();
      }
      syncDisplayRows();
      updateViewGraphButton();
      updateRrsMemberButton();
      resetRrsMemberModal();
      updateGenCmdsButton();
      updateExportDisplayButton();
      hideGraphModal();
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
    var previousModel = gridApi ? (gridApi.getFilterModel() || {}) : {};

    previewColumns = columns;
    previewRows = rows;
    selectedDomainKey = { name: '', type: '' };
    explicitRowSelection = false;
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    updateGenCmdsButton();
    updateExportDisplayButton();
    hideGraphModal();
    ensurePreviewGrid();

    if (!columns.length) {
      gridOptions.overlayNoRowsTemplate = noRowsHtml('未选择任何字段');
      gridApi.setColumnDefs([]);
      gridApi.setRowData([]);
      gridApi.setFilterModel(null);
      syncDisplayRows();
      return;
    }

    gridOptions.overlayNoRowsTemplate = noRowsHtml('无匹配数据，请调整过滤条件');
    gridApi.setColumnDefs(buildPreviewColumnDefs(columns));
    gridApi.setRowData(rows);
    gridApi.setFilterModel(pruneFilterModel(previousModel, columns));
    if (gridColumnApi) gridColumnApi.autoSizeAllColumns(false);
    if (rows.length) gridApi.ensureIndexVisible(0);
    syncDisplayRows();
  }

  function copySelection() {
    if (!previewColumns.length || !gridApi) return;

    var rowsToCopy = [];
    var focused;
    var node;
    var i;

    if (explicitRowSelection) {
      rowsToCopy = gridApi.getSelectedRows();
    } else if (selectedDomainKey.name) {
      gridApi.forEachNodeAfterFilter(function (rowNode) {
        var domain = domainOfRow(rowNode.data);
        if (domain.name === selectedDomainKey.name && domain.type === selectedDomainKey.type) {
          rowsToCopy.push(rowNode.data);
        }
      });
    } else if (gridApi.getFocusedCell) {
      focused = gridApi.getFocusedCell();
      node = focused ? gridApi.getDisplayedRowAtIndex(focused.rowIndex) : null;
      if (node && node.data) rowsToCopy.push(node.data);
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
    alert('已导出全量 CSV：' + filename);
  }

  /** 导出当前预览表可见行（含过滤）；列与预览一致。 */
  function exportDisplayCsv() {
    if (!jsonData) {
      alert('请先导入 JSON。');
      return;
    }
    if (!previewRows.length) {
      alert('请先点击「预览」加载数据。');
      return;
    }
    if (!previewColumns.length) {
      alert('未选择任何字段，无法导出。');
      return;
    }

    syncDisplayRows();
    if (!displayRows.length) {
      alert('当前无显示数据，请先预览或调整过滤条件。');
      return;
    }
    if (!gridApi || !gridApi.getDataAsCsv) {
      alert('预览表尚未就绪。');
      return;
    }

    // 表头用字段中文名；getDataAsCsv 只导出当前过滤后的行。
    var csvContent = gridApi.getDataAsCsv({
      columnKeys: previewColumns,
      processHeaderCallback: function (params) {
        var col = params && params.column;
        var id = col && col.getColId ? col.getColId() : '';
        return GslbFields.keyToCn(id);
      }
    });
    if (!csvContent) {
      alert('当前无显示数据，请先预览或调整过滤条件。');
      return;
    }
    var filename = 'gslb_export_display_' + new Date().toISOString().slice(0, 10) + '.csv';
    BocUtils.downloadBlob('\uFEFF' + csvContent, filename, 'text/csv;charset=utf-8');
    alert('已导出显示 CSV：' + filename);
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

  /** 无预览数据时禁用「导出显示 CSV」 */
  function updateExportDisplayButton() {
    var btn = document.getElementById('btn-export-display');
    if (!btn) return;
    btn.disabled = !jsonData || !previewRows.length;
    btn.title = btn.disabled
      ? '请先导入 JSON 并点击「预览」'
      : '导出当前预览表显示的行（含过滤）';
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
    meta.textContent = '共 ' + domainCount + ' 条域名记录，生成 ' + cmdCount + ' 条命令'
      + (hasActiveColumnFilters() ? '（已按列过滤）' : '（全部预览域名）');

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

  /** 选择或输入变化后，必须重新生成才能复制，避免复制过期命令。 */
  function clearRrsMemberCommands() {
    currentRrsMemberText = '';
    document.getElementById('rrs-member-warning').style.display = 'none';
    document.getElementById('rrs-member-warning').textContent = '';
    document.getElementById('rrs-member-pre').textContent = '';
    document.getElementById('btn-rrs-member-copy').disabled = true;
  }

  /** 清空并关闭旧成员命令，避免重新筛选、导入或切换域名后误用。 */
  function resetRrsMemberModal() {
    var overlay = document.getElementById('rrs-member-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    clearRrsMemberCommands();
    document.getElementById('rrs-member-meta').textContent = '';
    document.getElementById('rrs-member-scope').value = 'current';
    document.getElementById('rrs-member-list').innerHTML = '';
    document.getElementById('rrs-member-manual-ips').value = '';
  }

  /** 打开弹窗时从完整导出 JSON 收集当前域名成员，不依赖预览列是否包含 IP。 */
  function showRrsMemberModal() {
    if (!jsonData || !selectedDomainKey.name) {
      alert('请先在表格中点击一行选择域名。');
      return;
    }

    resetRrsMemberModal();
    document.getElementById('rrs-member-scope').disabled = !/^(a|aaaa)$/i.test(selectedDomainKey.type);
    renderRrsMemberScope();
    document.getElementById('rrs-member-overlay').classList.add('visible');
  }

  /** 切换范围时重建分组列表，清空输入和结果；主表选择及过滤保持独立。 */
  function renderRrsMemberScope() {
    clearRrsMemberCommands();
    document.getElementById('rrs-member-manual-ips').value = '';
    var scope = document.getElementById('rrs-member-scope').value;
    var collected = GslbCommands.collectRrsMembersForScope(jsonData, selectedDomainKey, scope, dcMemberIndex);
    var list = document.getElementById('rrs-member-list');
    list.innerHTML = '';
    for (var i = 0; i < collected.records.length; i++) {
      var record = collected.records[i];
      var items = GslbCommands.buildRrsMemberPickerItems(record.members);
      var group = document.createElement('section');
      group.className = 'rrs-member-group';
      var heading = document.createElement('h3');
      heading.className = 'rrs-member-group-title';
      heading.textContent = record.type.toUpperCase() + '　zone：' + record.zoneName + '　' + items.length + ' 个成员';
      group.appendChild(heading);
      appendRrsMemberItems(group, items);
      list.appendChild(group);
    }
    if (!collected.records.length) {
      list.innerHTML = '<div class="rrs-member-empty">当前范围未找到域名记录。</div>';
    }
    document.getElementById('rrs-member-meta').textContent =
      '域名：' + selectedDomainKey.name + '　范围：'
      + (scope === 'dual' ? 'A+AAAA 联合' : '当前类型（' + selectedDomainKey.type + '）');
    renderRrsMemberWarnings(collected.warnings, collected.error);
  }

  function appendRrsMemberItems(list, items) {
    var i, item, label, checkbox, textWrap, headEl, ipEl, statusEl, metaEl, dcText, vsText, poolText, memberText;

    for (i = 0; i < items.length; i++) {
      item = items[i];
      dcText = item.dcName || '—';
      vsText = item.memberName || '—';
      poolText = item.poolStatus === 'disable' ? '禁用' : '启用';
      memberText = item.memberStatus === 'disable' ? '禁用' : '启用';
      label = document.createElement('label');
      label.className = 'rrs-member-option' + (item.poolStatus === 'disable' ? ' is-disable' : '');
      label.title = item.ip + '　DC：' + dcText + '　VS：' + vsText
        + '　池成员：' + poolText + '　服务成员：' + memberText;
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.ip;
      checkbox.className = 'rrs-member-checkbox';
      textWrap = document.createElement('span');
      textWrap.className = 'rrs-member-option-text';
      ipEl = document.createElement('span');
      ipEl.className = 'rrs-member-option-ip';
      ipEl.textContent = item.ip;
      statusEl = document.createElement('span');
      statusEl.className = 'rrs-member-status ' + (item.poolStatus === 'disable' ? 'is-disable' : 'is-enable');
      statusEl.textContent = poolText;
      headEl = document.createElement('span');
      headEl.className = 'rrs-member-option-head';
      headEl.appendChild(ipEl);
      headEl.appendChild(statusEl);
      metaEl = document.createElement('span');
      metaEl.className = 'rrs-member-option-meta';
      metaEl.textContent = 'DC：' + dcText + '　VS：' + vsText + '　服务成员：' + memberText;
      textWrap.appendChild(headEl);
      textWrap.appendChild(metaEl);
      label.appendChild(checkbox);
      label.appendChild(textWrap);
      list.appendChild(label);
    }
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'rrs-member-empty';
      empty.textContent = '该记录未找到可用的成员 IP。';
      list.appendChild(empty);
    }
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

    var result = GslbCommands.buildRrsMemberCommandsForScope(
      jsonData,
      selectedDomainKey,
      selectedIps,
      document.getElementById('rrs-member-manual-ips').value,
      document.getElementById('rrs-member-status').value,
      dcMemberIndex,
      document.getElementById('rrs-member-scope').value
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

  document.addEventListener('DOMContentLoaded', function () {
    init();
  });

  return {
    init: init,
    preview: preview,
    exportCsv: exportCsv,
    exportDisplayCsv: exportDisplayCsv,
    exportDomainListCsv: exportDomainListCsv,
    exportDomainListTxt: exportDomainListTxt,
    exportOrphanPoolCsv: exportOrphanPoolCsv,
    exportOrphanMemberCsv: exportOrphanMemberCsv
  };
})();
