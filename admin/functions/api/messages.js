/* GET /api/messages?device_hash=&status=&q=&limit=&offset= —— 留言审核列表 */
import { json, requireAdmin, intParam } from '../../lib/admin.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const url = new URL(request.url);
  const limit = intParam(url.searchParams.get('limit'), 1, 200, 50);
  const offset = intParam(url.searchParams.get('offset'), 0, 1e6, 0);
  const status = String(url.searchParams.get('status') || '').trim();
  const dh = String(url.searchParams.get('device_hash') || '').trim().slice(0, 40);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);

  const conds = [];
  const args = [];
  if (dh) { conds.push('device_hash LIKE ?'); args.push(dh + '%'); }
  if (status === 'visible' || status === 'hidden') { conds.push('status = ?'); args.push(status); }
  if (q) { conds.push('(text LIKE ? OR name LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  try {
    const rows = await env.DB.prepare(
      `SELECT seq, id, device_hash, name, text, created_at, status, admin_note, updated_at
         FROM wall_messages ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`
    ).bind(...args, limit, offset).all();
    const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM wall_messages ${where}`)
      .bind(...args).first();
    return json({ ok: true, messages: rows.results || [], total: cnt ? cnt.n : 0, limit, offset });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
