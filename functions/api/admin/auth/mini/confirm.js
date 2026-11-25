/* POST /api/admin/auth/mini/confirm —— 小程序端回传 code，确认登录身份
   ──────────────────────────────────────────────────────────────
   小程序扫到 scene 里的 ticket，wx.login 拿 code，一起 POST 过来。
   本接口用 code 换 openid/unionid，比对白名单：
   · 命中 → ticket 标记 confirmed，网页轮询即可拿会话；
   · 没命中 → 标记 denied 并把 openid 留在 ticket 上，
              网页轮询会显示给站长，方便第一次配 WECHAT_ALLOW_OPENIDS。
   无论命中与否都对小程序回 ok:true，避免把 openid 直接塞进小程序界面；
   真实结果由网页端轮询展示（两边不在同一台设备，只能这样传）。

   ticket 是 16 字节随机数，猜不到；一次性由 poll 端置 used 保证。
   ────────────────────────────────────────────────────────────── */
import { fail, json } from '../../../../lib/admin-auth.js';
import { wechatAllowed } from '../../../../lib/admin-login.js';
import { code2Session, getTicket, putTicket, validTicket } from '../../../../lib/mini-login.js';

export async function onRequestPost({ request, env }) {
  let body = null;
  try { body = await request.json(); } catch (e) { /* 下面统一报 bad_input */ }
  const ticket = String((body && body.ticket) || '');
  const code = String((body && body.code) || '');

  if (!validTicket(ticket)) return fail('bad_ticket', '二维码凭证格式不对', 400);
  if (!code || code.length > 128) return fail('bad_code', '微信登录凭证格式不对', 400);

  const rec = await getTicket(env, ticket);
  if (!rec) return fail('ticket_expired', '二维码已过期，请刷新页面重新扫码', 410);
  if (rec.status !== 'pending') return fail('ticket_used', '这张二维码已经用过了', 409);

  let identity;
  try {
    identity = await code2Session(env, code);
  } catch (e) {
    const msg = String((e && e.message) || e);
    return fail('wechat_code_failed', '微信登录凭证校验失败：' + msg, 502);
  }

  const allowed = wechatAllowed(env, identity.openid, identity.unionid);
  await putTicket(env, ticket, {
    status: allowed ? 'confirmed' : 'denied',
    openid: identity.openid,
    unionid: identity.unionid,
    confirmed_at: Date.now(),
  });

  /* 故意不告诉小程序结果：网页端轮询才知道，避免 openid 泄漏在聊天/截图里 */
  return json({ ok: true });
}
