/**
 * 纯 JS xlsx 读取器（ZIP + DEFLATE inflate + OOXML 解析，无外部依赖）
 * 用法：BocXlsxRead.parse(arrayBuffer) → { rows: [{rowIndex, A-H, ...}] }
 * - 读取第一个工作表
 * - 解析 sharedStrings、inlineStr、数字单元格
 * - 解析 mergeCells 并回填（上方 TL 值覆盖同合并区域的空格）
 * - 行对象键为列字母（A/B/.../Z/AA/...），值均为字符串
 */
var BocXlsxRead = (function () {
  'use strict';

  /* ===== DEFLATE inflate (RFC 1951) ===== */

  var LEN_EXTRA  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0];
  var LEN_BASE   = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var DIST_BASE  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];

  var FIXED_LL, FIXED_DIST;
  (function () {
    var ll = [], i;
    for (i = 0; i <= 143; i++) ll.push(8);
    for (i = 144; i <= 255; i++) ll.push(9);
    for (i = 256; i <= 279; i++) ll.push(7);
    for (i = 280; i <= 287; i++) ll.push(8);
    var dist = [];
    for (i = 0; i < 32; i++) dist.push(5);
    FIXED_LL   = buildHuffTable(ll);
    FIXED_DIST = buildHuffTable(dist);
  }());

  function buildHuffTable(lengths) {
    var i, maxLen = 0;
    for (i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
    if (!maxLen) return null;

    var count = new Array(maxLen + 2).fill(0);
    for (i = 0; i < lengths.length; i++) if (lengths[i]) count[lengths[i]]++;

    var code = 0, next = new Array(maxLen + 2).fill(0);
    for (i = 1; i <= maxLen; i++) { code = (code + count[i - 1]) << 1; next[i] = code; }

    var size = 1 << maxLen;
    var table = new Int32Array(size).fill(-1);
    for (var sym = 0; sym < lengths.length; sym++) {
      var len = lengths[sym];
      if (!len) continue;
      var c = next[len]++;
      /* reverse bits so we can index with LSB-first stream bits */
      var rev = 0;
      for (var b = 0; b < len; b++) rev = (rev << 1) | ((c >> b) & 1);
      var step = 1 << len;
      for (var j = rev; j < size; j += step) table[j] = sym | (len << 16);
    }
    return { table: table, maxLen: maxLen };
  }

  function inflate(src) {
    var outBuf = new Uint8Array(Math.max(src.length * 4, 4096));
    var outPos = 0;
    var bytePos = 0, bitBuf = 0, bitLen = 0;

    function readBits(n) {
      while (bitLen < n) { bitBuf |= src[bytePos++] << bitLen; bitLen += 8; }
      var v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitLen -= n; return v;
    }

    function alignByte() { bitBuf = 0; bitLen = 0; }

    function decodeHuff(tbl) {
      while (bitLen < tbl.maxLen) {
        bitBuf |= (bytePos < src.length ? src[bytePos++] : 0) << bitLen;
        bitLen += 8;
      }
      var entry = tbl.table[bitBuf & ((1 << tbl.maxLen) - 1)];
      if (entry < 0) throw new Error('bad huffman');
      var clen = (entry >> 16) & 0xff; bitBuf >>>= clen; bitLen -= clen;
      return entry & 0xffff;
    }

    function ensureOut() {
      if (outPos + 288 >= outBuf.length) {
        var nb = new Uint8Array(outBuf.length * 2); nb.set(outBuf); outBuf = nb;
      }
    }

    var done = false;
    while (!done) {
      var bFinal = readBits(1), bType = readBits(2);
      done = !!bFinal;

      if (bType === 0) {
        alignByte();
        var bLen = src[bytePos] | (src[bytePos + 1] << 8); bytePos += 4;
        ensureOut();
        outBuf.set(src.subarray(bytePos, bytePos + bLen), outPos);
        outPos += bLen; bytePos += bLen;
        continue;
      }

      var llTbl, distTbl;
      if (bType === 1) {
        llTbl = FIXED_LL; distTbl = FIXED_DIST;
      } else {
        var hlit = readBits(5) + 257, hdist = readBits(5) + 1, hclen = readBits(4) + 4;
        var CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        var clenLens = new Array(19).fill(0);
        for (var ci = 0; ci < hclen; ci++) clenLens[CLEN_ORDER[ci]] = readBits(3);
        var clenTbl = buildHuffTable(clenLens);

        var allLens = new Array(hlit + hdist).fill(0), ai = 0, prev = 0;
        while (ai < hlit + hdist) {
          var cs = decodeHuff(clenTbl);
          if (cs < 16) { allLens[ai++] = prev = cs; }
          else if (cs === 16) { var r = readBits(2) + 3; while (r--) allLens[ai++] = prev; }
          else if (cs === 17) { var r = readBits(3) + 3; while (r--) allLens[ai++] = 0; prev = 0; }
          else { var r = readBits(7) + 11; while (r--) allLens[ai++] = 0; prev = 0; }
        }
        llTbl   = buildHuffTable(allLens.slice(0, hlit));
        distTbl = buildHuffTable(allLens.slice(hlit)) || buildHuffTable([0]);
      }

      while (true) {
        ensureOut();
        var sym = decodeHuff(llTbl);
        if (sym < 256) { outBuf[outPos++] = sym; }
        else if (sym === 256) { break; }
        else {
          var idx = sym - 257;
          var length = LEN_BASE[idx] + readBits(LEN_EXTRA[idx]);
          var ds = decodeHuff(distTbl);
          var dist = DIST_BASE[ds] + readBits(DIST_EXTRA[ds]);
          var from = outPos - dist;
          for (var cp = 0; cp < length; cp++) outBuf[outPos++] = outBuf[from++];
        }
      }
    }
    return outBuf.subarray(0, outPos);
  }

  /* ===== ZIP reader ===== */

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] * 16777216)) >>> 0; }

  function readZip(buf) {
    var files = {}, i = 0, sig;
    while (i < buf.length - 4) {
      sig = u32(buf, i);
      if (sig === 0x04034b50) {
        var method    = u16(buf, i + 8);
        var cSize     = u32(buf, i + 18);
        var nameLen   = u16(buf, i + 26);
        var extraLen  = u16(buf, i + 28);
        var dataStart = i + 30 + nameLen + extraLen;
        var name      = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nameLen));
        var raw       = buf.subarray(dataStart, dataStart + cSize);
        files[name]   = method === 8 ? inflate(raw) : raw;
        i = dataStart + cSize;
      } else if (sig === 0x02014b50 || sig === 0x06054b50) {
        break;
      } else {
        i++;
      }
    }
    return files;
  }

  /* ===== XML helpers ===== */

  function xmlDoc(bytes) {
    var text = new TextDecoder('utf-8').decode(bytes);
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  function tags(doc, name) { return doc.getElementsByTagName(name); }

  /* ===== XLSX specific ===== */

  function parseSharedStrings(doc) {
    var sis = tags(doc, 'si'), result = [], i, j, ts, txt;
    for (i = 0; i < sis.length; i++) {
      ts = sis[i].getElementsByTagName('t'); txt = '';
      for (j = 0; j < ts.length; j++) txt += ts[j].textContent || '';
      result.push(txt);
    }
    return result;
  }

  function colLetterIdx(col) {
    var n = 0, i;
    for (i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n - 1; /* 0-based */
  }

  function idxToColLetter(idx) {
    var out = '', i = idx + 1;
    while (i > 0) { i--; out = String.fromCharCode(65 + i % 26) + out; i = Math.floor(i / 26); }
    return out;
  }

  function parseCellRef(ref) {
    var m = ref.match(/^([A-Z]+)(\d+)$/);
    return m ? { col: colLetterIdx(m[1]), row: parseInt(m[2], 10) } : null;
  }

  /**
   * 解析工作簿清单，返回 [{name, rId, path}]。
   * 依赖 xl/workbook.xml 与 xl/_rels/workbook.xml.rels。
   */
  function parseWorkbook(files) {
    var wbData = files['xl/workbook.xml'];
    if (!wbData) return [];
    var doc = xmlDoc(wbData);
    var sheets = [], sheetEls = tags(doc, 'sheet'), i;
    for (i = 0; i < sheetEls.length; i++) {
      sheets.push({
        name: sheetEls[i].getAttribute('name') || '',
        rId:  sheetEls[i].getAttribute('r:id') || sheetEls[i].getAttribute('id') || ''
      });
    }
    /* 解析 rels 拿到真实路径 */
    var relData = files['xl/_rels/workbook.xml.rels'];
    if (relData) {
      var relDoc = xmlDoc(relData);
      var relEls = tags(relDoc, 'Relationship'), rmap = {}, j;
      for (j = 0; j < relEls.length; j++) {
        rmap[relEls[j].getAttribute('Id')] = relEls[j].getAttribute('Target') || '';
      }
      for (i = 0; i < sheets.length; i++) {
        var target = rmap[sheets[i].rId] || '';
        /* Target 可能是相对路径如 worksheets/sheet1.xml */
        sheets[i].path = /^\//.test(target) ? target.slice(1) : 'xl/' + target;
      }
    }
    return sheets;
  }

  /**
   * 解析单张工作表，返回行数组。
   * @param {Document} doc  工作表 XML
   * @param {string[]} ss   共享字符串
   * @param {Object}   opts 可选 { colIndices, startRow, endRow }
   *   colIndices: 0-based 列索引数组；未指定时输出 A–H（兼容旧行为）
   *   startRow / endRow: 1-based 行号过滤（含两端）
   */
  function parseSheet(doc, ss, opts) {
    opts = opts || {};

    /* --- Merge cells --- */
    var merges = [], mi, mcs = tags(doc, 'mergeCell');
    for (mi = 0; mi < mcs.length; mi++) {
      var parts = (mcs[mi].getAttribute('ref') || '').split(':');
      if (parts.length !== 2) continue;
      var tl = parseCellRef(parts[0]), br = parseCellRef(parts[1]);
      if (tl && br) merges.push({ tr: tl.row, tc: tl.col, br: br.row, bc: br.col });
    }

    /* --- Cell data --- */
    var rowEls = tags(doc, 'row'), rowDataMap = {}, ri;
    for (ri = 0; ri < rowEls.length; ri++) {
      var rowEl = rowEls[ri];
      var rowNum = parseInt(rowEl.getAttribute('r'), 10);
      var colData = {};
      var cEls = rowEl.getElementsByTagName('c'), ci;
      for (ci = 0; ci < cEls.length; ci++) {
        var cEl  = cEls[ci];
        var cr   = parseCellRef(cEl.getAttribute('r') || '');
        if (!cr) continue;
        var t    = cEl.getAttribute('t') || '';
        var vEl  = cEl.getElementsByTagName('v')[0];
        var isEl = cEl.getElementsByTagName('is')[0];
        var val  = '';
        if (isEl) {
          var iTs = isEl.getElementsByTagName('t');
          for (var k = 0; k < iTs.length; k++) val += iTs[k].textContent || '';
        } else if (t === 's') {
          var idx = vEl ? parseInt(vEl.textContent, 10) : -1;
          val = (idx >= 0 && ss[idx] !== undefined) ? ss[idx] : '';
        } else {
          val = vEl ? (vEl.textContent || '') : '';
        }
        colData[cr.col] = val;
      }
      rowDataMap[rowNum] = colData;
    }

    /* --- Merge back-fill: copy TL value to sibling cells --- */
    var mm;
    for (mm = 0; mm < merges.length; mm++) {
      var mg = merges[mm];
      var tlVal = (rowDataMap[mg.tr] || {})[mg.tc];
      if (tlVal === undefined) tlVal = '';
      var mr, mc;
      for (mr = mg.tr; mr <= mg.br; mr++) {
        if (!rowDataMap[mr]) rowDataMap[mr] = {};
        for (mc = mg.tc; mc <= mg.bc; mc++) {
          if (mr === mg.tr && mc === mg.tc) continue;
          rowDataMap[mr][mc] = tlVal;
        }
      }
    }

    /* --- 确定要输出的列（0-based 索引集合） --- */
    var colIndices = opts.colIndices;
    if (!colIndices || !colIndices.length) {
      /* 向后兼容：默认 A–H（0-7） */
      colIndices = [0,1,2,3,4,5,6,7];
    }

    /* --- 行范围过滤 --- */
    var startRow = opts.startRow || 1;
    var endRow   = opts.endRow   || Infinity;

    var rowNums = Object.keys(rowDataMap).map(Number)
      .filter(function (rn) { return rn >= startRow && rn <= endRow; })
      .sort(function (a, b) { return a - b; });

    return rowNums.map(function (rn) {
      var cd = rowDataMap[rn], row = { rowIndex: rn }, c;
      for (var ci2 = 0; ci2 < colIndices.length; ci2++) {
        c = colIndices[ci2];
        row[idxToColLetter(c)] = cd[c] !== undefined ? String(cd[c]) : '';
      }
      return row;
    });
  }

  /**
   * 解析 xlsx / 伪装成 .xls 的 xlsx 文件。
   *
   * @param {ArrayBuffer} arrayBuffer 文件内容
   * @param {Object}      [options]   可选配置，不传时行为与旧版完全一致
   *   sheetIndex {number}   工作表序号（0-based），默认 0
   *   sheetName  {string}   按名称选表（优先于 sheetIndex）
   *   columns    {string[]} 列字母数组，如 ['F','I']；不传时输出 A–H
   *   startRow   {number}   起始行（1-based，含），默认 1
   *   endRow     {number}   结束行（1-based，含），默认不限
   * @returns {{ rows: Array, sheetName: string, error?: string }}
   */
  function parse(arrayBuffer, options) {
    options = options || {};
    var buf = new Uint8Array(arrayBuffer);

    /* 魔数检测：BIFF .xls 以 D0 CF 11 E0 开头，不支持 */
    if (buf[0] === 0xD0 && buf[1] === 0xCF) {
      return { rows: [], error: '不支持旧版 BIFF .xls 格式，请在 Excel 中「另存为」.xlsx 后再上传' };
    }

    var files = readZip(buf);

    /* 共享字符串 */
    var ssData = files['xl/sharedStrings.xml'];
    var ss     = ssData ? parseSharedStrings(xmlDoc(ssData)) : [];

    /* 解析工作表列表 */
    var wbSheets = parseWorkbook(files);

    /* 定位目标工作表数据 */
    var sheetData = null;
    var resolvedName = '';

    if (options.sheetName) {
      /* 按名称查找 */
      for (var si = 0; si < wbSheets.length; si++) {
        if (wbSheets[si].name === options.sheetName) {
          sheetData = files[wbSheets[si].path];
          resolvedName = wbSheets[si].name;
          break;
        }
      }
    }

    if (!sheetData) {
      /* 按 sheetIndex（默认 0）查找 */
      var idx = options.sheetIndex || 0;
      if (wbSheets[idx] && wbSheets[idx].path) {
        sheetData = files[wbSheets[idx].path];
        resolvedName = wbSheets[idx].name;
      }
    }

    /* 回退：直接找 sheet1.xml 或任意 worksheet（与旧版相同） */
    if (!sheetData) {
      sheetData = files['xl/worksheets/sheet1.xml'];
      if (!sheetData) {
        var keys = Object.keys(files), i;
        for (i = 0; i < keys.length; i++) {
          if (/xl\/worksheets\/sheet\d+\.xml/.test(keys[i])) { sheetData = files[keys[i]]; break; }
        }
      }
    }

    if (!sheetData) return { rows: [], sheetName: resolvedName };

    /* 列字母 → 0-based 索引 */
    var colIndices = null;
    if (options.columns && options.columns.length) {
      colIndices = options.columns.map(function (c) {
        return colLetterIdx(c.trim().toUpperCase());
      });
    }

    var sheetOpts = {
      colIndices: colIndices,
      startRow:   options.startRow || null,
      endRow:     options.endRow   || null
    };

    return { rows: parseSheet(xmlDoc(sheetData), ss, sheetOpts), sheetName: resolvedName };
  }

  return { parse: parse };
}());
