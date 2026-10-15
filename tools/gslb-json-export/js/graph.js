/**
 * GSLB JSON 导出 — 域名 / 地址池 / 服务成员 引用关系图
 *
 * 数据流：buildTopology 的 domains/pools/members/edges
 * → 转成 vis.Network 节点（level 固定三列）与边
 * → 分层布局从左到右绘制；点击节点仍用右侧详情面板展示完整参数。
 *
 * 禁用判定、池顺序和成员 seq 留在 process.js，这里只负责画布。
 * 平移、缩放、悬停由 vis-network 提供；缩放按钮调用 getScale / fit。
 *
 * 依赖：vis（shared/vendor/vis-network）、GslbFields.keyToCn
 * 导出：GslbGraph（render / resetView / zoomIn / zoomOut）
 */
var GslbGraph = (function () {
  'use strict';

  var ZOOM_STEP = 1.2;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 2;

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

  var network = null;
  var nodeById = {};
  var wheelBound = false;

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

  function nodeLevel(type) {
    if (type === 'domain') return 0;
    if (type === 'pool') return 1;
    return 2;
  }

  function nodeLabel(node) {
    var lines = [node.name || ''];
    var params = pickNodeDisplayLines(node);
    var i, line;
    for (i = 0; i < params.length && i < 3; i++) {
      line = params[i].label + ': ' + params[i].value;
      if (line.length > 28) line = line.slice(0, 27) + '…';
      lines.push(line);
    }
    return lines.join('\n');
  }

  function nodeColor(type, disabled) {
    var colors = COLORS[type] || COLORS.member;
    var fill = disabled ? '#f1f5f9' : colors.fill;
    var border = disabled ? '#dc2626' : colors.stroke;
    return {
      background: fill,
      border: border,
      highlight: { background: fill, border: border },
      hover: { background: fill, border: border }
    };
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

  function destroyNetwork() {
    if (network) {
      network.destroy();
      network = null;
    }
  }

  function showEmpty(wrap, message) {
    destroyNetwork();
    nodeById = {};
    wrap.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'graph-empty';
    empty.textContent = message;
    wrap.appendChild(empty);
    renderDetail(null);
  }

  function bindWheelGuard() {
    if (wheelBound) return;
    var overlay = document.getElementById('graph-overlay');
    if (!overlay) return;
    wheelBound = true;
    // 绘图区滚轮交给 vis 缩放；详情栏仍可滚动。吞掉事件避免背后预览表跟着滚。
    overlay.addEventListener('wheel', function (e) {
      if (e.target.closest && e.target.closest('.graph-detail')) return;
      e.preventDefault();
    }, { passive: false });
  }

  function toVisNode(item, type) {
    var node = {
      id: item.id,
      type: type,
      name: item.name || item.label || '',
      params: item.params || {},
      disabled: !!item.disabled,
      disabledReasons: (item.disabledReasons || []).slice()
    };
    nodeById[item.id] = node;
    var visNode = {
      id: item.id,
      label: nodeLabel(node),
      level: nodeLevel(type),
      shape: 'box',
      margin: 10,
      borderWidth: 2,
      borderWidthSelected: 3,
      widthConstraint: { maximum: 220 },
      color: nodeColor(type, node.disabled),
      font: {
        color: node.disabled ? '#64748b' : (COLORS[type] || COLORS.member).text,
        face: 'PingFang SC, Microsoft YaHei, sans-serif',
        size: 13,
        align: 'left'
      },
      shapeProperties: { borderDashes: node.disabled ? [7, 5] : false },
      title: node.disabled
        ? node.name + '（禁用：' + node.disabledReasons.join('；') + '）'
        : node.name + '（启用）'
    };
    return visNode;
  }

  function toVisEdge(edge, index) {
    var label = edgeLabel(edge);
    var visEdge = {
      id: edge.from + '\0' + edge.to + '\0' + index,
      from: edge.from,
      to: edge.to,
      arrows: 'to',
      color: { color: edge.disabled ? '#dc2626' : '#94a3b8', highlight: edge.disabled ? '#dc2626' : '#2563a8' },
      width: edge.disabled ? 2 : 1.5,
      dashes: edge.disabled ? [7, 5] : false,
      smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.4 },
      font: {
        size: 11,
        color: edge.disabled ? '#b91c1c' : '#64748b',
        strokeWidth: 3,
        strokeColor: '#f8fafc',
        align: 'middle'
      }
    };
    if (label) visEdge.label = label;
    if (edge.disabled && edge.disabledReasons && edge.disabledReasons.length) {
      visEdge.title = '禁用：' + edge.disabledReasons.join('；');
    }
    return visEdge;
  }

  function mountNetwork(wrap, nodes, edges) {
    destroyNetwork();
    wrap.innerHTML = '';
    var host = document.createElement('div');
    host.className = 'graph-network';
    wrap.appendChild(host);

    network = new vis.Network(host, { nodes: nodes, edges: edges }, {
      autoResize: true,
      layout: {
        hierarchical: {
          enabled: true,
          direction: 'LR',
          sortMethod: 'directed',
          levelSeparation: 280,
          nodeSpacing: 36,
          treeSpacing: 48,
          blockShifting: true,
          edgeMinimization: true,
          parentCentralization: true
        }
      },
      physics: false,
      interaction: {
        hover: true,
        hoverConnectedEdges: true,
        tooltipDelay: 200,
        navigationButtons: false,
        keyboard: false,
        zoomView: true,
        dragView: true,
        multiselect: false
      },
      nodes: { shape: 'box' },
      edges: { arrows: { to: { enabled: true, scaleFactor: 0.6 } } }
    });

    network.on('click', function (params) {
      var id = params.nodes && params.nodes.length ? params.nodes[0] : '';
      renderDetail(id ? nodeById[id] : null);
    });

    network.fit({ animation: false });
    if (!wrap.clientWidth) {
      requestAnimationFrame(function () {
        if (network) network.fit({ animation: false });
      });
    }
  }

  function setBadge(text) {
    var badge = document.getElementById('graph-badge');
    if (badge) badge.textContent = text;
  }

  /**
   * 渲染拓扑图。
   * @param {object} topology     buildTopology 返回的拓扑数据
   * @param {object} filterState  保留参数，调用方传入 null
   * @param {string} displayLabel 展示标签，由 app.js 拼接为 "name (type)" 传入
   */
  function render(topology, filterState, displayLabel) {
    var wrap = document.getElementById('graph-svg-wrap');
    if (!wrap) return;
    bindWheelGuard();

    if (!topology || !displayLabel) {
      showEmpty(wrap, '双击表格行或点击「查看关系图」打开引用拓扑');
      setBadge('—');
      return;
    }

    if (!topology.domains.length) {
      showEmpty(wrap, '域名「' + displayLabel + '」无地址池引用或数据不存在');
      setBadge(displayLabel + ' · 无引用');
      return;
    }

    destroyNetwork();
    nodeById = {};
    var nodes = [];
    var edges = [];
    var i;
    for (i = 0; i < topology.domains.length; i++) nodes.push(toVisNode(topology.domains[i], 'domain'));
    for (i = 0; i < topology.pools.length; i++) nodes.push(toVisNode(topology.pools[i], 'pool'));
    for (i = 0; i < topology.members.length; i++) nodes.push(toVisNode(topology.members[i], 'member'));
    for (i = 0; i < topology.edges.length; i++) {
      if (nodeById[topology.edges[i].from] && nodeById[topology.edges[i].to]) {
        edges.push(toVisEdge(topology.edges[i], i));
      }
    }

    mountNetwork(wrap, nodes, edges);
    setBadge(displayLabel + ' · ' + nodes.length + ' 节点 · ' + edges.length + ' 条引用');
  }

  function zoomBy(factor) {
    if (!network) return;
    var next = network.getScale() * factor;
    if (next < ZOOM_MIN) next = ZOOM_MIN;
    if (next > ZOOM_MAX) next = ZOOM_MAX;
    network.moveTo({
      position: network.getViewPosition(),
      scale: next,
      animation: false
    });
  }

  function zoomIn() {
    zoomBy(ZOOM_STEP);
  }

  function zoomOut() {
    zoomBy(1 / ZOOM_STEP);
  }

  function resetView() {
    if (!network) return;
    network.fit({ animation: false });
  }

  return {
    render: render,
    resetView: resetView,
    zoomIn: zoomIn,
    zoomOut: zoomOut
  };
})();
