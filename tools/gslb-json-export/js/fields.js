/**
 * GSLB JSON 导出 — 字段映射、预设方案与 localStorage 偏好
 *
 * FIELD_MAP：内部字段键（domain.xxx）→ 中文表头
 * BASE_SCHEMES：「运维巡检」「排障分析」等预设的默认字段集合
 * loadPref/savePref：记住上次方案与穿梭框选中项（localStorage）
 *
 * 导出：GslbFields
 */
var GslbFields = (function () {
  'use strict';

  var PREF_KEY = 'gslb_json_export_pref_v35';
  var PREF_SCHEMA_VERSION = 42;

  var FIELD_MAP = {
    'domain.name': '域名名称',
    'domain.type': '域名类型',
    'domain.enable': '域名是否启用',
    'domain.algorithm': '域名负载均衡算法',
    'domain.fail_policy': '失败应答策略',
    'domain.persist_enable': '会话保持启用',
    'domain.persist_time': '会话保持时长',
    'domain.status': '域名状态',
    'pool.gpool_name': '地址池名称',
    'pool.type': '地址池类型',
    'pool.enable': '地址池是否启用',
    'pool.ttl': 'TTL',
    'pool.first_algorithm': '地址池主算法',
    'pool.second_algorithm': '地址池备算法',
    'pool.pass': '地址池健康检测有效性',
    'pool.hm_gm_flag': '健康检查标志',
    'pool.warning': '忽略健康检测',
    'pool.status': '地址池状态',
    'pool.hms': '地址池健康检查模板',
    'member.gmember_name': '成员名称',
    'member.ip': '成员IP',
    'member.port': '成员端口',
    'member.dc_name': '所属数据中心',
    'member.status': '成员最终健康检测状态',
    'member.gpool_status_hm_templates': '地址池层健康检测状态',
    'member.status_hm_templates': '服务成员层健康检测状态',
    'member.link_status': '链路状态',
    'member.enable': '服务成员是否启用',
    'member.pool_enable': '地址池成员是否启用',
    'member.dc_hms': '服务成员健康检查模板',
    'member.dc_pass': '服务成员健康检查有效性'
  };

  var BASE_SCHEMES = {
    '运维巡检': {
      domain: ['domain.name', 'domain.type', 'domain.algorithm', 'domain.status', 'domain.enable'],
      pool: ['pool.gpool_name', 'pool.type', 'pool.ttl', 'pool.first_algorithm', 'pool.second_algorithm',
        'pool.warning', 'pool.hms', 'pool.pass', 'pool.enable'],
      member: ['member.dc_name', 'member.gmember_name', 'member.ip', 'member.port',
        'member.dc_hms', 'member.dc_pass', 'member.status', 'member.gpool_status_hm_templates',
        'member.status_hm_templates', 'member.pool_enable', 'member.enable']
    },
    '排障分析': {
      domain: ['domain.name', 'domain.type', 'domain.algorithm', 'domain.fail_policy', 'domain.persist_enable',
        'domain.persist_time', 'domain.status', 'domain.enable'],
      pool: ['pool.gpool_name', 'pool.type', 'pool.ttl', 'pool.first_algorithm', 'pool.second_algorithm',
        'pool.pass', 'pool.hm_gm_flag', 'pool.status', 'pool.hms'],
      member: ['member.gmember_name', 'member.ip', 'member.port', 'member.enable', 'member.dc_name',
        'member.status', 'member.gpool_status_hm_templates', 'member.status_hm_templates',
        'member.link_status', 'member.dc_pass', 'member.dc_hms']
    },
    '全量导出': { domain: [], pool: [], member: [] }
  };

  var DEFAULT_PREF = {
    version: 42,
    last_scheme: '运维巡检',
    orders: {
      '运维巡检': { domain: [], pool: [], member: [] },
      '排障分析': { domain: [], pool: [], member: [] },
      '全量导出': { domain: [], pool: [], member: [] }
    }
  };

  function keyToCn(key) {
    return FIELD_MAP[key] || key;
  }

  function loadPref() {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (!raw) {
        savePref(DEFAULT_PREF);
        return JSON.parse(JSON.stringify(DEFAULT_PREF));
      }
      var data = JSON.parse(raw);
      if (data.version !== PREF_SCHEMA_VERSION) {
        data = JSON.parse(JSON.stringify(DEFAULT_PREF));
        savePref(data);
        return data;
      }
      var k;
      for (k in DEFAULT_PREF) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) {
          data[k] = DEFAULT_PREF[k];
        }
      }
      if (!data.orders) {
        data.orders = JSON.parse(JSON.stringify(DEFAULT_PREF.orders));
      }
      return data;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_PREF));
    }
  }

  function savePref(cfg) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }

  function getSchemeNames() {
    return Object.keys(BASE_SCHEMES);
  }

  /** 某分组下 FIELD_MAP 中的全部已知字段（未导入 JSON 时作为候选池） */
  function getKnownFields(groupKey) {
    var prefix = groupKey + '.';
    var keys = [];
    var k;
    for (k in FIELD_MAP) {
      if (Object.prototype.hasOwnProperty.call(FIELD_MAP, k) && k.indexOf(prefix) === 0) {
        keys.push(k);
      }
    }
    return keys;
  }

  /** 合并 JSON 发现的字段与已知字段，保持 JSON 顺序优先 */
  function mergeFieldPool(groupKey, fromJson) {
    var known = getKnownFields(groupKey);
    if (!fromJson || !fromJson.length) return known;
    var out = [];
    var seen = {};
    var i, k;
    for (i = 0; i < fromJson.length; i++) {
      k = fromJson[i];
      if (!seen[k]) {
        out.push(k);
        seen[k] = true;
      }
    }
    for (i = 0; i < known.length; i++) {
      k = known[i];
      if (!seen[k]) {
        out.push(k);
        seen[k] = true;
      }
    }
    return out;
  }

  return {
    FIELD_MAP: FIELD_MAP,
    BASE_SCHEMES: BASE_SCHEMES,
    DEFAULT_PREF: DEFAULT_PREF,
    keyToCn: keyToCn,
    loadPref: loadPref,
    savePref: savePref,
    getSchemeNames: getSchemeNames,
    getKnownFields: getKnownFields,
    mergeFieldPool: mergeFieldPool
  };
})();
