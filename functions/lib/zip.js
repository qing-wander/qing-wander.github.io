/* ──────────────────────────────────────────────────────────────────────
   自动投递 · 零依赖 ZIP 打包器（Cloudflare Workers 兼容）
   ──────────────────────────────────────────────────────────────────────
   Workers 运行时没有 Node 的 zlib / Buffer，也不能直接 npm 依赖未打包的库。
   这里用 ZIP 的 STORE（不压缩）方式手写：PDF 本身已是压缩格式，再 deflate
   收益极小；换来的是零依赖、可测试、中文文件名用 UTF-8 flag 正确编码。

   createZip([{name, bytes:Uint8Array}]) → Uint8Array
   ────────────────────────────────────────────────────────────────────── */

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
}
function dosDate(d) {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

export function createZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(String(f.name || 'file'));
    const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
    const crc = crc32(data);
    const flag = 0x0800; // bit 11：文件名为 UTF-8，中文不会乱码

    const head = new Uint8Array(30 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);        // version needed
    hv.setUint16(6, flag, true);
    hv.setUint16(8, 0, true);         // STORE
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, data.length, true);
    hv.setUint32(22, data.length, true);
    hv.setUint16(26, name.length, true);
    hv.setUint16(28, 0, true);        // extra length
    head.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // version made by
    cv.setUint16(6, 20, true);        // version needed
    cv.setUint16(8, flag, true);
    cv.setUint16(10, 0, true);        // STORE
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);        // extra
    cv.setUint16(32, 0, true);        // comment
    cv.setUint16(34, 0, true);        // disk number
    cv.setUint16(36, 0, true);        // internal attrs
    cv.setUint32(38, 0, true);        // external attrs
    cv.setUint32(42, offset, true);   // local header offset
    cen.set(name, 46);

    localParts.push(head, data);
    centralParts.push(cen);
    offset += head.length + data.length;
  }

  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const parts = localParts.concat(centralParts, [eocd]);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
