/**
 * PWA Service Worker 注册（无外部依赖）
 *
 * 根据当前页面脚本路径推算站点根目录下的 sw.js 相对 URL，
 * 在 HTTPS/HTTP 环境下于 load 后注册；file:// 协议下直接跳过，
 * 避免本地双击打开时报错。
 *
 * 导出：无（IIFE 加载即执行 register）
 */
var BocPwa = (function () {
  'use strict';

  /** 从 pwa.js 的 src 路径向上三级得到站点根，拼接 sw.js */
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
