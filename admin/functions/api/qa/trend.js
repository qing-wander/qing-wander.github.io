/* GET /api/qa/trend?days=14 —— 问答量按天趋势
   ──────────────────────────────────────────────────────────────
   输出最近 N 天（北京时间自然日）的 {date, total, empty}，前端画柱状。
   D1 里 ts 是毫秒，按 UTC+8 折算自然日：CAST((ts + 8h) / 1 天)。
   没有数据的日期补 0 —— 缺天会让折线"跳天"，看图的人会误判成断流。
   ────────────────────────────────────────────────────────────── */
import { json, requireAdmin, intParam } from '../../../lib/admin.js';

const DAY = 86400000;
const TZ = 8 * 3600000;

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const days = intParam(new URL(request.url).searchParams.get('days'), 3, 60, 14);

  try {
    const now = Date.now();
    const since = now - days * DAY;
    const rows = await env.DB.prepare(
      `SELECT CAST((ts + ?1) / ?2 AS INTEGER) AS d,
              COUNT(*) AS total,
              COALESCE(SUM(empty), 0) AS empty
       FROM qa_logs WHERE ts >= ?3
       GROUP BY d ORDER BY d ASC`
    ).bind(TZ, DAY, since).all();

    const byDay = new Map();
    for (const r of rows.results || []) byDay.set(Number(r.d), r);

    /* 补齐空缺日：从 today-(days-1) 到 today */
    const todayIdx = Math.floor((now + TZ) / DAY);
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const idx = todayIdx - i;
      const row = byDay.get(idx);
      const dt = new Date(idx * DAY - TZ);
      const label = `${dt.getUTCMonth() + 1}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      series.push({
        date: dt.toISOString().slice(0, 10),
        label,
        total: row ? Number(row.total) : 0,
        empty: row ? Number(row.empty) : 0,
      });
    }

    return json({ ok: true, days, series });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
