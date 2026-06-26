'use strict';

module.exports = function (test, assert, assertEq) {

  /* ===== parseRangeConfig ===== */

  test('parseRangeConfig：I7 → startRow 7, colList [I]', function () {
    var cfg = CidrExcelLookup.parseRangeConfig({ startCell: 'I7', columns: '', endRow: '', sheetIndex: '0', sheetName: '', contextColumns: '' });
    assertEq(cfg.startRow, 7);
    assertEq(cfg.colList[0], 'I');
    assertEq(cfg.sheetIndex, 0);
    assert(cfg.endRow === null, 'endRow 应为 null');
  });

  test('parseRangeConfig：F7 多列 F,I', function () {
    var cfg = CidrExcelLookup.parseRangeConfig({ startCell: 'F7', columns: 'F,I', endRow: '100', sheetIndex: '0', sheetName: '', contextColumns: '' });
    assertEq(cfg.startRow, 7);
    assertEq(cfg.colList.length, 2);
    assertEq(cfg.colList[0], 'F');
    assertEq(cfg.colList[1], 'I');
    assertEq(cfg.endRow, 100);
  });

  test('parseRangeConfig：起始单元格格式异常时回退到 A1', function () {
    var cfg = CidrExcelLookup.parseRangeConfig({ startCell: 'bad', columns: 'I', endRow: '', sheetIndex: '0', sheetName: '', contextColumns: '' });
    assertEq(cfg.startRow, 1);
  });

  test('parseRangeConfig：附加显示列 E,F 解析正确，columns 含并集去重', function () {
    var cfg = CidrExcelLookup.parseRangeConfig({
      startCell: 'I7', columns: 'F,I', contextColumns: 'E,F', endRow: '', sheetIndex: '0', sheetName: ''
    });
    assertEq(cfg.contextColumns.length, 2);
    assertEq(cfg.contextColumns[0], 'E');
    assertEq(cfg.contextColumns[1], 'F');
    /* columns 传给 BocXlsxRead：E∪F∪I，F 不重复 */
    assertEq(cfg.columns.length, 3);
    assert(cfg.columns.indexOf('E') >= 0, '应含 E');
    assert(cfg.columns.indexOf('F') >= 0, '应含 F');
    assert(cfg.columns.indexOf('I') >= 0, '应含 I');
  });

  /* ===== extractCellSubnets ===== */

  test('extractCellSubnets：换行分隔多条 CIDR', function () {
    var raw  = '103.238.96.0/24\n103.238.97.0/24\n10.0.0.1';
    var meta = { fileName: 'test.xlsx', sheetName: 'Sheet1', rowIndex: 7, colLetter: 'I' };
    var res  = CidrExcelLookup.extractCellSubnets(raw, meta);
    assertEq(res.record.subnets.length, 3);
    assertEq(res.cellErrors.length, 0);
  });

  test('extractCellSubnets：跳过空行与 # 注释', function () {
    var raw  = '# 注释\n\n10.0.0.0/8\n// 另一注释\n192.168.1.0/24';
    var meta = { fileName: 'f.xlsx', sheetName: '', rowIndex: 8, colLetter: 'I' };
    var res  = CidrExcelLookup.extractCellSubnets(raw, meta);
    assertEq(res.record.subnets.length, 2);
    assertEq(res.cellErrors.length, 0);
  });

  test('extractCellSubnets：无效行记入 cellErrors 不阻断', function () {
    var raw  = '10.0.0.0/8\nnot-valid\n192.168.0.0/16';
    var meta = { fileName: 'f.xlsx', sheetName: '', rowIndex: 9, colLetter: 'I' };
    var res  = CidrExcelLookup.extractCellSubnets(raw, meta);
    assertEq(res.record.subnets.length, 2);
    assertEq(res.cellErrors.length, 1);
  });

  /* ===== extractFromRows：附加显示列 ===== */

  test('extractFromRows：contextColumns 写入 record.context', function () {
    /* 模拟一行 BocXlsxRead 输出，含 E/F/I 列 */
    var rows = [{ rowIndex: 7, E: '访问源A', F: '1.2.3.0/24', I: '10.0.0.0/8' }];
    var res  = CidrExcelLookup.extractFromRows(rows, ['I'], 'f.xlsx', 'S1', ['E', 'F']);
    assertEq(res.cellRecords.length, 1);
    assertEq(res.cellRecords[0].context['E'], '访问源A');
    assertEq(res.cellRecords[0].context['F'], '1.2.3.0/24');
  });

  /* ===== lookup（通过 mock cellRecords）===== */

  function makeCellRecord(fileName, rowIndex, colLetter, cidrLines, context) {
    var raw     = cidrLines.join('\n');
    var meta    = { fileName: fileName, sheetName: 'S1', rowIndex: rowIndex, colLetter: colLetter };
    var res     = CidrExcelLookup.extractCellSubnets(raw, meta);
    res.record.context = context || {};
    return res.record;
  }

  test('lookup：单条查询命中单条单元格', function () {
    var cr = makeCellRecord('file1.xlsx', 7, 'I', ['103.238.96.0/24', '10.0.0.0/8']);
    var r  = CidrExcelLookup.lookup('103.238.96.5', [cr]);
    assertEq(r.rows.length, 1);
    assertEq(r.rows[0].matched, true);
    assertEq(r.rows[0].hits.length, 1);
    assertEq(r.rows[0].hits[0].matchedSubnet, '103.238.96.0/24');
    assertEq(r.rows[0].hits[0].rowIndex, 7);
  });

  test('lookup：未命中时 matched = false，hits 为空', function () {
    var cr = makeCellRecord('file1.xlsx', 7, 'I', ['10.0.0.0/8']);
    var r  = CidrExcelLookup.lookup('203.0.113.1', [cr]);
    assertEq(r.rows[0].matched, false);
    assertEq(r.rows[0].hits.length, 0);
  });

  test('lookup：查询网段大于单元格网段时不命中（需"被包含"）', function () {
    /* 10.0.0.0/8 不包含 10.0.0.0/7（更宽） */
    var cr = makeCellRecord('file1.xlsx', 7, 'I', ['10.0.0.0/8']);
    var r  = CidrExcelLookup.lookup('10.0.0.0/7', [cr]);
    assertEq(r.rows[0].matched, false);
  });

  test('lookup：查询为主机 IP，被 /24 覆盖', function () {
    var cr = makeCellRecord('file1.xlsx', 10, 'I', ['192.168.1.0/24']);
    var r  = CidrExcelLookup.lookup('192.168.1.100', [cr]);
    assertEq(r.rows[0].matched, true);
    assertEq(r.rows[0].hits[0].matchedSubnet, '192.168.1.0/24');
  });

  test('lookup：多文件同网段，hits 含两个 fileName', function () {
    var cr1 = makeCellRecord('file1.xlsx', 7, 'I', ['10.1.0.0/16']);
    var cr2 = makeCellRecord('file2.xlsx', 8, 'I', ['10.0.0.0/8']);
    var r   = CidrExcelLookup.lookup('10.1.2.3', [cr1, cr2]);
    assertEq(r.rows[0].matched, true);
    assertEq(r.rows[0].hits.length, 2);
    var names = r.rows[0].hits.map(function (h) { return h.fileName; }).sort();
    assertEq(names[0], 'file1.xlsx');
    assertEq(names[1], 'file2.xlsx');
  });

  test('lookup：多文件多命中取最具体网段', function () {
    /* file1 有 /8，file1 row8 有 /16 ——同一文件两个单元格；选最具体的 /16 */
    var cr1 = makeCellRecord('file1.xlsx', 7,  'I', ['10.0.0.0/8']);
    var cr2 = makeCellRecord('file1.xlsx', 8,  'I', ['10.1.0.0/16']);
    var r   = CidrExcelLookup.lookup('10.1.2.3', [cr1, cr2]);
    /* 两个都命中 */
    assertEq(r.rows[0].hits.length, 2);
    /* 但 cr2（/16）更具体 */
    var specific = r.rows[0].hits.filter(function (h) { return h.rowIndex === 8; });
    assertEq(specific[0].matchedSubnet, '10.1.0.0/16');
  });

  test('lookup：多行查询，stats 正确', function () {
    var cr = makeCellRecord('file1.xlsx', 7, 'I', ['10.0.0.0/8']);
    var r  = CidrExcelLookup.lookup('10.1.1.1\n200.0.0.1', [cr]);
    assertEq(r.stats.queryCount, 2);
    assertEq(r.stats.matchedCount, 1);
    assertEq(r.stats.unmatchedCount, 1);
  });

  test('lookup：查询包含解析错误行，errors 记录不阻断', function () {
    var cr = makeCellRecord('f.xlsx', 7, 'I', ['10.0.0.0/8']);
    var r  = CidrExcelLookup.lookup('10.1.1.1\nbadentry\n10.2.2.2', [cr]);
    assertEq(r.errors.length, 1);
    /* 两条合法查询仍被处理 */
    assertEq(r.stats.queryCount, 2);
  });

  test('lookup：IPv6 被包含命中', function () {
    var cr = makeCellRecord('f.xlsx', 7, 'I', ['2001:db8::/32']);
    var r  = CidrExcelLookup.lookup('2001:db8::1', [cr]);
    assertEq(r.rows[0].matched, true);
  });

  test('lookup：命中时 hit.context 携带附加列值', function () {
    var ctx = { E: '访问源A', F: '1.2.3.0/24' };
    var cr  = makeCellRecord('f.xlsx', 7, 'I', ['10.0.0.0/8'], ctx);
    var r   = CidrExcelLookup.lookup('10.1.1.1', [cr]);
    assertEq(r.rows[0].matched, true);
    assertEq(r.rows[0].hits[0].context['E'], '访问源A');
    assertEq(r.rows[0].hits[0].context['F'], '1.2.3.0/24');
  });

  test('lookup：未命中时 context 为空对象（不崩溃）', function () {
    var cr = makeCellRecord('f.xlsx', 7, 'I', ['10.0.0.0/8'], { E: '访问源A' });
    var r  = CidrExcelLookup.lookup('200.0.0.1', [cr]);
    assertEq(r.rows[0].matched, false);
    assertEq(r.rows[0].hits.length, 0);
  });

};
