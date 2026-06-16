/**
 * Excel 切换 JSON — 页面交互
 */
var Excel2JsonApp = (function () {
  'use strict';

  var lastResult = null;   /* { ok, outputs, stats } */
  var activeKey  = null;   /* 当前选中的输出项 key + 'switch'/'revert' */

  function init() {
    document.getElementById('btn-load').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', onFileSelected);
    document.getElementById('btn-copy').addEventListener('click', copyJson);
    document.getElementById('btn-download').addEventListener('click', downloadCurrent);
    document.getElementById('btn-download-all').addEventListener('click', downloadAll);
  }

  function setStatus(text, isErr) {
    var el = document.getElementById('status-text');
    el.textContent = text;
    el.className = 'status-bar' + (isErr ? ' status-error' : '');
  }

  function showError(msg) {
    var box = document.getElementById('error-box');
    box.textContent = msg;
    box.style.display = msg ? 'block' : 'none';
  }

  function onFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      alert('请选择 .xlsx 文件');
      e.target.value = '';
      return;
    }

    setStatus('正在解析：' + file.name + ' …');
    showError('');

    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var parsed = BocXlsxRead.parse(ev.target.result);
        if (parsed.rows.length > 5000) {
          setStatus('警告：数据行数超过 5000，处理可能较慢', false);
        }
        var result = Excel2JsonProcess.run(parsed.rows);
        lastResult = result;
        renderResult(result, file.name);
      } catch (err) {
        setStatus('解析失败：' + err.message, true);
        showError(err.message);
      }
    };
    reader.onerror = function () { setStatus('文件读取失败', true); };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function renderResult(result, filename) {
    if (!result.ok) {
      setStatus('校验失败，未生成文件', true);
      showError(result.error || '未知错误');
      clearPreview();
      return;
    }

    showError('');
    var st = result.stats;
    setStatus('完成：文件 ' + filename + ' — ' + st.appCount + ' 个应用，' +
              st.fileCount + ' 个 JSON 文件，数据行 ' + st.rowCount + ' 行');

    renderFileList(result.outputs);
    document.getElementById('btn-download-all').disabled = !result.outputs.length;

    if (result.outputs.length) {
      selectItem(result.outputs[0].key + '_switch');
    } else {
      clearPreview();
    }
  }

  function renderFileList(outputs) {
    var list = document.getElementById('file-list');
    list.innerHTML = '';
    if (!outputs.length) {
      list.innerHTML = '<div class="empty-hint">无输出文件（表格无有效数据）</div>';
      return;
    }
    outputs.forEach(function (out) {
      var grp = document.createElement('div');
      grp.className = 'file-group';

      var grpTitle = document.createElement('div');
      grpTitle.className = 'file-group-title';
      grpTitle.textContent = out.appName + '（' + out.typeName + '）';
      grp.appendChild(grpTitle);

      [
        { sub: '_switch', label: out.switchFilename },
        { sub: '_revert', label: out.revertFilename }
      ].forEach(function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'file-item-btn';
        btn.textContent = item.label;
        btn.setAttribute('data-key', out.key + item.sub);
        btn.addEventListener('click', function () { selectItem(out.key + item.sub); });
        grp.appendChild(btn);
      });

      list.appendChild(grp);
    });
  }

  function selectItem(key) {
    activeKey = key;

    /* 高亮 */
    var btns = document.querySelectorAll('.file-item-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-key') === key);
    }

    var data = resolveData(key);
    if (!data) { clearPreview(); return; }

    document.getElementById('preview-filename').textContent = data.filename;
    document.getElementById('preview-json').textContent = JSON.stringify(data.json, null, 2);
    document.getElementById('btn-copy').disabled = false;
    document.getElementById('btn-download').disabled = false;
  }

  function resolveData(key) {
    if (!lastResult || !lastResult.outputs) return null;
    for (var i = 0; i < lastResult.outputs.length; i++) {
      var out = lastResult.outputs[i];
      if (key === out.key + '_switch') return { filename: out.switchFilename, json: out.switchData };
      if (key === out.key + '_revert') return { filename: out.revertFilename, json: out.revertData };
    }
    return null;
  }

  function clearPreview() {
    document.getElementById('preview-filename').textContent = '—';
    document.getElementById('preview-json').textContent = '（请从左侧选择文件查看）';
    document.getElementById('btn-copy').disabled = true;
    document.getElementById('btn-download').disabled = true;
  }

  function copyJson() {
    var text = document.getElementById('preview-json').textContent;
    if (!text || text === '（请从左侧选择文件查看）') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { alert('已复制到剪贴板'); }).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('已复制到剪贴板');
    }
  }

  function downloadCurrent() {
    var data = resolveData(activeKey);
    if (!data) return;
    BocUtils.downloadBlob(
      JSON.stringify(data.json, null, 2),
      data.filename,
      'application/json;charset=utf-8'
    );
  }

  function downloadAll() {
    if (!lastResult || !lastResult.outputs.length) return;
    lastResult.outputs.forEach(function (out) {
      BocUtils.downloadBlob(JSON.stringify(out.switchData, null, 2), out.switchFilename, 'application/json;charset=utf-8');
      BocUtils.downloadBlob(JSON.stringify(out.revertData, null, 2), out.revertFilename, 'application/json;charset=utf-8');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    clearPreview();
    document.getElementById('btn-download-all').disabled = true;
  });

  return { init: init };
}());
