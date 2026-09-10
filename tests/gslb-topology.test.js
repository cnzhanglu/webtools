'use strict';

/**
 * GslbProcess.buildTopology / buildAddRows 单元测试
 *
 * 覆盖：
 *   - buildAddRows 携带 _domainType
 *   - 同名 A/AAAA 两条 ADD：各自 buildTopology 只返回对应类型节点（不串图）
 *   - buildTopology 节点 id 含 type
 *   - 缺省 domainType（undefined）时不限制 type（向后兼容）
 *   - 四级 enable 禁用状态、向后传播与共享 Server 入站路径规则
 *   - filterRowsByColumns 单列/多列 AND、包含/等于、空条件
 *   - measurePreviewColumnWidths 列宽估算
 *   - 预览页字段折叠与关系图弹窗静态结构
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

  /** 构造同时覆盖域名、池、池成员、服务成员和共享 Server 的状态拓扑。 */
  function makeStatusFixture() {
    return {
      ADD: [
        {
          name: 'disabled.example',
          type: 'A',
          enable: 'no',
          gpool_list: [{ gpool_name: 'pool_domain' }]
        },
        {
          name: 'shared.example',
          type: 'A',
          enable: 'yes',
          gpool_list: [
            { gpool_name: 'pool_enabled' },
            { gpool_name: 'pool_disabled' }
          ]
        }
      ],
      gpool: [
        {
          name: 'pool_domain',
          enable: 'yes',
          gmember_list: [
            { dc_name: 'dc', gmember_name: 'domain_member', ip: '192.0.2.1', enable: 'yes' }
          ]
        },
        {
          name: 'pool_enabled',
          enable: 'yes',
          gmember_list: [
            { dc_name: 'dc', gmember_name: 'shared_member', ip: '192.0.2.2', enable: 'yes' },
            { dc_name: 'dc', gmember_name: 'all_disabled_member', ip: '192.0.2.3', enable: 'no' },
            { dc_name: 'dc', gmember_name: 'self_disabled_member', ip: '192.0.2.4', enable: 'yes' }
          ]
        },
        {
          name: 'pool_disabled',
          enable: 'no',
          gmember_list: [
            { dc_name: 'dc', gmember_name: 'shared_member', ip: '192.0.2.2', enable: 'yes' },
            { dc_name: 'dc', gmember_name: 'all_disabled_member', ip: '192.0.2.3', enable: 'yes' }
          ]
        }
      ],
      data_center: [
        {
          name: 'dc',
          gmembers: [
            { gmember_name: 'domain_member', enable: 'yes' },
            { gmember_name: 'shared_member', enable: 'yes' },
            { gmember_name: 'all_disabled_member', enable: 'yes' },
            { gmember_name: 'self_disabled_member', enable: 'no' }
          ]
        }
      ]
    };
  }

  function findByName(items, name) {
    return items.filter(function (item) {
      return item.name === name || item.label === name;
    })[0];
  }

  function findEdge(topology, fromName, toName) {
    var nodes = topology.domains.concat(topology.pools).concat(topology.members);
    var from = findByName(nodes, fromName);
    var to = findByName(nodes, toName);
    return topology.edges.filter(function (edge) {
      return from && to && edge.from === from.id && edge.to === to.id;
    })[0];
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

  test('buildAddRows: 禁用元数据不依赖是否选择 enable 列', function () {
    var data = makeStatusFixture();
    var rows = GslbProcess.buildAddRows(data, { domain: [], pool: [], member: [] }, GslbProcess.buildDcMemberIndex(data));

    function hasReason(reason) {
      return rows.some(function (row) {
        return row._disabled && row._disabledReasons.indexOf(reason) !== -1;
      });
    }

    assert(hasReason('域名 enable=no'), '应识别域名禁用');
    assert(hasReason('地址池 enable=no'), '应识别地址池禁用');
    assert(hasReason('地址池成员 enable=no'), '应识别地址池成员禁用');
    assert(hasReason('服务成员 enable=no'), '应识别服务成员禁用');
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

  // ─── buildTopology：禁用状态传播 ──────────────────────────────────────────

  test('buildTopology: 域名禁用向地址池和 Server 路径传播', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'disabled.example', 'A');
    assert(findByName(topo.domains, 'disabled.example').disabled, '域名节点应禁用');
    assert(findByName(topo.pools, 'pool_domain').disabled, '池节点应因所有上游路径禁用而禁用');
    assert(findEdge(topo, 'disabled.example', 'pool_domain').disabled, '域名到池连线应禁用');
    assert(findEdge(topo, 'pool_domain', 'domain_member').disabled, '池到 Server 连线应禁用');
    assert(findByName(topo.members, 'domain_member').disabled, '仅有禁用入站路径的 Server 应禁用');
  });

  test('buildTopology: 地址池禁用向成员连线传播', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'shared.example', 'A');
    assert(findByName(topo.pools, 'pool_disabled').disabled, 'enable=no 的池节点应禁用');
    assert(findEdge(topo, 'pool_disabled', 'shared_member').disabled, '禁用池的成员连线应禁用');
  });

  test('buildTopology: 地址池成员禁用只禁用对应连线', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'shared.example', 'A');
    assert(findEdge(topo, 'pool_enabled', 'all_disabled_member').disabled, 'enable=no 的池成员连线应禁用');
    assert(!findByName(topo.pools, 'pool_enabled').disabled, '池成员禁用不应反向禁用地址池');
  });

  test('buildTopology: 服务成员自身禁用直接禁用 Server 节点', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'shared.example', 'A');
    assert(findByName(topo.members, 'self_disabled_member').disabled, '服务成员 enable=no 应直接禁用节点');
    assert(!findEdge(topo, 'pool_enabled', 'self_disabled_member').disabled,
      '服务成员自身禁用不应改写仍启用的入站连线');
  });

  test('buildTopology: 共享 Server 有启用路径时节点保持启用', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'shared.example', 'A');
    assert(!findByName(topo.members, 'shared_member').disabled, '存在启用路径的共享 Server 应保持启用');
    assert(!findEdge(topo, 'pool_enabled', 'shared_member').disabled, '启用路径应保持启用');
    assert(findEdge(topo, 'pool_disabled', 'shared_member').disabled, '禁用路径仍应单独标记');
  });

  test('buildTopology: 共享 Server 所有入站路径禁用时节点禁用', function () {
    var data = makeStatusFixture();
    var topo = GslbProcess.buildTopology(data, GslbProcess.buildDcMemberIndex(data), 'shared.example', 'A');
    var member = findByName(topo.members, 'all_disabled_member');
    assert(member.disabled, '所有入站路径禁用时 Server 应禁用');
    assert(member.disabledReasons.indexOf('所有入站路径均已禁用') !== -1, '应记录传播原因');
  });

  // ─── 逐列过滤 ──────────────────────────────────────────────────────────────

  test('filterRowsByColumns: 空条件返回全部行', function () {
    var rows = [
      { 'domain.name': 'a.example', 'member.ip': '1.1.1.1' },
      { 'domain.name': 'b.example', 'member.ip': '2.2.2.2' }
    ];
    var out = GslbProcess.filterRowsByColumns(rows, { 'domain.name': '  ' }, 'contains');
    assertEq(out.length, 2);
  });

  test('filterRowsByColumns: 单列包含匹配忽略大小写', function () {
    var rows = [
      { 'domain.name': 'App.Example', 'member.ip': '1.1.1.1' },
      { 'domain.name': 'other.com', 'member.ip': '2.2.2.2' }
    ];
    var out = GslbProcess.filterRowsByColumns(rows, { 'domain.name': 'app' }, 'contains');
    assertEq(out.length, 1);
    assertEq(out[0]['domain.name'], 'App.Example');
  });

  test('filterRowsByColumns: 多列条件按 AND 组合', function () {
    var rows = [
      { 'domain.name': 'app.example', 'member.ip': '1.1.1.1' },
      { 'domain.name': 'app.example', 'member.ip': '2.2.2.2' },
      { 'domain.name': 'other.example', 'member.ip': '1.1.1.1' }
    ];
    var out = GslbProcess.filterRowsByColumns(rows, {
      'domain.name': 'app',
      'member.ip': '1.1.1.1'
    }, 'contains');
    assertEq(out.length, 1);
    assertEq(out[0]['member.ip'], '1.1.1.1');
  });

  test('filterRowsByColumns: equals 需整格精确匹配', function () {
    var rows = [
      { 'domain.name': 'app.example' },
      { 'domain.name': 'app' }
    ];
    var out = GslbProcess.filterRowsByColumns(rows, { 'domain.name': 'app' }, 'equals');
    assertEq(out.length, 1);
    assertEq(out[0]['domain.name'], 'app');
  });

  test('filterRowsByColumns: 缺列按空字符串比较', function () {
    var rows = [
      { 'domain.name': 'app.example' },
      { 'domain.name': 'other', 'member.ip': '1.1.1.1' }
    ];
    var out = GslbProcess.filterRowsByColumns(rows, { 'member.ip': '1.1.1.1' }, 'contains');
    assertEq(out.length, 1);
    assertEq(out[0]['domain.name'], 'other');
  });

  test('measurePreviewColumnWidths: 空行按表头保底宽度', function () {
    var w = GslbProcess.measurePreviewColumnWidths(
      ['domain.name'],
      [],
      function () { return '域名名称'; }
    );
    assertEq(w.length, 1);
    assert(w[0] >= 88, '空表也应有最小列宽');
  });

  test('measurePreviewColumnWidths: 短列不低于最小宽', function () {
    var w = GslbProcess.measurePreviewColumnWidths(
      ['domain.type'],
      [{ 'domain.type': 'A' }],
      function () { return '类型'; }
    );
    assertEq(w.length, 1);
    assert(w[0] >= 88);
  });

  test('measurePreviewColumnWidths: 长文本列更宽', function () {
    var w = GslbProcess.measurePreviewColumnWidths(
      ['a', 'b'],
      [{ a: 'x', b: 'this-is-a-very-long-cell-value-that-should-be-wider-than-short' }],
      function (k) { return k; }
    );
    assertEq(w.length, 2);
    assert(w[1] > w[0], '长文本列应比短列更宽');
  });

  test('预览页字段配置默认折叠且关系图为独立弹窗', function () {
    var fs = require('fs');
    var path = require('path');
    var html = fs.readFileSync(path.join(__dirname, '../tools/gslb-json-export/index.html'), 'utf8');
    var css = fs.readFileSync(path.join(__dirname, '../tools/gslb-json-export/css/tool.css'), 'utf8');
    var app = fs.readFileSync(path.join(__dirname, '../tools/gslb-json-export/js/app.js'), 'utf8');
    var tdCss = css.match(/#preview-table td\s*\{[\s\S]*?\}/);

    assert(html.indexOf('<details class="field-config">') !== -1, '字段选择应为默认折叠的 details');
    assert(html.indexOf('<details class="field-config" open') === -1, '字段选择不得默认展开');
    assert(html.indexOf('id="graph-overlay"') !== -1, '缺少关系图弹窗');
    assert(html.indexOf('id="btn-close-graph"') !== -1, '缺少关系图关闭按钮');
    assert(html.indexOf('graph-overlay') !== -1 && html.indexOf('btn-close-graph') !== -1);
    assert(css.indexOf('modal-box-graph') !== -1, '缺少近全屏弹窗尺寸');
    assert(tdCss, '缺少预览单元格样式');
    assert(tdCss[0].indexOf('ellipsis') === -1, '预览单元格不应截断省略');
    assert(tdCss[0].indexOf('user-select: text') !== -1, '预览单元格应可直接选中文字');
    assert(app.indexOf("getElementById('graph-overlay').addEventListener('click'") === -1,
      '关系图遮罩不应绑定点击关闭');
    assert(/<div class="op-bar-row">[\s\S]*id="status-text"/.test(html),
      '状态应放在导入/方案/预览/导出同一行');
    assert(css.indexOf('body.graph-modal-open') !== -1, '打开关系图时应锁定背后页面滚动');
    assert(html.indexOf('id="preview-cols"') !== -1, '预览表应有 colgroup 冻结列宽');
    assert(css.indexOf('table-layout: fixed') !== -1, '预览表应使用固定列宽布局');
    assert(css.indexOf('preview-col-resize') !== -1, '表头应有列宽拖动手柄');
    assert(html.indexOf('id="btn-export-display"') !== -1, '预览区应有导出显示 CSV 按钮');
    assert(html.indexOf('导出全量 CSV') !== -1, '顶部导出按钮应标明全量');
    assert(app.indexOf('gslb_export_display_') !== -1, '显示 CSV 文件名前缀应为 gslb_export_display_');
  });

};
