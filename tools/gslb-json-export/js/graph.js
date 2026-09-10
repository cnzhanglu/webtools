/**
 * GSLB JSON 导出 — 域名 / 地址池 / 服务成员 引用关系图（纯 SVG）
 *
 * 将 buildTopology 返回的 nodes/edges 做三列布局（域 | 池 | 成员），
 * 支持禁用节点/路径、拖拽平移、按钮缩放（滚轮不缩放、也不滚动背后页面）、
 * 画布铺满弹窗可用区域；节点高亮与点击选中；不依赖外部图形库。
 *
 * 依赖：由 app.js 传入 topology 数据
 * 导出：GslbGraph（render / resetView / zoomIn / zoomOut / filterTopology）
 */
var GslbGraph = (function () {
  'use strict';

  var NODE_W = 200;
  var NODE_H = 72;
  var COL_GAP = 180;
  var ROW_GAP = 16;
  var PAD = 40;

  var COLORS = {
    domain: { fill: '#eff6ff', stroke: '#2563a8', text: '#1e3a5f' },
    pool: { fill: '#f0fdf4', stroke: '#16a34a', text: '#14532d' },
    member: { fill: '#f5f3ff', stroke: '#7c3aed', text: '#4c1d95' }
  };

  var KEY_LABELS = {
    type: '类型',
    enable: '启用',
    algorithm: '算法',
    status: '状态',
    ttl: 'TTL',
    first_algorithm: '主算法',
    second_algorithm: '备算法',
    pass: '健康有效性',
    hms: '健康检查',
    ratio: '权重',
    seq: '序号',
    ip: 'IP',
    port: '端口',
    dc_name: '数据中心',
    pool_enable: '池成员启用',
    dc_hms: '成员健康检查',
    dc_pass: '成员健康有效性',
    fail_policy: '失败策略',
    persist_enable: '会话保持',
    persist_time: '保持时长',
    warning: '忽略健康检测',
    link_status: '链路状态'
  };

  var currentTopology = null;
  var layoutNodes = [];
  var layoutEdges = [];
  var panZoom = { x: 0, y: 0, scale: 1 };
  var isPanning = false;
  var panStart = { x: 0, y: 0 };
  var highlightedIds = null;
  var selectedId = null;
  var bound = false;
  var lastLayout = null;

  function escText(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function nodeType(id) {
    if (id.indexOf('domain:') === 0) return 'domain';
    if (id.indexOf('pool:') === 0) return 'pool';
    return 'member';
  }

  function labelForKey(k) {
    return KEY_LABELS[k] || GslbFields.keyToCn(k) || k;
  }

  function pickDisplayParams(params, keys) {
    var out = [];
    var i, k, v;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        out.push({ key: k, label: labelForKey(k), value: String(params[k]) });
      }
    }
    return out;
  }

  function pickNodeDisplayLines(node) {
    if (node.type === 'domain') {
      return pickDisplayParams(node.params, ['algorithm', 'enable', 'status']);
    }
    if (node.type === 'pool') {
      return pickDisplayParams(node.params, ['first_algorithm', 'second_algorithm', 'enable']);
    }
    return pickDisplayParams(node.params, ['ip', 'port', 'enable']);
  }

  function nodeMatchesQuery(node, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    var title = (node.name || node.label || '').toLowerCase();
    if (title.indexOf(q) !== -1) return true;
    var k, v;
    for (k in node.params) {
      if (!Object.prototype.hasOwnProperty.call(node.params, k)) continue;
      v = node.params[k];
      if (v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function filterTopology(topology, filterState) {
    var query = (filterState && filterState.query) ? filterState.query.trim() : '';
    var scope = (filterState && filterState.scope) ? filterState.scope : 'all';
    if (!query) {
      return {
        domains: topology.domains.slice(),
        pools: topology.pools.slice(),
        members: topology.members.slice(),
        edges: topology.edges.slice()
      };
    }

    var matchedIds = {};
    var lists = [
      { key: 'domain', items: topology.domains },
      { key: 'pool', items: topology.pools },
      { key: 'member', items: topology.members }
    ];
    var i, j, item, typeKey, e, changed;

    for (i = 0; i < lists.length; i++) {
      typeKey = lists[i].key;
      if (scope !== 'all' && scope !== typeKey) continue;
      for (j = 0; j < lists[i].items.length; j++) {
        item = lists[i].items[j];
        if (nodeMatchesQuery(item, query)) matchedIds[item.id] = true;
      }
    }

    changed = true;
    while (changed) {
      changed = false;
      for (i = 0; i < topology.edges.length; i++) {
        e = topology.edges[i];
        if (matchedIds[e.from] && !matchedIds[e.to]) {
          matchedIds[e.to] = true;
          changed = true;
        }
        if (matchedIds[e.to] && !matchedIds[e.from]) {
          matchedIds[e.from] = true;
          changed = true;
        }
      }
    }

    function pick(list) {
      var out = [];
      for (i = 0; i < list.length; i++) {
        if (matchedIds[list[i].id]) out.push(list[i]);
      }
      return out;
    }

    var domains = pick(topology.domains);
    var pools = pick(topology.pools);
    var members = pick(topology.members);
    var idSet = {};
    for (i = 0; i < domains.length; i++) idSet[domains[i].id] = true;
    for (i = 0; i < pools.length; i++) idSet[pools[i].id] = true;
    for (i = 0; i < members.length; i++) idSet[members[i].id] = true;

    var edges = [];
    for (i = 0; i < topology.edges.length; i++) {
      e = topology.edges[i];
      if (idSet[e.from] && idSet[e.to]) edges.push(e);
    }

    return { domains: domains, pools: pools, members: members, edges: edges };
  }

  function computeLayout(filtered) {
    var cols = [
      { type: 'domain', items: filtered.domains },
      { type: 'pool', items: filtered.pools },
      { type: 'member', items: filtered.members }
    ];
    var nodes = [];
    var nodeIndex = {};
    var c, i, item, x, y, maxRows;

    maxRows = 0;
    for (c = 0; c < cols.length; c++) {
      if (cols[c].items.length > maxRows) maxRows = cols[c].items.length;
    }

    for (c = 0; c < cols.length; c++) {
      x = PAD + c * (NODE_W + COL_GAP);
      var colHeight = cols[c].items.length * NODE_H + Math.max(0, cols[c].items.length - 1) * ROW_GAP;
      var offsetY = PAD + Math.max(0, (maxRows * (NODE_H + ROW_GAP) - ROW_GAP - colHeight) / 2);

      for (i = 0; i < cols[c].items.length; i++) {
        item = cols[c].items[i];
        y = offsetY + i * (NODE_H + ROW_GAP);
        var ln = {
          id: item.id,
          type: cols[c].type,
          name: item.name || item.label || '',
          params: item.params || {},
          disabled: !!item.disabled,
          disabledReasons: (item.disabledReasons || []).slice(),
          x: x,
          y: y,
          w: NODE_W,
          h: NODE_H
        };
        nodes.push(ln);
        nodeIndex[item.id] = ln;
      }
    }

    var edges = [];
    for (i = 0; i < filtered.edges.length; i++) {
      var e = filtered.edges[i];
      if (nodeIndex[e.from] && nodeIndex[e.to]) {
        edges.push({
          from: e.from,
          to: e.to,
          kind: e.kind,
          params: e.params || {},
          disabled: !!e.disabled,
          disabledReasons: (e.disabledReasons || []).slice(),
          fromNode: nodeIndex[e.from],
          toNode: nodeIndex[e.to]
        });
      }
    }

    var width = PAD * 2 + 3 * NODE_W + 2 * COL_GAP;
    var height = PAD * 2 + Math.max(maxRows, 1) * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP;

    return { nodes: nodes, edges: edges, width: width, height: height, nodeIndex: nodeIndex };
  }

  function edgeLabel(edge) {
    if (edge.kind === 'domain-pool') {
      if (edge.params.ratio !== undefined && edge.params.ratio !== '') return 'ratio:' + edge.params.ratio;
      return '';
    }
    var parts = [];
    if (edge.params.seq !== undefined && edge.params.seq !== '') parts.push('seq:' + edge.params.seq);
    if (edge.params.port !== undefined && edge.params.port !== '') parts.push('port:' + edge.params.port);
    if (edge.params.pool_enable !== undefined && edge.params.pool_enable !== '') {
      parts.push('启用:' + edge.params.pool_enable);
    }
    return parts.join(' ');
  }

  function buildEdgePath(fromNode, toNode) {
    var x1 = fromNode.x + fromNode.w;
    var y1 = fromNode.y + fromNode.h / 2;
    var x2 = toNode.x;
    var y2 = toNode.y + toNode.h / 2;
    var cx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2;
  }

  function getRelatedIds(nodeId) {
    var ids = {};
    ids[nodeId] = true;
    var i, e;
    for (i = 0; i < layoutEdges.length; i++) {
      e = layoutEdges[i];
      if (e.from === nodeId) ids[e.to] = true;
      if (e.to === nodeId) ids[e.from] = true;
    }
    return ids;
  }

  function renderDetail(node) {
    var panel = document.getElementById('graph-detail');
    if (!panel) return;
    if (!node) {
      panel.innerHTML = '<div class="graph-detail-empty">点击节点查看完整参数</div>';
      return;
    }

    var typeName = node.type === 'domain' ? '域名' : (node.type === 'pool' ? '地址池' : '服务成员');
    var html = '<div class="graph-detail-title">' + escText(typeName) + '：' + escText(node.name) + '</div>';
    if (node.disabled) {
      html += '<div class="graph-detail-status disabled">禁用</div>'
        + '<div class="graph-detail-reason">' + escText((node.disabledReasons || []).join('；')) + '</div>';
    } else {
      html += '<div class="graph-detail-status enabled">启用</div>';
    }
    html += '<dl class="graph-detail-list">';
    var k, v;
    for (k in node.params) {
      if (!Object.prototype.hasOwnProperty.call(node.params, k)) continue;
      v = node.params[k];
      if (v === null || v === undefined || v === '') continue;
      html += '<dt>' + escText(labelForKey(k)) + '</dt><dd>' + escText(String(v)) + '</dd>';
    }
    html += '</dl>';
    panel.innerHTML = html;
  }

  function applyHighlight() {
    var svg = document.getElementById('graph-svg');
    if (!svg) return;
    var nodeEls = svg.querySelectorAll('.graph-node');
    var edgeEls = svg.querySelectorAll('.graph-edge');
    var i, id;

    for (i = 0; i < nodeEls.length; i++) {
      id = nodeEls[i].getAttribute('data-id');
      if (!highlightedIds) {
        nodeEls[i].classList.remove('dimmed', 'highlight');
        if (selectedId === id) nodeEls[i].classList.add('selected');
        else nodeEls[i].classList.remove('selected');
      } else if (highlightedIds[id]) {
        nodeEls[i].classList.add('highlight');
        nodeEls[i].classList.remove('dimmed');
      } else {
        nodeEls[i].classList.add('dimmed');
        nodeEls[i].classList.remove('highlight');
      }
    }

    for (i = 0; i < edgeEls.length; i++) {
      if (!highlightedIds) {
        edgeEls[i].classList.remove('dimmed', 'highlight');
      } else {
        var from = edgeEls[i].getAttribute('data-from');
        var to = edgeEls[i].getAttribute('data-to');
        if (highlightedIds[from] && highlightedIds[to]) {
          edgeEls[i].classList.add('highlight');
          edgeEls[i].classList.remove('dimmed');
        } else {
          edgeEls[i].classList.add('dimmed');
          edgeEls[i].classList.remove('highlight');
        }
      }
    }
  }

  function wrapSize() {
    var wrap = document.getElementById('graph-svg-wrap');
    return {
      w: wrap ? wrap.clientWidth : 0,
      h: wrap ? wrap.clientHeight : 0
    };
  }

  /** SVG 画布与容器同尺寸，平移/缩放才不会被内容包围盒裁切。 */
  function sizeSvgToWrap(svg) {
    var size = wrapSize();
    var w = Math.max(size.w, 1);
    var h = Math.max(size.h, 1);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  }

  /** 将拓扑居中放到可视区；超出部分靠拖拽查看。 */
  function centerGraph(layout) {
    var size = wrapSize();
    if (!layout || !size.w || !size.h) {
      panZoom.x = 0;
      panZoom.y = 0;
      return;
    }
    panZoom.x = Math.round((size.w - layout.width * panZoom.scale) / 2);
    panZoom.y = Math.round((size.h - layout.height * panZoom.scale) / 2);
  }

  function updateTransform() {
    var g = document.getElementById('graph-root');
    if (g) {
      g.setAttribute('transform', 'translate(' + panZoom.x + ',' + panZoom.y + ') scale(' + panZoom.scale + ')');
    }
  }

  function bindPanZoom() {
    if (bound) return;
    bound = true;

    var wrap = document.getElementById('graph-svg-wrap');
    var overlay = document.getElementById('graph-overlay');
    if (!wrap) return;

    wrap.addEventListener('mousedown', function (e) {
      if (e.target.closest('.graph-node')) return;
      isPanning = true;
      panStart = { x: e.clientX - panZoom.x, y: e.clientY - panZoom.y };
      wrap.classList.add('panning');
    });

    document.addEventListener('mousemove', function (e) {
      if (!isPanning) return;
      panZoom.x = e.clientX - panStart.x;
      panZoom.y = e.clientY - panStart.y;
      updateTransform();
    });

    document.addEventListener('mouseup', function () {
      isPanning = false;
      if (wrap) wrap.classList.remove('panning');
    });

    // 绘图区吞掉滚轮，避免背后预览表跟着滚；右侧详情仍可滚动。
    if (overlay) {
      overlay.addEventListener('wheel', function (e) {
        if (e.target.closest && e.target.closest('.graph-detail')) return;
        e.preventDefault();
      }, { passive: false });
    }

    window.addEventListener('resize', function () {
      var svg = document.getElementById('graph-svg');
      if (!svg || !lastLayout) return;
      if (overlay && !overlay.classList.contains('visible')) return;
      sizeSvgToWrap(svg);
    });
  }

  var ZOOM_STEP = 1.2;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 2;

  /** 以可视区中心为锚点缩放，限制在 ZOOM_MIN～ZOOM_MAX */
  function zoomBy(factor) {
    var prev = panZoom.scale;
    var next = prev * factor;
    if (next < ZOOM_MIN) next = ZOOM_MIN;
    if (next > ZOOM_MAX) next = ZOOM_MAX;
    var size = wrapSize();
    var cx = size.w / 2;
    var cy = size.h / 2;
    panZoom.x = cx - (cx - panZoom.x) * (next / prev);
    panZoom.y = cy - (cy - panZoom.y) * (next / prev);
    panZoom.scale = next;
    updateTransform();
  }

  function zoomIn() {
    zoomBy(ZOOM_STEP);
  }

  function zoomOut() {
    zoomBy(1 / ZOOM_STEP);
  }

  function renderSvg(layout) {
    var wrap = document.getElementById('graph-svg-wrap');
    if (!wrap) return;

    lastLayout = layout;
    layoutNodes = layout.nodes;
    layoutEdges = layout.edges;

    if (!layout.nodes.length) {
      wrap.innerHTML = '<div class="graph-empty">无匹配节点，请调整过滤条件</div>';
      renderDetail(null);
      return;
    }

    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.id = 'graph-svg';
    sizeSvgToWrap(svg);

    var root = document.createElementNS(svgNs, 'g');
    root.id = 'graph-root';

    var edgeLayer = document.createElementNS(svgNs, 'g');
    edgeLayer.setAttribute('class', 'graph-edges');
    var nodeLayer = document.createElementNS(svgNs, 'g');
    nodeLayer.setAttribute('class', 'graph-nodes');

    var i, j, edge, path, label, midX, midY, g, rect, title, sub, lines, params;

    for (i = 0; i < layout.edges.length; i++) {
      edge = layout.edges[i];
      g = document.createElementNS(svgNs, 'g');
      g.setAttribute('class', edge.disabled ? 'graph-edge disabled' : 'graph-edge');
      g.setAttribute('data-from', edge.from);
      g.setAttribute('data-to', edge.to);
      if (edge.disabledReasons.length) {
        var edgeTitle = document.createElementNS(svgNs, 'title');
        edgeTitle.textContent = '禁用：' + edge.disabledReasons.join('；');
        g.appendChild(edgeTitle);
      }

      path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', buildEdgePath(edge.fromNode, edge.toNode));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#94a3b8');
      path.setAttribute('stroke-width', '1.5');
      g.appendChild(path);

      label = edgeLabel(edge);
      if (label) {
        midX = (edge.fromNode.x + edge.fromNode.w + edge.toNode.x) / 2;
        midY = (edge.fromNode.y + edge.fromNode.h / 2 + edge.toNode.y + edge.toNode.h / 2) / 2;
        var text = document.createElementNS(svgNs, 'text');
        text.setAttribute('x', midX);
        text.setAttribute('y', midY - 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'graph-edge-label');
        text.textContent = label;
        g.appendChild(text);
      }

      edgeLayer.appendChild(g);
    }

    for (i = 0; i < layout.nodes.length; i++) {
      var node = layout.nodes[i];
      var colors = COLORS[node.type] || COLORS.member;

      g = document.createElementNS(svgNs, 'g');
      g.setAttribute('class', node.disabled ? 'graph-node disabled' : 'graph-node');
      g.setAttribute('data-id', node.id);
      g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');

      var nodeTitle = document.createElementNS(svgNs, 'title');
      nodeTitle.textContent = node.disabled
        ? node.name + '（禁用：' + node.disabledReasons.join('；') + '）'
        : node.name + '（启用）';
      g.appendChild(nodeTitle);

      rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('width', node.w);
      rect.setAttribute('height', node.h);
      rect.setAttribute('rx', '8');
      rect.setAttribute('fill', colors.fill);
      rect.setAttribute('stroke', colors.stroke);
      rect.setAttribute('stroke-width', '2');
      g.appendChild(rect);

      title = document.createElementNS(svgNs, 'text');
      title.setAttribute('x', '10');
      title.setAttribute('y', '22');
      title.setAttribute('class', 'graph-node-title');
      title.setAttribute('fill', colors.text);
      var titleText = node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name;
      title.textContent = titleText;
      g.appendChild(title);

      params = pickNodeDisplayLines(node);

      for (j = 0; j < params.length && j < 3; j++) {
        sub = document.createElementNS(svgNs, 'text');
        sub.setAttribute('x', '10');
        sub.setAttribute('y', String(40 + j * 14));
        sub.setAttribute('class', 'graph-node-sub');
        sub.setAttribute('fill', '#64748b');
        var line = params[j].label + ': ' + params[j].value;
        if (line.length > 28) line = line.slice(0, 27) + '…';
        sub.textContent = line;
        g.appendChild(sub);
      }

      g.addEventListener('mouseenter', function (ev) {
        var nid = ev.currentTarget.getAttribute('data-id');
        highlightedIds = getRelatedIds(nid);
        applyHighlight();
      });
      g.addEventListener('mouseleave', function () {
        highlightedIds = null;
        applyHighlight();
      });
      g.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var nid = ev.currentTarget.getAttribute('data-id');
        selectedId = nid;
        var n = null;
        for (var k = 0; k < layoutNodes.length; k++) {
          if (layoutNodes[k].id === nid) { n = layoutNodes[k]; break; }
        }
        renderDetail(n);
        applyHighlight();
      });

      nodeLayer.appendChild(g);
    }

    root.appendChild(edgeLayer);
    root.appendChild(nodeLayer);
    svg.appendChild(root);

    wrap.innerHTML = '';
    wrap.appendChild(svg);
    bindPanZoom();
    panZoom.scale = 1;
    centerGraph(layout);
    updateTransform();
    applyHighlight();
    if (!wrap.clientWidth) {
      requestAnimationFrame(function () {
        var live = document.getElementById('graph-svg');
        if (!live || !lastLayout) return;
        sizeSvgToWrap(live);
        centerGraph(lastLayout);
        updateTransform();
      });
    }
  }

  /**
   * 渲染拓扑图。
   * @param {object} topology     buildTopology 返回的拓扑数据
   * @param {object} filterState  保留参数（暂未使用）
   * @param {string} displayLabel 展示标签，由 app.js 拼接为 "name (type)" 传入
   */
  function render(topology, filterState, displayLabel) {
    currentTopology = topology;
    var wrap = document.getElementById('graph-svg-wrap');
    if (!wrap) return;

    if (!topology || !displayLabel) {
      lastLayout = null;
      wrap.innerHTML = '<div class="graph-empty">双击表格行或点击「查看关系图」打开引用拓扑</div>';
      renderDetail(null);
      var badgeEmpty = document.getElementById('graph-badge');
      if (badgeEmpty) badgeEmpty.textContent = '—';
      return;
    }

    if (!topology.domains.length) {
      wrap.innerHTML = '<div class="graph-empty">域名「' + escText(displayLabel) + '」无地址池引用或数据不存在</div>';
      renderDetail(null);
      var badgeNone = document.getElementById('graph-badge');
      if (badgeNone) badgeNone.textContent = displayLabel + ' · 无引用';
      return;
    }

    var layout = computeLayout(topology);
    renderSvg(layout);

    var badge = document.getElementById('graph-badge');
    if (badge) {
      var nodeCount = topology.domains.length + topology.pools.length + topology.members.length;
      badge.textContent = displayLabel + ' · ' + nodeCount + ' 节点 · ' + topology.edges.length + ' 条引用';
    }
  }

  function resetView() {
    panZoom.scale = 1;
    centerGraph(lastLayout);
    updateTransform();
  }

  return {
    render: render,
    resetView: resetView,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    filterTopology: filterTopology
  };
})();
