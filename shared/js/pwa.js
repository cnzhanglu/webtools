/**
 * PWA Service Worker 注册（无外部依赖）
 *
 * 根据当前页面脚本路径推算站点根目录下的 sw.js 相对 URL，
 * 在 HTTPS/HTTP 环境下于 load 后注册；file:// 协议下直接跳过。
 * 通过消息读取 SW 的 CACHE_VERSION；检测到新版本接管时提示用户刷新。
 *
 * 导出：无（IIFE 加载即执行 register）
 */
var BocPwa = (function () {
  'use strict';

  var refreshing = false;
  var hadController = false;
  var VERSION_KEY = 'boc-pwa-cache-version';

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

  /** 向当前 SW 查询缓存版本，首次安装只记录，后续版本变化才提示 */
  function checkVersion(worker, notifyIfUnknown) {
    if (!worker || typeof MessageChannel === 'undefined') return;

    var channel = new MessageChannel();
    channel.port1.onmessage = function (event) {
      var version = event.data && event.data.version;
      if (!version) return;

      var previous = null;
      try {
        previous = localStorage.getItem(VERSION_KEY);
        localStorage.setItem(VERSION_KEY, version);
      } catch (e) {
        /* 禁用本地存储时仍可依靠 controllerchange 判断更新 */
      }

      if (refreshing || (!notifyIfUnknown && !previous) || previous === version) return;
      refreshing = true;
      if (window.confirm('检测到工具箱新版本 ' + version + '，是否立即刷新？')) {
        window.location.reload();
      } else {
        refreshing = false;
      }
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  }

  function onControllerChange() {
    var shouldNotify = hadController;
    hadController = true;
    checkVersion(navigator.serviceWorker.controller, shouldNotify);
  }

  function register() {
    if (location.protocol === 'file:') return;
    if (!('serviceWorker' in navigator)) return;

    hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    var swUrl = getSwUrl();
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(swUrl).then(function (reg) {
        checkVersion(reg.active, false);
        reg.update();
      }).catch(function () {
        /* 注册失败时静默降级为普通网页 */
      });
    });
  }

  register();
})();
