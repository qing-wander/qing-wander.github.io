/* /api/qa/topics —— 问答问题聚类
   ──────────────────────────────────────────────────────────────
   GET /api/qa/topics?limit=200
   把最近 N 条问答按语义归簇，输出「话题 / 问了几次 / 其中几次空召回 / 典型问法」。
   空召回高的簇 = 简历里没写、但招聘方真的在问 —— 这就是补切片的优先级清单。
   ────────────────────────────────────────────────────────────── */
import { json, requireAdmin, intParam } from '../../../lib/admin.js';
import { cluster } from '../../../lib/topics.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const limit = intParam(new URL(request.url).searchParams.get('limit'), 20, 500, 200);

  try {
    const rows = await env.DB.prepare(
      'SELECT ts, query, empty FROM qa_logs ORDER BY ts DESC LIMIT ?'
    ).bind(limit).all();
    const list = rows.results || [];
    if (!list.length) {
      return json({ ok: true, scanned: 0, topics: [], suggest: [] });
    }

    const topics = cluster(list).map((t) => ({
      ...t,
      empty_rate: t.count ? Math.round((t.empty / t.count) * 100) : 0,
    }));

    /* 建议补切片：问过 2 次以上、且空召回过半的簇 */
    const suggest = topics
      .filter((t) => t.count >= 2 && t.empty_rate >= 50)
      .map((t) => ({ topic: t.topic, count: t.count, empty_rate: t.empty_rate }));

    return json({ ok: true, scanned: list.length, topics, suggest });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
