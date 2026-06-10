/**
 * 子网掩码计算器 — UI 交互
 */
var SubnetCalcApp = (function () {
  'use strict';

  var syncing = false;
  var currentFamily = 4;

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

  function updatePrefixControls(prefix) {
    var bounds = getPrefixBounds();
    var slider = $('prefix-slider');
    var num    = $('prefix-num');
    var maskDisplay = $('mask-display');

    slider.min = bounds.min;
    slider.max = bounds.max;
    num.min    = bounds.min;
    num.max    = bounds.max;

    var p = Math.max(bounds.min, Math.min(bounds.max, prefix));
    slider.value = p;
    num.value    = p;

    if (currentFamily === 4) {
      maskDisplay.textContent = SubnetCalcIp.dottedMaskFromPrefix(p);
    } else {
      maskDisplay.textContent = '/' + p;
    }
  }

  function detectFamilyFromInput() {
    var raw = $('network-input').value.trim();
    if (!raw) return currentFamily;
    var ipPart = raw.split(/\s+/)[0];
    var slashIdx = ipPart.lastIndexOf('/');
    if (slashIdx !== -1) ipPart = ipPart.slice(0, slashIdx);
    var f = SubnetCalcIp.detectFamily(ipPart);
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

  function renderResults(data) {
    var tbody = $('result-body');
    tbody.innerHTML = '';

    if (!data || data.error) {
      tbody.innerHTML = '<tr><td colspan="2"><span class="empty-hint">' +
        (data && data.error ? BocUtils.escHtml(data.error) : '请输入网络地址进行计算') +
        '</span></td></tr>';
      $('family-badge').textContent = '—';
      return;
    }

    $('family-badge').textContent = data.family === 4 ? 'IPv4' : 'IPv6';

    RESULT_FIELDS.forEach(function (field) {
      var tr = document.createElement('tr');
      var tdLabel = document.createElement('td');
      tdLabel.className = 'td-label';
      tdLabel.textContent = field.label;

      var tdVal = document.createElement('td');
      tdVal.className = 'td-value';
      tdVal.textContent = data[field.key] || '—';

      tr.appendChild(tdLabel);
      tr.appendChild(tdVal);
      tbody.appendChild(tr);
    });
  }

  function doCalc(updateInputFromPrefix) {
    if (syncing) return;

    var raw = $('network-input').value.trim();
    var prefix = parseInt($('prefix-num').value, 10);

    currentFamily = detectFamilyFromInput();
    updatePrefixControls(isNaN(prefix) ? getPrefixBounds().defaultVal : prefix);

    if (!raw) {
      showError('');
      renderResults(null);
      return;
    }

    var parsed = SubnetCalcIp.parseNetworkInput(raw, prefix);
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

    showError('');

    syncing = true;
    if (parsed.prefix !== prefix) {
      $('prefix-num').value = parsed.prefix;
      $('prefix-slider').value = parsed.prefix;
      updatePrefixControls(parsed.prefix);
    }

    if (updateInputFromPrefix) {
      var cidr = parsed.family === 4
        ? parsed.ipStr + '/' + parsed.prefix
        : parsed.ipStr + '/' + parsed.prefix;
      $('network-input').value = cidr;
    }

    syncing = false;

    var result = SubnetCalcCore.calc(parsed);
    renderResults(result);
  }

  function onInputChange() {
    doCalc(false);
  }

  function onPrefixChange() {
    if (syncing) return;
    syncing = true;
    var p = parseInt($('prefix-slider').value, 10);
    $('prefix-num').value = p;
    updatePrefixControls(p);
    syncing = false;
    doCalc(true);
  }

  function onPrefixNumChange() {
    if (syncing) return;
    var p = parseInt($('prefix-num').value, 10);
    if (isNaN(p)) return;
    var bounds = getPrefixBounds();
    p = Math.max(bounds.min, Math.min(bounds.max, p));
    syncing = true;
    $('prefix-slider').value = p;
    $('prefix-num').value = p;
    updatePrefixControls(p);
    syncing = false;
    doCalc(true);
  }

  function loadSample() {
    $('network-input').value = '192.168.1.100/24';
    currentFamily = 4;
    doCalc(false);
  }

  function loadSampleV6() {
    $('network-input').value = '2001:db8:abcd:0012::1/64';
    currentFamily = 6;
    doCalc(false);
  }

  function clearAll() {
    $('network-input').value = '';
    currentFamily = 4;
    updatePrefixControls(24);
    showError('');
    renderResults(null);
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
    $('network-input').addEventListener('input', onInputChange);
    $('prefix-slider').addEventListener('input', onPrefixChange);
    $('prefix-num').addEventListener('input', onPrefixNumChange);
    $('prefix-num').addEventListener('change', onPrefixNumChange);

    updatePrefixControls(24);
    renderResults(null);
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
