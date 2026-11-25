/* /api/admin/site-content —— 后台「站点数据」编辑器
   ──────────────────────────────────────────────────────────────
   GET    列出所有 key 的配置状态（不含正文，避免列表接口传 500KB）
   GET  ?key=xxx  读单条正文（text 字段）
   POST  { key, text }  保存；{ batch: [{key,text}] } 批量导入
   DELETE ?key=xxx  删除该条 → 公开端回退到本地脱敏副本

   key 固定白名单，requireAdmin + CSRF，跟其他后台接口同一套鉴权。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, fail, json, requireAdmin } from '../../lib/admin-auth.js';
import {
  KEY_LIST, isKey, readContent, listContent, writeContent, writeMany, deleteContent, validatePayload,
} from '../../lib/site-content.js';
import { syncKb } from '../../lib/kb-sync.js';

/* 站点数据是知识库的真相源：保存成功后顺手重建检索索引。
   用 waitUntil 放到响应之后跑，失败只记日志，不影响保存结果。 */
function kickKb(context, env, keys) {
  if (!keys || !keys.includes('site-data')) return;
  if (!context || typeof context.waitUntil !== 'function') return;
  context.waitUntil(syncKb(env));
}

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (key) {
    if (!isKey(key)) return fail('bad_key', '未知的数据项');
    const row = await readContent(env, key);
    return json({
      ok: true,
      key,
      text: row ? row.payload : null,
      configured: !!row,
      updated_at: row ? row.updated_at : null,
    });
  }

  const rows = await listContent(env);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return json({
    ok: true,
    keys: KEY_LIST.map((k) => {
      const r = byKey.get(k);
      return {
        key: k,
        configured: !!r,
        size: r ? r.size : 0,
        updated_at: r ? r.updated_at : null,
      };
    }),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  if (body && Array.isArray(body.batch)) {
    const err = validateBatch(body.batch);
    if (err) return fail(err.error, err.message);
    const r = await writeMany(env, body.batch, 'admin');
    kickKb(context, env, body.batch.map((x) => x.key));
    return json({ ok: true, saved: r.ok, failed: r.failed });
  }

  const key = body && body.key;
  if (!isKey(key)) return fail('bad_key', '未知的数据项');
  const err = validatePayload(body.text);
  if (err) {
    const messages = {
      empty_payload: '内容不能为空',
      payload_too_large: '内容超过 2MB 上限',
      payload_not_object: '顶层必须是 JSON 对象',
      bad_json: '不是合法 JSON',
    };
    return fail(err, messages[err] || '内容不合法');
  }

  try {
    await writeContent(env, key, body.text, 'admin');
  } catch (e) {
    return json({ ok: false, error: 'db_error', message: '写入失败' }, 500);
  }
  kickKb(context, env, [key]);
  return json({ ok: true, key, size: body.text.length });
}

function validateBatch(batch) {
  if (batch.length > KEY_LIST.length) return { error: 'batch_too_large', message: '批量条目过多' };
  for (const e of batch) {
    if (!e || !isKey(e.key)) return { error: 'bad_key', message: '批量里有未知的数据项' };
    const err = validatePayload(e.text);
    if (err) return { error: err, message: '批量里有内容不合法：' + e.key };
  }
  return null;
}

export async function onRequestDelete({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!isKey(key)) return fail('bad_key', '未知的数据项');
  await deleteContent(env, key);
  return json({ ok: true, key, configured: false });
}
