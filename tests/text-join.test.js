'use strict';

module.exports = function (test, assert, assertEq) {
  test('applyPattern 替换 $1 $2', function () {
    var out = TextJoinProcess.applyPattern('ip $1 port $2', ['10.0.0.1', '80']);
    assertEq(out, 'ip 10.0.0.1 port 80');
  });

  test('applyPattern 替换 ${1} ${2}', function () {
    var out = TextJoinProcess.applyPattern('ip ${1} port ${2}', ['10.0.0.1', '80']);
    assertEq(out, 'ip 10.0.0.1 port 80');
  });

  test('applyPattern 支持 $n 与 ${n} 混用', function () {
    var out = TextJoinProcess.applyPattern('src=$1 dst=${2}', ['10.0.0.1', '10.0.0.2']);
    assertEq(out, 'src=10.0.0.1 dst=10.0.0.2');
  });

  test('普通 $ 文本保持不变', function () {
    var out = TextJoinProcess.applyPattern('price=$100 item=${1}', ['apple']);
    assertEq(out, 'price=$100 item=apple');
  });

  test('使用 \\$ 可输出字面量 $1', function () {
    var out = TextJoinProcess.applyPattern('literal=\\$1 value=${1}', ['apple']);
    assertEq(out, 'literal=$1 value=apple');
  });

  test('process 跳过空行', function () {
    var r = TextJoinProcess.process('a,b\n\nc,d', ',', '$1-$2');
    assertEq(r.lineCount, 2);
    assertEq(r.lines[0], 'a-b');
  });

  test('越界占位符保留', function () {
    assertEq(TextJoinProcess.applyPattern('$99', ['a']), '$99');
    assertEq(TextJoinProcess.applyPattern('${99}', ['a']), '${99}');
  });
};
