/**
 * GSLB 多文件对比 — 页面交互
 */
var GslbCompareApp = (function () {
  'use strict';

  var files = [];
  var lastRows = [];
  var lastColumns = [];
  var filterState = { query: '', result: 'all' };

  function init() {
    document.getElementById('btn-load').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', onFilesSelected);
    document.getElementById('btn-preview').addEventListener('click', previewCompare);
    document.getElementById('btn-export').addEventListener('click', exportExcel);
    document.getElementById('filter-query').addEventListener('input', onFilterChange);
    document.getElementById('filter-result').addEventListener('change', onFilterChange);
    document.getElementById('btn-clear-filter').addEventListener('click', clearFilter);
    renderFieldOptions();
    renderFileList();
  }

  function defaultName(filename) {
    return String(filename || '').replace(/\.json$/i, '') || '文件';
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  function renderFieldOptions() {
    var root = document.getElementById('field-options');
    root.innerHTML = '';
    var i;
    for (i = 0; i < GslbCompareFields.STATUS_COLUMNS.length; i++) {
      var def = GslbCompareFields.STATUS_COLUMNS[i];
      var label = document.createElement('label');
      label.className = 'check-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = def.key;
      cb.checked = !!def.checked;
      label.appendChild(cb);
      var text = document.createElement('span');
      text.textContent = def.title;
      label.appendChild(text);
      root.appendChild(label);
    }
  }

  function selectedStatusKeys() {
    var nodes = document.querySelectorAll('#field-options input[type="checkbox"]:checked');
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) out.push(nodes[i].value);
    return out.length ? out : ['member.status'];
  }

  function onFilesSelected(e) {
    var picked = e.target.files || [];
    if (!picked.length) return;
    var readTasks = [];
    var i;
    for (i = 0; i < picked.length; i++) {
      readTasks.push(readJsonFile(picked[i]));
    }
    Promise.all(readTasks).then(function (parsed) {
      for (i = 0; i < parsed.length; i++) files.push(parsed[i]);
      renderFileList();
      setStatus('状态：已加载 ' + files.length + ' 个文件');
    }).catch(function (err) {
      alert('读取文件失败：' + err.message);
    });
    e.target.value = '';
  }

  function readJsonFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var jsonData = JSON.parse(ev.target.result);
          resolve({
            fileId: Date.now() + '_' + Math.random().toString(36).slice(2),
            originFileName: file.name,
            displayName: defaultName(file.name),
            jsonData: jsonData,
            rowMap: {},
            rowCount: 0
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('文件读取错误')); };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function renderFileList() {
    var root = document.getElementById('file-list');
    root.innerHTML = '';
    if (!files.length) {
      root.innerHTML = '<div class="empty-hint">暂无文件</div>';
      return;
    }
    var i;
    for (i = 0; i < files.length; i++) {
      var f = files[i];
      var item = document.createElement('div');
      item.className = 'file-item';

      var left = document.createElement('div');
      left.className = 'file-origin';
      left.textContent = '原文件：' + f.originFileName;
      item.appendChild(left);

      var input = document.createElement('input');
      input.className = 'file-name-input';
      input.value = f.displayName;
      input.setAttribute('data-id', f.fileId);
      input.addEventListener('input', onDisplayNameInput);
      item.appendChild(input);

      var right = document.createElement('div');
      right.className = 'file-count';
      right.textContent = '记录：' + (f.rowCount || 0);
      item.appendChild(right);
      root.appendChild(item);
    }
  }

  function onDisplayNameInput(e) {
    var id = e.target.getAttribute('data-id');
    var i;
    for (i = 0; i < files.length; i++) {
      if (files[i].fileId === id) {
        files[i].displayName = e.target.value;
        break;
      }
    }
  }

  function buildColumns(statusKeys) {
    var columns = [];
    var i, s;
    for (i = 0; i < GslbCompareFields.KEY_COLUMNS.length; i++) {
      columns.push({ key: GslbCompareFields.KEY_COLUMNS[i].key, title: GslbCompareFields.KEY_COLUMNS[i].title });
    }
    for (s = 0; s < statusKeys.length; s++) {
      var sk = statusKeys[s];
      for (i = 0; i < files.length; i++) {
        columns.push({
          key: files[i].resolvedName + '.' + sk,
          title: files[i].resolvedName + ' · ' + GslbCompareFields.keyLabel(sk)
        });
      }
      columns.push({ key: 'result.' + sk, title: GslbCompareFields.keyLabel(sk) + ' 对比结果' });
    }
    columns.push({ key: 'result.summary', title: '总结果' });
    return columns;
  }

  function previewCompare() {
    if (files.length < 2) {
      alert('请至少导入 2 个 JSON 文件再对比。');
      return;
    }

    var statusKeys = selectedStatusKeys();
    var i;
    for (i = 0; i < files.length; i++) {
      files[i].displayName = GslbCompareProcess.normalizeDisplayName(files[i].displayName, defaultName(files[i].originFileName));
      files[i].rowMap = GslbCompareProcess.extractRows(files[i].jsonData, statusKeys);
      files[i].rowCount = Object.keys(files[i].rowMap).length;
    }
    renderFileList();

    lastRows = GslbCompareProcess.buildComparison(files, statusKeys);
    lastColumns = buildColumns(statusKeys);
    applyFilterAndRender();
    setStatus('状态：对比完成，共 ' + lastRows.length + ' 条唯一记录');
  }

  function onFilterChange() {
    filterState.query = document.getElementById('filter-query').value || '';
    filterState.result = document.getElementById('filter-result').value || 'all';
    applyFilterAndRender();
  }

  function clearFilter() {
    filterState.query = '';
    filterState.result = 'all';
    document.getElementById('filter-query').value = '';
    document.getElementById('filter-result').value = 'all';
    applyFilterAndRender();
  }

  function applyFilter(rows) {
    if (!rows.length) return rows;
    var q = filterState.query.trim().toLowerCase();
    var mode = filterState.result;
    return rows.filter(function (row) {
      if (mode === 'inconsistent' && row['result.summary'] !== '不一致') return false;
      if (mode === 'missing' && row['result.summary'] !== '缺失') return false;
      if (mode === 'consistent' && row['result.summary'] !== '一致') return false;
      if (!q) return true;
      var i;
      for (i = 0; i < lastColumns.length; i++) {
        var val = row[lastColumns[i].key];
        if (val !== null && val !== undefined && String(val).toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
  }

  function applyFilterAndRender() {
    renderTable(applyFilter(lastRows));
  }

  function renderTable(rows) {
    var thead = document.getElementById('preview-head');
    var tbody = document.getElementById('preview-body');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!lastColumns.length) {
      tbody.innerHTML = '<tr><td><span class="empty-hint">请先执行预览对比</span></td></tr>';
      document.getElementById('preview-badge').textContent = '—';
      return;
    }

    var htr = document.createElement('tr');
    var i, r, c;
    for (i = 0; i < lastColumns.length; i++) {
      var th = document.createElement('th');
      th.textContent = lastColumns[i].title;
      htr.appendChild(th);
    }
    thead.appendChild(htr);

    if (!rows.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = lastColumns.length;
      emptyTd.innerHTML = '<span class="empty-hint">无匹配结果，请调整过滤条件</span>';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
    } else {
      for (r = 0; r < rows.length; r++) {
        var tr = document.createElement('tr');
        for (c = 0; c < lastColumns.length; c++) {
          var key = lastColumns[c].key;
          var td = document.createElement('td');
          var v = rows[r][key];
          td.textContent = v === undefined || v === null ? '' : String(v);
          if (key.indexOf('result.') === 0) {
            if (td.textContent === '一致') td.className = 'result-consistent';
            else if (td.textContent === '不一致') td.className = 'result-inconsistent';
            else if (td.textContent === '缺失') td.className = 'result-missing';
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    document.getElementById('preview-badge').textContent = '显示 ' + rows.length + ' / 共 ' + lastRows.length + ' 行';
  }

  function colName(index) {
    var n = index + 1;
    var out = '';
    while (n > 0) {
      var mod = (n - 1) % 26;
      out = String.fromCharCode(65 + mod) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function exportExcel() {
    if (!lastRows.length || !lastColumns.length) {
      alert('请先执行预览对比。');
      return;
    }
    var rows = applyFilter(lastRows);
    var headers = lastColumns.map(function (c) { return c.title; });
    var widths = lastColumns.map(function () { return 20; });
    var bytes = BocXlsx.generate(rows, {
      sheetName: 'GSLB对比',
      headers: headers,
      colWidths: widths,
      rowMapper: function (row) {
        var cells = [];
        var i;
        for (i = 0; i < lastColumns.length; i++) {
          cells.push({ col: colName(i), value: row[lastColumns[i].key] === undefined ? '' : row[lastColumns[i].key], style: 2 });
        }
        return cells;
      }
    });
    BocUtils.downloadBlob(
      bytes,
      'gslb_compare_' + new Date().toISOString().slice(0, 10) + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    alert('已导出 Excel。');
  }

  return {
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  GslbCompareApp.init();
});
