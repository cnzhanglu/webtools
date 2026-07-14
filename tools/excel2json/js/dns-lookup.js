/**
 * Excel 切换 JSON — DNS 权威区查询层
 *
 * 数据流：DNS 导出 ZIP → 解压 auth-zones.csv → 读取 A 列视图、B 列区名称
 * → 按区名称具体程度排序 → 根据完整域名做标签边界最长后缀匹配。
 *
 * 依赖：BocXlsxRead.readZip
 * 导出：Excel2JsonDnsLookup（parseZip、parseAuthZones、findZone）
 */
var Excel2JsonDnsLookup = (function () {
  'use strict';

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  /** 解析支持双引号、转义双引号和字段内逗号的单行 CSV。 */
  function parseCsvLine(line) {
    var fields = [];
    var value = '';
    var quoted = false;
    var i;
    for (i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') {
        if (quoted && line.charAt(i + 1) === '"') {
          value += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        fields.push(value);
        value = '';
      } else {
        value += ch;
      }
    }
    fields.push(value);
    return fields;
  }

  function parseAuthZones(text) {
    var normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n');
    var zones = [];
    var i;

    if (!lines.length || lines[0].indexOf('视图名称') === -1 || lines[0].indexOf('区名称') === -1) {
      throw new Error('auth-zones.csv 表头无效，必须包含视图名称和区名称');
    }

    for (i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var fields = parseCsvLine(lines[i]);
      var view = String(fields[0] || '').trim();
      var zone = normalizeName(fields[1]);
      if (view && zone) {
        zones.push({
          view: view,
          zone: zone,
          labelCount: zone.split('.').length
        });
      }
    }
    if (!zones.length) throw new Error('auth-zones.csv 中没有有效的视图与区记录');

    /* 最具体的区排在前面，使查询命中后可立即返回。 */
    zones.sort(function (a, b) {
      if (a.labelCount !== b.labelCount) return b.labelCount - a.labelCount;
      return b.zone.length - a.zone.length;
    });
    return { zones: zones };
  }

  function parseZip(arrayBuffer) {
    var files = BocXlsxRead.readZip(arrayBuffer);
    var names = Object.keys(files);
    var authPath = '';
    var i;
    for (i = 0; i < names.length; i++) {
      if (/(^|\/)auth-zones\.csv$/i.test(names[i])) {
        authPath = names[i];
        break;
      }
    }
    if (!authPath) throw new Error('DNS ZIP 中未找到 auth-zones.csv');

    var text = new TextDecoder('utf-8').decode(files[authPath]);
    var index = parseAuthZones(text);
    index.authPath = authPath;
    return index;
  }

  /**
   * 按 DNS 标签边界匹配最细区。
   * 例如 a.mbs.boc.cn 同时属于 boc.cn 与 mbs.boc.cn，返回后者。
   */
  function findZone(index, fqdn) {
    var name = normalizeName(fqdn);
    var zones = index && Array.isArray(index.zones) ? index.zones : [];
    var i;
    for (i = 0; i < zones.length; i++) {
      var zone = zones[i].zone;
      if (name === zone || name.slice(-(zone.length + 1)) === '.' + zone) {
        return { view: zones[i].view, zone: zone };
      }
    }
    return null;
  }

  return {
    parseZip: parseZip,
    parseAuthZones: parseAuthZones,
    findZone: findZone,
    normalizeName: normalizeName
  };
}());
