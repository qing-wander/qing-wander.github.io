/* 小程序扫码登录公共件（个人主体可用的微信登录方案）
   ──────────────────────────────────────────────────────────────
   网页弹小程序码 → 微信扫码进入小程序 → wx.login 拿 code →
   小程序把 code + ticket 回传本后端 → code2session 换 openid →
   比对白名单 → 标记 ticket → 网页轮询拿会话 Cookie。

   为什么不用公众号网页授权：网页授权只对认证服务号开放，
   个人主体只能注册订阅号且不能认证。小程序个人实名即可注册，
   不认证也能 wx.login，所以这是个人唯一走得通的「微信登录」。

   安全底线：
   · ticket 16 字节随机、5 分钟过期、一次性（确认后立即置 used）；
   · openid/unionid 必须命中白名单，空名单 = 谁都进不来（与公众号同款）；
   · 未放行时把 openid 写回 ticket，网页轮询时给站长自己看，方便首次配白名单；
   · AppID/Secret 只从 env 读，绝不写进代码或响应。
   ────────────────────────────────────────────────────────────── */

const enc = new TextEncoder();
export const TICKET_TTL = 300;          // 与 KV expirationTtl 一致
export const MINI_LOGIN_PAGE = 'pages/login/login';
const KV_PREFIX = 'mini:login:';

/* ── 配置 ───────────────────────────────────────────────────── */

export function miniConfig(env) {
  return {
    appId: String((env && env.WECHAT_MINI_APP_ID) || ''),
    secret: String((env && env.WECHAT_MINI_APP_SECRET) || ''),
  };
}

export function miniEnabled(env) {
  const cfg = miniConfig(env);
  return !!(cfg.appId && cfg.secret && env && env.SITE_KV);
}

/* ── ticket ─────────────────────────────────────────────────── */

export function newTicket() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function validTicket(v) {
  return /^[0-9a-f]{32}$/.test(String(v || ''));
}

export async function putTicket(env, ticket, data) {
  if (!env || !env.SITE_KV) throw new Error('SITE_KV 未绑定');
  await env.SITE_KV.put(KV_PREFIX + ticket, JSON.stringify(data), { expirationTtl: TICKET_TTL });
}

export async function getTicket(env, ticket) {
  if (!env || !env.SITE_KV || !validTicket(ticket)) return null;
  const raw = await env.SITE_KV.get(KV_PREFIX + ticket);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' ? d : null;
  } catch (e) {
    return null;
  }
}

/* ── 微信接口 ───────────────────────────────────────────────── */

async function wxFetch(url, init) {
  const r = await fetch(url, init);
  const buf = await r.arrayBuffer();
  return { ok: r.ok, contentType: String(r.headers.get('content-type') || ''), buf };
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function errcodeOf(buf) {
  try {
    const d = JSON.parse(new TextDecoder().decode(buf));
    return d && (d.errcode || d.errmsg) ? String(d.errcode || d.errmsg) : '';
  } catch (e) {
    return '';
  }
}

export async function getAccessToken(env) {
  const cfg = miniConfig(env);
  if (!cfg.appId || !cfg.secret) throw new Error('mini_not_configured');
  const url = 'https://api.weixin.qq.com/cgi-bin/token' +
    '?grant_type=client_credential' +
    '&appid=' + encodeURIComponent(cfg.appId) +
    '&secret=' + encodeURIComponent(cfg.secret);
  const out = await wxFetch(url);
  let d = {};
  try { d = JSON.parse(new TextDecoder().decode(out.buf)); } catch (e) { /* 下面统一报错 */ }
  if (!d || !d.access_token) throw new Error('wechat_token_failed:' + (d && d.errcode ? d.errcode : 'unknown'));
  return String(d.access_token);
}

/* 返回 base64（不带 data: 前缀），调用方自己拼 MIME。
   微信成功时返回图片二进制；失败时返回 JSON，必须分开处理。 */
export async function getMiniQr(env, ticket, page) {
  const token = await getAccessToken(env);
  const url = 'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(token);
  const out = await wxFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: ticket,
      page: page || MINI_LOGIN_PAGE,
      check_path: false,
      width: 280,
      env_version: 'release',
    }),
  });
  if (out.contentType.indexOf('json') >= 0 || errcodeOf(out.buf)) {
    throw new Error('wechat_qr_failed:' + (errcodeOf(out.buf) || out.ok || 'unknown'));
  }
  if (!out.buf.byteLength) throw new Error('wechat_qr_empty');
  return toBase64(out.buf);
}

export async function code2Session(env, code) {
  const cfg = miniConfig(env);
  if (!cfg.appId || !cfg.secret) throw new Error('mini_not_configured');
  const url = 'https://api.weixin.qq.com/sns/jscode2session' +
    '?appid=' + encodeURIComponent(cfg.appId) +
    '&secret=' + encodeURIComponent(cfg.secret) +
    '&js_code=' + encodeURIComponent(code) +
    '&grant_type=authorization_code';
  const out = await wxFetch(url);
  let d = {};
  try { d = JSON.parse(new TextDecoder().decode(out.buf)); } catch (e) { /* 下面统一报错 */ }
  if (!d || !d.openid) throw new Error('wechat_code_failed:' + (d && d.errcode ? d.errcode : 'unknown'));
  return { openid: String(d.openid), unionid: String(d.unionid || '') };
}
