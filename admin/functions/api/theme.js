/* /api/theme —— 站点默认主题（后台可改）
   ──────────────────────────────────────────────────────────────
   GET  当前默认主题（admin_config.key = 'theme'）
   POST { theme } 设置；theme 只能是四套配色之一或 ''（清空 = 恢复默认橙色 archive，不再按日期轮换）
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, json, fail, requireAdmin } from '../../lib/admin.js';

export const THEMES = [
  { id: 'archive', name: '档案纸', note: '米黄纸 + 墨黑 + 朱橙（当前主视觉）' },
  { id: 'blueprint', name: '工程蓝图', note: '淡蓝图纸 + 藏青墨 + 印章红' },
  { id: 'newsprint', name: '复古新闻纸', note: '米黄 + 纯黑 + 报头红' },
  { id: 'noir', name: '夜色霓虹', note: '深底 + 霓虹粉/青，对比最强' },
];

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  try {
    const row = await env.DB.prepare("SELECT value, updated_at FROM admin_config WHERE key = 'theme'").first();
    const saved = row ? JSON.parse(row.value) : {};
    return json({
      ok: true,
      theme: saved.theme || '',
      updated_at: row ? row.updated_at : 0,
      themes: THEMES,
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
  const theme = String(body.theme || '');
  if (theme && !THEMES.some((t) => t.id === theme)) return fail('bad_theme', '未知主题');
  try {
    await env.DB.prepare(
      `INSERT INTO admin_config (key, value, updated_at) VALUES ('theme', ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(JSON.stringify({ theme }), Date.now()).run();
    return json({ ok: true, theme });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
