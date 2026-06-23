'use strict';

module.exports = function (test, assert, assertEq) {
  test('escHtml 转义尖括号', function () {
    assertEq(BocUtils.escHtml('<b>'), '&lt;b&gt;');
  });

  test('escAttr 转义双引号', function () {
    assertEq(BocUtils.escAttr('a"b'), 'a&quot;b');
  });
};
