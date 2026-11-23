import cos from 'cos-nodejs-sdk-v5';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/shenge/Documents/chenpeisheng.cn';
const BUCKET = '7265-resume-ai-d9g7zghnxda2ee2cb-1307508155';
const REGION = 'ap-shanghai';
const PREFIX = 'shenge-work/';
const BASE_URL = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${PREFIX}`;

const client = new cos({
  SecretId: process.env.TMP_SECRET_ID,
  SecretKey: process.env.TMP_SECRET_KEY,
  SecurityToken: process.env.TMP_TOKEN,
});

//  MIME 映射
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

// 收集待上传文件：images/ videos/ assets/skins/models/ 根 favicon
function collect(dir, filter) {
  const out = [];
  if (!fs.existsSync(path.join(ROOT, dir))) return out;
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(rel, filter));
    else if (!filter || filter(rel)) out.push(rel);
  }
  return out;
}

const files = [
  ...collect('images'),
  ...collect('videos'),
  ...collect('assets/skins/models'),
  'favicon.png', 'favicon-64.png',
].filter((f) => !f.endsWith('.DS_Store'))
  // 分享卡（竖版/方形原图 + 预览）故意不上 COS：卡里的二维码与印刷域名会随
  // 站点自定义域名改版重绘，而 COS 是 max-age=31536000, immutable 长缓存，
  // 同名覆盖后 CDN 仍会发旧图。让它们始终走站点本地路径，改图 push 即生效。
  // 对应 data/asset-map.js / asset-manifest.json 里也已移除这 6 条映射。
  .filter((f) => !f.includes('分享卡'));

console.log(`待上传 ${files.length} 个文件`);

// ── 前置：确保桶公有读 + CORS 放行 ─────────────────────────────────
// 3D 模型（model-viewer）用 fetch 加载 GLB，必须有 CORS 头，否则浏览器拦截 → 模型不显示。
// <img>/<video> 不受 CORS 限制，所以只有 GLB 会挂。每次同步都兜底配置，避免漏配。
const ensure = async () => {
  await new Promise((resolve, reject) => {
    client.putBucketAcl({ Bucket: BUCKET, Region: REGION, ACL: 'public-read' },
      (err) => err ? reject(err) : resolve());
  });
  console.log('桶 ACL: public-read ✓');
  await new Promise((resolve, reject) => {
    client.putBucketCors({
      Bucket: BUCKET, Region: REGION,
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: ['*'],
          AllowedMethods: ['GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['Content-Length', 'Content-Type', 'ETag', 'Last-Modified'],
          MaxAgeSeconds: 86400,
        }],
      },
    }, (err) => err ? reject(err) : resolve());
  });
  console.log('桶 CORS: GET/HEAD 放行 ✓');
};
try {
  await ensure();
} catch (e) {
  console.error(`桶配置失败（需 cos:* 权限的临时密钥）: ${e.code || ''} ${e.message || ''}`);
  console.error('如果无法配置，请确认临时密钥 Policy 含 cos:PutBucketAcl 与 cos:PutBucketCors。');
}

const manifest = {};
let ok = 0, fail = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const ext = path.extname(rel).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  // 缓存策略：图片/模型长缓存，视频也长缓存（内容寻址式路径，换文件换名）
  const cacheControl = 'public, max-age=31536000, immutable';
  try {
    const data = await new Promise((resolve, reject) => {
      client.putObject({
        Bucket: BUCKET, Region: REGION,
        Key: PREFIX + rel,
        Body: fs.readFileSync(abs),
        ContentType: contentType,
        CacheControl: cacheControl,
      }, (err, d) => err ? reject(err) : resolve(d));
    });
    manifest[rel] = BASE_URL + rel;
    ok++;
    console.log(`OK  ${rel} -> ${data.ETag || ''}`);
  } catch (e) {
    fail++;
    console.error(`FAIL ${rel}: ${e.code || ''} ${e.message || ''}`);
  }
}

const manifestPath = path.join(ROOT, 'data', 'asset-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify({
  _generated: new Date().toISOString(),
  _source: 'tencent-cloudbase-cos',
  _bucket: BUCKET,
  _prefix: PREFIX,
  _baseUrl: BASE_URL,
  files: manifest,
}, null, 2) + '\n');

console.log(`\n完成: 成功 ${ok}, 失败 ${fail}`);
console.log(`manifest: ${manifestPath}`);
