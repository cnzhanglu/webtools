/**
 * 项目 / 设备数据模型与本地文件存取（无外部依赖）
 *
 * 文件 = 一个项目，含项目级默认模板（v4/v6）与多个设备。
 * 每个设备每个 stack 可选「自定义本设备模板」（templateOverride）覆盖项目默认。
 *
 * 导出：IptablesStore（依赖 IptablesTemplate、BocUtils）
 */
var IptablesStore = (function () {
  'use strict';

  var T = IptablesTemplate;
  var FILE_TYPE = 'webtools-iptables';

  function newStack() {
    return {
      whitelists: { dns: [], internal: [], snmp: [], mgmt: [] },
      whitelistEnabled: { dns: true, internal: true, snmp: true, mgmt: true },
      extraRules: [],
      disabledPrefixIds: [],
      templateOverride: null
    };
  }

  function newDevice(name) {
    return {
      name: name || '设备1',
      v4: newStack(),
      v6: newStack()
    };
  }

  function newProject(name) {
    return {
      fileType: FILE_TYPE,
      schemaVersion: T.SCHEMA_VERSION,
      templateVersion: T.TEMPLATE_VERSION,
      projectName: name || '新项目',
      templates: T.defaultTemplates(),
      devices: [newDevice('设备1')]
    };
  }

  /** 返回设备某 stack 的有效模板（设备覆盖优先，否则项目默认） */
  function effectiveTemplate(project, device, stack) {
    var override = device[stack] && device[stack].templateOverride;
    if (override) return override;
    return project.templates[stack];
  }

  /** 序列化为 JSON 字符串 */
  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  /** 触发下载保存 */
  function saveToFile(project, filename) {
    var json = serialize(project);
    var bytes = new TextEncoder().encode(json);
    var name = filename || (sanitize(project.projectName) || 'iptables') + '.json';
    BocUtils.downloadBlob(bytes, name, 'application/json');
  }

  function sanitize(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  /** 校验并补全打开的对象，返回规整后的 project（不合法则抛错） */
  function normalize(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('文件内容不是有效的 JSON 对象');
    if (!Array.isArray(obj.devices)) throw new Error('文件缺少 devices 列表');

    var project = newProject(obj.projectName || '导入的项目');
    project.schemaVersion = obj.schemaVersion || T.SCHEMA_VERSION;
    project.templateVersion = obj.templateVersion || 0;

    if (obj.templates && obj.templates.v4 && obj.templates.v6) {
      project.templates = {
        v4: normalizeTemplate(obj.templates.v4, 'v4'),
        v6: normalizeTemplate(obj.templates.v6, 'v6')
      };
    }

    project.devices = obj.devices.map(function (d, idx) {
      var dev = newDevice(d.name || ('设备' + (idx + 1)));
      ['v4', 'v6'].forEach(function (stack) {
        dev[stack] = normalizeStack(d[stack]);
      });
      return dev;
    });
    if (project.devices.length === 0) project.devices = [newDevice('设备1')];
    return project;
  }

  function normalizeStack(s) {
    var st = newStack();
    if (!s || typeof s !== 'object') return st;
    T.WHITELIST_IDS.forEach(function (id) {
      if (Array.isArray(s.whitelists && s.whitelists[id])) {
        st.whitelists[id] = s.whitelists[id].map(String);
      }
      if (s.whitelistEnabled && typeof s.whitelistEnabled[id] === 'boolean') {
        st.whitelistEnabled[id] = s.whitelistEnabled[id];
      }
    });
    if (Array.isArray(s.extraRules)) st.extraRules = s.extraRules.map(String);
    if (Array.isArray(s.disabledPrefixIds)) st.disabledPrefixIds = s.disabledPrefixIds.map(String);
    if (s.templateOverride) st.templateOverride = normalizeTemplate(s.templateOverride, stack);
    return st;
  }

  function normalizeTemplate(t, stack) {
    stack = stack === 'v6' ? 'v6' : 'v4';
    var out = { prefixRules: [], whitelistDefs: [], suffixRules: [] };
    if (Array.isArray(t.prefixRules)) {
      out.prefixRules = t.prefixRules.map(function (r) {
        return { id: r.id || T.genId('p'), enabled: r.enabled !== false, text: String(r.text || '') };
      });
    }
    if (Array.isArray(t.suffixRules)) {
      out.suffixRules = t.suffixRules.map(function (r) {
        return { id: r.id || T.genId('s'), enabled: r.enabled !== false, text: String(r.text || '') };
      });
    }
    if (Array.isArray(t.whitelistDefs)) {
      out.whitelistDefs = t.whitelistDefs.map(function (d) {
        return {
          id: d.id || T.genId('w'),
          name: String(d.name || d.id || '白名单'),
          lines: Array.isArray(d.lines) ? d.lines.map(String) : []
        };
      });
    }
    // 至少回退到默认，避免空模板
    if (!out.prefixRules.length && !out.suffixRules.length && !out.whitelistDefs.length) {
      return T.defaultTemplate(stack);
    }
    return out;
  }

  /** 从 File 对象读取并解析 */
  function openFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        cb(null, normalize(obj));
      } catch (e) {
        cb(e);
      }
    };
    reader.onerror = function () { cb(new Error('读取文件失败')); };
    reader.readAsText(file);
  }

  function needsTemplateUpgrade(project) {
    return (project.templateVersion || 0) < T.TEMPLATE_VERSION;
  }

  /** 将项目级模板重置为最新默认（保留设备白名单数据与设备级覆盖） */
  function upgradeTemplates(project) {
    project.templates = T.defaultTemplates();
    project.templateVersion = T.TEMPLATE_VERSION;
    return project;
  }

  return {
    FILE_TYPE: FILE_TYPE,
    newStack: newStack,
    newDevice: newDevice,
    newProject: newProject,
    effectiveTemplate: effectiveTemplate,
    serialize: serialize,
    saveToFile: saveToFile,
    openFile: openFile,
    normalize: normalize,
    needsTemplateUpgrade: needsTemplateUpgrade,
    upgradeTemplates: upgradeTemplates
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IptablesStore;
}
