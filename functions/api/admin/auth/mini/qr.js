/* GET /api/admin/auth/mini/qr —— 取小程序码 + 一次性 ticket
   ──────────────────────────────────────────────────────────────
   未配置 AppID/Secret/KV 时回 503，登录页据此把按钮置灰。
   小程序码是微信接口返回的 JPEG 二进制，转 data: URL 给登录页直接 <img>。
   ticket 32 位 hex（scene 上限正好 32 字符），5 分钟过期。
   ────────────────────────────────────────────────────────────── */
import { fail, json } from '../../../../lib/admin-auth.js';
import { getMiniQr, miniEnabled, newTicket, putTicket, TICKET_TTL } from '../../../../lib/mini-login.js';

export async function onRequestGet({ env }) {
  if (!miniEnabled(env)) {
    return fail('mini_not_configured', '小程序登录还没配置（缺 AppID / Secret / SITE_KV）', 503);
  }

  const ticket = newTicket();
  try {
    const image = await getMiniQr(env, ticket);
    await putTicket(env, ticket, { status: 'pending', created_at: Date.now() });
    return json({ ok: true, ticket, image: 'data:image/jpeg;base64,' + image, expires_in: TICKET_TTL });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return fail('wechat_qr_failed', '生成小程序码失败：' + msg, 502);
  }
}
