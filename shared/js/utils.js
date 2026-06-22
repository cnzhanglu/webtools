/**
 * 共享工具函数（无外部依赖）
 *
 * 被各工具 app.js 复用，提供：
 *   - escHtml：渲染用户输入到 innerHTML 时防 XSS
 *   - getSep / bindSepToggle：连接符下拉（换行/逗号/自定义）的读取与 UI 联动
 *   - copyText：剪贴板写入（优先 Clipboard API，失败降级 execCommand）
 *   - downloadBlob：触发浏览器文件下载
 *
 * 导出：BocUtils
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

  /** 复制文本到剪贴板，带降级方案；失败时不误报成功 */
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
    var ok = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      ok = false;
    }
    if (ok) alert(okMsg);
    else alert('复制失败，请手动选择并复制');
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
