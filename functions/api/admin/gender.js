/* /api/admin/gender —— 公开站展示套装（后台可改）
   ──────────────────────────────────────────────────────────────
   GET  当前套装（admin_config.key = 'gender'）
   POST { gender } 设置；gender 只能是 male / female 或 ''（清空 = 跟随站点数据默认）
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, json, fail, requireAdmin } from '../../lib/admin-auth.js';

export const GENDERS = [
  { id: 'male', name: '男版套装', note: '男声 + 男头像 + 男模型' },
  { id: 'female', name: '女版套装', note: '女声 + 女头像 + 女模型' },
];

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  try {
    const row = await env.DB.prepare("SELECT value, updated_at FROM admin_config WHERE key = 'gender'").first();
    const saved = row ? JSON.parse(row.value) : {};
    return json({
      ok: true,
      gender: saved.gender || '',
      updated_at: row ? row.updated_at : 0,
      genders: GENDERS,
    });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }
  const gender = String(body.gender || '');
  if (gender && !GENDERS.some((g) => g.id === gender)) return fail('bad_gender', '未知套装');
  try {
    await env.DB.prepare(
      `INSERT INTO admin_config (key, value, updated_at) VALUES ('gender', ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(JSON.stringify({ gender }), Date.now()).run();
    return json({ ok: true, gender });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
