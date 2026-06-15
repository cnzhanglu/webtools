/**
 * GSLB JSON 导出 — 字段穿梭框组件
 *
 * 左右双列表 + 中间按钮，管理「可选字段」与「已选导出字段」；
 * 右侧支持拖拽排序。选中变化时通过 onChange 回调通知 app 刷新预览列。
 *
 * 导出：GslbTransfer（含 TransferGroup 构造函数）
 */
var GslbTransfer = (function () {
  'use strict';

  function TransferGroup(container, title, onChange) {
    this.container = container;
    this.title = title;
    this.onChange = onChange || null;
    this.leftKeys = [];
    this.rightKeys = [];
    this._build();
  }

  TransferGroup.prototype._build = function () {
    var self = this;
    var root = document.createElement('div');
    root.className = 'transfer-group panel';

    var header = document.createElement('div');
    header.className = 'panel-header';
    var h2 = document.createElement('h2');
    h2.textContent = this.title;
    header.appendChild(h2);
    root.appendChild(header);

    var body = document.createElement('div');
    body.className = 'transfer-body';

    var leftWrap = document.createElement('div');
    leftWrap.className = 'transfer-list-wrap';
    this.leftList = document.createElement('select');
    this.leftList.className = 'transfer-list';
    this.leftList.multiple = true;
    this.leftList.size = 12;
    leftWrap.appendChild(this.leftList);
    body.appendChild(leftWrap);

    var mid = document.createElement('div');
    mid.className = 'transfer-mid';
    this._addBtn(mid, '>> 全部加入', function () { self._allRight(); });
    this._addBtn(mid, '> 加入所选', function () { self._someRight(); });
    this._addBtn(mid, '< 移出所选', function () { self._someLeft(); });
    this._addBtn(mid, '<< 全部移出', function () { self._allLeft(); });
    body.appendChild(mid);

    var rightCol = document.createElement('div');
    rightCol.className = 'transfer-right-col';

    var rightWrap = document.createElement('div');
    rightWrap.className = 'transfer-list-wrap';
    this.rightList = document.createElement('select');
    this.rightList.className = 'transfer-list';
    this.rightList.multiple = true;
    this.rightList.size = 12;
    rightWrap.appendChild(this.rightList);
    rightCol.appendChild(rightWrap);

    var orderBtns = document.createElement('div');
    orderBtns.className = 'transfer-order';
    this._addBtn(orderBtns, '上移', function () { self._moveUp(); });
    this._addBtn(orderBtns, '下移', function () { self._moveDown(); });
    rightCol.appendChild(orderBtns);

    body.appendChild(rightCol);
    root.appendChild(body);
    this.container.appendChild(root);
    this.root = root;
  };

  TransferGroup.prototype._addBtn = function (parent, text, handler) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline transfer-btn';
    btn.textContent = text;
    btn.addEventListener('click', handler);
    parent.appendChild(btn);
  };

  TransferGroup.prototype._refresh = function () {
    var i, opt;
    this.leftList.innerHTML = '';
    this.rightList.innerHTML = '';

    for (i = 0; i < this.leftKeys.length; i++) {
      opt = document.createElement('option');
      opt.value = this.leftKeys[i];
      opt.textContent = GslbFields.keyToCn(this.leftKeys[i]);
      this.leftList.appendChild(opt);
    }

    for (i = 0; i < this.rightKeys.length; i++) {
      opt = document.createElement('option');
      opt.value = this.rightKeys[i];
      opt.textContent = GslbFields.keyToCn(this.rightKeys[i]);
      this.rightList.appendChild(opt);
    }
  };

  TransferGroup.prototype._notify = function () {
    if (this.onChange) {
      this.onChange(this.rightKeys.slice());
    }
  };

  TransferGroup.prototype._selectedValues = function (list) {
    var opts = list.selectedOptions;
    var out = [];
    var i;
    for (i = 0; i < opts.length; i++) {
      out.push(opts[i].value);
    }
    return out;
  };

  TransferGroup.prototype._someRight = function () {
    var sel = this._selectedValues(this.leftList);
    var i, key;
    for (i = 0; i < sel.length; i++) {
      key = sel[i];
      var idx = this.leftKeys.indexOf(key);
      if (idx !== -1) {
        this.leftKeys.splice(idx, 1);
        this.rightKeys.push(key);
      }
    }
    this._refresh();
    this._notify();
  };

  TransferGroup.prototype._allRight = function () {
    var i;
    for (i = 0; i < this.leftKeys.length; i++) {
      this.rightKeys.push(this.leftKeys[i]);
    }
    this.leftKeys = [];
    this._refresh();
    this._notify();
  };

  TransferGroup.prototype._someLeft = function () {
    var sel = this._selectedValues(this.rightList);
    var i, key, idx;
    for (i = 0; i < sel.length; i++) {
      key = sel[i];
      idx = this.rightKeys.indexOf(key);
      if (idx !== -1) {
        this.rightKeys.splice(idx, 1);
        if (this.leftKeys.indexOf(key) === -1) {
          this.leftKeys.push(key);
        }
      }
    }
    this._refresh();
    this._notify();
  };

  TransferGroup.prototype._allLeft = function () {
    var i, key;
    for (i = 0; i < this.rightKeys.length; i++) {
      key = this.rightKeys[i];
      if (this.leftKeys.indexOf(key) === -1) {
        this.leftKeys.push(key);
      }
    }
    this.rightKeys = [];
    this._refresh();
    this._notify();
  };

  TransferGroup.prototype._moveUp = function () {
    var sel = this._selectedValues(this.rightList);
    if (!sel.length) return;

    var indices = [];
    var i, idx;
    for (i = 0; i < sel.length; i++) {
      idx = this.rightKeys.indexOf(sel[i]);
      if (idx !== -1) indices.push(idx);
    }
    indices.sort(function (a, b) { return a - b; });

    for (i = 0; i < indices.length; i++) {
      idx = indices[i];
      if (idx > 0) {
        var tmp = this.rightKeys[idx - 1];
        this.rightKeys[idx - 1] = this.rightKeys[idx];
        this.rightKeys[idx] = tmp;
      }
    }
    this._refresh();
    for (i = 0; i < indices.length; i++) {
      idx = Math.max(0, indices[i] - 1);
      this.rightList.options[idx].selected = true;
    }
    this._notify();
  };

  TransferGroup.prototype._moveDown = function () {
    var sel = this._selectedValues(this.rightList);
    if (!sel.length) return;

    var indices = [];
    var i, idx;
    for (i = 0; i < sel.length; i++) {
      idx = this.rightKeys.indexOf(sel[i]);
      if (idx !== -1) indices.push(idx);
    }
    indices.sort(function (a, b) { return b - a; });

    for (i = 0; i < indices.length; i++) {
      idx = indices[i];
      if (idx < this.rightKeys.length - 1) {
        var tmp = this.rightKeys[idx + 1];
        this.rightKeys[idx + 1] = this.rightKeys[idx];
        this.rightKeys[idx] = tmp;
      }
    }
    this._refresh();
    for (i = 0; i < indices.length; i++) {
      idx = Math.min(this.rightKeys.length - 1, indices[i] + 1);
      this.rightList.options[idx].selected = true;
    }
    this._notify();
  };

  TransferGroup.prototype.setValues = function (leftKeys, rightKeys) {
    this.leftKeys = leftKeys.slice();
    this.rightKeys = rightKeys.slice();
    this._refresh();
  };

  TransferGroup.prototype.getSelectedKeys = function () {
    return this.rightKeys.slice();
  };

  return {
    TransferGroup: TransferGroup
  };
})();
