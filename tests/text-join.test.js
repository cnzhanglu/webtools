'use strict';

module.exports = function (test, assert, assertEq) {
  test('applyPattern 替换 $1 $2', function () {
    var out = TextJoinProcess.applyPattern('ip $1 port $2', ['10.0.0.1', '80']);
    assertEq(out, 'ip 10.0.0.1 port 80');
  });

  test('process 跳过空行', function () {
    var r = TextJoinProcess.process('a,b\n\nc,d', ',', '$1-$2');
    assertEq(r.lineCount, 2);
    assertEq(r.lines[0], 'a-b');
  });

  test('越界占位符保留', function () {
    assertEq(TextJoinProcess.applyPattern('$99', ['a']), '$99');
  });
};
