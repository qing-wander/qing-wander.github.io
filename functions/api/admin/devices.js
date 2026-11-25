/* GET /api/devices?q=&limit=&offset= —— 设备台账 */
import { json, requireAdmin, intParam } from '../../lib/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const url = new URL(request.url);
  const limit = intParam(url.searchParams.get('limit'), 1, 200, 50);
  const offset = intParam(url.searchParams.get('offset'), 0, 1e6, 0);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
  const where = q ? 'WHERE d.device_hash LIKE ?' : '';
  const args = q ? [q + '%'] : [];
  try {
    const rows = await env.DB.prepare(
      `SELECT d.device_hash, d.first_seen, d.last_seen, d.post_count, d.status, d.note, d.ua,
              (SELECT COUNT(*) FROM wall_messages m WHERE m.device_hash = d.device_hash) AS messages,
              (SELECT COUNT(*) FROM wall_messages m WHERE m.device_hash = d.device_hash AND m.status='hidden') AS hidden,
              (SELECT MAX(created_at) FROM wall_messages m WHERE m.device_hash = d.device_hash) AS last_message_at,
              (SELECT text FROM wall_messages m WHERE m.device_hash = d.device_hash ORDER BY m.seq DESC LIMIT 1) AS last_text
         FROM wall_devices d ${where}
        ORDER BY d.last_seen DESC LIMIT ? OFFSET ?`
    ).bind(...args, limit, offset).all();
    const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM wall_devices d ${where}`)
      .bind(...args).first();
    /* 迁移前的旧留言没有对应设备行，单独给一条 legacy 账目，否则后台会“丢”这些数据 */
    const legacy = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM wall_messages WHERE device_hash = 'legacy'`
    ).first();
    return json({
      ok: true,
      devices: rows.results || [],
      total: cnt ? cnt.n : 0,
      legacyMessages: legacy ? legacy.n : 0,
      limit, offset,
    });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
