/**
 * 工具箱 Service Worker — 离线缓存（仅 HTTPS / HTTP 环境生效，file:// 不注册）
 * 新增工具时请将对应静态资源追加到 PRECACHE_URLS
 *
 * 注意：Cloudflare 会将 /xxx/index.html 307 重定向到 /xxx/，
 * 因此预缓存须使用带尾斜杠的目录 URL，不可用 index.html 路径。
 */
var CACHE_VERSION = 'webtools-v5';
var CACHE_NAME = CACHE_VERSION;

var PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './shared/css/common.css',
  './shared/js/utils.js',
  './shared/js/xlsx.js',
  './shared/js/tools-registry.js',
  './shared/js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './tools/net-policy/',
  './tools/net-policy/css/tool.css',
  './tools/net-policy/js/ip.js',
  './tools/net-policy/js/process.js',
  './tools/net-policy/js/app.js',
  './tools/subnet-calc/',
  './tools/subnet-calc/css/tool.css',
  './tools/subnet-calc/js/ip.js',
  './tools/subnet-calc/js/calc.js',
  './tools/subnet-calc/js/app.js',
];

function precacheAll(cache, urls) {
  return Promise.all(urls.map(function (url) {
    return fetch(url).then(function (response) {
      if (response && response.ok) {
        return cache.put(url, response);
      }
    }).catch(function () {
      /* 单个资源失败不影响整体安装 */
    });
  }));
}

function matchNavigateFallback(request) {
  var url = new URL(request.url);
  var path = url.pathname;
  var tries = [request];

  if (path.endsWith('/index.html')) {
    tries.push(path.slice(0, -'index.html'.length));
  }
  if (!path.endsWith('/')) {
    tries.push(path + '/');
  }
  tries.push('./');

  var i = 0;
  function next() {
    if (i >= tries.length) return undefined;
    var target = tries[i++];
    var req = typeof target === 'string'
      ? new Request(new URL(target, url.origin).toString())
      : target;
    return caches.match(req).then(function (hit) {
      return hit || next();
    });
  }
  return next();
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return precacheAll(cache, PRECACHE_URLS);
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

  /* 页面导航：网络优先，离线时回退缓存 */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function () {
        return matchNavigateFallback(event.request);
      })
    );
    return;
  }

  /* 静态资源：缓存优先，同时后台更新 */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
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
