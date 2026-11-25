/* GET /api/admin/auth/wechat?mode=qr|mp —— 跳去微信授权
   ──────────────────────────────────────────────────────────────
   qr：开放平台「网站应用」扫码（桌面端，手机微信扫一扫确认）
   mp：公众号「网页授权」（微信内置浏览器里直接确认，适合手机点开）
   没配 AppID/Secret 或白名单为空时直接回 503，前端据此把按钮置灰，
   不要出现「点了没反应」的按钮。
   ────────────────────────────────────────────────────────────── */
import { fail } from '../../../../lib/admin-auth.js';
import { signState, wechatAllowList, wechatConfig } from '../../../../lib/admin-login.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'mp' ? 'mp' : 'qr';
  const cfg = wechatConfig(env, mode);

  if (!cfg.appId || !cfg.secret) {
    return fail('wechat_not_configured', '微信登录还没配置（缺 AppID / Secret）', 503);
  }
  if (!wechatAllowList(env).length) {
    return fail('wechat_allowlist_empty', '微信登录白名单为空，先配 WECHAT_ALLOW_OPENIDS', 503);
  }

  const state = await signState(env, mode);
  const redirect = url.origin + '/api/admin/auth/wechat/callback';
  const q = 'appid=' + encodeURIComponent(cfg.appId) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&response_type=code' +
    '&scope=' + (mode === 'qr' ? 'snsapi_login' : 'snsapi_base') +
    '&state=' + encodeURIComponent(state);

  const target = mode === 'qr'
    ? 'https://open.weixin.qq.com/connect/qrconnect?' + q + '#wechat_redirect'
    : 'https://open.weixin.qq.com/connect/oauth2/authorize?' + q + '#wechat_redirect';

  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
