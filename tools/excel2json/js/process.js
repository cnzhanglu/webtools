/**
 * Excel 切换 JSON — 分组、动态/静态转换、切换/回切生成
 * 移植自 Python converters/data_converter.py + main._export_results
 *
 * API：Excel2JsonProcess.run(rows) → { ok, outputs, stats } | { ok:false, error }
 * rows：BocXlsxRead.parse 的 rows 数组（rowIndex, A-H 字段）
 */
var Excel2JsonProcess = (function () {
  'use strict';

  /**
   * 集合差分：A 中有 B 中无
   */
  function setDiff(a, b) {
    var bSet = {};
    b.forEach(function (v) { bSet[v] = true; });
    return a.filter(function (v) { return !bSet[v]; });
  }

  function sortedUniq(arr) {
    var seen = {};
    return arr.filter(function (v) { if (seen[v]) return false; seen[v] = true; return true; }).sort();
  }

  /**
   * 主入口
   */
  function run(rows) {
    if (!rows || !rows.length) {
      return { ok: true, outputs: [], stats: { appCount: 0, fileCount: 0, rowCount: 0 } };
    }

    /* 1. 跳过第 1 行（标题行） */
    var dataRows = rows.filter(function (r) { return r.rowIndex > 1; });

    /* 2. 按 A 列分组；A 列空值行跳过 */
    var groups   = {};
    var appOrder = [];
    var seenFqdn = {};

    for (var ri = 0; ri < dataRows.length; ri++) {
      var row  = dataRows[ri];
      var app  = (row.A || '').trim();
      if (!app) {
        return { ok: false, error: '[行 ' + row.rowIndex + ' 列 A] 应用名为空，请填写或删除该行' };
      }

      var fqdn = (row.D || '').trim();
      var rawE = row.E || '';
      var rawF = row.F || '';
      var type = (row.G || '').trim();

      if (type !== '动态' && type !== '静态') {
        return {
          ok: false,
          error: '[行 ' + row.rowIndex + ' 列 G] 类型须为「动态」或「静态」，当前为：' + (type || '（空）')
        };
      }

      /* 域名校验 */
      var domErr = Excel2JsonValidate.checkDomain(fqdn, row.rowIndex);
      if (domErr) return { ok: false, error: '[行 ' + row.rowIndex + ' 列 D] ' + domErr };

      if (!groups[app]) { groups[app] = { dynamic: [], static: [] }; appOrder.push(app); seenFqdn[app] = { dynamic: {}, static: {} }; }

      var typeKey = type === '动态' ? 'dynamic' : 'static';
      if (seenFqdn[app][typeKey][fqdn]) {
        return { ok: false, error: '[行 ' + row.rowIndex + '] 应用「' + app + '」下 FQDN「' + fqdn + '」重复（' + type + '）' };
      }

      if (type === '动态') {
        var eRes = Excel2JsonValidate.validateMultipleIPs(rawE, row.rowIndex, 'E');
        if (eRes.error) return { ok: false, error: eRes.error };
        var fRes = Excel2JsonValidate.validateMultipleIPs(rawF, row.rowIndex, 'F');
        if (fRes.error) return { ok: false, error: fRes.error };
        /* 差分后不能全为空（E/F 完全相同，切换无意义） */
        var diffAddr    = sortedUniq(setDiff(eRes.ips, fRes.ips));
        var diffNewAddr = sortedUniq(setDiff(fRes.ips, eRes.ips));
        if (!diffAddr.length && !diffNewAddr.length) {
          return { ok: false, error: '[行 ' + row.rowIndex + '] 动态类型 E/F 列 IP 完全相同，差分后 address 与 new_address 均为空，请检查数据' };
        }
        groups[app].dynamic.push({ fqdn: fqdn, eIps: eRes.ips, fIps: fRes.ips });
        seenFqdn[app].dynamic[fqdn] = true;
      } else {
        var eRes2 = Excel2JsonValidate.validateSingleIP(rawE, row.rowIndex, 'E');
        if (eRes2.error) return { ok: false, error: eRes2.error };
        var fRes2 = Excel2JsonValidate.validateSingleIP(rawF, row.rowIndex, 'F');
        if (fRes2.error) return { ok: false, error: fRes2.error };
        /* 静态类型 E/F 不能同时为空 */
        if (!eRes2.ip && !fRes2.ip) {
          return { ok: false, error: '[行 ' + row.rowIndex + '] 静态类型 E/F 列均为空，切换前后地址不能同时缺失' };
        }
        groups[app].static.push({ fqdn: fqdn, eIp: eRes2.ip, fIp: fRes2.ip });
        seenFqdn[app].static[fqdn] = true;
      }
    }

    /* 3. 生成输出 */
    var outputs   = [];
    var fileCount = 0;

    appOrder.forEach(function (appName) {
      var g = groups[appName];

      /* 动态 */
      if (g.dynamic.length) {
        var dynSwitch = [], dynRevert = [];
        g.dynamic.forEach(function (item) {
          var address    = sortedUniq(setDiff(item.eIps, item.fIps));
          var newAddress = sortedUniq(setDiff(item.fIps, item.eIps));
          dynSwitch.push({ fqdn: item.fqdn, address: address, new_address: newAddress });
          dynRevert.push({ fqdn: item.fqdn, address: newAddress, new_address: address });
        });
        outputs.push({
          key: appName + '_动态',
          appName: appName,
          typeName: '动态',
          switchData: dynSwitch,
          revertData: dynRevert,
          switchFilename: appName + '_动态_切换.json',
          revertFilename: appName + '_动态_回切.json'
        });
        fileCount += 2;
      }

      /* 静态 */
      if (g.static.length) {
        var stSwitch = [], stRevert = [];
        g.static.forEach(function (item) {
          var addrList    = item.eIp ? [item.eIp] : [];
          var newAddrList = item.fIp ? [item.fIp] : [];
          stSwitch.push({ fqdn: item.fqdn, address: addrList, new_address: newAddrList });
          stRevert.push({ fqdn: item.fqdn, address: newAddrList, new_address: addrList });
        });
        outputs.push({
          key: appName + '_静态',
          appName: appName,
          typeName: '静态',
          switchData: stSwitch,
          revertData: stRevert,
          switchFilename: appName + '_静态_切换.json',
          revertFilename: appName + '_静态_回切.json'
        });
        fileCount += 2;
      }
    });

    return {
      ok: true,
      outputs: outputs,
      stats: {
        appCount: appOrder.length,
        fileCount: fileCount,
        rowCount: dataRows.length,
        processedRows: appOrder.reduce(function (n, name) {
          return n + groups[name].dynamic.length + groups[name].static.length;
        }, 0)
      }
    };
  }

  return { run: run };
}());
