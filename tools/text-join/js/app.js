/**
 * 字符拼接工具 — UI 交互层
 *
 * 数据流：读取原始文本 / 分隔符 / 模版
 *   → TextJoinProcess.process() 转换
 *   → 渲染结果区 → 写入模版历史 → 复制
 *
 * 实时转换使用 300ms 防抖；模版历史与固定保存由 TextJoinTemplates 管理。
 *
 * 依赖：BocUtils、TextJoinProcess、TextJoinTemplates
 * 导出：TextJoinApp
 */
var TextJoinApp = (function () {
  'use strict';

  var DEBOUNCE_MS = 300;
  var convertTimer = null;
  var lastResultText = '';
  var lastSavedTemplate = '';

  function $(id) {
    return document.getElementById(id);
  }

  function isRealtimeEnabled() {
    return $('realtime-check').checked;
  }

  function scheduleConvert() {
    if (!isRealtimeEnabled()) return;
    if (convertTimer) clearTimeout(convertTimer);
    convertTimer = setTimeout(function () {
      convertTimer = null;
      doConvert();
    }, DEBOUNCE_MS);
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderTemplateLists() {
    var data = TextJoinTemplates.getState();
    renderList('pinned-list', data.pinned, 'pinned');
    renderList('history-list', data.history, 'history');
  }

  function renderList(containerId, items, kind) {
    var container = $(containerId);
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<div class="template-empty">' +
        (kind === 'pinned' ? '暂无固定模版' : '暂无历史记录') +
        '</div>';
      return;
    }

    var html = items.map(function (item) {
      var preview = TextJoinTemplates.preview(item.text);
      var labelHtml = item.label
        ? '<span class="template-label">' + escAttr(item.label) + '</span>'
        : '';
      var actions = '';

      if (kind === 'pinned') {
        actions =
          '<button type="button" class="btn btn-outline btn-sm" data-action="unpin" data-id="' +
          escAttr(item.id) + '">取消固定</button>';
      } else {
        actions =
          '<button type="button" class="btn btn-outline btn-sm" data-action="pin" data-id="' +
          escAttr(item.id) + '">固定</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="delete-history" data-id="' +
          escAttr(item.id) + '">删除</button>';
      }

      return '<div class="template-item template-item-' + kind + '" data-id="' + escAttr(item.id) + '">' +
        '<button type="button" class="template-preview" data-action="apply" data-id="' + escAttr(item.id) + '" title="' +
        escAttr(item.text) + '">' +
        (kind === 'pinned' ? '★ ' : '') + escAttr(preview) +
        '</button>' +
        labelHtml +
        '<div class="template-actions">' + actions + '</div>' +
        '</div>';
    }).join('');

    container.innerHTML = html;
  }

  function applyTemplate(text) {
    $('pattern-input').value = text;
    doConvert();
  }

  function pinCurrentTemplate() {
    var text = $('pattern-input').value;
    if (!TextJoinTemplates.normalizeText(text)) {
      alert('请先输入模版文本');
      return;
    }
    TextJoinTemplates.pin(text, $('template-label').value);
    renderTemplateLists();
  }

  function handleTemplatePanelClick(event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    var item = TextJoinTemplates.getById(id);
    if (!item && action !== 'apply') return;

    if (action === 'apply') {
      if (item) applyTemplate(item.text);
      return;
    }
    if (action === 'pin') {
      TextJoinTemplates.pin(item.text, item.label || '');
      renderTemplateLists();
      return;
    }
    if (action === 'unpin') {
      TextJoinTemplates.unpin(id);
      renderTemplateLists();
      return;
    }
    if (action === 'delete-history') {
      TextJoinTemplates.deleteHistory(id);
      renderTemplateLists();
    }
  }

  function maybeSaveTemplateHistory(text) {
    var normalized = TextJoinTemplates.normalizeText(text);
    if (!normalized || normalized === lastSavedTemplate) return;
    TextJoinTemplates.addHistory(normalized);
    lastSavedTemplate = normalized;
    renderTemplateLists();
  }

  function doConvert() {
    var raw = $('raw-input').value;
    var pattern = $('pattern-input').value;
    var separator = $('separator').value;

    if (!raw.trim() || !pattern.trim()) {
      $('result-output').value = '';
      lastResultText = '';
      $('stat-badge').textContent = '—';
      return;
    }

    var result = TextJoinProcess.process(raw, separator, pattern);
    lastResultText = result.lines.join('\n');
    $('result-output').value = lastResultText;
    $('stat-badge').textContent = result.lineCount ? '共 ' + result.lineCount + ' 条' : '—';

    if (result.lineCount > 0) {
      maybeSaveTemplateHistory(pattern);
    }
  }

  function setSeparator(value) {
    $('separator').value = value;
    if (isRealtimeEnabled()) {
      scheduleConvert();
    } else {
      doConvert();
    }
  }

  function clearAll() {
    $('raw-input').value = '';
    $('pattern-input').value = '';
    $('result-output').value = '';
    $('separator').value = ',';
    lastResultText = '';
    lastSavedTemplate = '';
    $('stat-badge').textContent = '—';
  }

  function copyResult() {
    if (!lastResultText) {
      alert('没有可复制的结果');
      return;
    }
    BocUtils.copyText(lastResultText);
  }

  function loadSample() {
    $('raw-input').value =
      '10.1.1.1,80\n' +
      '10.1.1.2,443\n' +
      '192.168.1.10,8080';
    $('pattern-input').value = 'create ip $1 port $2;';
    $('separator').value = ',';
    doConvert();
  }

  function init() {
    TextJoinTemplates.load();
    renderTemplateLists();

    $('raw-input').addEventListener('input', scheduleConvert);
    $('pattern-input').addEventListener('input', scheduleConvert);
    $('separator').addEventListener('input', scheduleConvert);
    $('realtime-check').addEventListener('change', function () {
      if (this.checked) scheduleConvert();
    });

    var pinnedList = $('pinned-list');
    var historyList = $('history-list');
    if (pinnedList) pinnedList.addEventListener('click', handleTemplatePanelClick);
    if (historyList) historyList.addEventListener('click', handleTemplatePanelClick);
  }

  return {
    doConvert: doConvert,
    setSeparator: setSeparator,
    clearAll: clearAll,
    copyResult: copyResult,
    loadSample: loadSample,
    pinCurrentTemplate: pinCurrentTemplate,
    applyTemplate: applyTemplate,
    renderTemplateLists: renderTemplateLists,
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  TextJoinApp.init();
});
