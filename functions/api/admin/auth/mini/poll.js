/* GET /api/admin/auth/mini/poll?ticket=xxx —— 网页端轮询扫码结果
   ──────────────────────────────────────────────────────────────
   pending   → 继续轮询
   denied    → 回 openid/unionid，让站长自己去配白名单（只回给持有 ticket 的人）
   confirmed → 标记 used 并下发与邮箱登录同款的会话 Cookie
   used/不存在 → 过期，前端提示刷新

   状态回写不是原子的，极端并发下两张轮询可能都读到 confirmed；
   ticket 随机且只活 5 分钟，实际风险可忽略。真要严格需换 D1 事务。
   ────────────────────────────────────────────────────────────── */
import { fail, json, sessionCookie, signSession, TTL } from '../../../../lib/admin-auth.js';
import { getTicket, putTicket, validTicket } from '../../../../lib/mini-login.js';

export async function onRequestGet({ request, env }) {
  const ticket = String(new URL(request.url).searchParams.get('ticket') || '');
  if (!validTicket(ticket)) return fail('bad_ticket', '二维码凭证格式不对', 400);

  const rec = await getTicket(env, ticket);
  if (!rec) return json({ ok: false, status: 'expired' });
  if (rec.status === 'pending') return json({ ok: false, status: 'pending' });

  if (rec.status === 'denied') {
    return json({
      ok: false,
      status: 'not_allowed',
      openid: String(rec.openid || ''),
      unionid: String(rec.unionid || ''),
    });
  }
  if (rec.status !== 'confirmed') return json({ ok: false, status: 'expired' });

  try {
    await putTicket(env, ticket, {
      status: 'used',
      openid: String(rec.openid || ''),
      used_at: Date.now(),
    });
    const exp = Math.floor(Date.now() / 1000) + TTL;
    const value = await signSession(env, exp);
    return json({ ok: true, status: 'ok' }, 200, { 'Set-Cookie': sessionCookie(env, value, TTL) });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return fail('sign_failed', '签发登录态失败：' + msg, 500);
  }
}
