/**
 * GSLB JSON 导出 — 数据解析与行构建（核心逻辑层）
 *
 * GSLB 配置 JSON 结构：ADD（域名列表）→ gpool_list → gpool / gmember_list，
 * 另通过 data_center 建立数据中心成员索引（dc_name + gmember_name → 详情）。
 *
 * 主要能力：
 *   collectAvailableFields — 扫描 JSON 中出现过的可导出字段
 *   buildAddRows — 按选定字段顺序展开为「域名×池×成员」扁平行
 *   buildOrphanGpoolRows — 未被域名引用的地址池（池×成员）
 *   buildOrphanGmemberRows — 未被地址池引用的数据中心服务成员
 *   buildTopology — 构建域名-池-成员引用图（供关系图渲染）
 *   buildCsvContent — 带 UTF-8 BOM 的 CSV 文本
 *
 * 依赖：GslbFields（字段名与中英文映射）
 * 导出：GslbProcess
 */
var GslbProcess = (function () {
  'use strict';

  function isScalar(x) {
    return typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || x === null;
  }

  function normalizeHmsList(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
      var names = [];
      var i;
      for (i = 0; i < value.length; i++) {
        var item = value[i];
        if (item && typeof item === 'object' && item.name !== undefined) {
          names.push(String(item.name));
        } else if (typeof item === 'string') {
          names.push(item);
        }
      }
      return names.join(',');
    }
    return '';
  }

  /** 构建 data_center 下 gmember 的二级索引，键为「数据中心名 + 成员名」组合 */
  function buildDcMemberIndex(jsonData) {
    var index = {};
    if (!jsonData || typeof jsonData !== 'object') return index;

    var dcs = jsonData.data_center || [];
    var i, j;
    for (i = 0; i < dcs.length; i++) {
      var dc = dcs[i];
      if (!dc || typeof dc !== 'object') continue;
      var dcName = dc.name || '';
      var gmembers = dc.gmembers || [];
      for (j = 0; j < gmembers.length; j++) {
        var gm = gmembers[j];
        if (!gm || typeof gm !== 'object') continue;
        var gmemberName = gm.gmember_name || '';
        if (dcName && gmemberName) {
          index[dcName + '\0' + gmemberName] = gm;
        }
      }
    }
    return index;
  }

  function getAddList(jsonData) {
    var addList = [];
    if (!jsonData || typeof jsonData !== 'object') return addList;

    var addNode = jsonData.ADD;
    if (addNode && typeof addNode === 'object' && !Array.isArray(addNode)) {
      var keys = Object.keys(addNode);
      var i;
      for (i = 0; i < keys.length; i++) {
        var val = addNode[keys[i]];
        if (Array.isArray(val)) {
          addList = addList.concat(val);
        }
      }
    } else if (Array.isArray(addNode)) {
      addList = addNode;
    }
    return addList;
  }

  function buildGpoolMap(jsonData) {
    var gpMap = {};
    if (!jsonData || typeof jsonData !== 'object') return gpMap;

    var pools = jsonData.gpool || [];
    var i;
    for (i = 0; i < pools.length; i++) {
      var gp = pools[i];
      if (gp && typeof gp === 'object' && gp.name) {
        gpMap[gp.name] = gp;
      }
    }
    return gpMap;
  }

  /** 收集所有 ADD 域名 gpool_list 中引用过的地址池名称 */
  function collectReferencedGpoolNames(jsonData) {
    var referenced = {};
    if (!jsonData || typeof jsonData !== 'object') return referenced;

    var addList = getAddList(jsonData);
    var i, j, dom, gpRefs, gpRef, gpName;
    for (i = 0; i < addList.length; i++) {
      dom = addList[i];
      if (!dom || typeof dom !== 'object') continue;
      gpRefs = dom.gpool_list || [];
      for (j = 0; j < gpRefs.length; j++) {
        gpRef = gpRefs[j];
        if (!gpRef || typeof gpRef !== 'object') continue;
        gpName = gpRef.gpool_name || '';
        if (gpName) referenced[gpName] = true;
      }
    }
    return referenced;
  }

  /** 收集所有 gpool.gmember_list 中引用过的服务成员键（dc_name + gmember_name） */
  function collectUsedGmemberKeys(jsonData) {
    var used = {};
    if (!jsonData || typeof jsonData !== 'object') return used;

    var pools = jsonData.gpool || [];
    var i, j, gp, gmemberList, gm, dcName, gmemberName;
    for (i = 0; i < pools.length; i++) {
      gp = pools[i];
      if (!gp || typeof gp !== 'object') continue;
      gmemberList = gp.gmember_list || [];
      for (j = 0; j < gmemberList.length; j++) {
        gm = gmemberList[j];
        if (!gm || typeof gm !== 'object') continue;
        dcName = gm.dc_name || '';
        gmemberName = gm.gmember_name || '';
        if (dcName && gmemberName) {
          used[dcName + '\0' + gmemberName] = true;
        }
      }
    }
    return used;
  }

  /** 向行对象填充地址池字段（与 buildAddRows 规则一致） */
  function fillPoolFields(row, orders, gpRef, gpObj) {
    var refDict = {};
    var objDict = {};
    var k, v, f, sub;

    gpRef = gpRef || {};
    gpObj = (gpObj && typeof gpObj === 'object') ? gpObj : {};

    for (k in gpRef) {
      if (!Object.prototype.hasOwnProperty.call(gpRef, k)) continue;
      v = gpRef[k];
      if (isScalar(v)) {
        if (k === 'gpool_name') refDict.gpool_name = v;
        else refDict[k] = v;
      }
    }

    for (k in gpObj) {
      if (!Object.prototype.hasOwnProperty.call(gpObj, k)) continue;
      v = gpObj[k];
      if (isScalar(v)) objDict[k] = v;
    }

    for (f = 0; f < orders.pool.length; f++) {
      sub = orders.pool[f].replace('pool.', '');
      if (sub === 'hms') {
        row[orders.pool[f]] = normalizeHmsList(gpObj.hms || []);
      } else if (Object.prototype.hasOwnProperty.call(refDict, sub)) {
        row[orders.pool[f]] = refDict[sub] !== undefined && refDict[sub] !== null ? refDict[sub] : '';
      } else if (sub === 'gpool_name' && objDict.name !== undefined) {
        row[orders.pool[f]] = objDict.name !== null ? objDict.name : '';
      } else {
        row[orders.pool[f]] = objDict[sub] !== undefined && objDict[sub] !== null ? objDict[sub] : '';
      }
    }
  }

  /** 向行对象填充成员字段（与 buildAddRows 规则一致） */
  function fillMemberFields(row, orders, gm, dcMemberIndex) {
    var gmDict = {};
    var k, v, f, sub, fieldKey, dcName, gmemberName, dcGm;

    if (gm && typeof gm === 'object') {
      for (k in gm) {
        if (!Object.prototype.hasOwnProperty.call(gm, k)) continue;
        v = gm[k];
        if (isScalar(v)) gmDict[k] = v;
      }
    }

    dcName = gmDict.dc_name || '';
    gmemberName = gmDict.gmember_name || '';
    dcGm = dcMemberIndex[dcName + '\0' + gmemberName] || {};

    for (f = 0; f < orders.member.length; f++) {
      fieldKey = orders.member[f];
      sub = fieldKey.replace('member.', '');
      if (fieldKey === 'member.dc_hms') {
        row[fieldKey] = normalizeHmsList(dcGm.hms || []);
      } else if (fieldKey === 'member.dc_pass') {
        row[fieldKey] = dcGm.pass !== undefined && dcGm.pass !== null ? dcGm.pass : '';
      } else if (fieldKey === 'member.enable') {
        row[fieldKey] = dcGm.enable !== undefined && dcGm.enable !== null ? dcGm.enable : '';
      } else if (fieldKey === 'member.pool_enable') {
        row[fieldKey] = gmDict.enable !== undefined && gmDict.enable !== null ? gmDict.enable : '';
      } else {
        row[fieldKey] = gmDict[sub] !== undefined && gmDict[sub] !== null ? gmDict[sub] : '';
      }
    }
  }

  /** 扫描 gpool 对象上的可导出池字段 */
  function scanPoolObjectFields(gpObj, poolSet) {
    if (!gpObj || typeof gpObj !== 'object') return;
    var k, v;
    for (k in gpObj) {
      if (!Object.prototype.hasOwnProperty.call(gpObj, k)) continue;
      if (k === 'gmember_list') continue;
      v = gpObj[k];
      if (isScalar(v)) {
        if (k === 'name') poolSet['pool.gpool_name'] = true;
        else poolSet['pool.' + k] = true;
      }
      if (k === 'hms' && Array.isArray(v)) poolSet['pool.hms'] = true;
    }
  }

  /** 扫描池成员与 DC 成员上的可导出成员字段 */
  function scanMemberFields(gmember, dcMemberIndex, memberSet) {
    if (!gmember || typeof gmember !== 'object') return;
    var k, v, dcName, gmemberName, dcGm;
    for (k in gmember) {
      if (!Object.prototype.hasOwnProperty.call(gmember, k)) continue;
      v = gmember[k];
      if (isScalar(v)) memberSet['member.' + k] = true;
    }
    if (gmember.enable !== undefined) memberSet['member.pool_enable'] = true;

    dcName = gmember.dc_name || '';
    gmemberName = gmember.gmember_name || '';
    dcGm = dcMemberIndex[dcName + '\0' + gmemberName];
    if (dcGm && typeof dcGm === 'object') {
      if (Array.isArray(dcGm.hms)) memberSet['member.dc_hms'] = true;
      if (isScalar(dcGm.pass)) memberSet['member.dc_pass'] = true;
      if (isScalar(dcGm.enable)) memberSet['member.enable'] = true;
    }
  }

  function mergeOrder(baseKeys, foundSet) {
    var out = [];
    var seen = {};
    var i, k;
    for (i = 0; i < baseKeys.length; i++) {
      k = baseKeys[i];
      if (foundSet[k] && !seen[k]) {
        out.push(k);
        seen[k] = true;
      }
    }
    var sorted = Object.keys(foundSet).sort();
    for (i = 0; i < sorted.length; i++) {
      k = sorted[i];
      if (!seen[k]) {
        out.push(k);
        seen[k] = true;
      }
    }
    return out;
  }

  function collectAvailableFields(jsonData, dcMemberIndex) {
    var domain = {};
    var pool = {};
    var member = {};
    var empty = { domain: [], pool: [], member: [] };

    if (!jsonData || typeof jsonData !== 'object') return empty;

    var addList = getAddList(jsonData);
    var gpMap = buildGpoolMap(jsonData);
    var r, gpRef, gpObj, gm, k, v, dcName, gmemberName, dcGm;

    for (r = 0; r < addList.length; r++) {
      var rec = addList[r];
      if (!rec || typeof rec !== 'object') continue;

      for (k in rec) {
        if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
        if (k === 'gpool_list' || k === 'alias_list') continue;
        v = rec[k];
        if (isScalar(v)) domain['domain.' + k] = true;
      }

      var gpRefs = rec.gpool_list || [];
      for (gpRef = 0; gpRef < gpRefs.length; gpRef++) {
        var ref = gpRefs[gpRef];
        if (ref && typeof ref === 'object') {
          for (k in ref) {
            if (!Object.prototype.hasOwnProperty.call(ref, k)) continue;
            v = ref[k];
            if (isScalar(v)) {
              if (k === 'gpool_name') pool['pool.gpool_name'] = true;
              else pool['pool.' + k] = true;
            }
          }
        }

        var gpName = (ref && typeof ref === 'object') ? (ref.gpool_name || '') : '';
        gpObj = gpMap[gpName] || {};
        if (gpObj && typeof gpObj === 'object') {
          for (k in gpObj) {
            if (!Object.prototype.hasOwnProperty.call(gpObj, k)) continue;
            if (k === 'gmember_list') continue;
            v = gpObj[k];
            if (isScalar(v)) pool['pool.' + k] = true;
            if (k === 'hms' && Array.isArray(v)) pool['pool.hms'] = true;
          }

          var gmemberList = gpObj.gmember_list || [];
          for (gm = 0; gm < gmemberList.length; gm++) {
            var gmember = gmemberList[gm];
            if (!gmember || typeof gmember !== 'object') continue;
            for (k in gmember) {
              if (!Object.prototype.hasOwnProperty.call(gmember, k)) continue;
              v = gmember[k];
              if (isScalar(v)) member['member.' + k] = true;
            }
            if (gmember.enable !== undefined) member['member.pool_enable'] = true;

            dcName = gmember.dc_name || '';
            gmemberName = gmember.gmember_name || '';
            dcGm = dcMemberIndex[dcName + '\0' + gmemberName];
            if (dcGm && typeof dcGm === 'object') {
              if (Array.isArray(dcGm.hms)) member['member.dc_hms'] = true;
              if (isScalar(dcGm.pass)) member['member.dc_pass'] = true;
              if (isScalar(dcGm.enable)) member['member.enable'] = true;
            }
          }
        }
      }
    }

    // 额外扫描全部 gpool 与 data_center.gmembers，覆盖未被域名引用的孤儿对象字段
    var pools = jsonData.gpool || [];
    var pi, gi, gpObj2, gmemberList2, gmember2;
    for (pi = 0; pi < pools.length; pi++) {
      gpObj2 = pools[pi];
      if (!gpObj2 || typeof gpObj2 !== 'object') continue;
      scanPoolObjectFields(gpObj2, pool);
      gmemberList2 = gpObj2.gmember_list || [];
      for (gi = 0; gi < gmemberList2.length; gi++) {
        scanMemberFields(gmemberList2[gi], dcMemberIndex, member);
      }
    }

    var dcs = jsonData.data_center || [];
    var di, dj, dc, dcGm2;
    for (di = 0; di < dcs.length; di++) {
      dc = dcs[di];
      if (!dc || typeof dc !== 'object') continue;
      var dcNameScan = dc.name || '';
      var dcGmembers = dc.gmembers || [];
      for (dj = 0; dj < dcGmembers.length; dj++) {
        dcGm2 = dcGmembers[dj];
        if (!dcGm2 || typeof dcGm2 !== 'object') continue;
        var gmForScan = {};
        for (k in dcGm2) {
          if (Object.prototype.hasOwnProperty.call(dcGm2, k)) {
            gmForScan[k] = dcGm2[k];
          }
        }
        if (dcNameScan && !gmForScan.dc_name) gmForScan.dc_name = dcNameScan;
        scanMemberFields(gmForScan, dcMemberIndex, member);
      }
    }

    var baseDom = GslbFields.BASE_SCHEMES['运维巡检'].domain.concat(
      GslbFields.BASE_SCHEMES['排障分析'].domain
    );
    var basePool = GslbFields.BASE_SCHEMES['运维巡检'].pool.concat(
      GslbFields.BASE_SCHEMES['排障分析'].pool
    );
    var baseMem = GslbFields.BASE_SCHEMES['运维巡检'].member.concat(
      GslbFields.BASE_SCHEMES['排障分析'].member
    );

    return {
      domain: mergeOrder(baseDom, domain),
      pool: mergeOrder(basePool, pool),
      member: mergeOrder(baseMem, member)
    };
  }

  /**
   * 将 ADD 域名列表按「域名 × 地址池引用 × 池成员」笛卡尔展开为扁平行；
   * 每行按 orders 中字段顺序填充，并附带 _domainName 供过滤/关系图使用。
   */
  function buildAddRows(jsonData, orders, dcMemberIndex) {
    var rows = [];
    if (!jsonData || typeof jsonData !== 'object') return rows;

    var addList = getAddList(jsonData);
    var gpMap = buildGpoolMap(jsonData);
    var r, gpRefIdx, gmIdx, f, sub, row;

    for (r = 0; r < addList.length; r++) {
      var dom = addList[r];
      if (!dom || typeof dom !== 'object') continue;

      var gpRefs = dom.gpool_list;
      if (!gpRefs || !gpRefs.length) {
        gpRefs = [{ gpool_name: '', ratio: '' }];
      }

      for (gpRefIdx = 0; gpRefIdx < gpRefs.length; gpRefIdx++) {
        var gpRef = gpRefs[gpRefIdx];
        if (!gpRef || typeof gpRef !== 'object') gpRef = {};

        var gpName = gpRef.gpool_name || '';
        var gpObj = gpMap[gpName] || {};

        var members = (gpObj && typeof gpObj === 'object') ? (gpObj.gmember_list || []) : [];
        if (!members.length) members = [null];

        for (gmIdx = 0; gmIdx < members.length; gmIdx++) {
          var gm = members[gmIdx];
          row = {};

          for (f = 0; f < orders.domain.length; f++) {
            sub = orders.domain[f].replace('domain.', '');
            row[orders.domain[f]] = dom[sub] !== undefined && dom[sub] !== null ? dom[sub] : '';
          }

          fillPoolFields(row, orders, gpRef, gpObj);
          fillMemberFields(row, orders, gm, dcMemberIndex);

          rows.push(row);
          row._domainName = dom.name || '';
        }
      }
    }
    return rows;
  }

  /**
   * 未被任何 ADD 域名引用的地址池，按「池 × 成员」展开；
   * 域名字段不填充，池/成员字段规则与 buildAddRows 一致。
   */
  function buildOrphanGpoolRows(jsonData, orders, dcMemberIndex) {
    var rows = [];
    if (!jsonData || typeof jsonData !== 'object') return rows;

    var referenced = collectReferencedGpoolNames(jsonData);
    var pools = jsonData.gpool || [];
    var orphanPools = [];
    var i, j, gp, gpName, members, gm, row;

    for (i = 0; i < pools.length; i++) {
      gp = pools[i];
      if (!gp || typeof gp !== 'object' || !gp.name) continue;
      if (referenced[gp.name]) continue;
      orphanPools.push(gp);
    }

    orphanPools.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    for (i = 0; i < orphanPools.length; i++) {
      gp = orphanPools[i];
      members = gp.gmember_list || [];
      if (!members.length) members = [null];

      for (j = 0; j < members.length; j++) {
        gm = members[j];
        row = {};
        fillPoolFields(row, orders, {}, gp);
        fillMemberFields(row, orders, gm, dcMemberIndex);
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * 未被任何 gpool.gmember_list 引用的数据中心服务成员；
   * 仅填充 member 字段，dc_name 取自父级 data_center.name。
   */
  function buildOrphanGmemberRows(jsonData, orders, dcMemberIndex) {
    var rows = [];
    if (!jsonData || typeof jsonData !== 'object') return rows;

    var used = collectUsedGmemberKeys(jsonData);
    var dcs = jsonData.data_center || [];
    var orphans = [];
    var i, j, dc, dcName, gmembers, gm, gmemberName, key, item, row;

    for (i = 0; i < dcs.length; i++) {
      dc = dcs[i];
      if (!dc || typeof dc !== 'object') continue;
      dcName = dc.name || '';
      gmembers = dc.gmembers || [];
      for (j = 0; j < gmembers.length; j++) {
        gm = gmembers[j];
        if (!gm || typeof gm !== 'object') continue;
        gmemberName = gm.gmember_name || '';
        if (!dcName || !gmemberName) continue;
        key = dcName + '\0' + gmemberName;
        if (used[key]) continue;
        orphans.push({ dcName: dcName, gm: gm });
      }
    }

    orphans.sort(function (a, b) {
      var ka = a.dcName + '\0' + (a.gm.gmember_name || '');
      var kb = b.dcName + '\0' + (b.gm.gmember_name || '');
      return ka.localeCompare(kb);
    });

    for (i = 0; i < orphans.length; i++) {
      item = orphans[i];
      gm = {};
      var k;
      for (k in item.gm) {
        if (Object.prototype.hasOwnProperty.call(item.gm, k)) {
          gm[k] = item.gm[k];
        }
      }
      if (!gm.dc_name) gm.dc_name = item.dcName;
      row = {};
      fillMemberFields(row, orders, gm, dcMemberIndex);
      rows.push(row);
    }
    return rows;
  }

  function escapeCsvCell(val) {
    var s = val === null || val === undefined ? '' : String(val);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function pickScalarParams(obj, skipKeys) {
    var params = {};
    if (!obj || typeof obj !== 'object') return params;
    var skip = skipKeys || {};
    var k, v;
    for (k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (skip[k]) continue;
      v = obj[k];
      if (isScalar(v)) params[k] = v;
    }
    return params;
  }

  function buildTopology(jsonData, dcMemberIndex, domainName) {
    var empty = { domains: [], pools: [], members: [], edges: [] };
    if (!jsonData || typeof jsonData !== 'object') return empty;

    var addList = getAddList(jsonData);
    var gpMap = buildGpoolMap(jsonData);
    var domainMap = {};
    var poolMap = {};
    var memberMap = {};
    var edges = [];
    var edgeSeen = {};
    var r, gpRefIdx, gmIdx, dom, gpRefs, gpRef, gpName, gpObj, members, gm;
    var domName, poolId, memberId, edgeKey, k, v, dcName, gmemberName, dcGm;
    var onlyDomain = domainName ? String(domainName) : '';

    function addEdge(from, to, kind, params) {
      edgeKey = from + '\0' + to + '\0' + kind;
      if (edgeSeen[edgeKey]) return;
      edgeSeen[edgeKey] = true;
      edges.push({ from: from, to: to, kind: kind, params: params || {} });
    }

    for (r = 0; r < addList.length; r++) {
      dom = addList[r];
      if (!dom || typeof dom !== 'object') continue;

      domName = dom.name || ('domain_' + r);
      if (onlyDomain && domName !== onlyDomain) continue;
      if (!domainMap[domName]) {
        domainMap[domName] = {
          id: 'domain:' + domName,
          name: domName,
          params: pickScalarParams(dom, { gpool_list: true, alias_list: true })
        };
      }

      gpRefs = dom.gpool_list;
      if (!gpRefs || !gpRefs.length) continue;

      for (gpRefIdx = 0; gpRefIdx < gpRefs.length; gpRefIdx++) {
        gpRef = gpRefs[gpRefIdx];
        if (!gpRef || typeof gpRef !== 'object') continue;

        gpName = gpRef.gpool_name || '';
        if (!gpName) continue;

        poolId = 'pool:' + gpName;
        if (!poolMap[poolId]) {
          gpObj = gpMap[gpName] || {};
          poolMap[poolId] = {
            id: poolId,
            name: gpName,
            params: pickScalarParams(gpObj, { gmember_list: true })
          };
          if (Array.isArray(gpObj.hms)) {
            poolMap[poolId].params.hms = normalizeHmsList(gpObj.hms);
          }
        }

        addEdge('domain:' + domName, poolId, 'domain-pool', pickScalarParams(gpRef));

        gpObj = gpMap[gpName] || {};
        members = (gpObj && typeof gpObj === 'object') ? (gpObj.gmember_list || []) : [];
        for (gmIdx = 0; gmIdx < members.length; gmIdx++) {
          gm = members[gmIdx];
          if (!gm || typeof gm !== 'object') continue;

          dcName = gm.dc_name || '';
          gmemberName = gm.gmember_name || '';
          memberId = 'member:' + dcName + '\0' + gmemberName + '\0' + (gm.ip || '');

          if (!memberMap[memberId]) {
            dcGm = dcMemberIndex[dcName + '\0' + gmemberName] || {};
            memberMap[memberId] = {
              id: memberId,
              label: gmemberName || gm.ip || '成员',
              params: pickScalarParams(gm)
            };
            if (gm.enable !== undefined) memberMap[memberId].params.pool_enable = gm.enable;
            if (Array.isArray(dcGm.hms)) {
              memberMap[memberId].params.dc_hms = normalizeHmsList(dcGm.hms);
            }
            if (isScalar(dcGm.pass)) memberMap[memberId].params.dc_pass = dcGm.pass;
            if (isScalar(dcGm.enable)) memberMap[memberId].params.enable = dcGm.enable;
          }

          addEdge(poolId, memberId, 'pool-member', {
            port: gm.port !== undefined && gm.port !== null ? gm.port : '',
            pool_enable: gm.enable !== undefined && gm.enable !== null ? gm.enable : ''
          });
        }
      }
    }

    var domains = [];
    var pools = [];
    var members = [];
    for (k in domainMap) {
      if (Object.prototype.hasOwnProperty.call(domainMap, k)) domains.push(domainMap[k]);
    }
    for (k in poolMap) {
      if (Object.prototype.hasOwnProperty.call(poolMap, k)) pools.push(poolMap[k]);
    }
    for (k in memberMap) {
      if (Object.prototype.hasOwnProperty.call(memberMap, k)) members.push(memberMap[k]);
    }

    domains.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    pools.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    members.sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });

    return { domains: domains, pools: pools, members: members, edges: edges };
  }

  function buildCsvContent(columns, rows) {
    var lines = [];
    var header = [];
    var i, c, r;
    for (i = 0; i < columns.length; i++) {
      header.push(escapeCsvCell(GslbFields.keyToCn(columns[i])));
    }
    lines.push(header.join(','));

    for (r = 0; r < rows.length; r++) {
      var line = [];
      for (c = 0; c < columns.length; c++) {
        line.push(escapeCsvCell(rows[r][columns[c]]));
      }
      lines.push(line.join(','));
    }
    return lines.join('\r\n');
  }

  function buildDomainListRows(jsonData) {
    var rows = [];
    if (!jsonData || typeof jsonData !== 'object') return rows;

    var addList = getAddList(jsonData);
    var gpMap = buildGpoolMap(jsonData);
    var domainMap = {};
    var i, j, k;

    for (i = 0; i < addList.length; i++) {
      var dom = addList[i];
      if (!dom || typeof dom !== 'object') continue;
      var domainName = dom.name || '';
      if (!domainName) continue;

      var domainType = dom.type !== undefined && dom.type !== null ? String(dom.type) : '';
      var dedupeKey = domainName + '\0' + domainType;
      var item = domainMap[dedupeKey];
      if (!item) {
        item = {
          'domain.name': domainName,
          'domain.type': domainType,
          'domain.algorithm': dom.algorithm !== undefined && dom.algorithm !== null ? dom.algorithm : '',
          _ipSet: {}
        };
        domainMap[dedupeKey] = item;
      } else if ((!item['domain.algorithm']) && dom.algorithm !== undefined && dom.algorithm !== null) {
        item['domain.algorithm'] = dom.algorithm;
      }

      var gpRefs = Array.isArray(dom.gpool_list) ? dom.gpool_list : [];
      for (j = 0; j < gpRefs.length; j++) {
        var gpRef = gpRefs[j];
        if (!gpRef || typeof gpRef !== 'object') continue;
        var gpName = gpRef.gpool_name || '';
        if (!gpName) continue;
        var gpObj = gpMap[gpName];
        if (!gpObj || typeof gpObj !== 'object' || !Array.isArray(gpObj.gmember_list)) continue;

        for (k = 0; k < gpObj.gmember_list.length; k++) {
          var gm = gpObj.gmember_list[k];
          if (!gm || typeof gm !== 'object') continue;
          var ip = gm.ip !== undefined && gm.ip !== null ? String(gm.ip).trim() : '';
          if (ip) item._ipSet[ip] = true;
        }
      }
    }

    var keys = Object.keys(domainMap).sort(function (a, b) {
      var ra = domainMap[a];
      var rb = domainMap[b];
      var na = String(ra['domain.name'] || '');
      var nb = String(rb['domain.name'] || '');
      var cmp = na.localeCompare(nb);
      if (cmp !== 0) return cmp;
      return String(ra['domain.type'] || '').localeCompare(String(rb['domain.type'] || ''));
    });
    for (i = 0; i < keys.length; i++) {
      var row = domainMap[keys[i]];
      var ips = Object.keys(row._ipSet).sort(function (a, b) {
        return String(a).localeCompare(String(b));
      });
      rows.push({
        'domain.name': row['domain.name'],
        'domain.type': row['domain.type'],
        'domain.algorithm': row['domain.algorithm'],
        'member.ip': ips.join(',')
      });
    }
    return rows;
  }

  return {
    isScalar: isScalar,
    normalizeHmsList: normalizeHmsList,
    buildDcMemberIndex: buildDcMemberIndex,
    collectAvailableFields: collectAvailableFields,
    buildAddRows: buildAddRows,
    buildOrphanGpoolRows: buildOrphanGpoolRows,
    buildOrphanGmemberRows: buildOrphanGmemberRows,
    buildDomainListRows: buildDomainListRows,
    buildTopology: buildTopology,
    buildCsvContent: buildCsvContent
  };
})();
