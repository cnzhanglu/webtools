/**
 * 子网掩码计算器 — UI 交互
 */
var SubnetCalcApp = (function () {
  'use strict';

  var syncing = false;
  var currentFamily = 4;
  var calcTimer = null;
  var resultCells = null;

  var RESULT_FIELDS = [
    { key: 'network',   label: '网络地址' },
    { key: 'broadcast', label: '广播地址' },
    { key: 'mask',      label: '子网掩码' },
    { key: 'maskPrefix', label: '前缀长度' },
    { key: 'wildcard',  label: '通配符掩码' },
    { key: 'hostCount', label: '可用主机数量' },
    { key: 'firstHost', label: '第一个主机地址' },
    { key: 'lastHost',  label: '最后一个主机地址' },
    { key: 'cidr',      label: 'CIDR 表示' },
  ];

  function $(id) { return document.getElementById(id); }

  function getPrefixBounds() {
    return currentFamily === 4
      ? { min: 0, max: 32, defaultVal: 24 }
      : { min: 0, max: 128, defaultVal: 64 };
  }

  function updatePrefixBounds() {
    var bounds = getPrefixBounds();
    var slider = $('prefix-slider');
    var num    = $('prefix-num');
    slider.min = bounds.min;
    slider.max = bounds.max;
    num.min    = bounds.min;
    num.max    = bounds.max;
  }

  function updateMaskDisplay(prefix) {
    var p = prefix;
    var maskDisplay = $('mask-display');
    if (currentFamily === 4) {
      maskDisplay.textContent = SubnetCalcIp.dottedMaskFromPrefix(p);
    } else {
      maskDisplay.textContent = '/' + p;
    }
  }

  function clampPrefix(prefix) {
    var bounds = getPrefixBounds();
    return Math.max(bounds.min, Math.min(bounds.max, prefix));
  }

  function stripEmbeddedPrefix(raw) {
    var ipPart = raw.trim().split(/\s+/)[0];
    var slashIdx = ipPart.lastIndexOf('/');
    if (slashIdx !== -1) ipPart = ipPart.slice(0, slashIdx);
    return ipPart;
  }

  function detectFamilyFromInput() {
    var raw = $('network-input').value.trim();
    if (!raw) return currentFamily;
    var f = SubnetCalcIp.detectFamily(stripEmbeddedPrefix(raw));
    return f || currentFamily;
  }

  function showError(msg) {
    var box = $('error-box');
    if (msg) {
      box.classList.add('visible');
      box.textContent = msg;
    } else {
      box.classList.remove('visible');
      box.textContent = '';
    }
  }

  function renderEmpty(msg) {
    resultCells = null;
    var tbody = $('result-body');
    tbody.innerHTML = '<tr><td colspan="2"><span class="empty-hint">' +
      BocUtils.escHtml(msg) + '</span></td></tr>';
    $('family-badge').textContent = '—';
  }

  function ensureResultTable() {
    if (resultCells) return;
    var tbody = $('result-body');
    tbody.innerHTML = '';
    resultCells = {};
    RESULT_FIELDS.forEach(function (field) {
      var tr = document.createElement('tr');
      var tdLabel = document.createElement('td');
      tdLabel.className = 'td-label';
      tdLabel.textContent = field.label;

      var tdVal = document.createElement('td');
      tdVal.className = 'td-value';
      tdVal.textContent = '—';

      tr.appendChild(tdLabel);
      tr.appendChild(tdVal);
      tbody.appendChild(tr);
      resultCells[field.key] = tdVal;
    });
  }

  function renderResults(data) {
    if (!data || data.error) {
      renderEmpty(data && data.error ? data.error : '请输入网络地址进行计算');
      return;
    }

    $('family-badge').textContent = data.family === 4 ? 'IPv4' : 'IPv6';
    ensureResultTable();
    RESULT_FIELDS.forEach(function (field) {
      resultCells[field.key].textContent = data[field.key] || '—';
    });
  }

  function doCalc(opts) {
    opts = opts || {};
    if (syncing) return;

    var raw = $('network-input').value.trim();
    var prefix = opts.prefix !== undefined
      ? opts.prefix
      : parseInt($('prefix-num').value, 10);

    currentFamily = detectFamilyFromInput();
    updatePrefixBounds();

    if (!raw) {
      showError('');
      renderEmpty('请输入网络地址进行计算');
      return;
    }

    if (isNaN(prefix)) {
      prefix = getPrefixBounds().defaultVal;
    }
    prefix = clampPrefix(prefix);

    var parseStr = opts.useControlPrefix ? stripEmbeddedPrefix(raw) : raw;
    var parsed = SubnetCalcIp.parseNetworkInput(parseStr, prefix);

    if (!parsed) {
      showError('无法解析输入，请检查 IP 地址格式');
      renderResults({ error: '解析失败' });
      return;
    }
    if (parsed.error) {
      showError(parsed.error);
      renderResults(parsed);
      return;
    }

    if (opts.useControlPrefix) {
      parsed.prefix = prefix;
    }

    showError('');

    if (opts.syncControls) {
      syncing = true;
      $('prefix-num').value = parsed.prefix;
      if (!opts.skipSliderWrite) {
        $('prefix-slider').value = parsed.prefix;
      }
      updateMaskDisplay(parsed.prefix);
      syncing = false;
    }

    if (opts.updateInput) {
      syncing = true;
      $('network-input').value = parsed.ipStr + '/' + parsed.prefix;
      syncing = false;
    }

    renderResults(SubnetCalcCore.calc(parsed));
  }

  function scheduleCalc(opts, delay) {
    if (calcTimer) clearTimeout(calcTimer);
    calcTimer = setTimeout(function () {
      calcTimer = null;
      doCalc(opts);
    }, delay === undefined ? 48 : delay);
  }

  function onNetworkInput() {
    if (syncing) return;
    scheduleCalc({ syncControls: true }, 80);
  }

  function onSliderInput() {
    if (syncing) return;
    var p = clampPrefix(parseInt($('prefix-slider').value, 10));
    syncing = true;
    $('prefix-num').value = p;
    updateMaskDisplay(p);
    syncing = false;

    scheduleCalc({
      prefix: p,
      useControlPrefix: true,
      skipSliderWrite: true,
      syncControls: false,
      updateInput: false,
    });
  }

  function onSliderChange() {
    if (calcTimer) {
      clearTimeout(calcTimer);
      calcTimer = null;
    }
    var p = clampPrefix(parseInt($('prefix-slider').value, 10));
    doCalc({
      prefix: p,
      useControlPrefix: true,
      skipSliderWrite: true,
      syncControls: true,
      updateInput: true,
    });
  }

  function onPrefixNumInput() {
    if (syncing) return;
    var p = parseInt($('prefix-num').value, 10);
    if (isNaN(p)) return;
    p = clampPrefix(p);
    syncing = true;
    $('prefix-slider').value = p;
    updateMaskDisplay(p);
    syncing = false;

    scheduleCalc({
      prefix: p,
      useControlPrefix: true,
      skipSliderWrite: true,
      syncControls: false,
      updateInput: false,
    });
  }

  function onPrefixNumChange() {
    if (calcTimer) {
      clearTimeout(calcTimer);
      calcTimer = null;
    }
    var p = parseInt($('prefix-num').value, 10);
    if (isNaN(p)) return;
    p = clampPrefix(p);
    doCalc({
      prefix: p,
      useControlPrefix: true,
      syncControls: true,
      updateInput: true,
    });
  }

  function loadSample() {
    $('network-input').value = '192.168.1.100/24';
    currentFamily = 4;
    doCalc({ syncControls: true });
  }

  function loadSampleV6() {
    $('network-input').value = '2001:db8:abcd:0012::1/64';
    currentFamily = 6;
    doCalc({ syncControls: true });
  }

  function clearAll() {
    if (calcTimer) {
      clearTimeout(calcTimer);
      calcTimer = null;
    }
    $('network-input').value = '';
    currentFamily = 4;
    syncing = true;
    $('prefix-slider').value = 24;
    $('prefix-num').value = 24;
    updatePrefixBounds();
    updateMaskDisplay(24);
    syncing = false;
    showError('');
    renderEmpty('请输入网络地址，结果将自动更新');
  }

  function copyResults() {
    var rows = $('result-body').querySelectorAll('tr');
    if (!rows.length || rows[0].querySelector('.empty-hint')) return;

    var lines = [];
    rows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td');
      if (cells.length === 2) {
        lines.push(cells[0].textContent + ': ' + cells[1].textContent);
      }
    });
    BocUtils.copyText(lines.join('\n'), '计算结果已复制！');
  }

  function init() {
    $('network-input').addEventListener('input', onNetworkInput);
    $('prefix-slider').addEventListener('input', onSliderInput);
    $('prefix-slider').addEventListener('change', onSliderChange);
    $('prefix-num').addEventListener('input', onPrefixNumInput);
    $('prefix-num').addEventListener('change', onPrefixNumChange);

    updatePrefixBounds();
    updateMaskDisplay(24);
    renderEmpty('请输入网络地址，结果将自动更新');
  }

  return {
    init: init,
    loadSample: loadSample,
    loadSampleV6: loadSampleV6,
    clearAll: clearAll,
    copyResults: copyResults,
  };
})();

document.addEventListener('DOMContentLoaded', SubnetCalcApp.init);
