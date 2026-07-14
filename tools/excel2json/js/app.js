/**
 * Excel 切换 JSON — 页面交互层
 *
 * 数据流：上传 Excel → 生成切换/回切 JSON；动态类型结合 GSLB JSON
 * → 生成 service-member 命令；静态类型结合 DNS ZIP → 生成 modify rrs 命令
 * → 文件列表预览、复制、单个或批量下载。
 *
 * 依赖：BocUtils、BocXlsxRead、Excel2JsonProcess、Excel2JsonGslbLookup、
 * Excel2JsonDnsLookup、Excel2JsonEmergency
 */
var Excel2JsonApp = (function () {
  'use strict';

  var lastResult = null;   /* { ok, outputs, stats } */
  var activeKey  = null;   /* 当前选中的输出项 key + 输出类型 */
  var excelFilename = '';
  var gslbJson = null;
  var gslbFilename = '';
  var dnsIndex = null;
  var dnsFilename = '';
  var emergencyStats = null;

  function init() {
    document.getElementById('btn-load').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', onFileSelected);
    document.getElementById('btn-load-gslb').addEventListener('click', function () {
      document.getElementById('gslb-file-input').click();
    });
    document.getElementById('gslb-file-input').addEventListener('change', onGslbFileSelected);
    document.getElementById('btn-load-dns').addEventListener('click', function () {
      document.getElementById('dns-file-input').click();
    });
    document.getElementById('dns-file-input').addEventListener('change', onDnsFileSelected);
    document.getElementById('btn-copy').addEventListener('click', copyCurrent);
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

  function showWarnings(warnings) {
    var box = document.getElementById('warning-box');
    if (!warnings || !warnings.length) {
      box.textContent = '';
      box.style.display = 'none';
      return;
    }
    box.textContent = '应急命令警告（共 ' + warnings.length + ' 条）：\n' + warnings.join('\n');
    box.style.display = 'block';
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
        excelFilename = file.name;
        lastResult = result;
        emergencyStats = result.ok ? rebuildEmergency(result.outputs) : null;
        renderResult(result);
      } catch (err) {
        setStatus('解析失败：' + err.message, true);
        showError(err.message);
      }
    };
    reader.onerror = function () { setStatus('文件读取失败', true); };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function onGslbFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      alert('请选择 .json 文件');
      e.target.value = '';
      return;
    }

    setStatus('正在解析 GSLB JSON：' + file.name + ' …');
    showError('');
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var parsed = JSON.parse(ev.target.result);
        /* 先构建一次索引完成结构校验，再保存文件，避免无效上传覆盖已加载数据。 */
        Excel2JsonGslbLookup.buildIndex(parsed);
        gslbJson = parsed;
        gslbFilename = file.name;
        if (lastResult && lastResult.ok) {
          emergencyStats = rebuildEmergency(lastResult.outputs);
          renderResult(lastResult);
        } else {
          showWarnings([]);
          setStatus(buildWaitingStatus());
        }
      } catch (err) {
        setStatus('GSLB JSON 解析失败：' + err.message, true);
        showError(err.message);
      }
    };
    reader.onerror = function () { setStatus('GSLB JSON 文件读取失败', true); };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function onDnsFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      alert('请选择 .zip 文件');
      e.target.value = '';
      return;
    }

    setStatus('正在解析 DNS ZIP：' + file.name + ' …');
    showError('');
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var parsedIndex = Excel2JsonDnsLookup.parseZip(ev.target.result);
        dnsIndex = parsedIndex;
        dnsFilename = file.name;
        if (lastResult && lastResult.ok) {
          emergencyStats = rebuildEmergency(lastResult.outputs);
          renderResult(lastResult);
        } else {
          showWarnings([]);
          setStatus(buildWaitingStatus());
        }
      } catch (err) {
        setStatus('DNS ZIP 解析失败：' + err.message, true);
        showError(err.message);
      }
    };
    reader.onerror = function () { setStatus('DNS ZIP 文件读取失败', true); };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function rebuildEmergency(outputs) {
    return Excel2JsonEmergency.build(outputs, {
      gslbJson: gslbJson,
      dnsIndex: dnsIndex
    });
  }

  function buildWaitingStatus() {
    var loaded = [];
    if (gslbJson) loaded.push('GSLB JSON：' + gslbFilename);
    if (dnsIndex) loaded.push('DNS ZIP：' + dnsFilename);
    return '已加载 ' + loaded.join('；') + '；请继续上传 Excel';
  }

  function hasType(outputs, typeName) {
    return outputs.some(function (out) { return out.typeName === typeName; });
  }

  function renderResult(result) {
    if (!result.ok) {
      setStatus('校验失败，未生成文件', true);
      showError(result.error || '未知错误');
      showWarnings([]);
      clearPreview();
      return;
    }

    showError('');
    var st = result.stats;
    var status = '完成：文件 ' + excelFilename + ' — ' + st.appCount + ' 个应用，' +
      st.fileCount + ' 个 JSON 文件，数据行 ' + st.rowCount + ' 行';
    var statusParts = [];
    if (hasType(result.outputs, '动态')) {
      statusParts.push(gslbJson
        ? '动态命令 ' + emergencyStats.dynamicCommandCount + ' 条（' + gslbFilename + '）'
        : '上传 GSLB JSON 后生成动态命令');
    }
    if (hasType(result.outputs, '静态')) {
      statusParts.push(dnsIndex
        ? '静态命令 ' + emergencyStats.staticCommandCount + ' 条（' + dnsFilename + '）'
        : '上传 DNS ZIP 后生成静态命令');
    }
    if (emergencyStats.warningCount) {
      statusParts.push(emergencyStats.warningCount + ' 条警告');
    }
    if (statusParts.length) status += '；' + statusParts.join('；');
    showWarnings(emergencyStats ? emergencyStats.warnings : []);
    setStatus(status);

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
        { sub: '_revert', label: out.revertFilename },
        { sub: '_switch_cmd', label: out.switchCmdFilename },
        { sub: '_revert_cmd', label: out.revertCmdFilename }
      ].forEach(function (item) {
        if (!item.label) return;
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
    document.getElementById('preview-title').textContent = data.kind === 'json' ? 'JSON 预览：' : '命令预览：';
    document.getElementById('preview-content').textContent = data.text;
    document.getElementById('btn-copy').disabled = false;
    document.getElementById('btn-download').disabled = false;
  }

  function resolveData(key) {
    if (!lastResult || !lastResult.outputs) return null;
    for (var i = 0; i < lastResult.outputs.length; i++) {
      var out = lastResult.outputs[i];
      if (key === out.key + '_switch') {
        return jsonFile(out.switchFilename, out.switchData);
      }
      if (key === out.key + '_revert') {
        return jsonFile(out.revertFilename, out.revertData);
      }
      if (key === out.key + '_switch_cmd' && out.switchCmdFilename) {
        return textFile(out.switchCmdFilename, out.switchCmdText);
      }
      if (key === out.key + '_revert_cmd' && out.revertCmdFilename) {
        return textFile(out.revertCmdFilename, out.revertCmdText);
      }
    }
    return null;
  }

  function jsonFile(filename, data) {
    return {
      filename: filename,
      kind: 'json',
      text: JSON.stringify(data, null, 2),
      mime: 'application/json;charset=utf-8'
    };
  }

  function textFile(filename, text) {
    return {
      filename: filename,
      kind: 'text',
      text: text || '',
      mime: 'text/plain;charset=utf-8'
    };
  }

  function clearPreview() {
    document.getElementById('preview-filename').textContent = '—';
    document.getElementById('preview-title').textContent = '文件预览：';
    document.getElementById('preview-content').textContent = '（请从左侧选择文件查看）';
    document.getElementById('btn-copy').disabled = true;
    document.getElementById('btn-download').disabled = true;
  }

  function copyCurrent() {
    var text = document.getElementById('preview-content').textContent;
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
    BocUtils.downloadBlob(data.text, data.filename, data.mime);
  }

  function downloadAll() {
    if (!lastResult || !lastResult.outputs.length) return;
    var tasks = [];
    lastResult.outputs.forEach(function (out) {
      tasks.push(jsonFile(out.switchFilename, out.switchData));
      tasks.push(jsonFile(out.revertFilename, out.revertData));
      if (out.switchCmdFilename) tasks.push(textFile(out.switchCmdFilename, out.switchCmdText));
      if (out.revertCmdFilename) tasks.push(textFile(out.revertCmdFilename, out.revertCmdText));
    });
    tasks.forEach(function (task, idx) {
      setTimeout(function () {
        BocUtils.downloadBlob(task.text, task.filename, task.mime);
      }, idx * 350);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    clearPreview();
    document.getElementById('btn-download-all').disabled = true;
  });

  return { init: init };
}());
