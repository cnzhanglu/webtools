/**
 * GSLB JSON 导出 — 域名 / 地址池 / 服务成员 引用关系图（纯 SVG）
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
    if (edge.params.port !== undefined && edge.params.port !== '') return 'port:' + edge.params.port;
    if (edge.params.pool_enable !== undefined && edge.params.pool_enable !== '') return '启用:' + edge.params.pool_enable;
    return '';
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
    var html = '<div class="graph-detail-title">' + escText(typeName) + '：' + escText(node.name) + '</div><dl class="graph-detail-list">';
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

    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      var next = panZoom.scale * delta;
      if (next < 0.5) next = 0.5;
      if (next > 2) next = 2;
      panZoom.scale = next;
      updateTransform();
    }, { passive: false });
  }

  function renderSvg(layout) {
    var wrap = document.getElementById('graph-svg-wrap');
    if (!wrap) return;

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
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);

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
      g.setAttribute('class', 'graph-edge');
      g.setAttribute('data-from', edge.from);
      g.setAttribute('data-to', edge.to);

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
      g.setAttribute('class', 'graph-node');
      g.setAttribute('data-id', node.id);
      g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');

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

      if (node.type === 'domain') {
        params = pickDisplayParams(node.params, ['type', 'enable', 'status']);
      } else if (node.type === 'pool') {
        params = pickDisplayParams(node.params, ['type', 'enable', 'ttl']);
      } else {
        params = pickDisplayParams(node.params, ['ip', 'port', 'enable']);
      }

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
    updateTransform();
    applyHighlight();
  }

  function render(topology, filterState) {
    currentTopology = topology;
    if (!topology) {
      var wrap = document.getElementById('graph-svg-wrap');
      if (wrap) wrap.innerHTML = '<div class="graph-empty">导入 JSON 并点击「预览」查看关系图</div>';
      renderDetail(null);
      return;
    }

    var filtered = filterTopology(topology, filterState || {});
    var layout = computeLayout(filtered);
    renderSvg(layout);

    var badge = document.getElementById('graph-badge');
    if (badge) {
      var total = topology.domains.length + topology.pools.length + topology.members.length;
      var shown = filtered.domains.length + filtered.pools.length + filtered.members.length;
      if (filterState && filterState.query) {
        badge.textContent = '显示 ' + shown + ' / 共 ' + total + ' 节点';
      } else {
        badge.textContent = '共 ' + total + ' 节点 · ' + topology.edges.length + ' 条引用';
      }
    }
  }

  function resetView() {
    panZoom = { x: 0, y: 0, scale: 1 };
    updateTransform();
  }

  return {
    render: render,
    resetView: resetView,
    filterTopology: filterTopology
  };
})();
