/* GET /api/export —— 导出「留言 + 设备」两段 CSV */
import { requireAdmin, csvCell } from '../../lib/admin.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  try {
    const rows = await env.DB.prepare(
      `SELECT seq, id, device_hash, name, text, created_at, status, admin_note
         FROM wall_messages ORDER BY seq ASC`
    ).all();
    const devices = await env.DB.prepare(
      `SELECT device_hash, first_seen, last_seen, post_count, status, ua
         FROM wall_devices ORDER BY last_seen DESC`
    ).all();
    const iso = (v) => (v ? new Date(Number(v)).toISOString() : '');
    const head = 'seq,id,device_hash,name,text,created_at_iso,status,admin_note\n';
    const body = (rows.results || []).map((m) => [
      m.seq, m.id, m.device_hash, csvCell(m.name), csvCell(m.text),
      iso(m.created_at), m.status, csvCell(m.admin_note),
    ].join(',')).join('\n');
    const devHead = '\n\ndevice_hash,first_seen_iso,last_seen_iso,post_count,status,ua\n';
    const devBody = (devices.results || []).map((d) => [
      d.device_hash, iso(d.first_seen), iso(d.last_seen), d.post_count, d.status, csvCell(d.ua),
    ].join(',')).join('\n');
    return new Response(head + body + devHead + devBody, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="wall-export.csv"',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (e) {
    return new Response('db_error', { status: 500 });
  }
}
