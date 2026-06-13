/**
 * 纯 JS xlsx 生成器（STORED / 不压缩，无外部依赖）
 * 用法：BocXlsx.generate(rows, { sheetName, headers, rowMapper })
 */
var BocXlsx = (function () {
  'use strict';

  function escX(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cellValue(s) {
    return escX(s).replace(/\n/g, '&#10;');
  }

  function u16le(n) { return [n & 0xff, (n >> 8) & 0xff]; }
  function u32le(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

  function crc32(data) {
    var crc = 0xffffffff;
    if (!crc32._t) {
      crc32._t = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crc32._t[i] = c;
      }
    }
    for (var k = 0; k < data.length; k++) crc = crc32._t[(crc ^ data[k]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZip(files) {
    var enc = new TextEncoder();
    var localParts = [], centralDirs = [], offset = 0;
    var DT = 0x5346, DD = 0x5929;

    for (var f = 0; f < files.length; f++) {
      var file = files[f];
      var nb   = enc.encode(file.name);
      var data = file.data;
      var crc  = crc32(data);
      var size = data.length;
      var lh   = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...u16le(20), ...u16le(0), ...u16le(0),
        ...u16le(DT), ...u16le(DD),
        ...u32le(crc), ...u32le(size), ...u32le(size),
        ...u16le(nb.length), ...u16le(0),
        ...nb,
      ]);
      centralDirs.push({ nb: nb, crc: crc, size: size, offset: offset });
      localParts.push(lh, data);
      offset += lh.length + size;
    }

    var cdOffset = offset;
    var cdParts = centralDirs.map(function (cd) {
      return new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...u16le(20), ...u16le(20), ...u16le(0), ...u16le(0),
        ...u16le(DT), ...u16le(DD),
        ...u32le(cd.crc), ...u32le(cd.size), ...u32le(cd.size),
        ...u16le(cd.nb.length), ...u16le(0), ...u16le(0),
        ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(cd.offset),
        ...cd.nb,
      ]);
    });

    var cdSize = cdParts.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,
      ...u16le(0), ...u16le(0),
      ...u16le(files.length), ...u16le(files.length),
      ...u32le(cdSize), ...u32le(cdOffset),
      ...u16le(0),
    ]);

    var parts = localParts.concat(cdParts, [eocd]);
    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out   = new Uint8Array(total);
    var pos   = 0;
    for (var i = 0; i < parts.length; i++) { out.set(parts[i], pos); pos += parts[i].length; }
    return out;
  }

  /**
   * 生成 xlsx 二进制
   * @param {Array} rows - 数据行
   * @param {Object} opts
   * @param {string[]} opts.headers - 表头列名
   * @param {number[]} opts.colWidths - 列宽
   * @param {Function} opts.rowMapper - (row, rowNum) => [{ col, value, style }]
   * @param {string} opts.sheetName
   */
  function generate(rows, opts) {
    opts = opts || {};
    var headers  = opts.headers  || ['列1', '列2'];
    var colWidths = opts.colWidths || [30, 20];
    var sheetName = opts.sheetName || 'Sheet1';
    var mapper   = opts.rowMapper;

    var colsXml = colWidths.map(function (w, i) {
      return '    <col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('\n');

    var headerCells = headers.map(function (h, i) {
      var col = String.fromCharCode(65 + i);
      return '    <c r="' + col + '1" t="inlineStr" s="1"><is><t>' + escX(h) + '</t></is></c>';
    }).join('\n');

    var sheetRows = '  <row r="1">\n' + headerCells + '\n  </row>\n';

    for (var r = 0; r < rows.length; r++) {
      var rowNum = r + 2;
      var cells  = mapper(rows[r], rowNum);
      var cellXml = cells.map(function (c) {
        if (c.type === 'n') {
          return '    <c r="' + c.col + rowNum + '" t="n"><v>' + c.value + '</v></c>';
        }
        return '    <c r="' + c.col + rowNum + '" t="inlineStr" s="' + (c.style || 2) + '"><is><t xml:space="preserve">' + cellValue(c.value) + '</t></is></c>';
      }).join('\n');
      sheetRows += '  <row r="' + rowNum + '">\n' + cellXml + '\n  </row>\n';
    }

    var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"\n' +
      '           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
      '  <sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews>\n' +
      '  <cols>\n' + colsXml + '\n  </cols>\n' +
      '  <sheetData>\n' + sheetRows + '  </sheetData>\n' +
      '</worksheet>';

    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
      '  <fonts>\n    <font><sz val="11"/><name val="Calibri"/></font>\n' +
      '    <font><sz val="11"/><name val="Calibri"/><b/></font>\n' +
      '    <font><sz val="11"/><name val="Calibri"/><b/><color rgb="FFFFFFFF"/></font>\n  </fonts>\n' +
      '  <fills>\n    <fill><patternFill patternType="none"/></fill>\n' +
      '    <fill><patternFill patternType="gray125"/></fill>\n' +
      '    <fill><patternFill patternType="solid"><fgColor rgb="FF5B9BD5"/></patternFill></fill>\n' +
      '  </fills>\n  <borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n' +
      '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
      '  <cellXfs>\n    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n' +
      '    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0"><alignment vertical="center"/></xf>\n' +
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>\n' +
      '  </cellXfs>\n</styleSheet>';

    var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"\n' +
      '          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
      '  <sheets><sheet name="' + escX(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>\n' +
      '</workbook>';

    var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
      '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n' +
      '</Relationships>';

    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
      '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
      '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n' +
      '</Types>';

    var topRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
      '</Relationships>';

    var enc = new TextEncoder();
    return buildZip([
      { name: '[Content_Types].xml',        data: enc.encode(contentTypesXml) },
      { name: '_rels/.rels',                data: enc.encode(topRelsXml) },
      { name: 'xl/workbook.xml',            data: enc.encode(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(relsXml) },
      { name: 'xl/worksheets/sheet1.xml',   data: enc.encode(sheetXml) },
      { name: 'xl/styles.xml',              data: enc.encode(stylesXml) },
    ]);
  }

  return { generate: generate, buildZip: buildZip };
})();
