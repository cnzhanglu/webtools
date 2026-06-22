/**
 * GSLB 多文件对比 — 数据解析与对比引擎
 */
var GslbCompareProcess = (function () {
  'use strict';

  var MISSING = '__MISSING__';

  function isScalar(x) {
    return typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || x === null;
  }

  function trimString(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function getAddList(jsonData) {
    var addList = [];
    if (!jsonData || typeof jsonData !== 'object') return addList;
    var addNode = jsonData.ADD;
    if (Array.isArray(addNode)) return addNode;
    if (addNode && typeof addNode === 'object') {
      var keys = Object.keys(addNode);
      var i;
      for (i = 0; i < keys.length; i++) {
        var val = addNode[keys[i]];
        if (Array.isArray(val)) addList = addList.concat(val);
      }
    }
    return addList;
  }

  function buildGpoolMap(jsonData) {
    var gpMap = {};
    var pools = (jsonData && jsonData.gpool) || [];
    var i;
    for (i = 0; i < pools.length; i++) {
      var gp = pools[i];
      if (gp && typeof gp === 'object' && gp.name) gpMap[gp.name] = gp;
    }
    return gpMap;
  }

  function buildDcMemberIndex(jsonData) {
    var index = {};
    var dcs = (jsonData && jsonData.data_center) || [];
    var i, j;
    for (i = 0; i < dcs.length; i++) {
      var dc = dcs[i];
      if (!dc || typeof dc !== 'object') continue;
      var dcName = trimString(dc.name);
      var gmembers = dc.gmembers || [];
      for (j = 0; j < gmembers.length; j++) {
        var gm = gmembers[j];
        if (!gm || typeof gm !== 'object') continue;
        var gmemberName = trimString(gm.gmember_name);
        if (!dcName || !gmemberName) continue;
        index[dcName + '\0' + gmemberName] = gm;
      }
    }
    return index;
  }

  function fillMemberStatuses(row, gm, dcRef, statusKeys) {
    var s;
    gm = gm || {};
    for (s = 0; s < statusKeys.length; s++) {
      var statusKey = statusKeys[s];
      if (row.statuses[statusKey] !== undefined && row.statuses[statusKey] !== '') continue;
      if (statusKey === 'member.pool_enable') {
        row.statuses[statusKey] = gm.enable !== undefined && gm.enable !== null ? gm.enable : '';
        continue;
      }
      if (statusKey === 'member.enable') {
        row.statuses[statusKey] = dcRef.enable !== undefined && dcRef.enable !== null ? dcRef.enable : '';
        continue;
      }
      if (statusKey === 'member.dc_pass') {
        row.statuses[statusKey] = dcRef.pass !== undefined && dcRef.pass !== null ? dcRef.pass : '';
        continue;
      }
      var field = statusKey.replace('member.', '');
      var value = gm[field];
      if ((value === undefined || value === null) && isScalar(dcRef[field])) value = dcRef[field];
      row.statuses[statusKey] = value !== undefined && value !== null ? value : '';
    }
  }

  function extractRows(jsonData, statusKeys) {
    var rowMap = {};
    var addList = getAddList(jsonData);
    var gpMap = buildGpoolMap(jsonData);
    var dcIndex = buildDcMemberIndex(jsonData);
    var r, p, m, s;

    for (r = 0; r < addList.length; r++) {
      var dom = addList[r];
      if (!dom || typeof dom !== 'object') continue;
      var domainName = trimString(dom.name);
      var domainType = trimString(dom.type);

      var gpRefs = Array.isArray(dom.gpool_list) ? dom.gpool_list : [];
      if (!gpRefs.length) gpRefs = [{}];

      for (p = 0; p < gpRefs.length; p++) {
        var gpRef = gpRefs[p];
        if (!gpRef || typeof gpRef !== 'object') gpRef = {};
        var gpName = trimString(gpRef.gpool_name);
        var gpObj = gpMap[gpName];
        var members = (gpObj && Array.isArray(gpObj.gmember_list)) ? gpObj.gmember_list : [];
        if (!members.length) members = [null];

        for (m = 0; m < members.length; m++) {
          var gm = members[m];
          var dcName = gm ? trimString(gm.dc_name) : '';
          var gmemberName = gm ? trimString(gm.gmember_name) : '';
          var ip = gm ? trimString(gm.ip) : '';
          var key = [domainName, domainType, dcName, gmemberName, ip].join('\0');
          var row = rowMap[key];
          if (!row) {
            row = {
              key: key,
              'domain.name': domainName,
              'domain.type': domainType,
              'member.dc_name': dcName,
              'member.gmember_name': gmemberName,
              'member.ip': ip,
              'member.port': gm ? trimString(gm.port) : '',
              statuses: {}
            };
            rowMap[key] = row;
          }
          if (!row['member.port'] && gm) {
            var portCandidate = trimString(gm.port);
            if (portCandidate) row['member.port'] = portCandidate;
          }

          var dcRef = dcIndex[dcName + '\0' + gmemberName] || {};
          fillMemberStatuses(row, gm, dcRef, statusKeys);
        }
      }
    }

    return rowMap;
  }

  function normalizeDisplayName(name, fallback) {
    var s = trimString(name);
    if (!s) s = trimString(fallback);
    if (!s) s = '文件';
    return s;
  }

  function buildUniqueDisplayNames(files) {
    var seen = {};
    var i;
    for (i = 0; i < files.length; i++) {
      var base = normalizeDisplayName(files[i].displayName, files[i].originFileName);
      var n = 1;
      var candidate = base;
      while (seen[candidate]) {
        n += 1;
        candidate = base + '_' + n;
      }
      seen[candidate] = true;
      files[i].resolvedName = candidate;
    }
  }

  function calcStatus(valuesByFile) {
    var i;
    var hasMissing = false;
    var allMissing = true;
    var uniq = {};
    var uniqCount = 0;
    for (i = 0; i < valuesByFile.length; i++) {
      var v = valuesByFile[i];
      if (v === MISSING) {
        hasMissing = true;
      } else {
        allMissing = false;
        var sv = String(v);
        if (!Object.prototype.hasOwnProperty.call(uniq, sv)) {
          uniq[sv] = true;
          uniqCount += 1;
        }
      }
    }
    if (allMissing) return '缺失';
    if (hasMissing) return '缺失';
    if (uniqCount > 1) return '不一致';
    return '一致';
  }

  function buildComparison(files, selectedStatusKeys) {
    var safeKeys = selectedStatusKeys && selectedStatusKeys.length
      ? selectedStatusKeys.slice()
      : ['member.status'];

    buildUniqueDisplayNames(files);
    var allKeys = {};
    var i, k, s;
    for (i = 0; i < files.length; i++) {
      var map = files[i].rowMap || {};
      var rowKeys = Object.keys(map);
      for (k = 0; k < rowKeys.length; k++) allKeys[rowKeys[k]] = true;
    }

    var keyList = Object.keys(allKeys);
    keyList.sort();
    var rows = [];

    for (k = 0; k < keyList.length; k++) {
      var uniqueKey = keyList[k];
      var base = null;
      for (i = 0; i < files.length; i++) {
        var r = files[i].rowMap[uniqueKey];
        if (r) {
          base = r;
          break;
        }
      }
      if (!base) continue;
      var out = {
        'domain.name': base['domain.name'],
        'domain.type': base['domain.type'],
        'member.dc_name': base['member.dc_name'],
        'member.gmember_name': base['member.gmember_name'],
        'member.ip': base['member.ip'],
        'member.port': base['member.port']
      };

      var summary = '一致';
      for (s = 0; s < safeKeys.length; s++) {
        var sk = safeKeys[s];
        var compareValues = [];
        for (i = 0; i < files.length; i++) {
          var item = files[i].rowMap[uniqueKey];
          var colName = files[i].resolvedName + '.' + sk;
          if (!item) {
            out[colName] = '';
            compareValues.push(MISSING);
          } else {
            var vv = item.statuses[sk];
            var displayVal = vv === undefined || vv === null ? '' : vv;
            out[colName] = displayVal;
            compareValues.push(displayVal);
          }
        }
        var result = calcStatus(compareValues);
        out['result.' + sk] = result;
        if (result === '不一致') summary = '不一致';
        else if (result === '缺失' && summary !== '不一致') summary = '缺失';
      }
      out['result.summary'] = summary;
      rows.push(out);
    }

    rows.sort(function (a, b) {
      var x = String(a['domain.name']).localeCompare(String(b['domain.name']));
      if (x !== 0) return x;
      x = String(a['domain.type']).localeCompare(String(b['domain.type']));
      if (x !== 0) return x;
      x = String(a['member.dc_name']).localeCompare(String(b['member.dc_name']));
      if (x !== 0) return x;
      x = String(a['member.gmember_name']).localeCompare(String(b['member.gmember_name']));
      if (x !== 0) return x;
      x = String(a['member.ip']).localeCompare(String(b['member.ip']));
      if (x !== 0) return x;
      return String(a['member.port']).localeCompare(String(b['member.port']));
    });

    return rows;
  }

  return {
    extractRows: extractRows,
    buildComparison: buildComparison,
    normalizeDisplayName: normalizeDisplayName
  };
})();
