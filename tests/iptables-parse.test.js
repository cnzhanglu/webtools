'use strict';

module.exports = function (test, assert, assertEq) {
  test('泛化 ACCEPT -s 归入附加规则而非 internal', function () {
    var text = '-A INPUT -s 10.0.0.0/24 -j ACCEPT';
    var r = IptablesParse.parseRules(text, 'v4');
    assertEq(r.byStack.v4.extraRules.length, 1);
    assertEq(r.byStack.v4.whitelists.internal.length, 0);
    assert(!r.byStack.v4.whitelistTouched.internal);
  });

  test('comment internal 白名单提取 -s', function () {
    var text = '-A INPUT -s 10.1.0.0/16 -j ACCEPT -m comment --comment "Cluster internal whitelist"';
    var r = IptablesParse.parseRules(text, 'v4');
    assert(r.byStack.v4.whitelistTouched.internal);
    assertEq(r.byStack.v4.whitelists.internal[0], '10.1.0.0/16');
  });

  test('iprange 复杂源匹配保留为附加规则', function () {
    var text = '-A INPUT -m iprange --src-range 10.0.0.1-10.0.0.5 -p tcp --dport 53 -j ACCEPT -m comment --comment "DNS TCP whitelist"';
    var r = IptablesParse.parseRules(text, 'v4');
    assertEq(r.byStack.v4.extraRules.length, 1);
    assert(r.warnings.length > 0);
  });
};
