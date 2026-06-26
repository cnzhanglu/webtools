/**
 * CIDR Excel 反查 — 核心逻辑层
 *
 * 数据流：
 *   Excel 文件 → BocXlsxRead.parse(opts)
 *   → extractCellSubnets()  将各单元格文本按换行拆成网段列表
 *   → lookup(queries, cellRecords) 对每条查询地址反查包含它的单元格
 *   → 输出 { rows, stats, errors, cellErrors }
 *
 * 匹配规则（被包含）：
 *   cellRecord 中某条网段 subnet 满足 BocIpCidr.subnetContains(subnet, query)
 *   即"单元格网段完全包含查询地址"。
 *
 * 依赖：BocIpCidr、CidrVsProcess（parseList 复用）
 * 导出：CidrExcelLookup
 */
var CidrExcelLookup = (function () {
  'use strict';

  /* ===== 内置预设 ===== */

  /**
   * NASP ACL 申请单预设：
   *   columns       = F（源地址）、I（目标地址）——用于网段匹配
   *   contextColumns = E（访问源 ACCESS_SOURCE）、F（源地址 SOURCE_IP）——命中时附加显示
   */
  var PRESET_NASP = {
    label:          'NASP ACL 预设',
    startCell:      'I7',
    columns:        'F,I',
    contextColumns: 'E,F',
    endRow:         '',
    sheetIndex:     '0'
  };

  /* ===== 范围配置解析 ===== */

  /**
   * 将起始单元格字符串（如 "I7"）解析为 { col, startRow }。
   * col 是列字母（大写），startRow 是 1-based 数字。
   * 解析失败时 col 默认 'A'，startRow 默认 1。
   */
  function parseStartCell(str) {
    str = String(str || '').trim().toUpperCase();
    var m = str.match(/^([A-Z]+)(\d+)$/);
    if (!m) return { col: 'A', startRow: 1 };
    return { col: m[1], startRow: parseInt(m[2], 10) };
  }

  /**
   * 解析逗号分隔的列字母串，返回去重大写列数组。
   * 空字符串时返回 null（由调用方决定默认值）。
   */
  function parseColumns(str) {
    str = String(str || '').trim();
    if (!str) return null;
    return str.split(',').map(function (c) { return c.trim().toUpperCase(); }).filter(Boolean);
  }

  /**
   * 从 UI 表单字段集合解析完整范围配置，供 BocXlsxRead.parse 使用。
   * @param {Object} ui { startCell, columns, contextColumns, endRow, sheetIndex, sheetName }
   * @returns {{ startCell, columns, startRow, endRow, sheetIndex, sheetName, colList, contextColumns }}
   *   colList:        IP 数据列（用于网段提取）
   *   contextColumns: 附加显示列（命中时一并展示的行上下文，如 ACCESS_SOURCE / SOURCE_IP）
   *   columns:        传入 BocXlsxRead 的列（colList ∪ contextColumns，去重）
   */
  function parseRangeConfig(ui) {
    var sc       = parseStartCell(ui.startCell);
    var colList  = parseColumns(ui.columns);
    /* 若未指定列，以起始单元格的列为默认 */
    if (!colList) colList = [sc.col];

    /* 附加显示列（可为空） */
    var ctxCols = parseColumns(ui.contextColumns) || [];

    /* 传给 BocXlsxRead 的列 = colList ∪ ctxCols（去重，保持顺序） */
    var allColsSet = {};
    var allCols    = [];
    colList.concat(ctxCols).forEach(function (c) {
      if (!allColsSet[c]) { allColsSet[c] = true; allCols.push(c); }
    });

    var endRow = parseInt(ui.endRow, 10);
    if (isNaN(endRow) || endRow < 1) endRow = null;

    var sheetIndex = parseInt(ui.sheetIndex, 10);
    if (isNaN(sheetIndex)) sheetIndex = 0;

    return {
      startCell:      ui.startCell,
      startRow:       sc.startRow,
      endRow:         endRow,
      sheetIndex:     sheetIndex,
      sheetName:      (ui.sheetName || '').trim() || null,
      columns:        allCols      /* 传入 BocXlsxRead（含 IP 列 + 附加列） */,
      colList:        colList      /* 仅 IP 数据列，extractFromRows 使用 */,
      contextColumns: ctxCols      /* 附加显示列 */
    };
  }

  /* ===== 单元格网段提取 ===== */

  /**
   * 将单个单元格原始文本拆成网段条目列表。
   * 换行符（\r?\n）分隔，跳过空行与 # / // 注释行。
   *
   * @param {string} raw  单元格文本
   * @param {Object} meta { fileName, sheetName, rowIndex, colLetter }
   * @returns {{ records: [{...meta, rawCell, subnets}], cellErrors: [{...}] }}
   *   一个单元格一条 record；cellErrors 记录该单元格内无法解析的行。
   */
  function extractCellSubnets(raw, meta) {
    var cellErrors = [];
    var subnets    = [];
    var lines      = String(raw || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#') === 0 || line.indexOf('//') === 0) continue;
      try {
        subnets.push(BocIpCidr.parseEntry(line));
      } catch (err) {
        cellErrors.push({
          fileName:  meta.fileName,
          sheetName: meta.sheetName,
          rowIndex:  meta.rowIndex,
          colLetter: meta.colLetter,
          text:      line,
          reason:    err.message
        });
      }
    }
    return {
      record: {
        fileName:    meta.fileName,
        sheetName:   meta.sheetName,
        rowIndex:    meta.rowIndex,
        colLetter:   meta.colLetter,
        rawCell:     raw,
        subnets:     subnets
      },
      cellErrors: cellErrors
    };
  }

  /**
   * 从已解析的 rows（BocXlsxRead 输出）批量提取所有目标列的单元格记录。
   * 只提取 rawCell 非空（且含至少一个非空行）的单元格。
   *
   * @param {Object[]} rows           BocXlsxRead.parse 的 rows 数组
   * @param {string[]} colList        IP 数据列，如 ['F','I']
   * @param {string}   fileName       来源文件名
   * @param {string}   sheetName      来源工作表名
   * @param {string[]} [contextColumns] 附加显示列，如 ['E','F']；命中时随 hit 携带同行的列值
   * @returns {{ cellRecords, cellErrors }}
   */
  function extractFromRows(rows, colList, fileName, sheetName, contextColumns) {
    contextColumns = contextColumns || [];
    var cellRecords = [];
    var cellErrors  = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      /* 采集同行的附加显示列值 { E: '...', F: '...' } */
      var context = {};
      for (var cx = 0; cx < contextColumns.length; cx++) {
        context[contextColumns[cx]] = row[contextColumns[cx]] || '';
      }
      for (var ci = 0; ci < colList.length; ci++) {
        var col    = colList[ci];
        var rawVal = row[col] || '';
        /* 跳过空单元格 */
        if (!rawVal.trim()) continue;
        var result = extractCellSubnets(rawVal, {
          fileName:  fileName,
          sheetName: sheetName || '',
          rowIndex:  row.rowIndex,
          colLetter: col
        });
        /* 将本行附加列值写入 record，供 findHits 传递给命中结果 */
        result.record.context = context;
        /* 只保留有网段（即使部分行解析失败）或有错误的记录 */
        if (result.record.subnets.length > 0) cellRecords.push(result.record);
        if (result.cellErrors.length)          cellErrors = cellErrors.concat(result.cellErrors);
      }
    }
    return { cellRecords: cellRecords, cellErrors: cellErrors };
  }

  /* ===== 反查主逻辑 ===== */

  /**
   * 规范化输出一条 IP/CIDR 条目的文本（与 cidr-vs process.js 保持一致）。
   */
  function normalizeEntry(entry) {
    if (entry.kind === 'range') {
      return BocIpCidr.ipFromBigInt(entry.start, entry.family) + '-' +
             BocIpCidr.ipFromBigInt(entry.end, entry.family);
    }
    return BocIpCidr.formatCidr(entry.start, entry.prefix, entry.family);
  }

  /**
   * 对单条查询条目，在 cellRecords 中寻找所有包含它的记录。
   * 包含规则：cellRecord.subnets 中存在 subnet 满足 subnetContains(subnet, query)。
   * 同一单元格可能有多条网段命中，只取最具体（范围最小）的一条上报。
   *
   * @returns {Array} hits 数组
   */
  function findHits(query, cellRecords) {
    var hits = [];
    for (var i = 0; i < cellRecords.length; i++) {
      var cr = cellRecords[i];
      var bestSubnet = null;
      for (var j = 0; j < cr.subnets.length; j++) {
        var sn = cr.subnets[j];
        if (sn.family !== query.family) continue;
        if (!BocIpCidr.subnetContains(sn, query)) continue;
        /* 取范围最小（最具体）的命中网段 */
        if (bestSubnet === null || (sn.end - sn.start) < (bestSubnet.end - bestSubnet.start)) {
          bestSubnet = sn;
        }
      }
      if (bestSubnet) {
        /* cellPreview：HTML 表格展示用，截断至 120 字符 */
        var preview = cr.rawCell.length > 120
          ? cr.rawCell.slice(0, 120) + '…'
          : cr.rawCell;
        hits.push({
          fileName:      cr.fileName,
          sheetName:     cr.sheetName,
          rowIndex:      cr.rowIndex,
          colLetter:     cr.colLetter,
          matchedSubnet: normalizeEntry(bestSubnet),
          rawCell:       cr.rawCell,   /* 完整原文，供导出/复制使用 */
          cellPreview:   preview,      /* 截断预览，供 HTML 表格展示 */
          /* 同行附加显示列值（由 extractFromRows 写入 record.context） */
          context:       cr.context || {}
        });
      }
    }
    return hits;
  }

  /**
   * 主反查入口：将一批查询地址（多行文本）逐条在 cellRecords 中查找。
   *
   * @param {string}   queryText    查询地址多行文本（每行一条）
   * @param {Object[]} cellRecords  extractFromRows 输出的 cellRecords
   * @returns {{
   *   rows:       Array,  // 每条查询一行结果
   *   stats:      Object,
   *   errors:     Array,  // 查询解析错误
   * }}
   *
   * rows 元素结构：
   *   { lineNo, raw, normalized, family, matched, hits }
   *   hits: [{ fileName, sheetName, rowIndex, colLetter, matchedSubnet, cellPreview }]
   */
  function lookup(queryText, cellRecords) {
    /* 1. 解析查询清单（复用 cidr-vs 的 parseList） */
    var parsed     = CidrVsProcess.parseList(queryText);
    var queries    = parsed.entries;
    var errors     = parsed.errors;

    /* 2. 统计文件数与单元格数 */
    var fileSet    = {};
    var cellCount  = cellRecords.length;
    for (var ci = 0; ci < cellRecords.length; ci++) {
      fileSet[cellRecords[ci].fileName] = true;
    }

    /* 3. 对每条查询反查 */
    var rows         = [];
    var matchedCount = 0;
    for (var qi = 0; qi < queries.length; qi++) {
      var q    = queries[qi];
      var hits = findHits(q, cellRecords);
      var matched = hits.length > 0;
      if (matched) matchedCount++;
      rows.push({
        lineNo:     q.lineNo,
        raw:        q.text,
        normalized: normalizeEntry(q),
        family:     q.family === 4 ? 'IPv4' : 'IPv6',
        matched:    matched,
        hits:       hits
      });
    }

    return {
      rows:   rows,
      errors: errors,
      stats: {
        queryCount:    queries.length,
        matchedCount:  matchedCount,
        unmatchedCount: queries.length - matchedCount,
        fileCount:     Object.keys(fileSet).length,
        cellCount:     cellCount,
        errorCount:    errors.length
      }
    };
  }

  return {
    PRESET_NASP:        PRESET_NASP,
    parseRangeConfig:   parseRangeConfig,
    extractFromRows:    extractFromRows,
    extractCellSubnets: extractCellSubnets,
    lookup:             lookup
  };
})();
