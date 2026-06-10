/**
 * 工具箱 Service Worker — 离线缓存（仅 HTTPS / HTTP 环境生效，file:// 不注册）
 * 新增工具时请将对应静态资源追加到 PRECACHE_URLS
 */
var CACHE_VERSION = 'webtools-v1';
var CACHE_NAME = CACHE_VERSION;

var PRECACHE_URLS = [
  './index.html',
  './manifest.webmanifest',
  './shared/css/common.css',
  './shared/js/utils.js',
  './shared/js/xlsx.js',
  './shared/js/tools-registry.js',
  './shared/js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './tools/net-policy/index.html',
  './tools/net-policy/css/tool.css',
  './tools/net-policy/js/ip.js',
  './tools/net-policy/js/process.js',
  './tools/net-policy/js/app.js',
  './tools/subnet-calc/index.html',
  './tools/subnet-calc/css/tool.css',
  './tools/subnet-calc/js/ip.js',
  './tools/subnet-calc/js/calc.js',
  './tools/subnet-calc/js/app.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function () {
        return cached;
      });

      return cached || networkFetch;
    })
  );
});
