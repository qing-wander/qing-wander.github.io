/* POST /api/auth/login —— 密码换会话 cookie */
import { json, fail, assertCsrf, gate, ipHash, safeEqual, signSession, sessionCookie, TTL } from '../../../lib/admin.js';

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
