'use strict';

module.exports = function (test, assert, assertEq) {
  test('isIPv6 接受 IPv4-mapped 全写法', function () {
    assert(Excel2JsonValidate.isIPv6('0:0:0:0:0:ffff:192.168.1.1'));
  });

  test('normalizeIp 统一 IPv6 文本', function () {
    assertEq(
      Excel2JsonValidate.normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'),
      '2001:db8::1'
    );
  });

  test('validateMultipleIPs 规范化并去重', function () {
    var res = Excel2JsonValidate.validateMultipleIPs('2001:db8::1\n2001:0db8::1', 2, 'E');
    assertEq(res.error, null);
    assertEq(res.ips.length, 1);
    assertEq(res.ips[0], '2001:db8::1');
  });

  test('validateSingleIP 拒绝多行', function () {
    var res = Excel2JsonValidate.validateSingleIP('1.1.1.1\n2.2.2.2', 3, 'E');
    assert(res.error !== null);
  });
};
