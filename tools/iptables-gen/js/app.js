/**
 * iptables 规则生成工具 — UI 交互层
 *
 * 项目模型：一个 JSON 文件 = 一个项目，含多设备；每设备独立 v4/v6 栈。
 * 数据流：
 *   UI 编辑（白名单 IP、开关、附加规则）→ syncFromUI 写回 project
 *   → IptablesGen.generateStack 按模板顺序拼接规则
 *   → IptablesValidate 校验 IP 与规则结构
 *
 * 另支持：模板编辑、现有规则导入（IptablesParse）、本地 JSON 存取（IptablesStore）
 *
 * 依赖：IptablesTemplate、IptablesGen、IptablesParse、IptablesValidate、
 *       IptablesStore、BocUtils
 */
var IptablesApp = (function () {
  'use strict';

  var T = IptablesTemplate;
  var project = null;
  var curDevice = 0;
  var curStack = 'v4';

  // 模板编辑草稿
  var tplDraft = null;
  var tplTarget = 'project'; // 'project' | 'device'

  /* ---------- 小工具 ---------- */
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'value') e.value = attrs[k];
      else if (k === 'checked') e.checked = !!attrs[k];
      else if (k === 'onclick') e.onclick = attrs[k];
      else if (k === 'onchange') e.onchange = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function curDev() { return project.devices[curDevice]; }
  function curStackData() { return curDev()[curStack]; }
  function effTemplate() { return IptablesStore.effectiveTemplate(project, curDev(), curStack); }
  function splitLines(s) { return String(s || '').split(/\r?\n/); }
  function cleanLines(s) {
    return splitLines(s).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    project = IptablesStore.newProject();
    curDevice = 0;
    curStack = 'v4';
    $('file-input').addEventListener('change', onFileChosen);
    renderAll();
  }

  function renderAll() {
    $('project-name').value = project.projectName;
    $('upgrade-hint').style.display = IptablesStore.needsTemplateUpgrade(project) ? 'flex' : 'none';
    renderDeviceList();
    renderStackTabs();
    renderEditor();
    clearOutput();
  }

  /* ---------- 设备列表 ---------- */
  function renderDeviceList() {
    var list = $('device-list');
    list.innerHTML = '';
    project.devices.forEach(function (d, i) {
      var li = el('li', {
        class: 'device-item' + (i === curDevice ? ' active' : ''),
        onclick: function () { selectDevice(i); }
      }, [el('span', { class: 'device-name', text: d.name })]);
      list.appendChild(li);
    });
  }

  function selectDevice(i) {
    if (i === curDevice) return;
    syncFromUI();
    curDevice = i;
    renderDeviceList();
    renderEditor();
    clearOutput();
  }

  function addDevice() {
    syncFromUI();
    var name = prompt('新设备名称：', '设备' + (project.devices.length + 1));
    if (name === null) return;
    project.devices.push(IptablesStore.newDevice(name.trim() || ('设备' + (project.devices.length + 1))));
    curDevice = project.devices.length - 1;
    renderDeviceList();
    renderEditor();
    clearOutput();
  }

  function renameDevice() {
    var name = prompt('重命名设备：', curDev().name);
    if (name === null) return;
    curDev().name = name.trim() || curDev().name;
    renderDeviceList();
    renderEditorTitle();
  }

  function removeDevice() {
    if (project.devices.length <= 1) { alert('至少保留一个设备'); return; }
    if (!confirm('确定删除设备「' + curDev().name + '」？')) return;
    project.devices.splice(curDevice, 1);
    if (curDevice >= project.devices.length) curDevice = project.devices.length - 1;
    renderDeviceList();
    renderEditor();
    clearOutput();
  }

  /* ---------- stack 标签页 ---------- */
  function renderStackTabs() {
    var tabs = document.querySelectorAll('.stack-tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle('active', t.getAttribute('data-stack') === curStack);
    });
  }

  function switchStack(stack) {
    if (stack === curStack) return;
    syncFromUI();
    curStack = stack;
    renderStackTabs();
    renderEditor();
    clearOutput();
  }

  /* ---------- 编辑区渲染 ---------- */
  function renderEditorTitle() {
    $('editor-title').textContent = '设备配置 — ' + curDev().name;
  }

  function renderEditor() {
    renderEditorTitle();
    $('override-toggle').checked = !!curStackData().templateOverride;
    renderWhitelistSections();
    $('extra-rules').value = (curStackData().extraRules || []).join('\n');
    renderToggles();
  }

  function renderWhitelistSections() {
    var container = $('whitelist-container');
    container.innerHTML = '';
    var sd = curStackData();
    var tpl = effTemplate();
    var disabledMap = sd.whitelistEnabled || {};
    tpl.whitelistDefs.forEach(function (def) {
      var enabled = disabledMap[def.id] !== false;
      var ips = (sd.whitelists && sd.whitelists[def.id]) || [];
      var cb = el('input', { type: 'checkbox', checked: enabled });
      cb.id = 'wlen-' + def.id;
      var ta = el('textarea', { class: 'code-area wl-area', value: ips.join('\n') });
      ta.id = 'wl-' + def.id;
      ta.placeholder = '留空 = 对所有源开放';
      var section = el('div', { class: 'wl-section' }, [
        el('div', { class: 'wl-head' }, [
          el('label', { class: 'chk' }, [cb, el('span', { class: 'wl-name', text: def.name })]),
          el('span', { class: 'wl-hint', text: '共 ' + def.lines.length + ' 条规则模板' })
        ]),
        ta
      ]);
      container.appendChild(section);
    });
  }

  function renderToggles() {
    var sd = curStackData();
    var tpl = effTemplate();
    var disabled = {};
    (sd.disabledPrefixIds || []).forEach(function (id) { disabled[id] = true; });

    buildToggleList($('prefix-toggles'), tpl.prefixRules, disabled);
    buildToggleList($('suffix-toggles'), tpl.suffixRules, disabled);
  }

  function buildToggleList(container, rules, disabled) {
    container.innerHTML = '';
    if (!rules.length) {
      container.appendChild(el('div', { class: 'muted', text: '（无规则）' }));
      return;
    }
    rules.forEach(function (r) {
      var cb = el('input', { type: 'checkbox', checked: r.enabled !== false && !disabled[r.id] });
      cb.id = 'tg-' + r.id;
      container.appendChild(el('label', { class: 'chk toggle-item' }, [
        cb, el('span', { class: 'tg-text', text: r.text })
      ]));
    });
  }

  /* ---------- UI → 数据 ---------- */
  function syncFromUI() {
    if (!project) return;
    project.projectName = $('project-name').value.trim() || '新项目';
    var sd = curStackData();
    var tpl = effTemplate();

    // 白名单
    tpl.whitelistDefs.forEach(function (def) {
      var ta = $('wl-' + def.id);
      var cb = $('wlen-' + def.id);
      if (ta) {
        sd.whitelists[def.id] = cleanLines(ta.value);
      }
      if (cb) {
        sd.whitelistEnabled[def.id] = cb.checked;
      }
    });

    // 自定义规则
    sd.extraRules = cleanLines($('extra-rules').value);

    // 固定策略开关
    var disabledIds = [];
    tpl.prefixRules.concat(tpl.suffixRules).forEach(function (r) {
      var cb = $('tg-' + r.id);
      if (cb && !cb.checked) disabledIds.push(r.id);
    });
    sd.disabledPrefixIds = disabledIds;
  }

  function toggleOverride() {
    syncFromUI();
    var sd = curStackData();
    if ($('override-toggle').checked) {
      sd.templateOverride = T.clone(project.templates[curStack]);
    } else {
      sd.templateOverride = null;
    }
    renderEditor();
    clearOutput();
  }

  /* ---------- 生成 + 校验 ---------- */
  function generate() {
    syncFromUI();
    var sd = curStackData();
    var tpl = effTemplate();
    var family = T.familyOf(curStack);
    var lines = IptablesGen.generateStack(sd, tpl, curStack);
    var text = IptablesGen.linesToText(lines);
    $('output-area').value = text;
    $('out-stack-label').textContent = ' — ' + curDev().name + ' / ' + (curStack === 'v6' ? 'IPv6' : 'IPv4');
    $('stat-badge').textContent = lines.length + ' 条规则';

    // 校验：白名单 IP + 生成文本结构
    var issues = [];
    tpl.whitelistDefs.forEach(function (def) {
      if (sd.whitelistEnabled[def.id] === false) return;
      var ipIssues = IptablesValidate.validateIpList(sd.whitelists[def.id] || [], family, def.name);
      ipIssues.forEach(function (it) {
        issues.push({ level: 'error', msg: it.error + '（第 ' + it.line + ' 行：' + it.text + '）' });
      });
    });
    var struct = IptablesValidate.validateRulesText(text, family);
    issues = issues.concat(struct.issues);
    renderValidate(issues);
  }

  function renderValidate(issues) {
    var box = $('validate-box');
    box.innerHTML = '';
    var errs = issues.filter(function (i) { return i.level === 'error'; });
    var warns = issues.filter(function (i) { return i.level === 'warn'; });
    box.className = 'validate-box visible ' + (errs.length ? 'has-error' : (warns.length ? 'has-warn' : 'ok'));

    if (!errs.length && !warns.length) {
      box.appendChild(el('div', { class: 'v-line v-ok', text: '✓ 校验通过，未发现问题' }));
      return;
    }
    box.appendChild(el('div', { class: 'v-summary', text: '校验：' + errs.length + ' 个错误，' + warns.length + ' 个告警' }));
    errs.concat(warns).forEach(function (i) {
      box.appendChild(el('div', {
        class: 'v-line ' + (i.level === 'error' ? 'v-err' : 'v-warn'),
        text: (i.level === 'error' ? '✗ ' : '⚠ ') + i.msg
      }));
    });
  }

  function clearOutput() {
    $('output-area').value = '';
    $('out-stack-label').textContent = '';
    $('stat-badge').textContent = '—';
    var box = $('validate-box');
    box.innerHTML = '';
    box.className = 'validate-box';
  }

  function copyOutput() {
    var text = $('output-area').value;
    if (!text) { alert('请先生成规则'); return; }
    BocUtils.copyText(text, '规则已复制到剪贴板！');
  }

  function exportSh() {
    var text = $('output-area').value;
    if (!text) { alert('请先生成规则'); return; }
    var name = sanitize(project.projectName) + '-' + sanitize(curDev().name) + '-' + curStack + '.sh';
    var content = '#!/bin/sh\n' + text + '\n';
    BocUtils.downloadBlob(new TextEncoder().encode(content), name, 'application/x-sh');
  }

  function sanitize(s) { return String(s || '').replace(/[\\/:*?"<>|\s]/g, '_'); }

  /* ---------- 文件 ---------- */
  function newProject() {
    if (!confirm('新建将清空当前项目（未保存的修改会丢失），确定？')) return;
    project = IptablesStore.newProject();
    curDevice = 0;
    curStack = 'v4';
    renderAll();
  }

  function openFilePicker() { $('file-input').click(); }

  function onFileChosen(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    IptablesStore.openFile(file, function (err, proj) {
      e.target.value = '';
      if (err) { alert('打开失败：' + err.message); return; }
      project = proj;
      curDevice = 0;
      curStack = 'v4';
      renderAll();
    });
  }

  function saveFile() {
    syncFromUI();
    IptablesStore.saveToFile(project);
  }

  function upgradeTemplates() {
    if (!confirm('将项目默认模板重置为最新内置版本？设备的白名单数据与设备级独立模板将保留。')) return;
    syncFromUI();
    IptablesStore.upgradeTemplates(project);
    renderAll();
  }

  /* ---------- 导入 ---------- */
  function openImport() {
    $('import-text').value = '';
    $('import-result').textContent = '';
    $('import-replace').checked = false;
    $('import-stack').value = curStack;
    $('import-modal').style.display = 'flex';
  }
  function closeImport() { $('import-modal').style.display = 'none'; }

  function doImport() {
    syncFromUI();
    var text = $('import-text').value;
    if (!text.trim()) { alert('请粘贴规则文本'); return; }
    var defaultStack = $('import-stack').value === 'v6' ? 'v6' : 'v4';
    var replace = $('import-replace').checked;
    var res = IptablesParse.parseRules(text, defaultStack);
    var dev = curDev();

    ['v4', 'v6'].forEach(function (stack) {
      var src = res.byStack[stack];
      var dst = dev[stack];
      if (replace) {
        dst.whitelists = { dns: [], internal: [], snmp: [], mgmt: [] };
        dst.extraRules = [];
      }
      T.WHITELIST_IDS.forEach(function (id) {
        if (!dst.whitelists[id]) dst.whitelists[id] = [];
        src.whitelists[id].forEach(function (ip) {
          if (dst.whitelists[id].indexOf(ip) === -1) dst.whitelists[id].push(ip);
        });
        if (src.whitelistTouched[id]) dst.whitelistEnabled[id] = true;
      });
      src.extraRules.forEach(function (r) {
        if (dst.extraRules.indexOf(r) === -1) dst.extraRules.push(r);
      });
    });

    var s = res.stats;
    $('import-result').textContent =
      '识别完成：白名单 ' + s.whitelist + ' 条，固定策略 ' + s.known + ' 条（跳过），自定义 ' + s.extra + ' 条。';
    renderEditor();
    clearOutput();
  }

  /* ---------- 模板编辑 ---------- */
  function openTemplate() {
    syncFromUI();
    if (curStackData().templateOverride) {
      tplTarget = 'device';
      tplDraft = T.clone(curStackData().templateOverride);
      $('tpl-target').textContent = '（本设备独立模板 · ' + (curStack === 'v6' ? 'IPv6' : 'IPv4') + '）';
    } else {
      tplTarget = 'project';
      tplDraft = T.clone(project.templates[curStack]);
      $('tpl-target').textContent = '（项目默认模板 · ' + (curStack === 'v6' ? 'IPv6' : 'IPv4') + '）';
    }
    renderTemplateModal();
    $('template-modal').style.display = 'flex';
  }
  function closeTemplate() { $('template-modal').style.display = 'none'; }

  function renderTemplateModal() {
    renderTplRuleList('tpl-prefix-list', tplDraft.prefixRules, 'prefix');
    renderTplRuleList('tpl-suffix-list', tplDraft.suffixRules, 'suffix');
    renderTplWhitelist();
  }

  function renderTplRuleList(containerId, rules, kind) {
    var c = $(containerId);
    c.innerHTML = '';
    rules.forEach(function (r, idx) {
      var en = el('input', { type: 'checkbox', checked: r.enabled !== false });
      en.className = 'tpl-en';
      var txt = el('input', { type: 'text', class: 'tpl-text', value: r.text });
      var del = el('button', {
        class: 'btn btn-danger btn-sm',
        text: '删除',
        onclick: function () { tplRemoveRule(kind, idx); }
      });
      c.appendChild(el('div', { class: 'tpl-row' }, [en, txt, del]));
    });
  }

  function renderTplWhitelist() {
    var c = $('tpl-wl-list');
    c.innerHTML = '';
    tplDraft.whitelistDefs.forEach(function (d, idx) {
      var name = el('input', { type: 'text', class: 'tpl-wl-name', value: d.name });
      name.placeholder = '类型名称';
      var lines = el('textarea', { class: 'code-area tpl-wl-lines', value: d.lines.join('\n') });
      lines.placeholder = '-A INPUT{src} -p udp --dport 53 -j ACCEPT -m comment --comment "..."';
      var del = el('button', {
        class: 'btn btn-danger btn-sm',
        text: '删除类型',
        onclick: function () { tplRemoveWhitelist(idx); }
      });
      c.appendChild(el('div', { class: 'tpl-wl' }, [
        el('div', { class: 'tpl-wl-head' }, [name, del]),
        lines
      ]));
    });
  }

  function tplReadDOM() {
    tplDraft.prefixRules = readRuleList('tpl-prefix-list', tplDraft.prefixRules, 'p');
    tplDraft.suffixRules = readRuleList('tpl-suffix-list', tplDraft.suffixRules, 's');
    tplDraft.whitelistDefs = readWhitelist();
  }

  function readRuleList(containerId, oldArr, idPrefix) {
    var rows = $(containerId).querySelectorAll('.tpl-row');
    var out = [];
    Array.prototype.forEach.call(rows, function (row, i) {
      var text = row.querySelector('.tpl-text').value.trim();
      var en = row.querySelector('.tpl-en').checked;
      if (!text) return;
      var id = (oldArr[i] && oldArr[i].id) || T.genId(idPrefix);
      out.push({ id: id, enabled: en, text: text });
    });
    return out;
  }

  function readWhitelist() {
    var rows = $('tpl-wl-list').querySelectorAll('.tpl-wl');
    var out = [];
    Array.prototype.forEach.call(rows, function (row, i) {
      var name = row.querySelector('.tpl-wl-name').value.trim();
      var lines = cleanLines(row.querySelector('.tpl-wl-lines').value);
      if (!name && !lines.length) return;
      var old = tplDraft.whitelistDefs[i];
      out.push({ id: (old && old.id) || T.genId('w'), name: name || ('whitelist' + (i + 1)), lines: lines });
    });
    return out;
  }

  function tplAddRule(kind) {
    tplReadDOM();
    var arr = kind === 'prefix' ? tplDraft.prefixRules : tplDraft.suffixRules;
    arr.push({ id: T.genId(kind === 'prefix' ? 'p' : 's'), enabled: true, text: '-A INPUT  -j ACCEPT -m comment --comment "new rule"' });
    renderTemplateModal();
  }
  function tplRemoveRule(kind, idx) {
    tplReadDOM();
    var arr = kind === 'prefix' ? tplDraft.prefixRules : tplDraft.suffixRules;
    arr.splice(idx, 1);
    renderTemplateModal();
  }
  function tplAddWhitelist() {
    tplReadDOM();
    tplDraft.whitelistDefs.push({
      id: T.genId('w'),
      name: '新白名单',
      lines: ['-A INPUT{src} -j ACCEPT -m comment --comment "new whitelist"']
    });
    renderTemplateModal();
  }
  function tplRemoveWhitelist(idx) {
    tplReadDOM();
    tplDraft.whitelistDefs.splice(idx, 1);
    renderTemplateModal();
  }
  function tplRestoreDefaults() {
    if (!confirm('恢复为内置默认模板？当前模板编辑内容将丢失。')) return;
    tplDraft = T.defaultTemplate(curStack);
    renderTemplateModal();
  }

  function tplSave() {
    tplReadDOM();
    if (tplTarget === 'device') {
      curStackData().templateOverride = tplDraft;
    } else {
      project.templates[curStack] = tplDraft;
    }
    closeTemplate();
    renderEditor();
    clearOutput();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    addDevice: addDevice,
    renameDevice: renameDevice,
    removeDevice: removeDevice,
    switchStack: switchStack,
    toggleOverride: toggleOverride,
    generate: generate,
    copyOutput: copyOutput,
    exportSh: exportSh,
    newProject: newProject,
    openFilePicker: openFilePicker,
    saveFile: saveFile,
    upgradeTemplates: upgradeTemplates,
    openImport: openImport,
    closeImport: closeImport,
    doImport: doImport,
    openTemplate: openTemplate,
    closeTemplate: closeTemplate,
    tplAddRule: tplAddRule,
    tplRemoveRule: tplRemoveRule,
    tplAddWhitelist: tplAddWhitelist,
    tplRemoveWhitelist: tplRemoveWhitelist,
    tplRestoreDefaults: tplRestoreDefaults,
    tplSave: tplSave
  };
})();
