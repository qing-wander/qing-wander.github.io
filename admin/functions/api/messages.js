/* GET /api/messages?device_hash=&status=&q=&limit=&offset=&focus= —— 留言审核列表
   2026-11-23 起附带每条留言的对话（wall_replies）、回复数、是否已回复、最后回复时间。
   · status=pending / replied 按「是否存在 owner 回复」筛，方便站长集中处理待回的留言；
   · focus=<留言 id> 是邮件里「打开后台直接回复」的直达入口：忽略其它筛选，
     只返回这一条，前端渲染后自动展开回复面板。

   设计：主查询不碰 wall_replies（表还没迁移的老环境仍能看留言），
   回复统一走 attachReplies 的一次 IN 查询，统计在 JS 里算。 */
import { json, requireAdmin, intParam } from '../../lib/admin.js';

const OWNER_EXISTS =
  "EXISTS (SELECT 1 FROM wall_replies r WHERE r.message_id = m.id AND r.author = 'owner' AND r.status = 'visible')";

/* 批量取对话：一次 IN 查询，避免列表每行一次 SQL。
   后台能看到 hidden 的评论（审核用），公开端只取 visible。 */
async function attachReplies(db, rows) {
  const list = rows || [];
  const byMsg = {};
  list.forEach((m) => { byMsg[m.id] = []; });
  if (list.length) {
    const holes = list.map(() => '?').join(',');
    try {
      const rr = await db.prepare(
        `SELECT id, message_id, author, text, created_at, status FROM wall_replies
          WHERE message_id IN (${holes}) ORDER BY seq ASC`
      ).bind(...list.map((m) => m.id)).all();
      (rr.results || []).forEach((r) => {
        if (!byMsg[r.message_id]) return;
        byMsg[r.message_id].push({
          id: r.id, author: r.author, text: r.text,
          created_at: r.created_at, status: r.status,
        });
      });
    } catch (e) { /* wall_replies 尚未迁移：降级为空对话 */ }
  }
  return list.map((m) => {
    const reps = byMsg[m.id] || [];
    const visible = reps.filter((r) => r.status === 'visible');
    return Object.assign({}, m, {
      replies: reps,
      reply_count: visible.length,
      owner_replied: visible.some((r) => r.author === 'owner'),
      last_reply_at: visible.length
        ? Math.max.apply(null, visible.map((r) => Number(r.created_at) || 0))
        : null,
    });
  });
}

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const url = new URL(request.url);
  const limit = intParam(url.searchParams.get('limit'), 1, 200, 50);
  const offset = intParam(url.searchParams.get('offset'), 0, 1e6, 0);
  const status = String(url.searchParams.get('status') || '').trim();
  const dh = String(url.searchParams.get('device_hash') || '').trim().slice(0, 40);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
  const focus = String(url.searchParams.get('focus') || '').trim().slice(0, 64);

  const conds = [];
  const args = [];
  if (focus) {
    conds.push('m.id = ?'); args.push(focus);
  } else {
    if (dh) { conds.push('m.device_hash LIKE ?'); args.push(dh + '%'); }
    if (status === 'visible' || status === 'hidden') { conds.push('m.status = ?'); args.push(status); }
    if (status === 'pending') { conds.push("m.status = 'visible' AND NOT " + OWNER_EXISTS); }
    if (status === 'replied') { conds.push("m.status = 'visible' AND " + OWNER_EXISTS); }
    if (q) { conds.push('(m.text LIKE ? OR m.name LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const pageLimit = focus ? 1 : limit;
  const pageOffset = focus ? 0 : offset;

  try {
    const rows = await env.DB.prepare(
      `SELECT m.seq, m.id, m.device_hash, m.name, m.text, m.created_at, m.status,
              m.admin_note, m.updated_at
         FROM wall_messages m ${where} ORDER BY m.seq DESC LIMIT ? OFFSET ?`
    ).bind(...args, pageLimit, pageOffset).all();
    const cnt = focus
      ? { n: (rows.results || []).length }
      : await env.DB.prepare(`SELECT COUNT(*) AS n FROM wall_messages m ${where}`)
        .bind(...args).first();
    const messages = await attachReplies(env.DB, rows.results || []);
    return json({ ok: true, messages, total: cnt ? cnt.n : 0, limit: pageLimit, offset: pageOffset });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
