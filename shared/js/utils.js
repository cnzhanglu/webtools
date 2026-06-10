/**
 * 共享工具函数（无外部依赖）
 */
var BocUtils = (function () {
  'use strict';

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** 从下拉 + 自定义输入框读取连接符 */
  function getSep(presetId, customId) {
    var preset = document.getElementById(presetId).value;
    if (preset === 'custom') {
      return document.getElementById(customId).value || '\n';
    }
    return preset === '\\n' ? '\n' : preset;
  }

  /** 绑定「自定义连接符」下拉显示切换 */
  function bindSepToggle(presetId, customGroupId) {
    document.getElementById(presetId).addEventListener('change', function () {
      document.getElementById(customGroupId).style.display =
        this.value === 'custom' ? '' : 'none';
    });
  }

  /** 复制文本到剪贴板，带降级方案 */
  function copyText(text, okMsg) {
    okMsg = okMsg || '已复制到剪贴板！';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { alert(okMsg); })
        .catch(function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert(okMsg);
  }

  /** 触发文件下载 */
  function downloadBlob(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 1000);
  }

  return {
    escHtml: escHtml,
    getSep: getSep,
    bindSepToggle: bindSepToggle,
    copyText: copyText,
    downloadBlob: downloadBlob
  };
})();
