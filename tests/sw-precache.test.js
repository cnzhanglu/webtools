'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

module.exports = function (test, assert, assertEq, ROOT) {
  test('check-precache-registry.py 通过', function () {
    var r = cp.spawnSync('python3', ['scripts/check-precache-registry.py'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    if (r.status !== 0) {
      throw new Error((r.stdout || '') + (r.stderr || '') || 'exit ' + r.status);
    }
  });

  test('sw.js 含 /api 旁路、导航缓存优先与版本查询', function () {
    var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    assert(sw.indexOf('isApiRequest') !== -1, '缺少 isApiRequest');
    assert(sw.indexOf("cache: 'reload'") !== -1, 'precache 未使用 cache: reload');
    assert(sw.indexOf('isSwScript') !== -1, '缺少 sw.js 网络优先逻辑');
    assert(sw.indexOf("event.data.type !== 'GET_VERSION'") !== -1, '缺少版本查询消息');
    assert(sw.indexOf('version: CACHE_VERSION') !== -1, '版本查询未返回 CACHE_VERSION');
    var nav = sw.match(/mode === 'navigate'[\s\S]*?return;\s*\n\s*\}/);
    assert(nav, '缺少 navigate 分支');
    assert(nav[0].indexOf('matchNavigateFallback') < nav[0].indexOf('fetch(event.request)'), '导航未缓存优先');
    assert(nav[0].indexOf('cache.put') === -1, '导航分支仍含 cache.put');
  });
};
