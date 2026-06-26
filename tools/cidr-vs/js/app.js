/**
 * CIDR 网段对比 — UI 交互层（文本对比 + Excel 反查双模式）
 *
 * 数据流（文本模式）：
 *   双栏文本 / 文件加载 → CidrVsProcess.compare
 *   → 错误区 + 结果表（已覆盖/未覆盖着色）→ 复制 / xlsx
 *
 * 数据流（Excel 模式）：
 *   多文件上传 → BocXlsxRead.parse(opts) → CidrExcelLookup.extractFromRows
 *   → CidrExcelLookup.lookup(queryText, cellRecords)
 *   → 结果表（命中/未命中着色）→ 复制 / xlsx
 *
 * 依赖：BocUtils、BocXlsx、BocXlsxRead、CidrVsProcess、CidrExcelLookup
 */
var CidrVsApp = (function () {
  'use strict';

  /* ===== 状态 ===== */
  var currentMode     = 'text';        /* 'text' | 'excel' */
  var lastRows        = [];            /* 文本对比结果行 */
  var lastExcelRows   = [];            /* Excel 反查结果行（展开后，一查询一行） */
  var lastContextCols = [];            /* 上次反查使用的附加显示列，如 ['E','F'] */
  var excelFiles      = [];            /* { name, size, buffer } */
  /* 过滤条件：'' 表示不过滤，可叠加多条件 */
  var excelFilter     = { family: '', matched: '' };

  /* ===== 初始化 ===== */

  function init() {
    bindFileLoader('file-a', 'input-a');
    bindFileLoader('file-b', 'input-b');
    document.getElementById('file-excel').addEventListener('change', onExcelFilesSelected);
  }

  /* ===== 模式切换 ===== */

  function switchMode(mode) {
    currentMode = mode;
    document.getElementById('mode-text').style.display  = mode === 'text'  ? '' : 'none';
    document.getElementById('mode-excel').style.display = mode === 'excel' ? '' : 'none';
    document.getElementById('tab-text').classList.toggle('active',  mode === 'text');
    document.getElementById('tab-excel').classList.toggle('active', mode === 'excel');
  }

  /* ===== 文本对比模式 ===== */

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

  function resetResults() {
    lastRows = [];
    document.getElementById('result-body').innerHTML =
      '<tr><td colspan="6"><span class="empty-hint">输入网段后点击「开始对比」</span></td></tr>';
    document.getElementById('stat-badge').textContent = '—';
    var eb = document.getElementById('error-box');
    eb.classList.remove('visible');
    eb.innerHTML = '';
  }

  function clearInput(textareaId) {
    document.getElementById(textareaId).value = '';
    resetResults();
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

    renderErrors(result.errorsA, result.errorsB, 'error-box');
    renderTextTable(result.rows);
    renderStats(result.stats);
  }

  function renderStats(stats) {
    document.getElementById('stat-badge').textContent =
      '基准 ' + stats.aCount + ' 条 / 待检 ' + stats.total +
      ' 条 · 已覆盖 ' + stats.covered + ' · 未覆盖 ' + stats.uncovered +
      (stats.errorCount ? ' · 错误 ' + stats.errorCount : '');
  }

  function renderErrors(errorsA, errorsB, boxId) {
    var box   = document.getElementById(boxId);
    var parts = [];
    function fmt(prefix, errs) {
      return (errs || []).map(function (e) {
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

  function renderTextTable(rows) {
    var tbody = document.getElementById('result-body');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6"><span class="empty-hint">没有可对比的数据</span></td></tr>';
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r  = rows[i];
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
      headers:   ['行号', 'B原始输入', 'B规范化', '协议', '覆盖状态', '匹配A网段'],
      colWidths: [8, 28, 26, 8, 12, 28],
      rowMapper: function (r) {
        return [
          { col: 'A', value: r.lineNo,                     type: 'n' },
          { col: 'B', value: r.raw,                         style: 2 },
          { col: 'C', value: r.normalized,                  style: 2 },
          { col: 'D', value: r.family,                      style: 2 },
          { col: 'E', value: r.covered ? '已覆盖' : '未覆盖', style: 2 },
          { col: 'F', value: r.matched,                     style: 2 }
        ];
      }
    });
    BocUtils.downloadBlob(
      bytes,
      'CIDR对比_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  /* ===== Excel 反查模式 ===== */

  function triggerExcelLoad() {
    document.getElementById('file-excel').click();
  }

  /** 读入多文件，检测 BIFF 并更新文件列表 */
  function onExcelFilesSelected(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    var pending = files.length;

    Array.prototype.forEach.call(files, function (file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var buf = ev.target.result;
        var sig = new Uint8Array(buf, 0, 2);
        /* BIFF .xls 头为 D0 CF — 不支持 */
        if (sig[0] === 0xD0 && sig[1] === 0xCF) {
          alert('「' + file.name + '」是旧版 BIFF .xls，请在 Excel 中另存为 .xlsx 后再上传。');
        } else {
          /* 避免重名重复 */
          var dup = false;
          for (var i = 0; i < excelFiles.length; i++) {
            if (excelFiles[i].name === file.name) { dup = true; break; }
          }
          if (!dup) excelFiles.push({ name: file.name, size: file.size, buffer: buf });
        }
        pending--;
        if (pending === 0) renderFileList();
      };
      reader.onerror = function () {
        alert('读取「' + file.name + '」失败');
        pending--;
        if (pending === 0) renderFileList();
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  }

  function renderFileList() {
    var container = document.getElementById('file-list');
    if (!excelFiles.length) {
      container.innerHTML = '<div class="file-list-empty">尚未选择文件，点击「添加文件」上传</div>';
      return;
    }
    var html = '';
    excelFiles.forEach(function (f, idx) {
      var kb = (f.size / 1024).toFixed(1);
      html += '<div class="file-chip">' +
        '<span class="file-chip-name" title="' + BocUtils.escHtml(f.name) + '">' +
        BocUtils.escHtml(f.name) + '</span>' +
        '<span class="file-chip-size">' + kb + ' KB</span>' +
        '<button class="file-chip-del" onclick="CidrVsApp.removeExcelFile(' + idx + ')" title="移除">✕</button>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  function removeExcelFile(idx) {
    excelFiles.splice(idx, 1);
    renderFileList();
  }

  function clearExcelFiles() {
    excelFiles = [];
    renderFileList();
    resetExcelResults();
  }

  function clearExcelQuery() {
    document.getElementById('input-query').value = '';
    resetExcelResults();
  }

  function resetExcelResults() {
    lastExcelRows   = [];
    lastContextCols = [];
    excelFilter     = { family: '', matched: '' };
    var colCount = 10;
    document.getElementById('result-body-excel').innerHTML =
      '<tr><td colspan="' + colCount + '"><span class="empty-hint">配置范围并点击「开始反查」</span></td></tr>';
    document.getElementById('stat-badge-excel').textContent = '—';
    var eb = document.getElementById('error-box-excel');
    eb.classList.remove('visible');
    eb.innerHTML = '';
    /* 隐藏过滤条 */
    document.getElementById('excel-filter-bar').style.display = 'none';
  }

  /** 填入 NASP ACL 预设配置 */
  function applyPresetNasp() {
    var p = CidrExcelLookup.PRESET_NASP;
    document.getElementById('cfg-start-cell').value    = p.startCell;
    document.getElementById('cfg-columns').value       = p.columns;
    document.getElementById('cfg-context-cols').value  = p.contextColumns;
    document.getElementById('cfg-end-row').value       = p.endRow;
    document.getElementById('cfg-sheet-index').value   = p.sheetIndex;
    document.getElementById('cfg-sheet-name').value    = '';
  }

  /** 从界面读取范围配置 */
  function readRangeConfig() {
    return CidrExcelLookup.parseRangeConfig({
      startCell:      document.getElementById('cfg-start-cell').value,
      columns:        document.getElementById('cfg-columns').value,
      contextColumns: document.getElementById('cfg-context-cols').value,
      endRow:         document.getElementById('cfg-end-row').value,
      sheetIndex:     document.getElementById('cfg-sheet-index').value,
      sheetName:      document.getElementById('cfg-sheet-name').value
    });
  }

  /**
   * 执行 Excel 反查：
   * 1. 读取配置
   * 2. 逐文件调用 BocXlsxRead.parse → extractFromRows
   * 3. 汇总 cellRecords → lookup
   * 4. 渲染
   */
  function doExcelLookup() {
    var queryText = document.getElementById('input-query').value.trim();
    if (!queryText) { alert('请先输入待查询的地址'); return; }
    if (!excelFiles.length) { alert('请先添加 Excel 文件'); return; }

    var cfg = readRangeConfig();

    /* BocXlsxRead 选项 */
    var readOpts = {
      sheetIndex: cfg.sheetIndex,
      sheetName:  cfg.sheetName  || null,
      columns:    cfg.columns,
      startRow:   cfg.startRow,
      endRow:     cfg.endRow
    };

    var allCellRecords = [];
    var allCellErrors  = [];

    /* 逐文件解析 */
    for (var i = 0; i < excelFiles.length; i++) {
      var ef = excelFiles[i];
      var parsed;
      try {
        parsed = BocXlsxRead.parse(ef.buffer, readOpts);
      } catch (err) {
        alert('解析「' + ef.name + '」失败：' + err.message);
        return;
      }
      if (parsed.error) {
        alert('「' + ef.name + '」：' + parsed.error);
        return;
      }
      var extracted = CidrExcelLookup.extractFromRows(
        parsed.rows, cfg.colList, ef.name, parsed.sheetName || '', cfg.contextColumns
      );
      allCellRecords = allCellRecords.concat(extracted.cellRecords);
      allCellErrors  = allCellErrors.concat(extracted.cellErrors);
    }

    /* 保存本次使用的附加显示列（渲染/导出时用） */
    lastContextCols = cfg.contextColumns;

    /* 反查 */
    var result = CidrExcelLookup.lookup(queryText, allCellRecords);

    /* 渲染错误（查询解析错误 + 单元格内容错误） */
    renderExcelErrors(result.errors, allCellErrors);

    /* 将 hits 展开：每条查询若有多个命中，重复行 */
    var flatRows = [];
    for (var ri = 0; ri < result.rows.length; ri++) {
      var r = result.rows[ri];
      if (!r.matched) {
        flatRows.push({ lineNo: r.lineNo, raw: r.raw, normalized: r.normalized,
          family: r.family, matched: false,
          fileName: '', rowIndex: '', colLetter: '', matchedSubnet: '', cellPreview: '',
          context: {} });
      } else {
        for (var hi = 0; hi < r.hits.length; hi++) {
          var h = r.hits[hi];
          flatRows.push({ lineNo: r.lineNo, raw: r.raw, normalized: r.normalized,
            family: r.family, matched: true,
            fileName:      h.fileName,
            rowIndex:      h.rowIndex,
            colLetter:     h.colLetter,
            matchedSubnet: h.matchedSubnet,
            rawCell:       h.rawCell,       /* 完整单元格原文（导出/复制用） */
            cellPreview:   h.cellPreview,   /* 截断预览（HTML 表格用） */
            context:       h.context || {} });
        }
      }
    }

    lastExcelRows = flatRows;
    /* 重置过滤条件并渲染 */
    excelFilter = { family: '', matched: '' };
    updateFilterButtons();
    applyFilter();
    renderExcelStats(result.stats, allCellErrors.length);
    /* 有结果时显示过滤条 */
    document.getElementById('excel-filter-bar').style.display =
      flatRows.length ? '' : 'none';
  }

  /* ===== 过滤条逻辑 ===== */

  /**
   * 设置某一维度的过滤值，并重新渲染过滤后的表格。
   * @param {'family'|'matched'} key  过滤维度
   * @param {string}             val  '' = 不过滤；其他为具体值
   */
  function setFilter(key, val) {
    excelFilter[key] = val;
    updateFilterButtons();
    applyFilter();
  }

  /**
   * 同步各过滤按钮的 active 状态。
   * 按钮通过 data-key / data-val 属性与 excelFilter 对应。
   */
  function updateFilterButtons() {
    var btns = document.querySelectorAll('#excel-filter-bar .filter-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var key = btn.getAttribute('data-key');
      var val = btn.getAttribute('data-val');
      btn.classList.toggle('active', excelFilter[key] === val);
    }
  }

  /**
   * 将当前 excelFilter 条件应用到 lastExcelRows，渲染过滤结果并更新计数。
   * 多条件叠加（family 与 matched 同时满足）。
   */
  function applyFilter() {
    var filtered = lastExcelRows.filter(function (r) {
      if (excelFilter.family  && r.family  !== excelFilter.family)  return false;
      if (excelFilter.matched && String(r.matched) !== excelFilter.matched) return false;
      return true;
    });
    renderExcelTable(filtered, lastContextCols);
    /* 计数提示 */
    var countEl = document.getElementById('filter-count');
    if (countEl) {
      var hasFilter = excelFilter.family || excelFilter.matched;
      countEl.textContent = hasFilter
        ? '显示 ' + filtered.length + ' / ' + lastExcelRows.length + ' 条'
        : '';
    }
  }

  function renderExcelStats(stats, cellErrCount) {
    var total = cellErrCount + stats.errorCount;
    document.getElementById('stat-badge-excel').textContent =
      '查询 ' + stats.queryCount + ' 条 · 命中 ' + stats.matchedCount +
      ' · 未命中 ' + stats.unmatchedCount +
      ' · 来源文件 ' + stats.fileCount +
      ' · 单元格 ' + stats.cellCount +
      (total ? ' · 错误 ' + total : '');
  }

  function renderExcelErrors(queryErrors, cellErrors) {
    var box   = document.getElementById('error-box-excel');
    var parts = [];
    queryErrors.forEach(function (e) {
      parts.push('查询第 ' + e.lineNo + ' 行：' + BocUtils.escHtml(e.text) +
        ' — ' + BocUtils.escHtml(e.reason));
    });
    cellErrors.forEach(function (e) {
      parts.push('文件「' + BocUtils.escHtml(e.fileName) + '」行 ' + e.rowIndex +
        ' 列 ' + e.colLetter + '：' + BocUtils.escHtml(e.text) +
        ' — ' + BocUtils.escHtml(e.reason));
    });
    if (parts.length) {
      box.classList.add('visible');
      box.innerHTML = '<b>以下内容无法解析，已跳过：</b><br>' + parts.join('<br>');
    } else {
      box.classList.remove('visible');
      box.innerHTML = '';
    }
  }

  /**
   * 渲染 Excel 反查结果表（含动态附加列）。
   * 固定列 10 列 + 每个 contextCols 一列。
   * 同时更新 thead 以与列数一致。
   */
  function renderExcelTable(rows, contextCols) {
    contextCols = contextCols || [];
    var totalCols = 10 + contextCols.length;

    /* 重建表头（包含附加列） */
    var thead = document.getElementById('excel-thead');
    if (thead) {
      var htr = '<tr>' +
        '<th>行号</th><th>查询原始</th><th>规范化</th><th>协议</th><th>命中状态</th>' +
        '<th>文件</th><th>Excel行</th><th>列</th><th>命中网段</th><th>单元格摘要</th>';
      for (var ci = 0; ci < contextCols.length; ci++) {
        htr += '<th>' + BocUtils.escHtml(contextCols[ci]) + ' 列</th>';
      }
      htr += '</tr>';
      thead.innerHTML = htr;
    }

    var tbody = document.getElementById('result-body-excel');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="' + totalCols + '"><span class="empty-hint">没有可对比的数据</span></td></tr>';
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r  = rows[i];
      var tr = document.createElement('tr');
      tr.className = r.matched ? 'row-covered' : 'row-uncovered';
      tr.appendChild(td(String(r.lineNo)));
      tr.appendChild(td(r.raw));
      tr.appendChild(td(r.normalized));
      tr.appendChild(td(r.family));
      var statusTd = td(r.matched ? '命中' : '未命中');
      statusTd.className = r.matched ? 'td-status covered' : 'td-status uncovered';
      tr.appendChild(statusTd);
      tr.appendChild(td(r.fileName));
      tr.appendChild(td(r.rowIndex !== '' ? String(r.rowIndex) : ''));
      tr.appendChild(td(r.colLetter));
      tr.appendChild(td(r.matchedSubnet));
      var previewTd = td(r.cellPreview);
      previewTd.className = 'td-preview';
      tr.appendChild(previewTd);
      /* 附加列值 */
      for (var cj = 0; cj < contextCols.length; cj++) {
        var ctxVal = (r.context && r.context[contextCols[cj]]) || '';
        tr.appendChild(td(ctxVal));
      }
      tbody.appendChild(tr);
    }
  }

  function copyExcelResult() {
    if (!lastExcelRows.length) { alert('请先执行反查'); return; }
    var ctxCols = lastContextCols;
    var header  = ['行号', '查询原始', '规范化', '协议', '命中状态',
                   '文件', 'Excel行', '列', '命中网段', '单元格摘要']
                  .concat(ctxCols.map(function (c) { return c + '列'; }))
                  .join('\t');
    var lines = [header];
    lastExcelRows.forEach(function (r) {
      var base = [r.lineNo, r.raw, r.normalized, r.family,
        r.matched ? '命中' : '未命中',
        r.fileName, r.rowIndex, r.colLetter, r.matchedSubnet,
        r.rawCell || r.cellPreview /* 导出用完整原文 */];
      ctxCols.forEach(function (c) { base.push((r.context && r.context[c]) || ''); });
      lines.push(base.join('\t'));
    });
    BocUtils.copyText(lines.join('\n'));
  }

  function exportExcelXlsx() {
    if (!lastExcelRows.length) { alert('请先执行反查'); return; }
    var ctxCols = lastContextCols;

    /* 固定列字母表（A-J），附加列从 K 开始 */
    var baseLetters = ['A','B','C','D','E','F','G','H','I','J'];
    /* 生成附加列字母（K, L, M, …） */
    function nextLetter(prev) {
      /* 单字母简化，A-Z 够用 */
      return String.fromCharCode(prev.charCodeAt(prev.length - 1) + 1);
    }
    var ctxLetters = [];
    var last = 'J';
    for (var ci = 0; ci < ctxCols.length; ci++) {
      last = nextLetter(last);
      ctxLetters.push(last);
    }

    var headers   = ['行号', '查询原始', '规范化', '协议', '命中状态',
                     '文件', 'Excel行', '列', '命中网段', '单元格摘要']
                    .concat(ctxCols.map(function (c) { return c + '列'; }));
    var colWidths = [7, 24, 22, 8, 10, 30, 8, 6, 24, 40]
                    .concat(ctxCols.map(function () { return 30; }));

    var bytes = BocXlsx.generate(lastExcelRows, {
      sheetName: 'Excel反查',
      headers:   headers,
      colWidths: colWidths,
      rowMapper: function (r) {
        var cells = [
          { col: 'A', value: r.lineNo,                            type: 'n' },
          { col: 'B', value: r.raw,                                style: 2 },
          { col: 'C', value: r.normalized,                         style: 2 },
          { col: 'D', value: r.family,                             style: 2 },
          { col: 'E', value: r.matched ? '命中' : '未命中',        style: 2 },
          { col: 'F', value: r.fileName,                           style: 2 },
          { col: 'G', value: r.rowIndex !== '' ? r.rowIndex : '',
            type: r.rowIndex !== '' ? 'n' : 's', style: 2 },
          { col: 'H', value: r.colLetter,                          style: 2 },
          { col: 'I', value: r.matchedSubnet,                          style: 2 },
          { col: 'J', value: r.rawCell || r.cellPreview,  /* 完整原文 */ style: 2 }
        ];
        for (var cj = 0; cj < ctxCols.length; cj++) {
          cells.push({ col: ctxLetters[cj],
            value: (r.context && r.context[ctxCols[cj]]) || '', style: 2 });
        }
        return cells;
      }
    });
    BocUtils.downloadBlob(
      bytes,
      'CIDR反查_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  /* ===== 公用辅助 ===== */

  function td(text) {
    var cell = document.createElement('td');
    cell.textContent = String(text != null ? text : '');
    return cell;
  }

  return {
    init:              init,
    switchMode:        switchMode,
    /* 文本对比 */
    triggerLoad:       triggerLoad,
    clearInput:        clearInput,
    loadSample:        loadSample,
    doCompare:         doCompare,
    copyResult:        copyResult,
    exportXlsx:        exportXlsx,
    /* Excel 反查 */
    triggerExcelLoad:  triggerExcelLoad,
    removeExcelFile:   removeExcelFile,
    clearExcelFiles:   clearExcelFiles,
    clearExcelQuery:   clearExcelQuery,
    applyPresetNasp:   applyPresetNasp,
    doExcelLookup:     doExcelLookup,
    copyExcelResult:   copyExcelResult,
    exportExcelXlsx:   exportExcelXlsx,
    /* 过滤条 */
    setFilter:         setFilter
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  CidrVsApp.init();
});
