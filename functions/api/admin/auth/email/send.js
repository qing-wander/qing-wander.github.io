/* POST /api/admin/auth/email/send —— 发登录验证码
   ──────────────────────────────────────────────────────────────
   只有 ADMIN_EMAILS 白名单里的邮箱能被发送；白名单外直接 403，
   否则这就成了「任何人注册即进后台」。
   限流三件套：IP 每小时 12 次、同邮箱 60 秒冷却、旧码立刻作废。
   ────────────────────────────────────────────────────────────── */
import { fail, json, assertCsrf, gate, ipHash } from '../../../../lib/admin-auth.js';
import {
  CODE_RESEND_COOLDOWN_MS, CODE_TTL_MS, codeHash, isAllowedEmail, looksLikeEmail,
  maskEmail, normalizeEmail, randomCode, sendCodeMail,
} from '../../../../lib/admin-login.js';

export async function onRequestPost({ request, env }) {
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  if (!env.DB) return fail('db_not_bound', '后台没有绑定 D1', 503);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  const email = normalizeEmail(body && body.email);
  if (!looksLikeEmail(email)) return fail('bad_email', '邮箱格式不对');
  if (!isAllowedEmail(env, email)) {
    return fail('email_not_allowed', '这个邮箱不在登录白名单里', 403);
  }

  /* IP 限流：换邮箱刷验证码也会被这里卡住 */
  const ip = await ipHash(request);
  const hour = new Date().toISOString().slice(0, 13);
  const hit = await gate(env.DB, 'admin:email:ip:' + ip, hour, 12, 3700);
  if (hit === null) return fail('rate_limited', '请求太频繁，稍后再试', 429);

  /* 同邮箱冷却：避免连点把邮件发爆，也避免把 Resend 额度打光。
     冷却判在配额之前——被冷却挡掉的请求不该算一次「已发送」。 */
  const prev = await env.DB.prepare(
    'SELECT sent_at FROM admin_email_codes WHERE email = ?'
  ).bind(email).first();
  const now = Date.now();
  if (prev && now - Number(prev.sent_at || 0) < CODE_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((CODE_RESEND_COOLDOWN_MS - (now - Number(prev.sent_at))) / 1000);
    return json({ ok: false, error: 'cooldown', message: '刚发过，' + wait + ' 秒后可重发', retry: wait }, 429);
  }

  /* 同邮箱每小时最多 4 封：挡「知道地址就能一直炸邮箱 / 烧发信额度」。
     桶名用 HMAC 后的邮箱，rate_limits 里不出现明文地址。 */
  const addrKey = await codeHash(env, email, 'send');
  const addrHit = await gate(env.DB, 'admin:email:addr:' + addrKey, hour, 4, 3700);
  if (addrHit === null) return fail('rate_limited', '这个邮箱本小时发得太频繁，稍后再试', 429);

  /* 密钥缺失时 codeHash 会 throw，落到平台就是 1101 + 前端「发送失败」，
     完全看不出原因。这里显式转成错误码，后台能直接看到该补哪个变量。 */
  let code, codeHashValue;
  try {
    code = randomCode();
    codeHashValue = await codeHash(env, email, code);
  } catch (e) {
    return fail('mail_secret_missing', '后台密钥未配置，无法发送验证码', 503);
  }
  await env.DB.prepare(
    `INSERT INTO admin_email_codes (email, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       sent_at = excluded.sent_at`
  ).bind(email, codeHashValue, now + CODE_TTL_MS, now).run();

  const sent = await sendCodeMail(env, email, code);
  if (!sent.ok) {
    /* 发不出去就把这行撤掉，避免留下一个用户永远收不到的码 */
    await env.DB.prepare('DELETE FROM admin_email_codes WHERE email = ?').bind(email).run().catch(() => {});
    if (sent.error === 'mail_not_configured') {
      return fail('mail_not_configured', '还没配置发信（缺 RESEND_API_KEY）', 503);
    }
    if (sent.error === 'mail_network') {
      return fail('mail_network', '发信服务连不上，稍后重试', 502);
    }
    return fail('mail_rejected', '发信被拒（检查发件域名是否已在 Resend 验证）', 502);
  }

  return json({
    ok: true,
    email: maskEmail(email),
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    cooldown: Math.floor(CODE_RESEND_COOLDOWN_MS / 1000),
  });
}
