/* POST /api/messages/status —— 隐藏 / 恢复某条留言 */
import { json, requireAdmin, assertCsrf } from '../../../lib/admin-auth.js';

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const id = String(body.id || '').trim();
  const status = String(body.status || '');
  if (!id) return json({ ok: false, error: 'bad_request', message: '缺少 id' }, 400);
  if (status !== 'visible' && status !== 'hidden') {
    return json({ ok: false, error: 'bad_request', message: 'status 只能是 visible / hidden' }, 400);
  }
  try {
    const r = await env.DB.prepare(
      'UPDATE wall_messages SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?'
    ).bind(status, String(body.note || '').slice(0, 200) || null, Date.now(), id).run();
    if (!r || !r.meta || r.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, id, status });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
