'use strict';

/**
 * GslbProcess.buildTopology / buildAddRows 单元测试
 *
 * 覆盖：
 *   - buildAddRows 携带 _domainType
 *   - 同名 A/AAAA 两条 ADD：各自 buildTopology 只返回对应类型节点（不串图）
 *   - buildTopology 节点 id 含 type
 *   - 缺省 domainType（undefined）时不限制 type（向后兼容）
 */
module.exports = function (test, assert, assertEq) {

  // ─── 测试数据 ────────────────────────────────────────────────────────────────

  /** 构造最小 GSLB JSON：两条同名 ADD，一 A 一 AAAA，各引用不同地址池 */
  function makeFixture() {
    return {
      // getAddList 读取 jsonData.ADD（大写）
      ADD: [
        {
          name: 'example.com',
          type: 'A',
          algorithm: 'rr',
          enable: 'yes',
          gpool_list: [{ gpool_name: 'pool_a', ratio: '1' }]
        },
        {
          name: 'example.com',
          type: 'AAAA',
          algorithm: 'rr',
          enable: 'yes',
          gpool_list: [{ gpool_name: 'pool_aaaa', ratio: '1' }]
        },
        {
          name: 'other.com',
          type: 'A',
          algorithm: 'rr',
          enable: 'yes',
          gpool_list: [{ gpool_name: 'pool_other', ratio: '1' }]
        }
      ],
      gpool: [
        { name: 'pool_a',    gmember_list: [] },
        { name: 'pool_aaaa', gmember_list: [] },
        { name: 'pool_other', gmember_list: [] }
      ]
    };
  }

  var dcIdx = {};

  // ─── buildAddRows ─────────────────────────────────────────────────────────

  test('buildAddRows: 每行包含 _domainType', function () {
    var rows = GslbProcess.buildAddRows(makeFixture(), { domain: ['domain.name', 'domain.type'], pool: [], member: [] }, dcIdx);
    assert(rows.length > 0, '应有行');
    rows.forEach(function (row) {
      assert('_domainType' in row, '每行应含 _domainType');
    });
  });

  test('buildAddRows: A 记录行 _domainType 为 A', function () {
    var rows = GslbProcess.buildAddRows(makeFixture(), { domain: ['domain.name'], pool: [], member: [] }, dcIdx);
    var aRow = rows.filter(function (r) { return r._domainName === 'example.com' && r._domainType === 'A'; });
    assert(aRow.length > 0, '应有 example.com A 的行');
  });

  test('buildAddRows: AAAA 记录行 _domainType 为 AAAA', function () {
    var rows = GslbProcess.buildAddRows(makeFixture(), { domain: ['domain.name'], pool: [], member: [] }, dcIdx);
    var aaaaRow = rows.filter(function (r) { return r._domainName === 'example.com' && r._domainType === 'AAAA'; });
    assert(aaaaRow.length > 0, '应有 example.com AAAA 的行');
  });

  // ─── buildTopology：按 name+type 精确匹配 ────────────────────────────────

  test('buildTopology: example.com A 只返回 pool_a 池，不含 pool_aaaa', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', 'A');
    assertEq(topo.domains.length, 1, '只应有 1 个域名节点');
    var poolNames = topo.pools.map(function (p) { return p.name; });
    assert(poolNames.indexOf('pool_a') !== -1, '应含 pool_a');
    assert(poolNames.indexOf('pool_aaaa') === -1, '不应含 pool_aaaa（AAAA 的池）');
  });

  test('buildTopology: example.com AAAA 只返回 pool_aaaa 池，不含 pool_a', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', 'AAAA');
    assertEq(topo.domains.length, 1, '只应有 1 个域名节点');
    var poolNames = topo.pools.map(function (p) { return p.name; });
    assert(poolNames.indexOf('pool_aaaa') !== -1, '应含 pool_aaaa');
    assert(poolNames.indexOf('pool_a') === -1, '不应含 pool_a（A 的池）');
  });

  test('buildTopology: 域名节点 id 含 type 信息', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', 'A');
    var domainNode = topo.domains[0];
    assert(domainNode.id.indexOf('A') !== -1, '节点 id 应含 type "A"');
  });

  test('buildTopology: 边的 from 指向含 type 的域名节点 id', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', 'A');
    assert(topo.edges.length > 0, '应有边');
    var domainId = topo.domains[0].id;
    var fromEdge = null;
    for (var i = 0; i < topo.edges.length; i++) {
      if (topo.edges[i].from === domainId) { fromEdge = topo.edges[i]; break; }
    }
    assert(fromEdge !== null, '应有从域名节点出发的边，且 from 与域名节点 id 一致');
  });

  test('buildTopology: domainType 为 undefined 时不限制 type（返回全部同名域名）', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', undefined);
    // onlyType 为 null → 不过滤 type，两条同名 ADD 均入图
    assert(topo.domains.length >= 1, '不限 type 时应至少有节点');
    var poolNames = topo.pools.map(function (p) { return p.name; });
    assert(poolNames.indexOf('pool_a') !== -1 && poolNames.indexOf('pool_aaaa') !== -1,
      '不限 type 时应同时含 pool_a 和 pool_aaaa');
  });

  test('buildTopology: 指定 name+type 时不匹配其他域名', function () {
    var topo = GslbProcess.buildTopology(makeFixture(), dcIdx, 'example.com', 'A');
    var names = topo.domains.map(function (d) { return d.name; });
    assert(names.indexOf('other.com') === -1, '不应包含其他域名的节点');
  });

};
