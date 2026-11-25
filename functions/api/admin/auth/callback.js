/* GET /api/admin/auth/callback —— GitHub 授权回调
   ──────────────────────────────────────────────────────────────
   code → access_token → /user → 校验登录名在放行名单 → 发会话 cookie → 回首页。
   放行名单：ADMIN_GITHUB_USERS（逗号分隔，默认 shenge-work）。
   state 校验：签名 + 10 分钟有效期，防 CSRF 与重放。
   ────────────────────────────────────────────────────────────── */
import { json, sessionCookie, signSession, TTL } from '../../../lib/admin-auth.js';

async function verifyState(env, state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > 600000) return false;
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || 'dev';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expect = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`state|${ts}|${nonce}`));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(expect)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64 === sig;
}

function back(location, extraHeaders) {
  return new Response(null, {
    status: 302,
    headers: Object.assign({ Location: location, 'Cache-Control': 'no-store' }, extraHeaders || {}),
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) return back('/login?error=' + encodeURIComponent(err));
  if (!code) return back('/login?error=no_code');
  if (!(await verifyState(env, state))) return back('/login?error=bad_state');

  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back('/login?error=not_configured');

  try {
    const tr = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: `${url.origin}/api/admin/auth/callback`,
      }),
    });
    const td = await tr.json().catch(() => ({}));
    const token = td.access_token;
    if (!token) return back('/login?error=token_failed');

    const ur = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'shenge-work-admin' },
    });
    const user = await ur.json().catch(() => ({}));
    const login = String(user.login || '');
    const allow = String(env.ADMIN_GITHUB_USERS || 'shenge-work')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (!allow.includes(login)) return back('/login?error=not_allowed');

    const exp = Math.floor(Date.now() / 1000) + TTL;
    const value = await signSession(env, exp);
    return back('/admin/', { 'Set-Cookie': sessionCookie(env, value, TTL) });
  } catch (e) {
    return back('/login?error=exception');
  }
}
