/* /api/qa —— 问答埋点看板
   ──────────────────────────────────────────────────────────────
   数据源：qa_logs（/api/chat 每次调用落一条）。
   看什么：
     · 总量 / 空召回率 / 延迟 —— 判断检索质量与体验
     · 高频问题 —— 用户真正关心什么（也是补切片的依据）
     · 命中片段热度 —— 哪些经历被反复引用，哪些从没被问到
     · 最近原始记录 —— 排查个例
   ────────────────────────────────────────────────────────────── */
import { json, requireAdmin, intParam } from '../../lib/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const url = new URL(request.url);
  const recentLimit = intParam(url.searchParams.get('recent'), 5, 100, 30);

  try {
    const totals = await env.DB.prepare(
      `SELECT
         COUNT(*)                                                    AS total,
         COALESCE(SUM(empty), 0)                                     AS empty,
         COALESCE(SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END), 0)       AS last7,
         COALESCE(SUM(CASE WHEN empty = 0 AND ms < 60000 THEN ms ELSE 0 END), 0) AS ms_sum,
         COALESCE(SUM(CASE WHEN empty = 0 AND ms < 60000 THEN 1 ELSE 0 END), 0) AS answered
       FROM qa_logs`
    ).bind(Date.now() - 7 * 86400000).first();

    /* 高频问题：完全相同的问法归一类（前缀 60 字，够看） */
    const top = await env.DB.prepare(
      `SELECT substr(trim(query), 1, 60) AS q, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM qa_logs GROUP BY substr(trim(query), 1, 60)
       ORDER BY n DESC, last_ts DESC LIMIT 15`
    ).all();

    const recent = await env.DB.prepare(
      `SELECT ts, query, hit_count, empty, model, ms FROM qa_logs
       ORDER BY ts DESC LIMIT ?`
    ).bind(recentLimit).all();

    /* 命中片段热度：hit_ids 落库是逗号串（"me-01,exp-lessie-03"），不是 JSON；
       最近 200 条在 JS 里汇总即可，量小不值得再建表 */
    const rows = await env.DB.prepare(
      `SELECT hit_ids, empty FROM qa_logs WHERE empty = 0 ORDER BY ts DESC LIMIT 200`
    ).all();
    const hits = new Map();
    for (const r of rows.results || []) {
      const ids = String(r.hit_ids || '').split(',').map((x) => x.trim()).filter(Boolean);
      for (const id of ids) hits.set(id, (hits.get(id) || 0) + 1);
    }
    const topHits = [...hits.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([id, n]) => ({ id, n }));

    const ms_avg = totals && totals.answered ? Math.round((totals.ms_sum || 0) / totals.answered) : 0;
    const empty_rate = totals && totals.total ? Math.round((totals.empty / totals.total) * 1000) / 10 : 0;

    return json({
      ok: true,
      totals: {
        total: totals?.total || 0,
        empty: totals?.empty || 0,
        last7: totals?.last7 || 0,
        answered: totals?.answered || 0,
        ms_avg,
        empty_rate,
      },
      top_questions: top.results || [],
      top_hits: topHits,
      recent: recent.results || [],
    });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
