'use strict';

module.exports = function (test, assert, assertEq) {
  test('parseCIDR 拒绝范围输入', function () {
    assertEq(NetPolicyIp.parseCIDR('10.0.0.1-10.0.0.5'), null);
  });

  test('parseCIDR 拒绝畸形 IPv6', function () {
    assertEq(NetPolicyIp.parseCIDR('12g::1/64'), null);
  });

  test('aggregateCIDR 向下聚合到 /24', function () {
    var c = NetPolicyIp.parseCIDR('10.1.1.5/32');
    assert(c !== null);
    assertEq(NetPolicyIp.aggregateCIDR(c, 24, 64), '10.1.1.0/24');
  });

  test('compareCIDRStr 按族与地址排序', function () {
    assert(NetPolicyIp.compareCIDRStr('10.0.0.0/24', '10.0.1.0/24') < 0);
  });
};
