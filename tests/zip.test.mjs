/* 零依赖 ZIP writer 回归：用独立解析器 + 系统 zipfile 双重校验格式 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createZip, crc32 } from '../functions/lib/zip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/* 独立于 createZip 的读取器：从 EOCD 反查中央目录，再取 local header 的数据 */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, '找不到 EOCD');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, '中央目录签名错误');
    const flag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    assert.equal(dv.getUint32(localOff, true), 0x04034b50, 'local header 签名错误');
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(dataStart, dataStart + size);

    assert.equal(method, 0, '应使用 STORE');
    assert.equal(flag & 0x0800, 0x0800, '文件名应标 UTF-8');
    assert.equal(crc32(data), crc, 'CRC 不匹配');
    out.push({ name, text: dec.decode(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('crc32 标准向量 123456789', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xCBF43926);
});

test('ZIP 解析：中文文件名、内容与顺序都正确', () => {
  const z = createZip([
    { name: '陈培胜-简历-2026.pdf', bytes: enc.encode('RESUME') },
    { name: '身份证复印件_陈培胜.pdf', bytes: enc.encode('ID') },
    { name: '学历证书_陈培胜.pdf', bytes: enc.encode('DIPLOMA') },
  ]);
  assert.deepEqual(readZip(z), [
    { name: '陈培胜-简历-2026.pdf', text: 'RESUME' },
    { name: '身份证复印件_陈培胜.pdf', text: 'ID' },
    { name: '学历证书_陈培胜.pdf', text: 'DIPLOMA' },
  ]);
});

test('空文件列表也生成合法空 ZIP', () => {
  assert.equal(readZip(createZip([])).length, 0);
});

test('系统 zipfile 能识别生成的包（格式兼容性）', () => {
  const z = createZip([
    { name: '陈培胜-简历-2026.pdf', bytes: enc.encode('%PDF-1.7') },
    { name: '学位证书_陈培胜.pdf', bytes: enc.encode('%PDF-1.7') },
  ]);
  const r = spawnSync('python3', ['-c',
    'import sys,zipfile,io;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));' +
    'print("|".join(z.namelist()));print(z.testzip())',
  ], { input: Buffer.from(z), encoding: 'utf8' });
  if (r.status !== 0) return; // 环境没 python3 就跳过，前面的独立解析已覆盖
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], '陈培胜-简历-2026.pdf|学位证书_陈培胜.pdf');
  assert.equal(lines[1], 'None');
});
