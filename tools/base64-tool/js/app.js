/**
 * Base64 编解码工具 — 逻辑与 UI 合一
 *
 * 三种模式（标签页）：
 *   文本：TextEncoder/Decoder + btoa/atob
 *   文件编码：FileReader 读 ArrayBuffer → 分块 uint8ToBase64（避免大数组栈溢出）
 *   文件解码：Base64 文本 → Uint8Array → downloadBlob 还原文件
 *
 * 依赖：BocUtils
 * 导出：Base64App
 */
var Base64App = (function () {
  'use strict';

  var CHUNK = 32768; // 32 KiB — 避免 String.fromCharCode.apply 栈溢出

  /* ---- 核心算法 ---- */

  /** Uint8Array → Base64 字符串（分块，支持任意大小） */
  function uint8ToBase64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
    }
    return btoa(parts.join(''));
  }

  /** Base64 字符串 → Uint8Array（去除空白后解码） */
  function base64ToUint8(b64) {
    b64 = b64.replace(/\s+/g, '');
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** 文件大小格式化 */
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  /* ---- 标签页切换 ---- */

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(function (pane) {
      pane.classList.toggle('active', pane.id === 'tab-' + tab);
    });
  }

  /* ---- 文本模式 ---- */

  function textEncode() {
    var input = document.getElementById('text-input').value;
    if (!input) return;
    var bytes = new TextEncoder().encode(input);
    document.getElementById('text-output').value = uint8ToBase64(bytes);
    document.getElementById('text-stat').textContent =
      '原始 ' + fmtSize(bytes.length) + ' → 编码后 ' + fmtSize(document.getElementById('text-output').value.length) + ' B';
  }

  function textDecode() {
    var input = document.getElementById('text-input').value.trim();
    if (!input) return;
    try {
      var bytes = base64ToUint8(input);
      document.getElementById('text-output').value = new TextDecoder().decode(bytes);
      document.getElementById('text-stat').textContent = '解码 ' + fmtSize(bytes.length);
    } catch (e) {
      alert('解码失败：' + e.message);
    }
  }

  function textSwap() {
    var a = document.getElementById('text-input').value;
    var b = document.getElementById('text-output').value;
    document.getElementById('text-input').value = b;
    document.getElementById('text-output').value = a;
  }

  function copyText(id) {
    var val = document.getElementById(id).value;
    if (!val) return;
    BocUtils.copyText(val);
  }

  function clearText() {
    document.getElementById('text-input').value = '';
    document.getElementById('text-output').value = '';
    document.getElementById('text-stat').textContent = '';
  }

  /* ---- 文件编码模式 ---- */

  var _fileBytes = null;
  var _fileName = '';
  var _fileB64 = '';

  function triggerFileLoad() {
    document.getElementById('file-input').click();
  }

  function onFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    _fileName = file.name;
    setFileStatus('读取文件中…', '');

    var reader = new FileReader();
    reader.onload = function (ev) {
      _fileBytes = new Uint8Array(ev.target.result);
      setFileStatus(
        '已加载：' + _fileName + '（' + fmtSize(_fileBytes.length) + '）',
        ''
      );
      document.getElementById('btn-encode-file').disabled = false;
      document.getElementById('file-b64-output').value = '';
    };
    reader.onerror = function () { alert('读取文件失败'); };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function encodeFile() {
    if (!_fileBytes) { alert('请先选择文件'); return; }
    setFileStatus('编码中…', '');
    // 使用 setTimeout 让 UI 先更新
    setTimeout(function () {
      try {
        _fileB64 = uint8ToBase64(_fileBytes);
        document.getElementById('file-b64-output').value = _fileB64;
        setFileStatus(
          '已完成：' + _fileName,
          '原始 ' + fmtSize(_fileBytes.length) + ' → Base64 ' + fmtSize(_fileB64.length) + ' B（' +
          (((_fileB64.length / _fileBytes.length - 1) * 100).toFixed(1)) + '% 膨胀）'
        );
        document.getElementById('btn-save-b64').disabled = false;
      } catch (e) {
        alert('编码失败：' + e.message);
        setFileStatus('编码失败', '');
      }
    }, 30);
  }

  function saveB64AsTxt() {
    if (!_fileB64) { alert('请先编码文件'); return; }
    BocUtils.downloadBlob(_fileB64, _fileName + '.base64.txt', 'text/plain;charset=utf-8');
  }

  function setFileStatus(line1, line2) {
    document.getElementById('file-status-1').textContent = line1;
    document.getElementById('file-status-2').textContent = line2;
  }

  /* ---- Base64 解码为文件 ---- */

  function triggerB64Load() {
    document.getElementById('b64decode-file-input').click();
  }

  function onB64FileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      document.getElementById('b64decode-input').value = ev.target.result;
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function decodeToFile() {
    var b64 = document.getElementById('b64decode-input').value.trim();
    if (!b64) { alert('请输入 Base64 内容'); return; }
    var saveName = document.getElementById('b64decode-filename').value.trim() || 'decoded_file';
    try {
      var bytes = base64ToUint8(b64);
      document.getElementById('b64decode-stat').textContent = '解码成功，大小 ' + fmtSize(bytes.length);
      BocUtils.downloadBlob(bytes, saveName, 'application/octet-stream');
    } catch (e) {
      alert('解码失败：' + e.message);
    }
  }

  /* ---- 初始化 ---- */

  function init() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });
    document.getElementById('file-input').addEventListener('change', onFileSelected);
    document.getElementById('b64decode-file-input').addEventListener('change', onB64FileSelected);
  }

  return {
    init: init,
    switchTab: switchTab,
    textEncode: textEncode,
    textDecode: textDecode,
    textSwap: textSwap,
    copyText: copyText,
    clearText: clearText,
    triggerFileLoad: triggerFileLoad,
    encodeFile: encodeFile,
    saveB64AsTxt: saveB64AsTxt,
    triggerB64Load: triggerB64Load,
    decodeToFile: decodeToFile
  };
})();

document.addEventListener('DOMContentLoaded', function () { Base64App.init(); });
