/**
 * GSLB 多文件对比 — 字段定义
 */
var GslbCompareFields = (function () {
  'use strict';

  var KEY_COLUMNS = [
    { key: 'domain.name', title: '域名名称' },
    { key: 'domain.type', title: '域名类型' },
    { key: 'member.dc_name', title: '所属数据中心' },
    { key: 'member.gmember_name', title: '成员名称' },
    { key: 'member.ip', title: '成员IP' },
    { key: 'member.port', title: '成员端口' }
  ];

  var STATUS_COLUMNS = [
    { key: 'member.status', title: '成员最终健康检测状态', checked: true },
    { key: 'member.gpool_status_hm_templates', title: '地址池层健康检测状态', checked: false },
    { key: 'member.status_hm_templates', title: '服务成员层健康检测状态', checked: false },
    { key: 'member.link_status', title: '链路状态', checked: false },
    { key: 'member.pool_enable', title: '地址池成员是否启用', checked: false },
    { key: 'member.enable', title: '服务成员是否启用', checked: false },
    { key: 'member.dc_pass', title: '服务成员健康检查有效性', checked: false }
  ];

  function keyLabel(key) {
    var i;
    for (i = 0; i < KEY_COLUMNS.length; i++) {
      if (KEY_COLUMNS[i].key === key) return KEY_COLUMNS[i].title;
    }
    for (i = 0; i < STATUS_COLUMNS.length; i++) {
      if (STATUS_COLUMNS[i].key === key) return STATUS_COLUMNS[i].title;
    }
    return key;
  }

  return {
    KEY_COLUMNS: KEY_COLUMNS,
    STATUS_COLUMNS: STATUS_COLUMNS,
    keyLabel: keyLabel
  };
})();
