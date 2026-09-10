/**
 * GSLB JSON 导出 — UI 交互层
 *
 * 数据流：
 *   加载 JSON 文件 → 解析并扫描字段 → 穿梭框选列 → 虚拟滚动预览表
 *   → 点击查询/回车或表头列过滤（多列 AND）→ 单击表格行选中域名
 *   → 双击行或「查看关系图」打开近全屏弹窗 / 全量 CSV 或预览显示 CSV 导出（UTF-8 BOM）
 *   → 点击「生成创建命令」→ 按过滤域名生成 CLI 命令 → 弹窗展示 / 复制 / 下载
 *   → 选中单个域名 → 勾选成员（显示 IP / DC / VS）或输入 IP → 生成逐 ID 的 RRS 成员启停命令
 *
 * 布局：表格始终可见；关系图仅在双击行或点击「查看关系图」时以弹窗打开，仅 × 关闭
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
  var filterState = { match: 'contains', columns: {} };
  var currentRrsMemberText = '';
  var filterTimer = null;
  var FILTER_DEBOUNCE_MS = 300;

  var groupDomain = null;
  var groupPool = null;
  var groupMember = null;

  /** 虚拟滚动：默认行高（首次渲染后按实测值修正） */
  var ROW_HEIGHT = 34;
  var measuredRowHeight = 0;
  var VIRTUAL_OVERSCAN = 6;
  var scrollRaf = null;
  /** 冻结列宽（px）；仅预览/过滤后重测，滚动不重测；拖动手柄可改宽 */
  var previewColumnWidths = [];
  var colResizeState = null;
  var colResizeBound = false;
  var PREVIEW_COL_MIN = 88;

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
    document.getElementById('filter-match').addEventListener('change', onFilterQuery);
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
    updateExportDisplayButton();
    bindVirtualScroll();
    bindPreviewColResize();
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

  /** 从表头过滤框读取条件并执行过滤；过滤后清空选中与关系图弹窗 */
  function onFilterQuery() {
    syncFilterFromInputs();
    clearSelectionAndGraph();
    applyFilterAndRender();
  }

  function scheduleFilter() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function () {
      filterTimer = null;
      onFilterQuery();
    }, FILTER_DEBOUNCE_MS);
  }

  function clearFilter() {
    filterState.columns = {};
    filterState.match = 'contains';
    document.getElementById('filter-match').value = 'contains';
    var inputs = document.querySelectorAll('#preview-head .col-filter-input');
    var i;
    for (i = 0; i < inputs.length; i++) inputs[i].value = '';
    clearSelectionAndGraph();
    applyFilterAndRender();
  }

  /** 清空行选中状态并关闭关系图弹窗 */
  function clearSelectionAndGraph() {
    selectedDomainKey = { name: '', type: '' };
    selectedRowIndices = {};
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    hideGraphModal();
  }

  function syncFilterFromInputs() {
    filterState.match = document.getElementById('filter-match').value;
    var inputs = document.querySelectorAll('#preview-head .col-filter-input');
    var next = {};
    var i;
    var col;
    for (i = 0; i < inputs.length; i++) {
      col = inputs[i].getAttribute('data-col');
      if (col) next[col] = inputs[i].value;
    }
    filterState.columns = next;
  }

  function hasActiveColumnFilters() {
    var k;
    for (k in filterState.columns) {
      if (Object.prototype.hasOwnProperty.call(filterState.columns, k) &&
          String(filterState.columns[k] || '').trim()) {
        return true;
      }
    }
    return false;
  }

  /** 列变更后只保留仍展示列上的过滤条件，避免隐藏列继续参与 AND。 */
  function pruneColumnFilters(columns) {
    var next = {};
    var i;
    var key;
    for (i = 0; i < columns.length; i++) {
      key = columns[i];
      if (filterState.columns[key] !== undefined) next[key] = filterState.columns[key];
    }
    filterState.columns = next;
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

  function buildTableRow(row, columns, rowIndex) {
    var tr = document.createElement('tr');
    var domainName = row._domainName || row['domain.name'] || '';
    var domainType = row._domainType !== undefined ? row._domainType : (row['domain.type'] || '');
    if (row._disabled) {
      var disabledReason = (row._disabledReasons || []).join('；');
      tr.classList.add('disabled-row');
      tr.title = '禁用：' + disabledReason;
      tr.setAttribute('data-disabled-reason', disabledReason);
    }
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
      td.title = row._disabled
        ? '禁用：' + disabledReason + (td.textContent ? '\n' + td.textContent : '')
        : td.textContent;
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

  function labelForPreviewColumn(colKey) {
    return GslbFields.keyToCn(colKey);
  }

  /** 浏览器端可选 canvas 测量；无 canvas 时回退到 process 内估算 */
  function createCanvasMeasureText() {
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.font = '600 .82rem "PingFang SC", "Microsoft YaHei", sans-serif';
      return function (text) {
        return ctx.measureText(text === null || text === undefined ? '' : String(text)).width;
      };
    } catch (e) {
      return null;
    }
  }

  function measurePreviewColumnWidths() {
    var measureFn = createCanvasMeasureText();
    return GslbProcess.measurePreviewColumnWidths(
      previewColumns,
      displayRows,
      labelForPreviewColumn,
      measureFn
    );
  }

  function applyPreviewColgroup(widths) {
    var colgroup = document.getElementById('preview-cols');
    var table = document.getElementById('preview-table');
    var i;
    var col;
    var total = 0;
    if (!colgroup) return;
    colgroup.innerHTML = '';
    for (i = 0; i < widths.length; i++) {
      col = document.createElement('col');
      col.style.width = widths[i] + 'px';
      colgroup.appendChild(col);
      total += widths[i];
    }
    if (table && widths.length) {
      table.style.width = Math.max(total, 0) + 'px';
    } else if (table) {
      table.style.width = '';
    }
  }

  /** 预览或过滤后重算列宽；虚拟滚动 renderVirtualSlice 不调用 */
  function syncPreviewColumnWidths() {
    if (!previewColumns.length) {
      previewColumnWidths = [];
      applyPreviewColgroup([]);
      return;
    }
    previewColumnWidths = measurePreviewColumnWidths();
    applyPreviewColgroup(previewColumnWidths);
  }

  function setPreviewColWidth(colIndex, widthPx) {
    var colgroup = document.getElementById('preview-cols');
    var table = document.getElementById('preview-table');
    var cols;
    var i;
    var total;
    if (!previewColumnWidths.length || colIndex < 0 || colIndex >= previewColumnWidths.length) return;
    previewColumnWidths[colIndex] = widthPx;
    cols = colgroup ? colgroup.querySelectorAll('col') : [];
    if (cols[colIndex]) cols[colIndex].style.width = widthPx + 'px';
    if (table) {
      total = 0;
      for (i = 0; i < previewColumnWidths.length; i++) total += previewColumnWidths[i];
      table.style.width = total + 'px';
    }
  }

  function bindPreviewColResize() {
    if (colResizeBound) return;
    colResizeBound = true;

    document.addEventListener('mousemove', function (e) {
      if (!colResizeState) return;
      var next = colResizeState.startWidth + (e.clientX - colResizeState.startX);
      if (next < PREVIEW_COL_MIN) next = PREVIEW_COL_MIN;
      setPreviewColWidth(colResizeState.colIndex, next);
    });

    document.addEventListener('mouseup', function () {
      if (!colResizeState) return;
      colResizeState = null;
      document.body.classList.remove('preview-col-resizing');
    });

    var thead = document.getElementById('preview-head');
    if (!thead) return;
    thead.addEventListener('mousedown', function (e) {
      var handle = e.target.closest && e.target.closest('.preview-col-resize');
      var colIndex;
      if (!handle) return;
      e.preventDefault();
      colIndex = parseInt(handle.getAttribute('data-col-index'), 10);
      if (isNaN(colIndex) || !previewColumnWidths[colIndex]) return;
      colResizeState = {
        colIndex: colIndex,
        startX: e.clientX,
        startWidth: previewColumnWidths[colIndex]
      };
      document.body.classList.add('preview-col-resizing');
    });
  }

  function rebuildPreviewHead(columns) {
    var thead = document.getElementById('preview-head');
    var trHead;
    var i;
    thead.innerHTML = '';
    if (!columns.length) return;
    trHead = document.createElement('tr');
    for (i = 0; i < columns.length; i++) {
      var th = document.createElement('th');
      var handle = document.createElement('span');
      th.textContent = GslbFields.keyToCn(columns[i]);
      handle.className = 'preview-col-resize';
      handle.setAttribute('data-col-index', String(i));
      handle.setAttribute('aria-hidden', 'true');
      handle.title = '拖动调整列宽';
      th.appendChild(handle);
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    thead.appendChild(buildFilterRow(columns));
  }

  function renderPreviewTable() {
    var columns = previewColumns;
    var rows = displayRows;
    var thead = document.getElementById('preview-head');
    var tbody = document.getElementById('preview-body');

    tbody.innerHTML = '';

    if (!columns.length) {
      thead.innerHTML = '';
      previewColumnWidths = [];
      applyPreviewColgroup([]);
      tbody.innerHTML = '<tr><td><span class="empty-hint">未选择任何字段</span></td></tr>';
      updatePreviewBadge(0, previewRows.length);
      return;
    }

    if (!thead.querySelector('.filter-row')) rebuildPreviewHead(columns);
    syncPreviewColumnWidths();

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
  }

  function buildFilterRow(columns) {
    var tr = document.createElement('tr');
    var i;
    tr.className = 'filter-row';
    for (i = 0; i < columns.length; i++) {
      var th = document.createElement('th');
      var input = document.createElement('input');
      input.type = 'search';
      input.className = 'col-filter-input';
      input.setAttribute('data-col', columns[i]);
      input.value = filterState.columns[columns[i]] || '';
      input.placeholder = '过滤';
      input.setAttribute('aria-label', GslbFields.keyToCn(columns[i]) + ' 列过滤');
      input.addEventListener('input', scheduleFilter);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (filterTimer) {
            clearTimeout(filterTimer);
            filterTimer = null;
          }
          onFilterQuery();
        }
      });
      th.appendChild(input);
      tr.appendChild(th);
    }
    return tr;
  }

  function applyFilterAndRender() {
    if (!previewColumns.length) {
      displayRows = [];
      renderPreviewTable();
      updateExportDisplayButton();
      return;
    }
    if (!previewRows.length) {
      displayRows = [];
      renderPreviewTable();
      updateExportDisplayButton();
      return;
    }
    displayRows = GslbProcess.filterRowsByColumns(previewRows, filterState.columns, filterState.match);
    resetPreviewScroll();
    renderPreviewTable();
    updateExportDisplayButton();
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

    previewColumns = columns;
    previewRows = rows;
    measuredRowHeight = 0;
    selectedDomainKey = { name: '', type: '' };
    selectedRowIndices = {};
    updateViewGraphButton();
    updateRrsMemberButton();
    resetRrsMemberModal();
    updateGenCmdsButton();
    updateExportDisplayButton();
    hideGraphModal();
    pruneColumnFilters(columns);
    rebuildPreviewHead(columns);

    syncFilterFromInputs();
    applyFilterAndRender();
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

    syncFilterFromInputs();
    var rows = GslbProcess.filterRowsByColumns(previewRows, filterState.columns, filterState.match);
    if (!rows.length) {
      alert('当前无显示数据，请先预览或调整过滤条件。');
      return;
    }

    var csvContent = GslbProcess.buildCsvContent(previewColumns, rows);
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
    var items = GslbCommands.buildRrsMemberPickerItems(collected.members);
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
          hideGraphModal();
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
    exportDisplayCsv: exportDisplayCsv,
    exportDomainListCsv: exportDomainListCsv,
    exportDomainListTxt: exportDomainListTxt,
    exportOrphanPoolCsv: exportOrphanPoolCsv,
    exportOrphanMemberCsv: exportOrphanMemberCsv
  };
})();
