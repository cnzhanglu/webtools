'use strict';

module.exports = function (test, assert, assertEq) {
  test('compare：B 被 A 覆盖', function () {
    var r = CidrVsProcess.compare('10.0.0.0/24', '10.0.0.1/32');
    assertEq(r.rows.length, 1);
    assertEq(r.rows[0].covered, true);
  });

  test('compare：B 未被 A 覆盖', function () {
    var r = CidrVsProcess.compare('10.0.0.0/24', '10.0.1.0/24');
    assertEq(r.rows[0].covered, false);
  });

  test('parseList：缩进注释行跳过', function () {
    var r = CidrVsProcess.parseList('  # comment\n10.0.0.1/32');
    assertEq(r.entries.length, 1);
    assertEq(r.errors.length, 0);
  });
};
