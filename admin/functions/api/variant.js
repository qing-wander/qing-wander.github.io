/* POST /api/variant —— 后台代理「贴 JD 生成变体」
   ──────────────────────────────────────────────────────────────
   后台与主站不同域名，浏览器直连会撞 CORS；这里在服务端转发，
   顺带把鉴权与 CSRF 校验拦在前面（主站的 /api/variant 是公开接口）。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, json, fail, requireAdmin } from '../../lib/admin.js';

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }
  const jd = String(body.jd || '').trim();
  if (jd.length < 20) return fail('jd_too_short', 'JD 至少 20 字');

  const base = String(env.MAIN_SITE_URL || 'https://shenge-work.pages.dev').replace(/\/$/, '');
  const r = await fetch(`${base}/api/variant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jd }),
  }).catch(() => null);
  if (!r) return json({ ok: false, error: 'upstream_unreachable', message: '主站接口不可达' }, 502);

  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    return json({ ok: false, error: d.error || 'upstream_error', message: d.message || '生成失败' }, r.status === 200 ? 502 : r.status);
  }
  return json({ ok: true, html: d.html, stats: d.stats });
}
