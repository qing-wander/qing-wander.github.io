/* 站点内容云端真相源（公开仓库脱敏后，真人数据只在这里）
   ──────────────────────────────────────────────────────────────
   仓库里的 data/*.json 是给 CI / 本地预览用的脱敏占位副本；
   线上访客请求 /data/* 时由 Functions 拦截，从 D1 的 site_content 读真人数据。
   后台「站点数据」面板编辑同一张表，改完即时生效，不用重新构建。

   安全边界：
   · key 固定白名单，外部塞不进任意 key；
   · payload 必须是合法 JSON，且不超过 MAX_PAYLOAD（防止撑爆 D1）；
   · 公开读取只给白名单 key，不暴露 updated_by 等内部字段。
   ────────────────────────────────────────────────────────────── */

export const MAX_PAYLOAD = 2 * 1024 * 1024; // 2MB，最大的 company-profiles 约 150KB

/* key → 前端全局变量名。快照格式由对应的 sync_*.py 约定，必须逐字一致。 */
export const KEYS = Object.freeze({
  'site-data':         { global: 'SITE_DATA',         file: 'site-data.js',         kind: 'json' },
  'company-profiles':  { global: 'COMPANY_PROFILES',  file: 'company-profiles.js',  kind: 'json' },
  'school-profiles':   { global: 'SCHOOL_PROFILES',   file: 'school-profiles.js',   kind: 'json' },
  'people':            { global: 'PEOPLE',            file: 'people.js',            kind: 'json' },
  'contributions':     { global: null,                file: 'contributions.json',   kind: 'json' },
  'work-details':      { global: null,                file: 'work-details.json',    kind: 'json' },
  'asset-manifest':    { global: null,                file: 'asset-manifest.json',  kind: 'json' },
});

export const KEY_LIST = Object.keys(KEYS);

export function isKey(key) {
  return Object.prototype.hasOwnProperty.call(KEYS, key);
}

/* 把 key 映射到 /data/<file>。反过来供拦截路由解析。 */
const BY_FILE = Object.freeze(Object.fromEntries(
  KEY_LIST.map((k) => [KEYS[k].file, k])
));

export function keyForFile(file) {
  return BY_FILE[file] || null;
}

/* 序列化成前端脚本：与 scripts/sync_*.py 的输出格式保持逐字一致。
   site-data 快照历史上剔除了 resume 块（体积大且只在生成页用），这里照旧。 */
export function toSnapshot(key, payloadText) {
  const meta = KEYS[key];
  if (!meta || !meta.global) return null;
  let data = JSON.parse(payloadText);
  if (key === 'site-data' && data && typeof data === 'object' && data.resume) {
    const clone = { ...data };
    delete clone.resume;
    data = clone;
  }
  const header = '/* 云端真相源：由 /data/' + meta.file + ' 提供（后台「站点数据」可编辑），请勿手改。 */\n';
  return header + 'window.' + meta.global + ' = ' + JSON.stringify(data) + ';\n';
}

/* ── 读 ───────────────────────────────────────────────────────── */

export async function readContent(env, key) {
  if (!isKey(key) || !env || !env.DB) return null;
  const row = await env.DB.prepare(
    'SELECT payload, updated_at, updated_by FROM site_content WHERE key = ?'
  ).bind(key).first();
  if (!row) return null;
  return {
    key,
    payload: row.payload,
    updated_at: row.updated_at,
    updated_by: row.updated_by || '',
  };
}

export async function listContent(env) {
  if (!env || !env.DB) return [];
  const r = await env.DB.prepare(
    'SELECT key, payload, updated_at, updated_by FROM site_content ORDER BY key'
  ).all();
  return (r.results || []).map((row) => ({
    key: row.key,
    size: (row.payload || '').length,
    updated_at: row.updated_at,
    updated_by: row.updated_by || '',
    configured: isKey(row.key),
  }));
}

/* ── 写 ───────────────────────────────────────────────────────── */

/* 校验 payload：合法 JSON + 体积上限。返回 error 或 null。 */
export function validatePayload(text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty_payload';
  if (text.length > MAX_PAYLOAD) return 'payload_too_large';
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'payload_not_object';
  } catch (e) {
    return 'bad_json';
  }
  return null;
}

export async function writeContent(env, key, payload, updatedBy) {
  if (!isKey(key) || !env || !env.DB) return false;
  const err = validatePayload(payload);
  if (err) return false;
  await env.DB.prepare(
    `INSERT INTO site_content (key, payload, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       payload = excluded.payload, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(key, payload, Date.now(), String(updatedBy || 'admin').slice(0, 64)).run();
  return true;
}

export async function deleteContent(env, key) {
  if (!isKey(key) || !env || !env.DB) return false;
  await env.DB.prepare('DELETE FROM site_content WHERE key = ?').bind(key).run();
  return true;
}

/* 批量导入：一次 POST 多份，用于初次从本地脱敏副本迁移真人数据。 */
export async function writeMany(env, entries, updatedBy) {
  if (!env || !env.DB) return { ok: 0, failed: [] };
  let ok = 0;
  const failed = [];
  for (const e of entries) {
    if (!e || !isKey(e.key) || validatePayload(e.payload)) {
      failed.push(e && e.key ? e.key : '(invalid)');
      continue;
    }
    await writeContent(env, e.key, e.payload, updatedBy);
    ok++;
  }
  return { ok, failed };
}
