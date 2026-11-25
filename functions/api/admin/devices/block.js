/* POST /api/devices/block —— 拉黑 / 解封设备 */
import { json, requireAdmin, assertCsrf } from '../../../lib/admin-auth.js';

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const dh = String(body.device_hash || '').trim().slice(0, 40);
  if (!dh) return json({ ok: false, error: 'bad_request', message: '缺少 device_hash' }, 400);
  const blocked = !!body.blocked;
  try {
    const r = await env.DB.prepare(
      'UPDATE wall_devices SET status = ?, note = ? WHERE device_hash = ?'
    ).bind(blocked ? 'blocked' : 'active', String(body.note || '').slice(0, 200) || null, dh).run();
    if (!r || !r.meta || r.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, device_hash: dh, status: blocked ? 'blocked' : 'active' });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
