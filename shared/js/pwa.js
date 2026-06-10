/**
 * PWA 注册 — file:// 本地打开时自动跳过，不影响离线 HTML 使用
 */
var BocPwa = (function () {
  'use strict';

  function getSwUrl() {
    var script = document.currentScript;
    var src = (script && script.getAttribute('src')) || 'shared/js/pwa.js';
    var parts = src.split('/');
    parts.pop();
    parts.pop();
    parts.pop();
    var base = parts.join('/');
    return (base ? base + '/' : '') + 'sw.js';
  }

  function register() {
    if (location.protocol === 'file:') return;
    if (!('serviceWorker' in navigator)) return;

    var swUrl = getSwUrl();
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(swUrl).then(function (reg) {
        reg.update();
      }).catch(function () {
        /* 注册失败时静默降级为普通网页 */
      });
    });
  }

  register();
})();
