'use strict';

module.exports = function (test, assert, assertEq) {
  test('规范化大小写与单个末尾点', function () {
    var result = DnsZoneSummaryProcess.normalizeZone('  API.Example.COM. ');
    assert(result.valid);
    assertEq(result.value, 'api.example.com');
  });

  test('拒绝连续点、空格与首尾连字符', function () {
    assert(!DnsZoneSummaryProcess.normalizeZone('a..example.com').valid);
    assert(!DnsZoneSummaryProcess.normalizeZone('bad zone.example.com').valid);
    assert(!DnsZoneSummaryProcess.normalizeZone('-bad.example.com').valid);
    assert(!DnsZoneSummaryProcess.normalizeZone('bad-.example.com').valid);
    assert(!DnsZoneSummaryProcess.normalizeZone('example.com..').valid);
  });

  test('允许 DNS 服务使用的下划线标签', function () {
    var result = DnsZoneSummaryProcess.normalizeZone('_msdcs.example.com');
    assert(result.valid);
    assertEq(result.value, '_msdcs.example.com');
  });

  test('多级父区同时存在时归入最短父区', function () {
    var result = DnsZoneSummaryProcess.process(
      'example.com\nsub.example.com\na.sub.example.com'
    );
    assertEq(result.zones.join(','), 'example.com');
    assertEq(result.mappings.length, 2);
    assertEq(result.mappings[1].target, 'example.com');
  });

  test('只有兄弟区时不推导共同父区', function () {
    var result = DnsZoneSummaryProcess.process(
      'a.example.com\nb.example.com'
    );
    assertEq(result.zones.join(','), 'a.example.com,b.example.com');
    assertEq(result.mergedCount, 0);
  });

  test('仅按完整 DNS 标签边界判断父区', function () {
    var result = DnsZoneSummaryProcess.process(
      'example.com\nbadexample.com\napi.example.com'
    );
    assertEq(result.zones.join(','), 'example.com,badexample.com');
    assertEq(result.mappings.length, 1);
    assertEq(result.mappings[0].source, 'api.example.com');
  });

  test('去重不区分大小写和末尾点并保留首次顺序', function () {
    var result = DnsZoneSummaryProcess.process(
      'B.EXAMPLE.NET.\na.example.net\nb.example.net\nA.Example.Net.'
    );
    assertEq(result.inputCount, 4);
    assertEq(result.validCount, 4);
    assertEq(result.uniqueCount, 2);
    assertEq(result.duplicateCount, 2);
    assertEq(result.zones.join(','), 'b.example.net,a.example.net');
  });

  test('无效输入单独报告且不参与汇总', function () {
    var result = DnsZoneSummaryProcess.process(
      'example.com\ninvalid zone\napi.example.com\n\n'
    );
    assertEq(result.inputCount, 3);
    assertEq(result.invalidLines.length, 1);
    assertEq(result.invalidLines[0].line, 2);
    assertEq(result.zones.join(','), 'example.com');
    assertEq(result.mergedCount, 1);
  });
};
