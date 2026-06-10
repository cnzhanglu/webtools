/**
 * 生成 PWA 图标（无第三方依赖）
 * 运行：node scripts/generate-icons.js
 */
var zlib = require('zlib');
var fs   = require('fs');
var path = require('path');

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32.table[i] = c >>> 0;
    }
  }
  var crc = 0xffffffff;
  for (var j = 0; j < buf.length; j++) {
    crc = crc32.table[(crc ^ buf[j]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var typeBuf = Buffer.from(type);
  var crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createIcon(size) {
  var rawRows = [];
  var cx = size / 2;
  var cy = size / 2;
  var radius = size * 0.38;

  for (var y = 0; y < size; y++) {
    var row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (var x = 0; x < size; x++) {
      var i = 1 + x * 4;
      var dist = Math.hypot(x - cx, y - cy);
      if (dist <= radius) {
        row[i] = 37; row[i + 1] = 99; row[i + 2] = 168; row[i + 3] = 255;
      } else if (dist <= radius + size * 0.04) {
        row[i] = 26; row[i + 1] = 58; row[i + 2] = 92; row[i + 3] = 255;
      } else {
        row[i] = 240; row[i + 1] = 242; row[i + 2] = 245; row[i + 3] = 255;
      }

      if (size >= 96) {
        var ts = size * 0.22;
        var inH = y >= cy - ts * 0.5 && y <= cy - ts * 0.2 && x >= cx - ts && x <= cx + ts;
        var inV = y >= cy - ts * 0.5 && y <= cy + ts * 0.8 && x >= cx - ts * 0.2 && x <= cx + ts * 0.2;
        if (inH || inV) {
          row[i] = 255; row[i + 1] = 255; row[i + 2] = 255; row[i + 3] = 255;
        }
      }
    }
    rawRows.push(row);
  }

  var compressed = zlib.deflateSync(Buffer.concat(rawRows), { level: 9 });
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

var outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
[192, 512].forEach(function (s) {
  fs.writeFileSync(path.join(outDir, 'icon-' + s + '.png'), createIcon(s));
  console.log('wrote icons/icon-' + s + '.png');
});
