/* POST /api/admin/auth/email/verify —— 验证码换会话 cookie
   ──────────────────────────────────────────────────────────────
   失败语义要清楚，前端才知道该让人重输还是重发：
     code_not_found / code_expired → 重发
     bad_code（还剩几次）           → 重输
     too_many_attempts             → 必须重发
   同一行最多试 5 次，成功即删；邮箱再次过白名单，防止改配置后旧码还能用。
   ────────────────────────────────────────────────────────────── */
import {
  COOKIE, TTL, assertCsrf, fail, gate, ipHash, json, safeEqual, sessionCookie, signSession,
} from '../../../../lib/admin-auth.js';
import {
  CODE_MAX_ATTEMPTS, codeHash, isAllowedEmail, normalizeEmail,
} from '../../../../lib/admin-login.js';

export async function onRequestPost({ request, env }) {
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  if (!env.DB) return fail('db_not_bound', '后台没有绑定 D1', 503);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  const email = normalizeEmail(body && body.email);
  const code = String((body && body.code) || '').replace(/\D/g, '').slice(0, 6);
  if (!email || code.length !== 6) return fail('bad_input', '邮箱或验证码格式不对');
  if (!isAllowedEmail(env, email)) return fail('email_not_allowed', '这个邮箱不在登录白名单里', 403);

  /* 猜码限流：同一 IP 每小时 30 次，正常人手输远远用不到 */
  const ip = await ipHash(request);
  const hour = new Date().toISOString().slice(0, 13);
  const hit = await gate(env.DB, 'admin:emailverify:ip:' + ip, hour, 30, 3700);
  if (hit === null) return fail('rate_limited', '尝试次数太多，稍后再试', 429);

  const row = await env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM admin_email_codes WHERE email = ?'
  ).bind(email).first();

  if (!row) return fail('code_not_found', '没有待验证的验证码，请重新发送', 401);
  if (Number(row.expires_at) < Date.now()) {
    await env.DB.prepare('DELETE FROM admin_email_codes WHERE email = ?').bind(email).run().catch(() => {});
    return fail('code_expired', '验证码已过期，请重新发送', 401);
  }
  if (Number(row.attempts) >= CODE_MAX_ATTEMPTS) {
    return fail('too_many_attempts', '错误次数太多，请重新发送验证码', 429);
  }

  const expect = await codeHash(env, email, code);
  if (!safeEqual(expect, row.code_hash)) {
    const attempts = Number(row.attempts) + 1;
    await env.DB.prepare('UPDATE admin_email_codes SET attempts = ? WHERE email = ?')
      .bind(attempts, email).run().catch(() => {});
    return json({
      ok: false,
      error: 'bad_code',
      message: '验证码不对',
      left: Math.max(0, CODE_MAX_ATTEMPTS - attempts),
    }, 401);
  }

  /* 一次性：验过就删，重放同一个码不可能再进 */
  await env.DB.prepare('DELETE FROM admin_email_codes WHERE email = ?').bind(email).run();

  const exp = Math.floor(Date.now() / 1000) + TTL;
  const value = await signSession(env, exp);
  return json({ ok: true, exp, via: 'email' }, 200, {
    'Set-Cookie': sessionCookie(env, value, TTL),
  });
}
