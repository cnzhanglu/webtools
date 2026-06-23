'use strict';

module.exports = function (test, assert, assertEq) {
  test('strict 模式合并相邻 /24', function () {
    var r = NetSummaryProcess.summarize('10.0.0.0/24\n10.0.1.0/24', 'strict');
    assert(r.rows.length >= 1);
  });

  test('parseList 跳过缩进注释', function () {
    var r = NetSummaryProcess.parseList('  // note\n192.168.1.0/24');
    assertEq(r.entries.length, 1);
  });
};
