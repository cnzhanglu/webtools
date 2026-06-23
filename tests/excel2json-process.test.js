'use strict';

module.exports = function (test, assert, assertEq) {
  test('空应用名行返回错误而非静默跳过', function () {
    var res = Excel2JsonProcess.run([
      { rowIndex: 2, A: '', D: 'a.example.com', E: '1.1.1.1', F: '2.2.2.2', G: '动态' }
    ]);
    assertEq(res.ok, false);
    assert(res.error.indexOf('列 A') !== -1);
  });

  test('非法类型返回错误', function () {
    var res = Excel2JsonProcess.run([
      { rowIndex: 2, A: 'app1', D: 'a.example.com', E: '1.1.1.1', F: '2.2.2.2', G: '未知' }
    ]);
    assertEq(res.ok, false);
    assert(res.error.indexOf('列 G') !== -1);
  });
};
