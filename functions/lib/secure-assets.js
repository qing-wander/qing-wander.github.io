/* ──────────────────────────────────────────────────────────────────────
   私密材料注册表 + 私有对象存储读取（通用能力，不绑定具体业务页面）
   ──────────────────────────────────────────────────────────────────────
   背景：离职证明 / 学历验证码 / 未来任何带隐私的佐证材料，原件都不能进
   公开仓库，也不能放进「公有读」的 COS 桶（那样任何人猜到路径就能拖走）。
   本项目线上可用的私有对象存储是 Cloudflare KV（真实简历 PDF 已用它），
   R2 因账号未开通已废弃；COS 桶是 public-read，只适合放公开静态资源。

   存储后端（可插拔，前端无感）：
     ① kv（默认）：二进制在 SITE_KV 键 secure-asset:<id>，
        元数据在 secure-asset-meta:<id>，由 scripts/upload-secure-assets.mjs 写入。
     ② cos（可选）：配好 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
        后，服务端用 COS 签名（q-sign-algorithm=sha1）拉取私有对象，
        原件可由同一上传脚本以 --to cos 写入（对象 ACL 必须 private）。

   ⚠️ 前端永远拿不到这里的原始存储地址：只能拿到 /api/secure-asset 的
      短时效签名 URL，由 functions/api/secure-asset.js 校验后代理读取。
   ────────────────────────────────────────────────────────────────────── */

export const ASSET_KV_PREFIX = 'secure-asset:';
export const ASSET_META_PREFIX = 'secure-asset-meta:';

/* 资源注册表：key 形如 `<type>:<target>`，target 与站点数据里的公司 / 学校 id 对齐。
   status: available = 原件已上传；pending = 材料待补充（页面显示「整理中」）。
   将来新增资源只需在这里加一项 + 在展示数据里加 secureMaterials 段，
   申请 / 审批 / 签名 / 续期全流程不用改一行代码。 */
export const MATERIALS = Object.freeze({
  'company-material:comein': [
    { id: 'leaving-comein', label: '离职证明', issuer: '深圳进门财经科技股份有限公司',
      date: '2026-07-16', contentType: 'image/jpeg', status: 'available' },
  ],
  'company-material:zhishu': [
    { id: 'leaving-zhishu', label: '离职证明', issuer: '深圳指数引力科技有限公司',
      date: '2025-11-18', contentType: 'image/jpeg', status: 'available' },
  ],
  'company-material:fanggeek': [
    { id: 'leaving-fanggeek', label: '离职证明', issuer: '深圳市房极客网络科技有限公司',
      date: '2024-01-11', contentType: 'image/jpeg', status: 'available' },
  ],
  'company-material:chowsang': [
    { id: 'leaving-chowsang', label: '离职证明', issuer: '周生生（中国）商业有限公司',
      date: '', contentType: 'image/jpeg', status: 'pending' },
  ],
});

export function listMaterials(resource) {
  return MATERIALS[String(resource || '')] || [];
}

export function findMaterial(resource, assetId) {
  return listMaterials(resource).find((m) => m.id === String(assetId || '')) || null;
}

/* 只有「已上传」的材料才允许签发链接，pending 的材料不会误发空对象 */
export function availableMaterials(resource) {
  return listMaterials(resource).filter((m) => m.status === 'available');
}

export function cosConfig(env) {
  const id = String((env && env.COS_SECRET_ID) || '').trim();
  const key = String((env && env.COS_SECRET_KEY) || '').trim();
  const bucket = String((env && env.COS_BUCKET) || '').trim();
  const region = String((env && env.COS_REGION) || 'ap-shanghai').trim();
  const prefix = String((env && env.COS_PRIVATE_PREFIX) || 'qing-wander/private/').trim();
  if (!id || !key || !bucket) return null;
  return { id, key, bucket, region, prefix, token: String((env && env.COS_SESSION_TOKEN) || '').trim() };
}

async function hmacSha1Hex(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* COS 签名 v5（Authorization 头），只用于服务端私有读，不下发给浏览器。
   文档：q-sign-algorithm=sha1 & q-ak & q-sign-time & q-key-time & q-signature */
export async function cosAuthHeader(cfg, objectKey, now = Date.now()) {
  const start = Math.floor(now / 1000) - 30;
  const end = Math.floor(now / 1000) + 600;
  const keyTime = start + ';' + end;
  const signKey = await hmacSha1Hex(cfg.key, keyTime);
  const path = '/' + String(objectKey).split('/').map(encodeURIComponent).join('/');
  const httpString = 'get\n' + path + '\n\nhost=' +
    cfg.bucket + '.cos.' + cfg.region + '.myqcloud.com\n';
  const stringToSign = 'sha1\n' + keyTime + '\n' + (await sha1Hex(httpString)) + '\n';
  const signature = await hmacSha1Hex(signKey, stringToSign);
  return 'q-sign-algorithm=sha1&q-ak=' + cfg.id +
    '&q-sign-time=' + keyTime + '&q-key-time=' + keyTime +
    '&q-header-list=host&q-url-param-list=&q-signature=' + signature;
}

/* 读元数据：KV 里是 JSON 文本；没有元数据时用注册表里的 contentType 兜底 */
async function readMeta(env, assetId) {
  const kv = env && env.SITE_KV;
  if (!kv) return {};
  try {
    const raw = await kv.get(ASSET_META_PREFIX + assetId, { type: 'text' });
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

async function readFromCos(env, assetId, meta) {
  const cfg = cosConfig(env);
  if (!cfg) return null;
  const objectKey = String(meta.cosKey || (cfg.prefix + assetId + '.jpg'));
  const url = 'https://' + cfg.bucket + '.cos.' + cfg.region + '.myqcloud.com/' +
    objectKey.split('/').map(encodeURIComponent).join('/');
  const headers = { Authorization: await cosAuthHeader(cfg, objectKey) };
  if (cfg.token) headers['x-cos-security-token'] = cfg.token;
  const res = await fetch(url, { method: 'GET', headers }).catch(() => null);
  if (!res || !res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

async function readFromKv(env, assetId) {
  const kv = env && env.SITE_KV;
  if (!kv) return null;
  try {
    const buf = await kv.get(ASSET_KV_PREFIX + assetId, { type: 'arrayBuffer' });
    if (!buf || !buf.byteLength) return null;
    return new Uint8Array(buf);
  } catch (e) {
    return null;
  }
}

/* 统一读口：返回 { bytes, contentType, meta }；取不到返回 null。
   后端由元数据的 backend 字段决定；没写就默认 KV。 */
export async function readAsset(env, assetId) {
  const meta = await readMeta(env, assetId);
  let bytes = null;
  if (meta.backend === 'cos') bytes = await readFromCos(env, assetId, meta);
  else bytes = await readFromKv(env, assetId);
  if (!bytes) return null;
  return {
    bytes,
    contentType: String(meta.contentType || 'application/octet-stream'),
    meta,
  };
}
