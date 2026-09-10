'use strict';

/**
 * GslbCommands 单元测试
 *
 * 覆盖：算法映射、布尔格式化、资源收集、命令顺序与去重、多池 ratio 串、
 *       name+type 双记录独立、未知算法 warning、pass 字符串映射，以及
 *       当前域名 RRS 成员 IP 匹配、跨池 ID 去重、启停命令与 zone 推导
 */
module.exports = function (test, assert, assertEq) {

  // ─── 算法映射 ──────────────────────────────────────────────────────────────

  test('mapAlgorithm: rr → round-robin（pref）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('rr', 'pref', w), 'round-robin');
    assertEq(w.length, 0);
  });

  test('mapAlgorithm: wrr → weighted-round-robin（domain）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('wrr', 'domain', w), 'weighted-round-robin');
  });

  test('mapAlgorithm: sp → static-proximity（pref）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('sp', 'pref', w), 'static-proximity');
    assertEq(w.length, 0);
  });

  test('mapAlgorithm: sp 在备算法（alt）中不支持，回退 round-robin 并 warning', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('sp', 'alt', w), 'round-robin');
    assert(w.length > 0, '应有 warning');
  });

  test('mapAlgorithm: ga → global-availability（alt）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('ga', 'alt', w), 'global-availability');
    assertEq(w.length, 0);
  });

  test('mapAlgorithm: fi → fallback-ip（alt）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('fi', 'alt', w), 'fallback-ip');
    assertEq(w.length, 0);
  });

  test('mapAlgorithm: none → none（alt）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('none', 'alt', w), 'none');
    assertEq(w.length, 0);
  });

  test('mapAlgorithm: wsps 降级为 weighted-round-robin 并 warning（pref）', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('wsps', 'pref', w), 'weighted-round-robin');
    assert(w.length > 0, '应有 wsps warning');
  });

  test('mapAlgorithm: 未知简写原样输出并 warning', function () {
    var w = [];
    var result = GslbCommands.mapAlgorithm('xyz', 'pref', w);
    assertEq(result, 'xyz');
    assert(w.length > 0, '应有未知算法 warning');
  });

  test('mapAlgorithm: 空值 → pref 默认 round-robin', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('', 'pref', w), 'round-robin');
  });

  test('mapAlgorithm: 空值 → alt 默认 none', function () {
    var w = [];
    assertEq(GslbCommands.mapAlgorithm('', 'alt', w), 'none');
  });

  // ─── 布尔格式化 ─────────────────────────────────────────────────────────────

  test('formatStatus: yes → enable', function () {
    assertEq(GslbCommands.formatStatus('yes'), 'enable');
  });

  test('formatStatus: no → disable', function () {
    assertEq(GslbCommands.formatStatus('no'), 'disable');
  });

  test('formatStatus: "1" → enable', function () {
    assertEq(GslbCommands.formatStatus('1'), 'enable');
  });

  test('formatStatus: "0" → disable', function () {
    assertEq(GslbCommands.formatStatus('0'), 'disable');
  });

  test('formatStatus: 缺省（undefined）→ enable', function () {
    assertEq(GslbCommands.formatStatus(undefined), 'enable');
  });

  test('formatMemberStatusCheck: "1" → enable', function () {
    assertEq(GslbCommands.formatMemberStatusCheck('1'), 'enable');
  });

  test('formatMemberStatusCheck: "0" → disable', function () {
    assertEq(GslbCommands.formatMemberStatusCheck('0'), 'disable');
  });

  // ─── 资源收集与命令生成 ──────────────────────────────────────────────────────

  /** 最小化测试 fixture */
  var FIXTURE = {
    ADD: {
      '@': [
        {
          name: 'test.example.com.',
          type: 'A',
          enable: 'yes',
          algorithm: 'rr',
          gpool_list: [
            { gpool_name: 'pool_a', ratio: '2' },
            { gpool_name: 'pool_b', ratio: '3' }
          ]
        },
        {
          name: 'test.example.com.',
          type: 'AAAA',
          enable: 'yes',
          algorithm: 'ga',
          gpool_list: [
            { gpool_name: 'pool_v6', ratio: '1' }
          ]
        },
        {
          name: 'other.example.com.',
          type: 'A',
          enable: 'no',
          algorithm: 'sp',
          gpool_list: [
            { gpool_name: 'pool_a', ratio: '1' }  // 与 test.example.com 共用
          ]
        }
      ]
    },
    gpool: [
      {
        name: 'pool_a',
        type: 'A',
        enable: 'yes',
        ttl: '60',
        first_algorithm: 'wrr',
        second_algorithm: 'none',
        pass: '0',
        gmember_list: [
          { dc_name: 'dc_east', gmember_name: 'gm_east', ip: '1.2.3.4', port: '443', enable: 'yes', ratio: '1' },
          { dc_name: 'dc_west', gmember_name: 'gm_west', ip: '5.6.7.8', port: '80',  enable: 'no',  ratio: '2' }
        ]
      },
      {
        name: 'pool_b',
        type: 'A',
        enable: 'yes',
        ttl: '300',
        first_algorithm: 'rr',
        second_algorithm: 'rr',
        pass: '1',
        gmember_list: [
          { dc_name: 'dc_east', gmember_name: 'gm_east', ip: '1.2.3.4', port: '443', enable: 'yes', ratio: '1' }
        ]
      },
      {
        name: 'pool_v6',
        type: 'AAAA',
        enable: 'yes',
        ttl: '120',
        first_algorithm: 'ga',
        second_algorithm: 'none',
        pass: '0',
        gmember_list: [
          { dc_name: 'dc_east', gmember_name: 'gm_v6', ip: '2001:db8::1', port: '443', enable: 'yes', ratio: '1' }
        ]
      }
    ],
    data_center: [
      {
        name: 'dc_east',
        gmembers: [
          { gmember_name: 'gm_east', ip: '1.2.3.4', port: '443', hms: ['http_monitor'], enable: 'yes' },
          { gmember_name: 'gm_v6',   ip: '2001:db8::1', port: '443', hms: ['http_v6_monitor'], enable: 'yes' }
        ]
      },
      {
        name: 'dc_west',
        gmembers: [
          { gmember_name: 'gm_west', ip: '5.6.7.8', port: '80', hms: [], enable: 'no' }
        ]
      }
    ]
  };

  function buildDcIdx(data) {
    return GslbProcess.buildDcMemberIndex(data);
  }

  test('buildCommandsForDomains: 单域名 A 记录生成命令顺序正确', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var lines = result.lines;
    // 检查命令存在
    var hasDc    = lines.some(function (l) { return l.indexOf('create gslb datacenter') === 0; });
    var hasSm    = lines.some(function (l) { return l.indexOf('create gslb service-member') === 0; });
    var hasPool  = lines.some(function (l) { return l.indexOf('create gslb pool') === 0; });
    var hasPm    = lines.some(function (l) { return l.indexOf('create gslb pool-member') === 0; });
    var hasRrs   = lines.some(function (l) { return l.indexOf('create gslb rrs') === 0; });
    assert(hasDc,   '应有 datacenter 命令');
    assert(hasSm,   '应有 service-member 命令');
    assert(hasPool, '应有 pool 命令');
    assert(hasPm,   '应有 pool-member 命令');
    assert(hasRrs,  '应有 rrs 命令');
  });

  test('buildCommandsForDomains: rrs 多池格式为 pool1:ratio,pool2:ratio', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var rrsLine = result.lines.filter(function (l) { return l.indexOf('create gslb rrs') === 0; })[0];
    assert(rrsLine, '应有 rrs 命令');
    assert(rrsLine.indexOf('pool_a:2,pool_b:3') !== -1, 'pool 段应为 pool_a:2,pool_b:3，实际：' + rrsLine);
  });

  test('buildCommandsForDomains: 多域名共用池不重复生成 pool/service-member 命令', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [
        { name: 'test.example.com.', type: 'A' },
        { name: 'other.example.com.', type: 'A' }
      ],
      dcIdx
    );
    var lines = result.lines;
    // pool_a 只应出现一次（用 'create gslb pool ' 精确匹配，排除 pool-member 行）
    var poolACount = lines.filter(function (l) {
      return l.indexOf('create gslb pool ') === 0 && l.indexOf('pool_a') !== -1;
    }).length;
    assertEq(poolACount, 1, 'pool_a 命令应只出现一次');
    // gm_east 的 service-member 只应出现一次
    var smEastCount = lines.filter(function (l) {
      return l.indexOf('create gslb service-member') === 0 && l.indexOf('gm_east') !== -1;
    }).length;
    assertEq(smEastCount, 1, 'gm_east service-member 命令应只出现一次');
  });

  test('buildCommandsForDomains: A 与 AAAA 同名域名独立生成各自 rrs', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [
        { name: 'test.example.com.', type: 'A' },
        { name: 'test.example.com.', type: 'AAAA' }
      ],
      dcIdx
    );
    var rrsLines = result.lines.filter(function (l) { return l.indexOf('create gslb rrs') === 0; });
    assertEq(rrsLines.length, 2, '应生成 2 条 rrs 命令（A + AAAA 独立）');
    var hasTypeA    = rrsLines.some(function (l) { return l.indexOf('type a') !== -1; });
    var hasTypeAAAA = rrsLines.some(function (l) { return l.indexOf('type aaaa') !== -1; });
    assert(hasTypeA,    '应有 type a 的 rrs');
    assert(hasTypeAAAA, '应有 type aaaa 的 rrs');
  });

  test('buildCommandsForDomains: pool 命令含正确的 pref-bal-algo', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var poolA = result.lines.filter(function (l) {
      return l.indexOf('create gslb pool') === 0 && l.indexOf('pool_a') !== -1;
    })[0];
    assert(poolA, '应有 pool_a 命令');
    assert(poolA.indexOf('pref-bal-algo weighted-round-robin') !== -1, 'pool_a 主算法应为 weighted-round-robin');
    assert(poolA.indexOf('member-status-check disable') !== -1, 'pool_a pass=0 应 disable');
  });

  test('buildCommandsForDomains: pool-member weight 与 status 正确映射', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var pmWest = result.lines.filter(function (l) {
      return l.indexOf('create gslb pool-member') === 0 && l.indexOf('gm_west') !== -1;
    })[0];
    assert(pmWest, '应有 gm_west 的 pool-member 命令');
    assert(pmWest.indexOf('status disable') !== -1, 'gm_west enable=no 应 disable');
    assert(pmWest.indexOf('weight 2') !== -1, 'gm_west ratio=2 应 weight 2');
  });

  test('buildCommandsForDomains: service-member 包含 hms', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var smEast = result.lines.filter(function (l) {
      return l.indexOf('create gslb service-member') === 0 && l.indexOf('gm_east') !== -1;
    })[0];
    assert(smEast, '应有 gm_east 的 service-member 命令');
    assert(smEast.indexOf('health-check-tmpl http_monitor') !== -1, '应包含健康检查模板');
  });

  test('buildCommandsForDomains: 域名无 gpool_list 时产生 warning', function () {
    var data = {
      ADD: { '@': [{ name: 'empty.com.', type: 'A', enable: 'yes', algorithm: 'rr', gpool_list: [] }] },
      gpool: [],
      data_center: []
    };
    var result = GslbCommands.buildCommandsForDomains(
      data,
      [{ name: 'empty.com.', type: 'A' }],
      {}
    );
    assert(result.warnings.length > 0, '应有 warning 提示 gpool_list 为空');
  });

  test('buildCommandsForDomains: 命令顺序 datacenter < service-member < pool < pool-member < rrs', function () {
    var dcIdx = buildDcIdx(FIXTURE);
    var result = GslbCommands.buildCommandsForDomains(
      FIXTURE,
      [{ name: 'test.example.com.', type: 'A' }],
      dcIdx
    );
    var lines = result.lines.filter(function (l) { return l.indexOf('create gslb') === 0; });
    var idxDc  = lines.findIndex(function (l) { return l.indexOf('create gslb datacenter') === 0; });
    var idxSm  = lines.findIndex(function (l) { return l.indexOf('create gslb service-member') === 0; });
    var idxP   = lines.findIndex(function (l) { return /^create gslb pool [^-]/.test(l); });
    var idxPm  = lines.findIndex(function (l) { return l.indexOf('create gslb pool-member') === 0; });
    var idxRrs = lines.findIndex(function (l) { return l.indexOf('create gslb rrs') === 0; });
    assert(idxDc < idxSm,  'datacenter 应在 service-member 之前');
    assert(idxSm < idxP,   'service-member 应在 pool 之前');
    assert(idxP  < idxPm,  'pool 应在 pool-member 之前');
    assert(idxPm < idxRrs, 'pool-member 应在 rrs 之前');
  });

  test('buildCommandsForDomains: 空 domainKeys 返回 warning', function () {
    var result = GslbCommands.buildCommandsForDomains(FIXTURE, [], {});
    assert(result.warnings.length > 0, '无域名应有 warning');
    assertEq(result.lines.length, 0, '无域名应无命令行');
  });

  // ─── 当前域名 RRS 成员启停 ──────────────────────────────────────────────────

  var RRS_MEMBER_FIXTURE = {
    ADD: {
      'prod.example': [
        {
          name: 'app.example.com.',
          type: 'A',
          gpool_list: [{ gpool_name: 'pool_a' }, { gpool_name: 'pool_b' }]
        }
      ],
      'v6.example': [
        {
          name: 'app.example.com.',
          type: 'AAAA',
          gpool_list: [{ gpool_name: 'pool_v6' }]
        }
      ]
    },
    gpool: [
      {
        name: 'pool_a',
        gmember_list: [
          { dc_name: 'dc_a', gmember_name: 'gm_shared', ip: '192.0.2.10' },
          { dc_name: 'dc_b', gmember_name: 'gm_same_ip', ip: '192.0.2.10' }
        ]
      },
      {
        name: 'pool_b',
        gmember_list: [
          { dc_name: 'dc_a', gmember_name: 'gm_shared', ip: '192.0.2.10' },
          { dc_name: 'dc_c', gmember_name: 'gm_fallback' },
          { dc_name: '', gmember_name: 'gm_no_id', ip: '192.0.2.99' }
        ]
      },
      {
        name: 'pool_v6',
        gmember_list: [
          { dc_name: 'dc_v6', gmember_name: 'gm_v6', ip: '2001:db8::1' }
        ]
      }
    ],
    data_center: [
      { name: 'dc_c', gmembers: [{ gmember_name: 'gm_fallback', ip: '198.51.100.20' }] }
    ]
  };

  test('RRS 成员：跨池重复 ID 去重，勾选与手工 IP 取并集', function () {
    var result = GslbCommands.buildRrsMemberCommands(
      RRS_MEMBER_FIXTURE,
      { name: 'app.example.com.', type: 'A' },
      ['192.0.2.10'],
      '198.51.100.20',
      'disable',
      GslbProcess.buildDcMemberIndex(RRS_MEMBER_FIXTURE)
    );
    assertEq(result.lines.length, 3);
    assertEq(result.lines[0], 'modify gslb rrs-member zone-name prod.example record-name app.example.com. type a pool-member id dc_a*gm_shared status disable force');
    assert(result.lines[1].indexOf('pool-member id dc_b*gm_same_ip') !== -1);
    assert(result.lines[2].indexOf('pool-member id dc_c*gm_fallback') !== -1);
  });

  test('RRS 成员：enable 与 IPv6 规范化匹配', function () {
    var result = GslbCommands.buildRrsMemberCommands(
      RRS_MEMBER_FIXTURE,
      { name: 'app.example.com.', type: 'AAAA' },
      [],
      '2001:0db8:0:0:0:0:0:1',
      'enable',
      {}
    );
    assertEq(result.lines.length, 1);
    assertEq(result.lines[0], 'modify gslb rrs-member zone-name v6.example record-name app.example.com. type aaaa pool-member id dc_v6*gm_v6 status enable force');
  });

  test('RRS 成员：ADD 数组格式的 zone 回退为 @', function () {
    var data = {
      ADD: [{ name: 'array.example.', type: 'A', gpool_list: [{ gpool_name: 'p' }] }],
      gpool: [{ name: 'p', gmember_list: [{ dc_name: 'dc', gmember_name: 'gm', ip: '203.0.113.8' }] }]
    };
    var result = GslbCommands.buildRrsMemberCommands(
      data,
      { name: 'array.example.', type: 'A' },
      ['203.0.113.8'],
      '',
      'disable',
      {}
    );
    assert(result.lines[0].indexOf('zone-name @') !== -1);
  });

  test('RRS 成员：未命中、非法 IP 与缺少 ID 返回中文警告', function () {
    var result = GslbCommands.buildRrsMemberCommands(
      RRS_MEMBER_FIXTURE,
      { name: 'app.example.com.', type: 'A' },
      ['192.0.2.99'],
      'not-an-ip,203.0.113.254',
      'disable',
      {}
    );
    assertEq(result.lines.length, 0);
    assert(result.warnings.some(function (w) { return w.indexOf('无法解析') !== -1; }));
    assert(result.warnings.some(function (w) { return w.indexOf('未在当前域名成员中找到') !== -1; }));
    assert(result.warnings.some(function (w) { return w.indexOf('无法构造 ID') !== -1; }));
  });
};
