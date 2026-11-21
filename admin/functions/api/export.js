/* GET /api/export —— 导出「留言 + 设备」两段 CSV
   ──────────────────────────────────────────────────────────────
   两个容易踩的点：
   · Excel 只认带 BOM 的 UTF-8，没 BOM 的中文会变乱码，所以整份文件前置 \ufeff
   · 留言是访客自由输入，=HYPERLINK(...) / +cmd / -2+3 这类开头会被 Excel
     当公式执行（CSV 注入），自由文本字段统一加 ' 前缀；设备哈希等系统字段不动
   ────────────────────────────────────────────────────────────── */
import { requireAdmin, csvCell } from '../../lib/admin.js';

/* 自由文本专用：先判断公式前缀，再做标准 CSV 转义 */
function csvText(v) {
  const s = String(v == null ? '' : v);
  return csvCell(/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
}

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
      m.seq, m.id, m.device_hash, csvText(m.name), csvText(m.text),
      iso(m.created_at), m.status, csvText(m.admin_note),
    ].join(',')).join('\n');
    const devHead = '\n\ndevice_hash,first_seen_iso,last_seen_iso,post_count,status,ua\n';
    const devBody = (devices.results || []).map((d) => [
      d.device_hash, iso(d.first_seen), iso(d.last_seen), d.post_count, d.status, csvText(d.ua),
    ].join(',')).join('\n');
    return new Response('\ufeff' + head + body + devHead + devBody, {
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