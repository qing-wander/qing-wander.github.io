/* POST   /api/messages/reply —— 站长在后台回复某条留言（author='owner'）
   DELETE /api/messages/reply —— 删掉一条回复（误发 / 不当评论审核）

   与公开端 /api/wall 的分工：
     · 访客评论由公开端写 author='visitor'，必须校验设备归属；
     · 站长回复只走这里，带会话鉴权 + CSRF，公开端无法伪造 owner；
     · 两者都写同一张 wall_replies，公开端按留言所属设备读取，保持隔离。

   不自动给访客发邮件：留言是匿名的，没有收件地址。站长回复后，
   访客回到同一台设备刷新（或等 60 秒轮询提示「站长回复了你」）即可看到。 */
import { json, fail, requireAdmin, assertCsrf } from '../../../lib/admin.js';

const MAX_TEXT = 300;
const MIN_TEXT = 2;

/* 与公开端同样的净化：归一换行、剔除控制字符 / 零宽字符、按码点截断 */
function clean(s, max) {
  return Array.from(String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\u200c\u200e\u200f\u2060\u202a-\u202e\ufeff]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
    .slice(0, max).join('');
}

async function listReplies(db, messageId) {
  try {
    const r = await db.prepare(
      `SELECT id, message_id, author, text, created_at, status FROM wall_replies
        WHERE message_id = ? ORDER BY seq ASC`
    ).bind(messageId).all();
    return r.results || [];
  } catch (e) {
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const messageId = String((body && (body.messageId || body.id)) || '').trim().slice(0, 64);
  const text = clean(body && body.text, MAX_TEXT);
  if (!messageId) return fail('bad_request', '缺少 messageId', 400);
  if (!text) return fail('bad_request', '回复内容不能为空', 400);
  if (Array.from(text).length < MIN_TEXT) return fail('bad_request', '再多写两个字吧（至少 2 个字）', 400);

  try {
    const parent = await env.DB.prepare(
      'SELECT id, device_hash, status FROM wall_messages WHERE id = ?'
    ).bind(messageId).first();
    if (!parent) return fail('not_found', '这条留言不存在', 404);

    const now = Date.now();
    const id = 'ro' + now.toString(36) + Math.random().toString(36).slice(2, 7);
    const ins = await env.DB.prepare(
      `INSERT INTO wall_replies (id, message_id, author, text, created_at, device_hash, status)
       VALUES (?, ?, 'owner', ?, ?, ?, 'visible')`
    ).bind(id, messageId, text, now, parent.device_hash).run();
    if (!ins || !ins.success) return fail('db_error', '回复没能保存', 500);
    await env.DB.prepare('UPDATE wall_messages SET updated_at = ? WHERE id = ?').bind(now, messageId).run();

    return json({
      ok: true, messageId: messageId,
      reply: { id, author: 'owner', text, created_at: now, status: 'visible' },
      replies: await listReplies(env.DB, messageId),
    }, 201);
  } catch (e) {
    return fail('db_error', '回复没能保存，稍后再试', 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  let id = String((body && body.id) || '').trim().slice(0, 64);
  if (!id) {
    try { id = String(new URL(request.url).searchParams.get('id') || '').trim().slice(0, 64); } catch (e) { id = ''; }
  }
  if (!id) return fail('bad_request', '缺少回复 id', 400);

  try {
    const r = await env.DB.prepare('DELETE FROM wall_replies WHERE id = ?').bind(id).run();
    if (!r || !r.meta || r.meta.changes === 0) return fail('not_found', '回复不存在', 404);
    return json({ ok: true, deleted: id });
  } catch (e) {
    return fail('db_error', '删除失败', 500);
  }
}
