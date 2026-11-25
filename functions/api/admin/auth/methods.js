/* GET /api/admin/auth/methods —— 登录页能显示哪些登录方式
   ──────────────────────────────────────────────────────────────
   只回「能不能用」和脱敏邮箱，不回完整白名单：
   页面据此决定按钮是否可点，避免出现点了没反应的死按钮。
   ────────────────────────────────────────────────────────────── */
import { json } from '../../../lib/admin-auth.js';
import { adminEmails, maskEmail, wechatEnabled } from '../../../lib/admin-login.js';
import { miniEnabled } from '../../../lib/mini-login.js';

export async function onRequestGet({ request, env }) {
  const emails = adminEmails(env);
  const wx = wechatEnabled(env);
  return json({
    ok: true,
    email: {
      enabled: !!(env.RESEND_API_KEY && emails.length),
      hint: emails.length ? maskEmail(emails[0]) : '',
      count: emails.length,
    },
    wechat: wx,
    /* 小程序扫码：个人主体唯一可行的微信登录，独立于公众号/开放平台 */
    mini: miniEnabled(env),
    /* 微信内置浏览器：手机点开时优先展示公众号授权，省一次扫码 */
    inWechat: /micromessenger/i.test(request.headers.get('User-Agent') || ''),
  });
}
