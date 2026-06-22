/**
 * 字符拼接工具 — 模版历史与固定保存
 *
 * 使用 localStorage 持久化，与 Service Worker 静态资源缓存分离。
 * - history：最近 20 条（LRU，同文本去重后置顶）
 * - pinned：用户手动固定，不参与 20 条淘汰
 *
 * 导出：TextJoinTemplates
 */
var TextJoinTemplates = (function () {
  'use strict';

  var STORAGE_KEY = 'text_join_templates_v1';
  var MAX_HISTORY = 20;

  var state = {
    pinned: [],
    history: []
  };

  function genId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeText(text) {
    return String(text || '').trim();
  }

  function preview(text, maxLen) {
    maxLen = maxLen || 48;
    var oneLine = String(text || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (oneLine.length <= maxLen) return oneLine;
    return oneLine.slice(0, maxLen) + '…';
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(state));
      var data = JSON.parse(raw);
      state.pinned = Array.isArray(data.pinned) ? data.pinned : [];
      state.history = Array.isArray(data.history) ? data.history : [];
      return getState();
    } catch (e) {
      return { pinned: [], history: [] };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota errors */ }
  }

  function getState() {
    return {
      pinned: state.pinned.slice(),
      history: state.history.slice()
    };
  }

  function findPinnedByText(text) {
    var key = normalizeText(text);
    for (var i = 0; i < state.pinned.length; i++) {
      if (normalizeText(state.pinned[i].text) === key) return state.pinned[i];
    }
    return null;
  }

  function findHistoryByText(text) {
    var key = normalizeText(text);
    for (var i = 0; i < state.history.length; i++) {
      if (normalizeText(state.history[i].text) === key) return state.history[i];
    }
    return null;
  }

  /**
   * 转换成功后写入历史（去重、置顶、最多 20 条）
   * @param {string} text 模版文本
   */
  function addHistory(text) {
    var normalized = normalizeText(text);
    if (!normalized) return null;

    var existing = findHistoryByText(normalized);
    if (existing) {
      existing.text = normalized;
      existing.lastUsedAt = Date.now();
      state.history.sort(function (a, b) { return (b.lastUsedAt || 0) - (a.lastUsedAt || 0); });
    } else {
      state.history.unshift({
        id: genId('h'),
        text: normalized,
        lastUsedAt: Date.now()
      });
      while (state.history.length > MAX_HISTORY) {
        state.history.pop();
      }
    }
    save();
    return getState();
  }

  /**
   * 固定当前模版
   * @param {string} text 模版文本
   * @param {string} label 可选备注
   */
  function pin(text, label) {
    var normalized = normalizeText(text);
    if (!normalized) return null;

    var existing = findPinnedByText(normalized);
    if (existing) {
      existing.text = normalized;
      if (label !== undefined && label !== null) {
        existing.label = String(label).trim();
      }
      existing.createdAt = existing.createdAt || Date.now();
    } else {
      state.pinned.unshift({
        id: genId('p'),
        text: normalized,
        label: String(label || '').trim(),
        createdAt: Date.now()
      });
    }
    save();
    return getState();
  }

  function unpin(id) {
    state.pinned = state.pinned.filter(function (item) { return item.id !== id; });
    save();
    return getState();
  }

  function deleteHistory(id) {
    state.history = state.history.filter(function (item) { return item.id !== id; });
    save();
    return getState();
  }

  function getById(id) {
    var i;
    for (i = 0; i < state.pinned.length; i++) {
      if (state.pinned[i].id === id) return state.pinned[i];
    }
    for (i = 0; i < state.history.length; i++) {
      if (state.history[i].id === id) return state.history[i];
    }
    return null;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    MAX_HISTORY: MAX_HISTORY,
    load: load,
    save: save,
    getState: getState,
    addHistory: addHistory,
    pin: pin,
    unpin: unpin,
    deleteHistory: deleteHistory,
    getById: getById,
    preview: preview,
    normalizeText: normalizeText
  };
})();
