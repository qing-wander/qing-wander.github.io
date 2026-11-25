/* GET /api/admin/auth/oauth —— 跳去 GitHub 授权
   ──────────────────────────────────────────────────────────────
   state 用现有会话密钥做 HMAC（ts + 随机数），回调时校验，防 CSRF。
   留了 password 登录兜底：OAuth 配错/挂了也不能把自己锁在门外。
   ────────────────────────────────────────────────────────────── */
const GITHUB = 'https://github.com/login/oauth/authorize';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response(JSON.stringify({ ok: false, error: 'oauth_not_configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const state = await signState(request, env);
  const redirect = `${url.origin}/api/admin/auth/callback`;
  const target = `${GITHUB}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user&state=${encodeURIComponent(state)}`;
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

async function signState(request, env) {
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || 'dev';
  const ts = String(Date.now());
  const nonce = crypto.randomUUID().slice(0, 8);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`state|${ts}|${nonce}`));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${ts}.${nonce}.${b64}`;
}
