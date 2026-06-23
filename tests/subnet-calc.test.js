'use strict';

module.exports = function (test, assert, assertEq) {
  test('calc /24 网络地址', function () {
    var net = SubnetCalcIp.parseNetworkInput('192.168.1.10/24');
    assert(net && !net.error);
    var r = SubnetCalcCore.calc(net);
    assertEq(r.network, '192.168.1.0');
  });

  test('parseNetworkInput 拒绝无效 IPv4', function () {
    assertEq(SubnetCalcIp.parseNetworkInput('1e2.0.0.1/24'), null);
  });
};
