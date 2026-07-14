/**
 * Excel 切换 JSON — GSLB 成员查询层
 *
 * 数据流：GSLB 全量 JSON → ADD 域名 → gpool_list → gpool.gmember_list
 * → 按「规范化域名 + IP」建立服务成员索引 → 返回 dc_name / gmember_name。
 *
 * 依赖：BocIpCidr（统一 IPv4/IPv6 文本格式）
 * 导出：Excel2JsonGslbLookup（buildIndex、findMembers）
 */
var Excel2JsonGslbLookup = (function () {
  'use strict';

  /** 域名比较忽略大小写和末尾根域点，兼容 Excel 与 GSLB 导出的格式差异。 */
  function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  /** 统一 IPv6 压缩写法，避免 Excel 与 GSLB 使用不同文本形式而漏匹配。 */
  function normalizeIp(value) {
    var text = String(value || '').trim();
    if (typeof BocIpCidr === 'undefined') return text;
    var parsed = BocIpCidr.parseSingleIp(text);
    return parsed ? BocIpCidr.ipFromBigInt(parsed.value, parsed.family) : text;
  }

  function getAddList(jsonData) {
    var result = [];
    var addNode = jsonData && jsonData.ADD;
    var keys;
    var i;

    if (Array.isArray(addNode)) return addNode;
    if (!addNode || typeof addNode !== 'object') return result;

    keys = Object.keys(addNode);
    for (i = 0; i < keys.length; i++) {
      if (Array.isArray(addNode[keys[i]])) {
        result = result.concat(addNode[keys[i]]);
      }
    }
    return result;
  }

  function buildGpoolMap(jsonData) {
    var result = {};
    var pools = jsonData && Array.isArray(jsonData.gpool) ? jsonData.gpool : [];
    var i;
    for (i = 0; i < pools.length; i++) {
      if (pools[i] && pools[i].name) result[pools[i].name] = pools[i];
    }
    return result;
  }

  /**
   * data_center 中的成员是 IP 的权威回退来源。
   * 键使用 dc_name + gmember_name，不能使用仅存在于地址池成员中的 real_id。
   */
  function buildDcMemberMap(jsonData) {
    var result = {};
    var dcs = jsonData && Array.isArray(jsonData.data_center) ? jsonData.data_center : [];
    var i;
    var j;
    for (i = 0; i < dcs.length; i++) {
      var dc = dcs[i] || {};
      var members = Array.isArray(dc.gmembers) ? dc.gmembers : [];
      for (j = 0; j < members.length; j++) {
        var member = members[j] || {};
        if (dc.name && member.gmember_name) {
          result[dc.name + '\0' + member.gmember_name] = member;
        }
      }
    }
    return result;
  }

  function addMember(domainEntry, ip, dcName, gmemberName) {
    if (!ip || !dcName || !gmemberName) return;
    if (!domainEntry[ip]) domainEntry[ip] = [];

    var key = dcName + '\0' + gmemberName;
    var items = domainEntry[ip];
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i]._key === key) return;
    }
    items.push({ dc_name: dcName, gmember_name: gmemberName, _key: key });
  }

  /**
   * 构建域名到 IP 成员的查询索引。
   * 同名 ADD 记录和重复地址池会合并，成员以「数据中心 + 名称」去重。
   */
  function buildIndex(jsonData) {
    if (!jsonData || typeof jsonData !== 'object' || Array.isArray(jsonData)) {
      throw new Error('GSLB JSON 顶层必须是对象');
    }
    if (!jsonData.ADD) {
      throw new Error('GSLB JSON 缺少 ADD 域名数据');
    }

    var domainIndex = {};
    var addList = getAddList(jsonData);
    var gpoolMap = buildGpoolMap(jsonData);
    var dcMemberMap = buildDcMemberMap(jsonData);
    var i;
    var j;
    var k;

    for (i = 0; i < addList.length; i++) {
      var domain = addList[i] || {};
      var domainName = normalizeDomain(domain.name);
      if (!domainName) continue;
      if (!domainIndex[domainName]) domainIndex[domainName] = {};

      var refs = Array.isArray(domain.gpool_list) ? domain.gpool_list : [];
      for (j = 0; j < refs.length; j++) {
        var pool = gpoolMap[(refs[j] || {}).gpool_name];
        if (!pool) continue;
        var members = Array.isArray(pool.gmember_list) ? pool.gmember_list : [];

        for (k = 0; k < members.length; k++) {
          var poolMember = members[k] || {};
          var dcName = poolMember.dc_name || '';
          var gmemberName = poolMember.gmember_name || '';
          var dcMember = dcMemberMap[dcName + '\0' + gmemberName] || {};
          var ip = poolMember.ip || dcMember.ip || '';
          addMember(domainIndex[domainName], normalizeIp(ip), dcName, gmemberName);
        }
      }
    }

    return { domains: domainIndex };
  }

  /** 返回 null 表示域名不存在，空数组表示域名存在但 IP 无对应服务成员。 */
  function findMembers(index, fqdn, ip) {
    var domainEntry = index && index.domains && index.domains[normalizeDomain(fqdn)];
    if (!domainEntry) return null;
    return domainEntry[normalizeIp(ip)] || [];
  }

  return {
    buildIndex: buildIndex,
    findMembers: findMembers,
    normalizeDomain: normalizeDomain
  };
}());
