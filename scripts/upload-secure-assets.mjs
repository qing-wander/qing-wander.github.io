#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   私密材料上传：本地图片 → 私有对象存储（KV 默认 / COS 可选）
   ──────────────────────────────────────────────────────────────────────
   用法：
     node scripts/upload-secure-assets.mjs --dry-run
     node scripts/upload-secure-assets.mjs
     node scripts/upload-secure-assets.mjs --source leaving-chowsang=~/Downloads/xxx.jpg
     node scripts/upload-secure-assets.mjs --to cos            # 需 COS_* 凭证 + SDK
     node scripts/upload-secure-assets.mjs --only leaving-comein

   流程：找源图 → 按注册表旋转到正立 → 等比缩到 2200px → JPEG 质量 82
   （去掉 EXIF，减小体积）→ 算 sha256 → 写二进制 + 元数据到存储。

   KV：键 secure-asset:<id>（二进制）、secure-asset-meta:<id>（JSON）。
   COS：对象放 qing-wander/private/ 下，单对象 ACL=private（桶是 public-read，
        必须显式私有），元数据 backend=cos；服务端用 COS_* 密钥签名私有读。

   环境变量：
     SITE_KV_ID          KV namespace id（默认项目已有命名空间）
     WRANGLER_BIN        wrangler.js 路径（可选，避免 npx 解析）
     TMP_SECRET_ID / TMP_SECRET_KEY / TMP_TOKEN   临时密钥（--to cos）
     COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION（--to cos）
   ────────────────────────────────────────────────────────────────────── */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.temp', 'secure-assets');
const KV_NS = process.env.SITE_KV_ID || 'f5253a16b4d84a20a32c0cd497b1f269';
const ASSET_KV_PREFIX = 'secure-asset:';
const ASSET_META_PREFIX = 'secure-asset-meta:';

/* 与 functions/lib/secure-assets.js 的 MATERIALS 一一对应。
   rotate = PIL 逆时针角度：进门财经正立、指数引力转 180°、房极客转 90°。 */
const ASSETS = {
  'leaving-comein':   { resource: 'company-material:comein',   label: '离职证明', rotate: 0,   pattern: /离职证明_进门财经/i },
  'leaving-zhishu':   { resource: 'company-material:zhishu',   label: '离职证明', rotate: 180, pattern: /离职证明_指数引力/i },
  'leaving-fanggeek': { resource: 'company-material:fanggeek', label: '离职证明', rotate: 90,  pattern: /离职证明_房极客|clipboard-2026-11-25T10-15-31/i },
  'leaving-chowsang': { resource: 'company-material:chowsang', label: '离职证明', rotate: 0,   pattern: /离职证明_周生生|离职证明_chowsang/i },
};

const SEARCH_DIRS = [
  join(homedir(), 'Downloads'),
  join(homedir(), '.workbuddy', 'clipboard-images'),
  ROOT,
];
const IMG_RE = /\.(jpe?g|png|webp|heic|tiff?)$/i;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const toCos = args.includes('--to') && args[args.indexOf('--to') + 1] === 'cos';

