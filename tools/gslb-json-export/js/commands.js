/**
 * GSLB JSON 导出 — 创建命令生成层
 *
 * 根据搜索过滤后的域名记录（name + type），收集其依赖的 datacenter、service-member、
 * pool、pool-member，按依赖顺序生成 `create gslb ...` CLI 命令文本；也可针对当前
 * 选中的单个域名，按成员 IP 生成逐 ID 的 RRS 成员启停命令。
 *
 * 依赖：GslbProcess（提供索引）、BocIpCidr（统一 IPv4/IPv6 文本）
 * 导出：GslbCommands
 *
 * 数据流：
 *   domainKeys[{name,type}]
 *   → collectResourcesForDomains  (查 ADD、gpool、data_center 索引)
 *   → buildCreateCommands         (按顺序拼接命令行 + 收集 warnings)
 *   → { lines, warnings }
 *   当前域名成员启停：collectRrsMembers → buildRrsMemberPickerItems（按成员列出 IP/DC/VS/启停状态）
 *   → buildRrsMemberCommands（勾选/手工 IP 合并匹配，跨池按 dc*gmember_name 去重）
 */
var GslbCommands = (function () {
  'use strict';

  // ─── 算法映射 ────────────────────────────────────────────────────────────────

  /**
   * 主算法（pref-bal-algo）与域名算法（balance-algorithm）映射表。
   * sp / qos 仅适用于此表，出现在备算法时会产生 warning。
   */
  var ALGO_MAP_PREF = {
    'rr':  'round-robin',
    'wrr': 'weighted-round-robin',
    'sp':  'static-proximity',
    'ga':  'global-availability',
    'cm':  'cpu-memory',
    'dp':  'dynamic-proximity',
    'qos': 'quality-of-service',
    'sps': 'static-persistence',
    'cr':  'drop-packet',
    'wsps': 'weighted-round-robin'   // 无官方 CLI 对应，降级并 warning
  };

  /** 备算法（alt-bal-algo）映射表，额外支持 fallback-ip 与 none */
  var ALGO_MAP_ALT = {
    'rr':  'round-robin',
    'wrr': 'weighted-round-robin',
    'ga':  'global-availability',
    'cm':  'cpu-memory',
    'dp':  'dynamic-proximity',
    'sps': 'static-persistence',
    'cr':  'drop-packet',
    'fi':  'fallback-ip',
    'none': 'none'
  };

  /**
   * 将 JSON 算法简写映射为 CLI 值。
   * @param {string} code  JSON 中的算法简写，如 'rr'/'wrr'/'sp'
   * @param {'pref'|'alt'|'domain'} kind  使用场景（pref/domain 共用 ALGO_MAP_PREF）
   * @param {string[]} warnings  警告信息数组，映射异常时追加
   * @returns {string}  CLI 算法值
   */
  function mapAlgorithm(code, kind, warnings) {
    if (!code) {
      return kind === 'alt' ? 'none' : 'round-robin';
    }
    var lc = String(code).toLowerCase();
    if (kind === 'alt') {
      if (Object.prototype.hasOwnProperty.call(ALGO_MAP_ALT, lc)) {
        return ALGO_MAP_ALT[lc];
      }
      // sp / qos 不在备算法表中
      if (lc === 'sp' || lc === 'qos') {
        warnings.push('备算法不支持 "' + code + '"，已回退为 round-robin');
        return 'round-robin';
      }
      warnings.push('未知备算法 "' + code + '"，原样输出');
      return lc;
    }
    // pref / domain
    if (Object.prototype.hasOwnProperty.call(ALGO_MAP_PREF, lc)) {
      if (lc === 'wsps') {
        warnings.push('"wsps" 无官方 CLI 对应，已降级为 weighted-round-robin');
      }
      return ALGO_MAP_PREF[lc];
    }
    warnings.push('未知算法 "' + code + '"，原样输出');
    return lc;
  }

  // ─── 布尔/状态字段格式化 ─────────────────────────────────────────────────────

  /**
   * 将各种形式的启用标志格式化为 enable / disable。
   * JSON 中 enable 字段实为字符串 'yes'/'no'，也兼容布尔与 '1'/'0'。
   */
  function formatStatus(v) {
    if (v === true || v === 'yes' || v === '1' || v === 1) return 'enable';
    if (v === false || v === 'no' || v === '0' || v === 0) return 'disable';
    return 'enable';  // 缺省开启
  }

  /**
   * 根据 pool.pass 推导 member-status-check 参数。
   * pass 为 '1'/1/true 时开启健康检测参考，否则禁用。
   */
  function formatMemberStatusCheck(pass) {
    if (pass === '1' || pass === 1 || pass === true) return 'enable';
    return 'disable';
  }

  /** 将 HMS 数组（字符串或 {name:...} 对象）格式化为逗号分隔字符串 */
  function normalizeHmsList(value) {
    if (!value) return '';
    if (!Array.isArray(value)) return '';
    var names = [];
    var i;
    for (i = 0; i < value.length; i++) {
      var item = value[i];
      if (typeof item === 'string') {
        names.push(item);
      } else if (item && typeof item === 'object' && item.name !== undefined) {
        names.push(String(item.name));
      }
    }
    return names.join(',');
  }

  // ─── 资源收集 ────────────────────────────────────────────────────────────────

  /**
   * 对指定的域名记录集合（name + type），遍历其 gpool_list → gmember_list，
   * 收集所有涉及的 datacenter、service-member、pool、pool-member、rrs 去重集合。
   *
   * @param {object}   jsonData       完整 GSLB JSON 对象
   * @param {Array}    domainKeys     [{name, type}, ...] 需生成命令的域名记录
   * @param {object}   dcMemberIndex  dc_name+\0+gmember_name → DC 成员详情
   * @returns {{ dcs, gms, pools, poolMembers, rrsRecords, warnings }}
   */
  function collectResourcesForDomains(jsonData, domainKeys, dcMemberIndex) {
    var addList = GslbProcess.getAddList(jsonData);
    var gpMap = GslbProcess.buildGpoolMap(jsonData);

    // 快速查找：将 domainKeys 构建为 name\0type 集合
    var keySet = {};
    var i;
    for (i = 0; i < domainKeys.length; i++) {
      keySet[domainKeys[i].name + '\0' + domainKeys[i].type] = true;
    }

    var dcs = {};           // dc_name → true（有序，排序后生成命令）
    var gms = {};           // dc_name+\0+gmember_name → {dc_name, gmember_name, ip, port, hms}
    var pools = {};         // gpool_name → gpool 对象
    var poolMembers = {};   // pool+\0+dc+\0+gm → {pool_name, type, dc, gm, enable, weight}
    var rrsRecords = [];    // 按 domainKeys 顺序，不去重（rrs 每条域名记录独立）
    var rrsSeen = {};       // name+\0+type 避免同 ADD 出现重复
    var warnings = [];

    var r, dom, domKey, gpRefs, gpRef, gpName, gpObj, members, gm, dcName, gmemberName;
    var pmKey, dcGm, hms, gmIdx;

    for (r = 0; r < addList.length; r++) {
      dom = addList[r];
      if (!dom || typeof dom !== 'object') continue;
      domKey = (dom.name || '') + '\0' + (dom.type || '');
      if (!keySet[domKey]) continue;
      if (rrsSeen[domKey]) continue;
      rrsSeen[domKey] = true;

      // 收集 rrs
      rrsRecords.push(dom);

      gpRefs = Array.isArray(dom.gpool_list) ? dom.gpool_list : [];
      if (!gpRefs.length) {
        warnings.push('域名 "' + dom.name + '" (' + dom.type + ') 无 gpool_list，跳过池/成员生成');
        continue;
      }

      for (var gpIdx = 0; gpIdx < gpRefs.length; gpIdx++) {
        gpRef = gpRefs[gpIdx];
        if (!gpRef || typeof gpRef !== 'object') continue;
        gpName = gpRef.gpool_name || '';
        if (!gpName) continue;

        gpObj = gpMap[gpName];
        if (!gpObj) {
          warnings.push('域名 "' + dom.name + '" 引用的地址池 "' + gpName + '" 在 JSON 中不存在');
          continue;
        }

        pools[gpName] = gpObj;

        members = Array.isArray(gpObj.gmember_list) ? gpObj.gmember_list : [];
        for (gmIdx = 0; gmIdx < members.length; gmIdx++) {
          gm = members[gmIdx];
          if (!gm || typeof gm !== 'object') continue;
          dcName = gm.dc_name || '';
          gmemberName = gm.gmember_name || '';

          if (dcName) dcs[dcName] = true;

          if (dcName && gmemberName) {
            var gmKey = dcName + '\0' + gmemberName;
            if (!gms[gmKey]) {
              dcGm = dcMemberIndex[gmKey] || {};
              hms = normalizeHmsList(dcGm.hms || gm.hms);
              if (!dcGm.ip && !gm.ip) {
                warnings.push('服务成员 "' + gmemberName + '" 缺少 IP 地址');
              }
              gms[gmKey] = {
                dc_name: dcName,
                gmember_name: gmemberName,
                ip: dcGm.ip || gm.ip || '',
                port: dcGm.port || gm.port || '',
                hms: hms
              };
            }
          }

          pmKey = gpName + '\0' + dcName + '\0' + gmemberName;
          if (!poolMembers[pmKey]) {
            poolMembers[pmKey] = {
              pool_name: gpName,
              pool_type: (gpObj.type || '').toLowerCase(),
              dc_name: dcName,
              gmember_name: gmemberName,
              enable: gm.enable,
              weight: gm.ratio || '1'
            };
          }
        }
      }
    }

    return {
      dcs: dcs,
      gms: gms,
      pools: pools,
      poolMembers: poolMembers,
      rrsRecords: rrsRecords,
      warnings: warnings
    };
  }

  // ─── 命令行生成 ──────────────────────────────────────────────────────────────

  /**
   * 将收集到的资源对象转换为有序命令行列表。
   * 顺序：datacenter → service-member → pool → pool-member → rrs
   *
   * @param {object} res  collectResourcesForDomains 的返回值
   * @returns {{ lines: string[], warnings: string[] }}
   */
  function buildCreateCommands(res) {
    var lines = [];
    var warnings = res.warnings.slice();  // 继承收集阶段的 warnings
    var i, key, obj, dcName, gmObj, gpObj, pmObj, dom;
    var dcKeys, gmKeys, poolKeys, pmKeys;

    // 1. datacenter
    dcKeys = Object.keys(res.dcs).sort();
    if (dcKeys.length) {
      lines.push('# Datacenter');
      for (i = 0; i < dcKeys.length; i++) {
        lines.push('create gslb datacenter datacenter-name ' + dcKeys[i]);
      }
    }

    // 2. service-member
    gmKeys = Object.keys(res.gms).sort();
    if (gmKeys.length) {
      lines.push('# Service Member');
      for (i = 0; i < gmKeys.length; i++) {
        gmObj = res.gms[gmKeys[i]];
        var gmLine = 'create gslb service-member'
          + ' datacenter-name ' + gmObj.dc_name
          + ' member-name ' + gmObj.gmember_name
          + ' ip ' + gmObj.ip
          + ' port ' + gmObj.port;
        if (gmObj.hms) {
          gmLine += ' health-check-tmpl ' + gmObj.hms;
        }
        lines.push(gmLine);
      }
    }

    // 3. pool
    poolKeys = Object.keys(res.pools).sort();
    if (poolKeys.length) {
      lines.push('# Pool');
      for (i = 0; i < poolKeys.length; i++) {
        gpObj = res.pools[poolKeys[i]];
        var poolType = (gpObj.type || '').toLowerCase();
        var prefAlgo = mapAlgorithm(gpObj.first_algorithm, 'pref', warnings);
        var altAlgo  = mapAlgorithm(gpObj.second_algorithm, 'alt', warnings);
        var ttl = gpObj.ttl || '60';
        var msc = formatMemberStatusCheck(gpObj.pass);
        var poolStatus = formatStatus(gpObj.enable);
        lines.push(
          'create gslb pool'
          + ' pool-name ' + poolKeys[i]
          + ' type ' + poolType
          + ' member-status-check ' + msc
          + ' pref-bal-algo ' + prefAlgo
          + ' alt-bal-algo ' + altAlgo
          + ' ttl ' + ttl
          + ' status ' + poolStatus
        );
      }
    }

    // 4. pool-member
    pmKeys = Object.keys(res.poolMembers).sort();
    if (pmKeys.length) {
      lines.push('# Pool Member');
      for (i = 0; i < pmKeys.length; i++) {
        pmObj = res.poolMembers[pmKeys[i]];
        lines.push(
          'create gslb pool-member'
          + ' pool-name ' + pmObj.pool_name
          + ' type ' + (pmObj.pool_type || 'a')
          + ' datacenter-name ' + pmObj.dc_name
          + ' service-member ' + pmObj.gmember_name
          + ' status ' + formatStatus(pmObj.enable)
          + ' weight ' + (pmObj.weight || '1')
        );
      }
    }

    // 5. rrs（域名记录）
    if (res.rrsRecords.length) {
      lines.push('# RRS');
      for (i = 0; i < res.rrsRecords.length; i++) {
        dom = res.rrsRecords[i];
        var domType = (dom.type || '').toLowerCase();
        var domAlgo = mapAlgorithm(dom.algorithm, 'domain', warnings);
        var domStatus = formatStatus(dom.enable);
        var poolArg = '';
        if (Array.isArray(dom.gpool_list) && dom.gpool_list.length) {
          poolArg = dom.gpool_list.map(function (ref) {
            return ref.gpool_name + ':' + (ref.ratio || '1');
          }).join(',');
        }
        var rrsLine = 'create gslb rrs'
          + ' zone-name @'
          + ' record-name ' + (dom.name || '')
          + ' type ' + domType
          + ' balance-algorithm ' + domAlgo;
        if (poolArg) {
          rrsLine += ' pool ' + poolArg;
        }
        rrsLine += ' status ' + domStatus;
        lines.push(rrsLine);
      }
    }

    return { lines: lines, warnings: warnings };
  }

  /**
   * 组合入口：从 JSON 和指定域名记录键生成创建命令。
   *
   * @param {object} jsonData       完整 GSLB JSON 对象
   * @param {Array}  domainKeys     [{name, type}, ...] 需生成命令的域名记录
   * @param {object} dcMemberIndex  dc_name+\0+gmember_name → DC 成员详情
   * @returns {{ lines: string[], warnings: string[] }}
   */
  function buildCommandsForDomains(jsonData, domainKeys, dcMemberIndex) {
    if (!jsonData || !domainKeys || !domainKeys.length) {
      return { lines: [], warnings: ['未指定域名记录，无命令生成'] };
    }
    var res = collectResourcesForDomains(jsonData, domainKeys, dcMemberIndex);
    return buildCreateCommands(res);
  }

  // ─── RRS 成员启停 ──────────────────────────────────────────────────────────

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  /** 统一 IPv4/IPv6 文本；解析失败返回空串，避免原文误匹配。 */
  function normalizeIp(value) {
    var text = trim(value);
    if (!text || typeof BocIpCidr === 'undefined') return '';
    var parsed = BocIpCidr.parseSingleIp(text);
    return parsed ? BocIpCidr.ipFromBigInt(parsed.value, parsed.family) : '';
  }

  /** 按空白、逗号和分号拆分手工 IP，保留输入顺序。 */
  function parseIpList(text) {
    return String(text == null ? '' : text).split(/[\s,，;；]+/).filter(function (item) {
      return trim(item);
    });
  }

  /**
   * 在 ADD 中定位当前域名，同时保留对象形态 ADD 的分组键作为 zone。
   * 数组形态无法提供 zone，按设备常用值回退为 @。
   */
  function findDomainWithZone(jsonData, domainKey) {
    var addNode = jsonData && jsonData.ADD;
    var targetName = trim(domainKey && domainKey.name);
    var targetType = trim(domainKey && domainKey.type).toLowerCase();
    var i, j, zones, list, item;

    if (addNode && typeof addNode === 'object' && !Array.isArray(addNode)) {
      zones = Object.keys(addNode);
      for (i = 0; i < zones.length; i++) {
        list = Array.isArray(addNode[zones[i]]) ? addNode[zones[i]] : [];
        for (j = 0; j < list.length; j++) {
          item = list[j] || {};
          if (trim(item.name) === targetName && trim(item.type).toLowerCase() === targetType) {
            return { domain: item, zoneName: zones[i] || '@' };
          }
        }
      }
    } else if (Array.isArray(addNode)) {
      for (i = 0; i < addNode.length; i++) {
        item = addNode[i] || {};
        if (trim(item.name) === targetName && trim(item.type).toLowerCase() === targetType) {
          return { domain: item, zoneName: '@' };
        }
      }
    }
    return { domain: null, zoneName: '@' };
  }

  /**
   * 收集当前域名引用池中的成员。IP 优先取池成员，缺失时回退 data_center；
   * ID 使用设备的「数据中心名*服务成员名」规则，同一成员跨池引用时按 ID 去重。
   */
  function collectRrsMembers(jsonData, domainKey, dcMemberIndex) {
    var found = findDomainWithZone(jsonData, domainKey);
    var warnings = [];
    var members = [];
    var seenIds = {};
    var gpMap = GslbProcess.buildGpoolMap(jsonData);
    var refs = found.domain && Array.isArray(found.domain.gpool_list) ? found.domain.gpool_list : [];
    var i, j, pool, poolMembers, member, dcName, memberName, memberId, dcMember, rawIp, ip;

    if (!found.domain) {
      warnings.push('未在导出 JSON 中找到当前域名记录');
      return { domain: null, zoneName: found.zoneName, members: members, warnings: warnings };
    }

    for (i = 0; i < refs.length; i++) {
      pool = gpMap[refs[i] && refs[i].gpool_name];
      if (!pool) {
        warnings.push('地址池「' + trim(refs[i] && refs[i].gpool_name) + '」在导出 JSON 中不存在');
        continue;
      }
      poolMembers = Array.isArray(pool.gmember_list) ? pool.gmember_list : [];
      for (j = 0; j < poolMembers.length; j++) {
        member = poolMembers[j] || {};
        dcName = trim(member.dc_name);
        memberName = trim(member.gmember_name);
        memberId = dcName && memberName ? dcName + '*' + memberName : '';
        if (memberId && seenIds[memberId]) continue;
        if (memberId) seenIds[memberId] = true;

        dcMember = dcMemberIndex && dcMemberIndex[dcName + '\0' + memberName];
        rawIp = trim(member.ip) || trim(dcMember && dcMember.ip);
        ip = normalizeIp(rawIp);
        members.push({
          id: memberId,
          ip: ip,
          rawIp: rawIp,
          dcName: dcName,
          memberName: memberName,
          enable: member.enable,
          memberEnable: dcMember && dcMember.enable
        });
      }
    }

    return { domain: found.domain, zoneName: found.zoneName, members: members, warnings: warnings };
  }

  /**
   * 勾选列表按服务成员分行，不再按 IP 去重，便于同 IP 区分 DC / VS / 当前启停状态。
   * 无可用 IP 的成员无法按现有规则匹配，故不进入勾选项。
   */
  function buildRrsMemberPickerItems(members) {
    var items = [];
    var i, m, ip;
    for (i = 0; i < (members || []).length; i++) {
      m = members[i] || {};
      ip = m.ip || '';
      if (!ip) continue;
      items.push({
        ip: ip,
        dcName: m.dcName || '',
        memberName: m.memberName || '',
        id: m.id || '',
        poolStatus: formatStatus(m.enable),
        memberStatus: formatStatus(m.memberEnable)
      });
    }
    return items;
  }

  function buildRrsMemberModifyCommand(zoneName, recordName, type, memberId, status) {
    return 'modify gslb rrs-member'
      + ' zone-name ' + zoneName
      + ' record-name ' + recordName
      + ' type ' + type
      + ' pool-member id ' + memberId
      + ' status ' + status
      + ' force';
  }

  /**
   * 将勾选与手工 IP 取并集后匹配当前域名成员，并为每个去重 ID 生成一条命令。
   */
  function buildRrsMemberCommands(jsonData, domainKey, selectedIps, manualIpsText, status, dcMemberIndex) {
    var collected = collectRrsMembers(jsonData, domainKey, dcMemberIndex);
    var warnings = collected.warnings.slice();
    var requested = (selectedIps || []).concat(parseIpList(manualIpsText));
    var normalized = {};
    var requestedOrder = [];
    var lines = [];
    var matched = [];
    var seenIds = {};
    var validStatus = trim(status).toLowerCase();
    var type = trim(domainKey && domainKey.type).toLowerCase();
    var i, rawIp, ip, hit, member;

    if (validStatus !== 'enable' && validStatus !== 'disable') {
      return { lines: [], warnings: warnings, matched: [], members: collected.members, zoneName: collected.zoneName, error: '请选择 enable 或 disable' };
    }
    if (type !== 'a' && type !== 'aaaa') {
      return { lines: [], warnings: warnings, matched: [], members: collected.members, zoneName: collected.zoneName, error: '当前记录类型仅支持 A 或 AAAA' };
    }

    for (i = 0; i < requested.length; i++) {
      rawIp = trim(requested[i]);
      ip = normalizeIp(rawIp);
      if (!ip) {
        warnings.push('IP「' + rawIp + '」无法解析，已跳过');
      } else if (!normalized[ip]) {
        normalized[ip] = rawIp;
        requestedOrder.push(ip);
      }
    }
    if (!requestedOrder.length) {
      return { lines: [], warnings: warnings, matched: [], members: collected.members, zoneName: collected.zoneName, error: '请勾选或手工输入至少一个成员 IP' };
    }

    for (i = 0; i < requestedOrder.length; i++) {
      ip = requestedOrder[i];
      hit = false;
      for (var j = 0; j < collected.members.length; j++) {
        member = collected.members[j];
        if (member.ip !== ip) continue;
        hit = true;
        if (!member.id) {
          warnings.push('IP「' + normalized[ip] + '」命中成员但缺少数据中心名或成员名，无法构造 ID');
        } else if (!seenIds[member.id]) {
          seenIds[member.id] = true;
          matched.push(member);
          lines.push(buildRrsMemberModifyCommand(
            collected.zoneName,
            trim(domainKey.name),
            type,
            member.id,
            validStatus
          ));
        }
      }
      if (!hit) warnings.push('IP「' + normalized[ip] + '」未在当前域名成员中找到');
    }

    return {
      lines: lines,
      warnings: warnings,
      matched: matched,
      members: collected.members,
      zoneName: collected.zoneName,
      error: ''
    };
  }

  return {
    ALGO_MAP_PREF: ALGO_MAP_PREF,
    ALGO_MAP_ALT: ALGO_MAP_ALT,
    mapAlgorithm: mapAlgorithm,
    formatStatus: formatStatus,
    formatMemberStatusCheck: formatMemberStatusCheck,
    collectResourcesForDomains: collectResourcesForDomains,
    buildCreateCommands: buildCreateCommands,
    buildCommandsForDomains: buildCommandsForDomains,
    normalizeIp: normalizeIp,
    parseIpList: parseIpList,
    findDomainWithZone: findDomainWithZone,
    collectRrsMembers: collectRrsMembers,
    buildRrsMemberPickerItems: buildRrsMemberPickerItems,
    buildRrsMemberModifyCommand: buildRrsMemberModifyCommand,
    buildRrsMemberCommands: buildRrsMemberCommands
  };
})();
