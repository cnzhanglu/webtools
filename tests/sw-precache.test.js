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

  test('sw.js 含 /api 旁路与 precache reload', function () {
    var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    assert(sw.indexOf('isApiRequest') !== -1, '缺少 isApiRequest');
    assert(sw.indexOf("cache: 'reload'") !== -1, 'precache 未使用 cache: reload');
    assert(sw.indexOf('isSwScript') !== -1, '缺少 sw.js 网络优先逻辑');
  });
};