function opt(name) {
  const i = args.findIndex((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (i < 0) return '';
  const eq = args[i].indexOf('=');
  return eq > 0 ? args[i].slice(eq + 1) : (args[i + 1] || '');
}
const only = opt('only');
const explicit = {};
for (const a of args) {
  const m = /^--source=([a-z0-9_-]+)=(.+)$/i.exec(a);
  if (m) explicit[m[1]] = resolve(m[2].replace(/^~/, homedir()));
}

const PY_PREPARE = `
import sys
from PIL import Image, ImageOps
src, dst, rot = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = ImageOps.exif_transpose(Image.open(src))
if rot:
    im = im.rotate(rot, expand=True)
im.thumbnail((2200, 2200), Image.LANCZOS)
if im.mode != 'RGB':
    im = im.convert('RGB')
im.save(dst, 'JPEG', quality=82, optimize=True, progressive=True)
print('%dx%d' % im.size)
`;

function findSource(id, cfg) {
  if (explicit[id]) return explicit[id];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    const hits = readdirSync(dir)
      .filter((f) => cfg.pattern.test(f) && IMG_RE.test(f))
      .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (hits.length) return hits[0].path;
  }
  return '';
}

function wrangler(extra) {
  const bin = process.env.WRANGLER_BIN;
  const cmd = bin ? process.execPath : 'npx';
  const pre = bin ? [bin] : ['--yes', 'wrangler'];
  return spawnSync(cmd, [...pre, ...extra], { cwd: ROOT, encoding: 'utf8', env: process.env });
}

async function putCos(cfg, key, file) {
  let mod;
  try { mod = await import('cos-nodejs-sdk-v5'); }
  catch (e) {
    throw new Error('缺少 cos-nodejs-sdk-v5，请先执行 npm i -D cos-nodejs-sdk-v5');
  }
  const COS = mod.default || mod;
  const client = new COS({
    SecretId: process.env.TMP_SECRET_ID || process.env.COS_SECRET_ID,
    SecretKey: process.env.TMP_SECRET_KEY || process.env.COS_SECRET_KEY,
    SecurityToken: process.env.TMP_TOKEN || process.env.COS_SESSION_TOKEN || undefined,
  });
  const bucket = process.env.COS_BUCKET || '7265-resume-ai-d9g7zghnxda2ee2cb-1307508155';
  const region = process.env.COS_REGION || 'ap-shanghai';
  const prefix = process.env.COS_PRIVATE_PREFIX || 'qing-wander/private/';
  const objectKey = prefix + key;
  await new Promise((res, rej) => {
    client.putObject({
      Bucket: bucket, Region: region, Key: objectKey,
      Body: readFileSync(file),
      Headers: { 'x-cos-acl': 'private' },   // 桶是 public-read，单对象必须显式私有
      ContentType: 'image/jpeg',
    }, (err, data) => err ? rej(err) : res(data));
  });
  return { bucket, region, cosKey: objectKey };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ids = Object.keys(ASSETS).filter((id) => !only || id === only);
  let uploaded = 0;
  for (const id of ids) {
    const cfg = ASSETS[id];
    const src = findSource(id, cfg);
    if (!src || !existsSync(src)) {
      console.log(`⊘ ${id}: 未找到源图，跳过（可用 --source ${id}=/path 指定）`);
      continue;
    }
    const img = join(OUT, id + '.jpg');
    const prepared = spawnSync('python3', ['-c', PY_PREPARE, src, img, String(cfg.rotate)],
      { encoding: 'utf8' });
    if (prepared.status !== 0) {
      console.error(`✗ ${id}: 图片处理失败 ${String(prepared.stderr).slice(0, 300)}`);
      process.exitCode = 2;
      continue;
    }
    const bytes = readFileSync(img);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const meta = {
      id, resource: cfg.resource, label: cfg.label, backend: toCos ? 'cos' : 'kv',
      contentType: 'image/jpeg', size: bytes.length, sha256,
      uploadedAt: new Date().toISOString(), sourceName: src.split('/').pop(),
    };
    console.log(`${dryRun ? '·' : '→'} ${id}: ${prepared.stdout.trim()} · ${(bytes.length / 1024).toFixed(0)}KB · sha256 ${sha256.slice(0, 12)}… · 源 ${src.split('/').pop()}`);
    if (dryRun) continue;

    if (toCos) {
      const info = await putCos(cfg, id + '.jpg', img);
      meta.cosKey = info.cosKey;
      meta.cosBucket = info.bucket;
      meta.cosRegion = info.region;
    } else {
      const r1 = wrangler(['kv', 'key', 'put', ASSET_KV_PREFIX + id, '--namespace-id', KV_NS,
        '--path', img, '--remote']);
      if (r1.status !== 0) {
        console.error(`✗ ${id}: KV 二进制写入失败 ${String(r1.stderr || r1.stdout).slice(0, 300)}`);
        process.exitCode = 3;
        continue;
      }
    }
    const metaFile = join(OUT, id + '.meta.json');
    writeFileSync(metaFile, JSON.stringify(meta));
    const r2 = wrangler(['kv', 'key', 'put', ASSET_META_PREFIX + id, '--namespace-id', KV_NS,
      '--path', metaFile, '--remote']);
    if (r2.status !== 0) {
      console.error(`✗ ${id}: KV 元数据写入失败 ${String(r2.stderr || r2.stdout).slice(0, 300)}`);
      process.exitCode = 3;
      continue;
    }
    console.log(`  ✓ 已上传 ${toCos ? 'COS 私有对象 + KV 元数据' : 'KV'}：${ASSET_KV_PREFIX}${id}`);
    uploaded++;
  }
  console.log(dryRun ? `（dry-run 结束，共可处理 ${ids.length} 项）` : `完成，上传 ${uploaded} 份材料`);
}

main().catch((e) => { console.error('上传失败：' + (e && e.message || e)); process.exit(1); });
