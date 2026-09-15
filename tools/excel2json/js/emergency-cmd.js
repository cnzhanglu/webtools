/**
 * Excel 切换 JSON — 应急手动切换命令生成层
 *
 * 数据流：Excel2JsonProcess 的 switch/revert 数据
 * → 动态类型通过 GSLB 索引同时生成 Server（service-member）
 *   与互联网（rrs-member）两种启停命令
 * → 静态类型通过 DNS 权威区索引生成 modify rrs 命令
 * → TXT 文本、文件名、警告与统计。
 *
 * 依赖：Excel2JsonGslbLookup、Excel2JsonDnsLookup、BocIpCidr
 * 导出：Excel2JsonEmergency（build、buildGslbCommands、buildDnsCommands）
 */
var Excel2JsonEmergency = (function () {
  'use strict';

  function warningText(fqdn, ip, reason) {
    return '域名「' + fqdn + '」IP「' + ip + '」' + reason;
  }

  /**
   * 为一组切换数据生成命令。
   * 未找到的域名/IP 不阻断任务；同一 IP 对应多个成员时全部输出并告警。
   */
  function buildGslbCommands(data, index, mode) {
    var lines = [];
    var warnings = [];
    var seenLines = {};
    var commandMode = mode === 'internet' ? 'internet' : 'server';

    function appendForIps(item, ips, status) {
      var i;
      var j;
      for (i = 0; i < ips.length; i++) {
        var ip = ips[i];
        var members = Excel2JsonGslbLookup.findMembers(index, item.fqdn, ip);
        if (members === null) {
          warnings.push(warningText(item.fqdn, ip, '未在 GSLB ADD 中找到，已跳过'));
          continue;
        }
        if (!members.length) {
          warnings.push(warningText(item.fqdn, ip, '未找到对应服务成员，已跳过'));
          continue;
        }
        if (members.length > 1) {
          warnings.push(warningText(item.fqdn, ip, '对应 ' + members.length + ' 个服务成员，已全部生成命令'));
        }

        for (j = 0; j < members.length; j++) {
          var member = members[j];
          var line;
          if (commandMode === 'internet') {
            line = 'modify gslb rrs-member'
              + ' zone-name ' + member.zone_name
              + ' record-name ' + member.record_name
              + ' type ' + member.record_type
              + ' pool-member id ' + member.member_id
              + ' status ' + status
              + ' force';
          } else {
            line = 'modify gslb service-member'
              + ' datacenter-name ' + member.dc_name
              + ' member-name ' + member.gmember_name
              + ' status ' + status;
          }
          if (!seenLines[line]) {
            seenLines[line] = true;
            lines.push(line);
          }
        }
      }
    }

    var i;
    for (i = 0; i < data.length; i++) {
      var item = data[i] || {};
      appendForIps(item, Array.isArray(item.address) ? item.address : [], 'disable');
      appendForIps(item, Array.isArray(item.new_address) ? item.new_address : [], 'enable');
    }

    var textLines = lines.slice();
    if (warnings.length) {
      if (textLines.length) textLines.push('');
      for (i = 0; i < warnings.length; i++) {
        textLines.push('# WARN: ' + warnings[i]);
      }
    }

    return {
      text: textLines.join('\n') + (textLines.length ? '\n' : ''),
      lines: lines,
      warnings: warnings
    };
  }

  function ensureTrailingDot(fqdn) {
    var name = String(fqdn || '').trim().replace(/\.+$/, '');
    return name ? name + '.' : '';
  }

  function ipType(address, newAddress) {
    var oldParsed = BocIpCidr.parseSingleIp(address);
    var newParsed = BocIpCidr.parseSingleIp(newAddress);
    if (!oldParsed || !newParsed || oldParsed.family !== newParsed.family) return '';
    return oldParsed.family === 6 ? 'aaaa' : 'a';
  }

  /**
   * 静态类型按权威区生成 RRS 地址替换命令。
   * 每份文件只进入/退出一次 .dns；缺 IP、区或地址族不一致时跳过并告警。
   */
  function buildDnsCommands(data, dnsIndex) {
    var lines = [];
    var warnings = [];
    var seenLines = {};
    var i;

    for (i = 0; i < data.length; i++) {
      var item = data[i] || {};
      var address = Array.isArray(item.address) && item.address.length ? item.address[0] : '';
      var newAddress = Array.isArray(item.new_address) && item.new_address.length ? item.new_address[0] : '';
      if (!address || !newAddress) {
        warnings.push('域名「' + item.fqdn + '」address 或 new_address 为空，无法生成 modify rrs，已跳过');
        continue;
      }

      var zone = Excel2JsonDnsLookup.findZone(dnsIndex, item.fqdn);
      if (!zone) {
        warnings.push('域名「' + item.fqdn + '」未在 auth-zones.csv 中匹配到权威区，已跳过');
        continue;
      }

      var type = ipType(address, newAddress);
      if (!type) {
        warnings.push('域名「' + item.fqdn + '」切换前后 IP 地址族不一致，已跳过');
        continue;
      }

      var line = 'modify rrs'
        + ' view ' + zone.view
        + ' zone ' + zone.zone
        + ' name ' + ensureTrailingDot(item.fqdn)
        + ' type ' + type
        + ' rdata ' + address
        + ' new_rdata ' + newAddress;
      if (!seenLines[line]) {
        seenLines[line] = true;
        lines.push(line);
      }
    }

    var textLines = ['.dns'].concat(lines);
    /* 警告放在 quit 前，确保 quit 始终是命令文件最后一行。 */
    if (warnings.length) {
      if (lines.length) textLines.push('');
      for (i = 0; i < warnings.length; i++) {
        textLines.push('# WARN: ' + warnings[i]);
      }
    }
    textLines.push('quit');

    return {
      text: textLines.join('\n') + '\n',
      lines: lines,
      warnings: warnings
    };
  }

  function clearCommandOutput(out) {
    delete out.switchCmdText;
    delete out.revertCmdText;
    delete out.switchCmdFilename;
    delete out.revertCmdFilename;
    delete out.switchCmdWarnings;
    delete out.revertCmdWarnings;
    delete out.internetSwitchCmdText;
    delete out.internetRevertCmdText;
    delete out.internetSwitchCmdFilename;
    delete out.internetRevertCmdFilename;
    delete out.internetSwitchCmdWarnings;
    delete out.internetRevertCmdWarnings;
  }

  function attachResult(out, switchResult, revertResult) {
    out.switchCmdText = switchResult.text;
    out.revertCmdText = revertResult.text;
    out.switchCmdFilename = out.appName + '_' + out.typeName + '_切换_应急命令.txt';
    out.revertCmdFilename = out.appName + '_' + out.typeName + '_回切_应急命令.txt';
    out.switchCmdWarnings = switchResult.warnings;
    out.revertCmdWarnings = revertResult.warnings;
  }

  /** 动态互联网模式单独附加文件，避免与 Server 模式混在同一命令文件。 */
  function attachInternetResult(out, switchResult, revertResult) {
    out.internetSwitchCmdText = switchResult.text;
    out.internetRevertCmdText = revertResult.text;
    out.internetSwitchCmdFilename = out.appName + '_' + out.typeName + '_切换_互联网模式应急命令.txt';
    out.internetRevertCmdFilename = out.appName + '_' + out.typeName + '_回切_互联网模式应急命令.txt';
    out.internetSwitchCmdWarnings = switchResult.warnings;
    out.internetRevertCmdWarnings = revertResult.warnings;
  }

  /**
   * 按 output.typeName 选择数据源并附加切换/回切命令，不改变原 JSON 数据。
   * config：{ gslbJson, dnsIndex }，缺少对应数据源时不为该类型生成命令文件。
   * 返回汇总统计，供 UI 展示命令条数与跳过警告数。
   */
  function build(outputs, config) {
    config = config || {};
    var hasDynamic = outputs.some(function (out) { return out.typeName === '动态'; });
    var gslbIndex = hasDynamic && config.gslbJson
      ? Excel2JsonGslbLookup.buildIndex(config.gslbJson)
      : null;
    var commandCount = 0;
    var warningCount = 0;
    var commandFileCount = 0;
    var dynamicCommandCount = 0;
    var staticCommandCount = 0;
    var allWarnings = [];
    var i;

    for (i = 0; i < outputs.length; i++) {
      var out = outputs[i];
      clearCommandOutput(out);
      var switchResult;
      var revertResult;
      /* var 为函数作用域，每轮必须显式清空，避免动态结果串入后续静态项。 */
      var internetSwitchResult = null;
      var internetRevertResult = null;

      if (out.typeName === '动态' && gslbIndex) {
        switchResult = buildGslbCommands(out.switchData || [], gslbIndex, 'server');
        revertResult = buildGslbCommands(out.revertData || [], gslbIndex, 'server');
        internetSwitchResult = buildGslbCommands(out.switchData || [], gslbIndex, 'internet');
        internetRevertResult = buildGslbCommands(out.revertData || [], gslbIndex, 'internet');
        dynamicCommandCount += switchResult.lines.length + revertResult.lines.length
          + internetSwitchResult.lines.length + internetRevertResult.lines.length;
      } else if (out.typeName === '静态' && config.dnsIndex) {
        switchResult = buildDnsCommands(out.switchData || [], config.dnsIndex);
        revertResult = buildDnsCommands(out.revertData || [], config.dnsIndex);
        staticCommandCount += switchResult.lines.length + revertResult.lines.length;
      } else {
        continue;
      }

      attachResult(out, switchResult, revertResult);
      commandFileCount += 2;
      if (internetSwitchResult) {
        /* Server 文件沿用原属性；文件名补充模式，互联网文件使用独立属性。 */
        out.switchCmdFilename = out.appName + '_' + out.typeName + '_切换_Server模式应急命令.txt';
        out.revertCmdFilename = out.appName + '_' + out.typeName + '_回切_Server模式应急命令.txt';
        attachInternetResult(out, internetSwitchResult, internetRevertResult);
        commandFileCount += 2;
      }

      commandCount += switchResult.lines.length + revertResult.lines.length;
      warningCount += switchResult.warnings.length + revertResult.warnings.length;
      allWarnings = allWarnings.concat(
        switchResult.warnings.map(function (msg) { return out.switchCmdFilename + '：' + msg; }),
        revertResult.warnings.map(function (msg) { return out.revertCmdFilename + '：' + msg; })
      );
      if (internetSwitchResult) {
        commandCount += internetSwitchResult.lines.length + internetRevertResult.lines.length;
        warningCount += internetSwitchResult.warnings.length + internetRevertResult.warnings.length;
        allWarnings = allWarnings.concat(
          internetSwitchResult.warnings.map(function (msg) { return out.internetSwitchCmdFilename + '：' + msg; }),
          internetRevertResult.warnings.map(function (msg) { return out.internetRevertCmdFilename + '：' + msg; })
        );
      }
    }

    return {
      commandCount: commandCount,
      warningCount: warningCount,
      warnings: allWarnings,
      commandFileCount: commandFileCount,
      dynamicCommandCount: dynamicCommandCount,
      staticCommandCount: staticCommandCount
    };
  }

  return {
    build: build,
    buildGslbCommands: buildGslbCommands,
    buildDnsCommands: buildDnsCommands,
    buildCommands: buildGslbCommands
  };
}());
