/* POST /api/admin/auth/login —— 应急口令换会话 cookie
   ──────────────────────────────────────────────────────────────
   登录页已经改成免密（微信 / 邮箱验证码），这个接口默认不对外展示。
   保留的原因只有一个：微信或邮箱通道同时出问题时，还能用 curl 进来。
   没配 ADMIN_PASSWORD 时它直接 503 —— 不配就等于关闭。 */
import { json, fail, assertCsrf, gate, ipHash, safeEqual, signSession, sessionCookie, TTL } from '../../../lib/admin-auth.js';

export async function onRequestPost({ request, env }) {
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  if (!env.DB) return fail('db_not_bound', '后台没有绑定 D1', 503);

  const password = env.ADMIN_PASSWORD;
  if (!password) return fail('not_configured', '还没配置 ADMIN_PASSWORD', 503);

  const ip = await ipHash(request);
  const win = Math.floor(Date.now() / 900000); // 15 分钟固定窗
  const hit = await gate(env.DB, 'admin:login:' + ip, String(win), 8, 960);
  if (hit === null) return fail('rate_limited', '尝试次数太多，15 分钟后再试', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object' || !safeEqual(password, body.password)) {
    return fail('bad_password', '口令不对', 401);
  }

  const exp = Math.floor(Date.now() / 1000) + TTL;
  const value = await signSession(env, exp);
  return json({ ok: true, exp }, 200, { 'Set-Cookie': sessionCookie(env, value, TTL) });
}
