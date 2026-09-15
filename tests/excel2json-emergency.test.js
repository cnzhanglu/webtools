'use strict';

module.exports = function (test, assert, assertEq) {
  function fixture() {
    return {
      ADD: {
        '@': [
          {
            name: 'app.example.com.',
            type: 'A',
            gpool_list: [{ gpool_name: 'pool_app' }, { gpool_name: 'pool_app_duplicate' }]
          }
        ]
      },
      gpool: [
        {
          name: 'pool_app',
          gmember_list: [
            { dc_name: 'dc_a', gmember_name: 'gm_a', ip: '10.0.0.1' },
            { dc_name: 'dc_b', gmember_name: 'gm_b', ip: '10.0.0.2' },
            { dc_name: 'dc_c', gmember_name: 'gm_c' },
            { dc_name: 'dc_v6', gmember_name: 'gm_v6', ip: '2001:0db8:0:0:0:0:0:1' }
          ]
        },
        {
          name: 'pool_app_duplicate',
          gmember_list: [
            { dc_name: 'dc_a', gmember_name: 'gm_a', ip: '10.0.0.1' },
            { dc_name: 'dc_d', gmember_name: 'gm_d', ip: '10.0.0.1' }
          ]
        }
      ],
      data_center: [
        {
          name: 'dc_c',
          gmembers: [{ gmember_name: 'gm_c', ip: '10.0.0.3' }]
        }
      ]
    };
  }

  function dnsIndex() {
    return Excel2JsonDnsLookup.parseAuthZones(
      '视图名称,区名称,设备名称\n'
      + 'default,boc.cn,\"device1,device2\"\n'
      + 'default,mbs.boc.cn,device1\n'
      + 'other,example.com,device2\n'
    );
  }

  test('GSLB 查询忽略域名大小写和末尾点，并回退 data_center IP', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var direct = Excel2JsonGslbLookup.findMembers(index, 'APP.EXAMPLE.COM', '10.0.0.2');
    var fallback = Excel2JsonGslbLookup.findMembers(index, 'app.example.com.', '10.0.0.3');

    assertEq(direct.length, 1);
    assertEq(direct[0].gmember_name, 'gm_b');
    assertEq(direct[0].zone_name, '@');
    assertEq(direct[0].record_name, 'app.example.com.');
    assertEq(direct[0].record_type, 'a');
    assertEq(direct[0].member_id, 'dc_b*gm_b');
    assertEq(fallback.length, 1);
    assertEq(fallback[0].dc_name, 'dc_c');
  });

  test('GSLB 查询可匹配不同文本写法的 IPv6', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var members = Excel2JsonGslbLookup.findMembers(index, 'app.example.com', '2001:db8::1');
    assertEq(members.length, 1);
    assertEq(members[0].gmember_name, 'gm_v6');
  });

  test('address 生成 disable，new_address 生成 enable', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var result = Excel2JsonEmergency.buildCommands([
      { fqdn: 'app.example.com', address: ['10.0.0.2'], new_address: ['10.0.0.3'] }
    ], index);

    assert(result.lines[0].indexOf('datacenter-name dc_b member-name gm_b status disable') !== -1);
    assert(result.lines[1].indexOf('datacenter-name dc_c member-name gm_c status enable') !== -1);
    assertEq(result.warnings.length, 0);
  });

  test('互联网模式生成 rrs-member 命令并带 force', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var result = Excel2JsonEmergency.buildGslbCommands([
      { fqdn: 'app.example.com', address: ['10.0.0.2'], new_address: ['10.0.0.3'] }
    ], index, 'internet');

    assertEq(
      result.lines[0],
      'modify gslb rrs-member zone-name @ record-name app.example.com. type a'
      + ' pool-member id dc_b*gm_b status disable force'
    );
    assert(result.lines[1].indexOf('pool-member id dc_c*gm_c status enable force') !== -1);
  });

  test('互联网模式使用 ADD 分组键作为 zone-name', function () {
    var data = fixture();
    data.ADD = { 'prod.example': data.ADD['@'] };
    var index = Excel2JsonGslbLookup.buildIndex(data);
    var result = Excel2JsonEmergency.buildGslbCommands([
      { fqdn: 'app.example.com', address: ['10.0.0.2'], new_address: [] }
    ], index, 'internet');

    assert(result.lines[0].indexOf('zone-name prod.example') !== -1);
  });

  test('重复成员命令去重，同 IP 多成员全部输出并警告', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var result = Excel2JsonEmergency.buildCommands([
      { fqdn: 'app.example.com', address: ['10.0.0.1', '10.0.0.1'], new_address: [] }
    ], index);

    assertEq(result.lines.length, 2);
    assert(result.lines.some(function (line) { return line.indexOf('member-name gm_a') !== -1; }));
    assert(result.lines.some(function (line) { return line.indexOf('member-name gm_d') !== -1; }));
    assert(result.warnings.length >= 1);
  });

  test('缺失域名或 IP 时跳过并把警告写入 TXT', function () {
    var index = Excel2JsonGslbLookup.buildIndex(fixture());
    var result = Excel2JsonEmergency.buildCommands([
      { fqdn: 'missing.example.com', address: ['10.0.0.1'], new_address: [] },
      { fqdn: 'app.example.com', address: [], new_address: ['10.0.0.99'] }
    ], index);

    assertEq(result.lines.length, 0);
    assertEq(result.warnings.length, 2);
    assert(result.text.indexOf('# WARN:') !== -1);
  });

  test('build 同时生成切换与回切命令文件且状态对调', function () {
    var outputs = [{
      appName: '应用一',
      typeName: '动态',
      switchData: [{ fqdn: 'app.example.com', address: ['10.0.0.2'], new_address: ['10.0.0.3'] }],
      revertData: [{ fqdn: 'app.example.com', address: ['10.0.0.3'], new_address: ['10.0.0.2'] }]
    }];
    var stats = Excel2JsonEmergency.build(outputs, { gslbJson: fixture() });

    assertEq(outputs[0].switchCmdFilename, '应用一_动态_切换_Server模式应急命令.txt');
    assertEq(outputs[0].revertCmdFilename, '应用一_动态_回切_Server模式应急命令.txt');
    assertEq(outputs[0].internetSwitchCmdFilename, '应用一_动态_切换_互联网模式应急命令.txt');
    assertEq(outputs[0].internetRevertCmdFilename, '应用一_动态_回切_互联网模式应急命令.txt');
    assert(outputs[0].switchCmdText.indexOf('member-name gm_b status disable') !== -1);
    assert(outputs[0].revertCmdText.indexOf('member-name gm_b status enable') !== -1);
    assert(outputs[0].internetSwitchCmdText.indexOf('pool-member id dc_b*gm_b status disable force') !== -1);
    assert(outputs[0].internetRevertCmdText.indexOf('pool-member id dc_b*gm_b status enable force') !== -1);
    assertEq(stats.commandFileCount, 4);
    assertEq(stats.commandCount, 8);
  });

  test('DNS 区查询使用标签边界最长后缀', function () {
    var index = dnsIndex();
    var specific = Excel2JsonDnsLookup.findZone(index, 'asdk.mbs.boc.cn.');
    var parent = Excel2JsonDnsLookup.findZone(index, 'www.boc.cn');
    var boundaryMiss = Excel2JsonDnsLookup.findZone(index, 'notboc.cn');

    assertEq(specific.view, 'default');
    assertEq(specific.zone, 'mbs.boc.cn');
    assertEq(parent.zone, 'boc.cn');
    assertEq(boundaryMiss, null);
  });

  test('静态命令包含一次 .dns/quit、完整尾点域名和最细区', function () {
    var result = Excel2JsonEmergency.buildDnsCommands([
      { fqdn: 'asdk.mbs.boc.cn', address: ['1.1.1.1'], new_address: ['2.2.2.2'] },
      { fqdn: 'www.boc.cn.', address: ['3.3.3.3'], new_address: ['4.4.4.4'] }
    ], dnsIndex());

    assertEq(result.lines.length, 2);
    assertEq(result.text.indexOf('.dns\n'), 0);
    assert(result.text.indexOf('view default zone mbs.boc.cn name asdk.mbs.boc.cn. type a') !== -1);
    assert(result.text.indexOf('rdata 1.1.1.1 new_rdata 2.2.2.2') !== -1);
    assert(result.text.slice(-5), 'quit\n');
    assertEq((result.text.match(/\.dns/g) || []).length, 1);
    assertEq((result.text.match(/\nquit\n/g) || []).length, 1);
  });

  test('静态 IPv6 使用 type aaaa', function () {
    var result = Excel2JsonEmergency.buildDnsCommands([
      { fqdn: 'www.boc.cn', address: ['2001:db8::1'], new_address: ['2001:db8::2'] }
    ], dnsIndex());
    assert(result.text.indexOf('type aaaa') !== -1);
  });

  test('静态缺少一侧 IP 或权威区时跳过并警告', function () {
    var result = Excel2JsonEmergency.buildDnsCommands([
      { fqdn: 'www.boc.cn', address: [], new_address: ['2.2.2.2'] },
      { fqdn: 'missing.invalid', address: ['1.1.1.1'], new_address: ['2.2.2.2'] }
    ], dnsIndex());

    assertEq(result.lines.length, 0);
    assertEq(result.warnings.length, 2);
    assert(result.text.indexOf('# WARN:') !== -1);
    assertEq(result.text.slice(-5), 'quit\n');
  });

  test('build 按类型分流，静态不使用 GSLB 且切换回切地址对调', function () {
    var outputs = [
      {
        appName: '应用一',
        typeName: '动态',
        switchData: [{ fqdn: 'app.example.com', address: ['10.0.0.2'], new_address: ['10.0.0.3'] }],
        revertData: [{ fqdn: 'app.example.com', address: ['10.0.0.3'], new_address: ['10.0.0.2'] }]
      },
      {
        appName: '应用一',
        typeName: '静态',
        switchData: [{ fqdn: 'asdk.mbs.boc.cn', address: ['1.1.1.1'], new_address: ['2.2.2.2'] }],
        revertData: [{ fqdn: 'asdk.mbs.boc.cn', address: ['2.2.2.2'], new_address: ['1.1.1.1'] }]
      }
    ];
    var stats = Excel2JsonEmergency.build(outputs, {
      gslbJson: fixture(),
      dnsIndex: dnsIndex()
    });

    assert(outputs[0].switchCmdText.indexOf('modify gslb service-member') !== -1);
    assert(outputs[0].internetSwitchCmdText.indexOf('modify gslb rrs-member') !== -1);
    assert(outputs[1].switchCmdText.indexOf('modify rrs') !== -1);
    assert(outputs[1].switchCmdText.indexOf('rdata 1.1.1.1 new_rdata 2.2.2.2') !== -1);
    assert(outputs[1].revertCmdText.indexOf('rdata 2.2.2.2 new_rdata 1.1.1.1') !== -1);
    assertEq(stats.commandFileCount, 6);
    assertEq(stats.dynamicCommandCount, 8);
    assertEq(stats.staticCommandCount, 2);
  });

  test('缺少对应数据源时只生成已就绪类型的命令文件', function () {
    var outputs = [
      { appName: 'a', typeName: '动态', switchData: [], revertData: [] },
      {
        appName: 'a',
        typeName: '静态',
        switchData: [{ fqdn: 'www.boc.cn', address: ['1.1.1.1'], new_address: ['2.2.2.2'] }],
        revertData: [{ fqdn: 'www.boc.cn', address: ['2.2.2.2'], new_address: ['1.1.1.1'] }]
      }
    ];
    var stats = Excel2JsonEmergency.build(outputs, { dnsIndex: dnsIndex() });

    assertEq(outputs[0].switchCmdFilename, undefined);
    assert(outputs[1].switchCmdFilename.indexOf('静态') !== -1);
    assertEq(stats.commandFileCount, 2);
  });

  test('页面操作按钮横排、格式说明默认隐藏并提供产出区全部下载', function () {
    var fs = require('fs');
    var path = require('path');
    var html = fs.readFileSync(path.join(__dirname, '../tools/excel2json/index.html'), 'utf8');
    var css = fs.readFileSync(path.join(__dirname, '../tools/excel2json/css/tool.css'), 'utf8');
    var app = fs.readFileSync(path.join(__dirname, '../tools/excel2json/js/app.js'), 'utf8');

    assert(css.indexOf('flex-direction: row') !== -1, '操作按钮应横向排列');
    assert(html.indexOf('class="panel help-panel hidden"') !== -1, '格式说明应默认隐藏');
    assert(css.indexOf('.help-panel.hidden') !== -1, '缺少格式说明隐藏样式');
    assert(html.indexOf('id="btn-download-all-output"') !== -1, '产出文件区缺少全部下载按钮');
    assert(app.indexOf("getElementById('btn-download-all-output').addEventListener('click', downloadAll)") !== -1,
      '产出文件区全部下载按钮未绑定下载逻辑');
    assert(html.indexOf('../../shared/js/xlsx.js') !== -1, '页面未加载 ZIP 生成器');
    assert(app.indexOf('BocXlsx.buildZip(zipFiles)') !== -1, '全部下载未合并为 ZIP');
    assert(app.indexOf("'application/zip'") !== -1, '全部下载未使用 ZIP MIME 类型');
  });

  test('ZIP 打包器使用 UTF-8 文件名标志并保留中文文件名', function () {
    var name = '应用A_互联网模式应急命令.txt';
    var bytes = BocXlsx.buildZip([{
      name: name,
      data: new TextEncoder().encode('测试内容')
    }]);
    var flag = bytes[6] | (bytes[7] << 8);
    var nameLength = bytes[26] | (bytes[27] << 8);
    var decodedName = new TextDecoder('utf-8').decode(bytes.subarray(30, 30 + nameLength));

    assert((flag & 0x0800) !== 0, 'ZIP 本地文件头缺少 UTF-8 文件名标志');
    assertEq(decodedName, name);
  });
};
