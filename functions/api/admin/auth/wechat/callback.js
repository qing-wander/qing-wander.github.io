/* GET /api/admin/auth/wechat/callback —— 微信授权回调
   ──────────────────────────────────────────────────────────────
   code → access_token → openid / unionid → 比对白名单 → 发会话 cookie。
   白名单没命中时不登录，而是把 openid 带回登录页：站长可以照着填进
   WECHAT_ALLOW_OPENIDS，第一次配置不用去猜自己是谁。
   白名单为空 = 全部拒绝（安全默认，绝不放行任意微信用户）。
   ────────────────────────────────────────────────────────────── */
import { sessionCookie, signSession, TTL } from '../../../../lib/admin-auth.js';
import { verifyState, wechatAllowed, wechatConfig } from '../../../../lib/admin-login.js';

function back(location, extraHeaders) {
  return new Response(null, {
    status: 302,
    headers: Object.assign({ Location: location, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }, extraHeaders || {}),
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error') || (url.searchParams.get('errcode') ? 'wechat_' + url.searchParams.get('errcode') : '');

  if (err) return back('/login?error=' + encodeURIComponent(err));
  if (!code) return back('/login?error=wechat_no_code');

  const mode = await verifyState(env, state);
  if (!mode) return back('/login?error=bad_state');

  const cfg = wechatConfig(env, mode);
  if (!cfg.appId || !cfg.secret) return back('/login?error=wechat_not_configured');

  let openid = '';
  let unionid = '';
  try {
    const tr = await fetch(
      'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' + encodeURIComponent(cfg.appId) +
      '&secret=' + encodeURIComponent(cfg.secret) +
      '&code=' + encodeURIComponent(code) +
      '&grant_type=authorization_code'
    );
    const td = await tr.json().catch(() => ({}));
    if (!td || !td.access_token) {
      const why = td && td.errcode ? 'wechat_' + td.errcode : 'wechat_token_failed';
      return back('/login?error=' + encodeURIComponent(why));
    }
    openid = String(td.openid || '');
    unionid = String(td.unionid || '');
  } catch (e) {
    return back('/login?error=wechat_network');
  }

  if (!wechatAllowed(env, openid, unionid)) {
    /* 把身份带回去，方便第一次配置白名单；openid 本身不是密钥，泄漏也无害 */
    const q = 'wechat_not_allowed&openid=' + encodeURIComponent(openid) +
      (unionid ? '&unionid=' + encodeURIComponent(unionid) : '');
    return back('/login?error=' + q);
  }

  const exp = Math.floor(Date.now() / 1000) + TTL;
  const value = await signSession(env, exp);
  return back('/admin/', { 'Set-Cookie': sessionCookie(env, value, TTL) });
}
