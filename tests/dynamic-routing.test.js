/**
 * 动态路由工具单元测试
 *
 * 覆盖 DynamicRoutingProcess 的 BGP AS 与 OSPF Area ID 互转逻辑。
 * 运行方式：node tests/run-tests.js
 */
module.exports = function (test, assert, assertEq) {

  /* ================================================================
   * BGP AS 号转换
   * ================================================================ */

  test('BGP: 十进制 65536 解析正确', function () {
    var r = DynamicRoutingProcess.parseAS('65536');
    assert(r !== null, '应解析成功');
    assertEq(r.value, 65536, 'value');
    assertEq(r.kind, 'decimal', 'kind');
  });

  test('BGP: 带点格式 1.0 解析正确', function () {
    var r = DynamicRoutingProcess.parseAS('1.0');
    assert(r !== null, '应解析成功');
    assertEq(r.value, 65536, 'value');
    assertEq(r.kind, 'asdot', 'kind');
  });

  test('BGP: 65536 转点格式为 1.0', function () {
    assertEq(DynamicRoutingProcess.asToDot(65536), '1.0');
  });

  test('BGP: 0 转点格式为 0.0', function () {
    assertEq(DynamicRoutingProcess.asToDot(0), '0.0');
  });

  test('BGP: 4294967295 转点格式为 65535.65535', function () {
    assertEq(DynamicRoutingProcess.asToDot(4294967295), '65535.65535');
  });

  test('BGP: ASDOT+ 模式 — 65535 显示十进制', function () {
    assertEq(DynamicRoutingProcess.toDisplayDot(65535, 'asdotplus'), '65535');
  });

  test('BGP: ASDOT+ 模式 — 65536 显示点格式', function () {
    assertEq(DynamicRoutingProcess.toDisplayDot(65536, 'asdotplus'), '1.0');
  });

  test('BGP: ASDOT 模式 — 1 显示 0.1', function () {
    assertEq(DynamicRoutingProcess.toDisplayDot(1, 'asdot'), '0.1');
  });

  test('BGP: asRange — 64512 为 2字节私有', function () {
    assert(DynamicRoutingProcess.asRange(64512).indexOf('私有') !== -1);
  });

  test('BGP: asRange — 0 为 Reserved', function () {
    assertEq(DynamicRoutingProcess.asRange(0), 'Reserved');
  });

  test('BGP: 超范围输入返回 null', function () {
    assert(DynamicRoutingProcess.parseAS('4294967296') === null, '超出最大值应返回 null');
  });

  test('BGP: 非法字符返回 null', function () {
    assert(DynamicRoutingProcess.parseAS('abc') === null);
  });

  test('BGP: 带点三段返回 null（非法格式）', function () {
    assert(DynamicRoutingProcess.parseAS('1.0.0') === null);
  });

  test('BGP: convertBgpLines 批量处理', function () {
    var result = DynamicRoutingProcess.convertBgpLines('65536\n1.0\n# 注释\n\nXXX', 'asdotplus');
    assertEq(result.rows.length, 2, '应有 2 条有效数据');
    assertEq(result.errors.length, 1, '应有 1 条错误');
    assertEq(result.rows[0].decimal, 65536);
    assertEq(result.rows[1].decimal, 65536);
  });

  /* ================================================================
   * OSPF Area ID 转换
   * ================================================================ */

  test('OSPF: 整数 0 解析正确（骨干区域）', function () {
    var r = DynamicRoutingProcess.parseArea('0');
    assert(r && !r.error, '应解析成功');
    assertEq(r.value, 0);
    assertEq(r.kind, 'integer');
  });

  test('OSPF: 整数 1 解析正确', function () {
    var r = DynamicRoutingProcess.parseArea('1');
    assertEq(r.value, 1);
  });

  test('OSPF: 整数 256 解析正确', function () {
    var r = DynamicRoutingProcess.parseArea('256');
    assertEq(r.value, 256);
  });

  test('OSPF: 点分 0.0.0.1 → 整数 1', function () {
    var r = DynamicRoutingProcess.parseArea('0.0.0.1');
    assert(r && !r.error);
    assertEq(r.value, 1);
    assertEq(r.kind, 'dotted');
  });

  test('OSPF: 点分 0.0.1.0 → 整数 256', function () {
    assertEq(DynamicRoutingProcess.parseArea('0.0.1.0').value, 256);
  });

  test('OSPF: 点分 192.168.1.0 → 整数 3232235776', function () {
    assertEq(DynamicRoutingProcess.parseArea('192.168.1.0').value, 3232235776);
  });

  test('OSPF: 整数 3232235776 → 点分 192.168.1.0', function () {
    assertEq(DynamicRoutingProcess.areaToOspfDotted(3232235776), '192.168.1.0');
  });

  test('OSPF: 整数 0 → 点分 0.0.0.0', function () {
    assertEq(DynamicRoutingProcess.areaToOspfDotted(0), '0.0.0.0');
  });

  test('OSPF: 整数 1 → 点分 0.0.0.1', function () {
    assertEq(DynamicRoutingProcess.areaToOspfDotted(1), '0.0.0.1');
  });

  test('OSPF: 整数 256 → 点分 0.0.1.0', function () {
    assertEq(DynamicRoutingProcess.areaToOspfDotted(256), '0.0.1.0');
  });

  test('OSPF: 最大值 4294967295 → 点分 255.255.255.255', function () {
    assertEq(DynamicRoutingProcess.areaToOspfDotted(4294967295), '255.255.255.255');
  });

  test('OSPF: areaNote(0) 标注骨干区域', function () {
    assert(DynamicRoutingProcess.areaNote(0).indexOf('骨干') !== -1);
  });

  test('OSPF: areaNote(1) 标注普通区域', function () {
    assert(DynamicRoutingProcess.areaNote(1).indexOf('普通') !== -1);
  });

  test('OSPF: 两段 X.Y 返回错误（提示 BGP 格式）', function () {
    var r = DynamicRoutingProcess.parseArea('1.0');
    assert(r && r.error && r.error.indexOf('BGP') !== -1, '应提示 BGP 格式错误');
  });

  test('OSPF: 三段点分返回错误', function () {
    var r = DynamicRoutingProcess.parseArea('1.2.3');
    assert(r && r.error, '应返回错误');
  });

  test('OSPF: 点分段超出 0~255 返回错误', function () {
    var r = DynamicRoutingProcess.parseArea('256.0.0.0');
    assert(r && r.error, '应返回错误');
  });

  test('OSPF: 前导零返回错误', function () {
    var r = DynamicRoutingProcess.parseArea('01');
    assert(r && r.error, '不允许前导零');
  });

  test('OSPF: 超范围整数返回错误', function () {
    var r = DynamicRoutingProcess.parseArea('4294967296');
    assert(r && r.error, '超出最大值应返回错误');
  });

  test('OSPF: convertOspfLines 批量处理', function () {
    var result = DynamicRoutingProcess.convertOspfLines('0\n1\n0.0.0.1\n# 注释\n\n1.0\nXXX');
    assertEq(result.rows.length, 3, '应有 3 条有效数据');
    assertEq(result.errors.length, 2, '1.0 和 XXX 共 2 条错误');
    assertEq(result.rows[0].integer, 0);
    assertEq(result.rows[0].dotted, '0.0.0.0');
    assertEq(result.rows[1].integer, 1);
    assertEq(result.rows[2].integer, 1);
  });
};
