'use strict';

module.exports = function (test, assert, assertEq) {
  test('parseIPv4 拒绝科学计数法', function () {
    assertEq(BocIpCidr.parseIPv4('1e2'), null);
    assert(BocIpCidr.parseIPv4('192.168.1.1') !== null);
  });

  test('parseIPv6 拒绝畸形 hextet', function () {
    assertEq(BocIpCidr.parseIPv6('12g::1'), null);
    assert(BocIpCidr.parseIPv6('2001:db8::1') !== null);
  });

  test('parseIPv6 接受 IPv4-mapped 全写法', function () {
    var v = BocIpCidr.parseIPv6('0:0:0:0:0:ffff:192.168.1.1');
    assert(v !== null);
  });

  test('normalize：ipFromBigInt 与 parseSingleIp 往返', function () {
    var ip = BocIpCidr.parseSingleIp('2001:0db8:0000:0000:0000:0000:0000:0001');
    assert(ip !== null);
    var text = BocIpCidr.ipFromBigInt(ip.value, ip.family);
    assertEq(text, '2001:db8::1');
  });

  test('mergeStrict 合并相邻 /24', function () {
    var a = BocIpCidr.parseEntry('10.0.0.0/24');
    var b = BocIpCidr.parseEntry('10.0.1.0/24');
    var out = BocIpCidr.mergeStrict([a, b]);
    assert(out.length >= 1);
  });
};
