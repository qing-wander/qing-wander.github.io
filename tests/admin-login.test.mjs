/* 后台免密登录回归：邮箱白名单、验证码生命周期、限流、微信 OAuth 白名单
   发信与微信接口都用 fetch stub，不产生真实外呼；D1 用 node:sqlite 内存库。 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost as sendPost } from '../functions/api/admin/auth/email/send.js';
import { onRequestPost as verifyPost } from '../functions/api/admin/auth/email/verify.js';
import { onRequestGet as methodsGet } from '../functions/api/admin/auth/methods.js';
import { onRequestGet as wechatStart } from '../functions/api/admin/auth/wechat/index.js';
import { onRequestGet as wechatCallback } from '../functions/api/admin/auth/wechat/callback.js';
import { signState, codeHash, wechatAllowed, isAllowedEmail } from '../functions/lib/admin-login.js';
import { verifySession, COOKIE } from '../functions/lib/admin-auth.js';

const ORIGIN = 'https://chenpeisheng.cn';
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const SECRET = 'test-session-secret';
const EMAILS = 'me@gmail.com,me@qq.com';

function fakeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  return {
    raw: sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const make = (params) => ({
        all: async () => ({ results: stmt.all(...params), success: true, meta: {} }),
        first: async (col) => {
          const row = stmt.all(...params)[0];
          if (!row) return null;
          return col ? (row[col] === undefined ? null : row[col]) : row;
        },
        run: async () => {
          const info = stmt.run(...params);
          return { success: true, meta: { changes: Number(info && info.changes) || 0 } };
        },
      });
      return Object.assign(make([]), { bind: (...params) => make(params) });
    },
  };
}

function envOf(db, extra = {}) {
  return Object.assign({
    DB: db,
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_EMAILS: EMAILS,
    RESEND_API_KEY: 'test-resend',
    RESEND_FROM: 'chenpeisheng <hi@chenpeisheng.cn>',
  }, extra);
}

function post(path, body, headers = {}) {
  return new Request(ORIGIN + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: ORIGIN }, headers),
    body: JSON.stringify(body || {}),
  });
}

/* ── fetch stub：截获发信与微信接口 ────────────────────────────── */
let calls = [];
const realFetch = globalThis.fetch;

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init || {});
  };
}

function jsonRes(obj, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

/* 从 stub 截获的邮件正文里取 6 位验证码 */
function codeFromCalls() {
  const mail = calls.find((c) => c.url.indexOf('api.resend.com') >= 0);
  assert.ok(mail, '应该调用 Resend 发信');
  const body = JSON.parse(mail.init.body);
  const m = /(\d{6})/.exec(body.text || '');
  return { code: m && m[1], to: body.to, from: body.from, subject: body.subject };
}

/* ── 白名单 ─────────────────────────────────────────────────────── */

test('邮箱白名单：默认只认站长邮箱，配了多个都能用', () => {
  assert.equal(isAllowedEmail({}, 'hi@chenpeisheng.cn'), true);
  assert.equal(isAllowedEmail({}, 'someone@gmail.com'), false);
  assert.equal(isAllowedEmail({ ADMIN_EMAILS: EMAILS }, 'ME@GMAIL.COM'), true);
  assert.equal(isAllowedEmail({ ADMIN_EMAILS: EMAILS }, 'me@qq.com'), true);
  assert.equal(isAllowedEmail({ ADMIN_EMAILS: EMAILS }, 'me@163.com'), false);
});

test('白名单外邮箱发验证码 → 403，且不外呼', async () => {
  stubFetch(() => jsonRes({ id: 'x' }));
  const res = await sendPost({ request: post('/api/admin/auth/email/send', { email: 'stranger@gmail.com' }), env: envOf(fakeDb()) });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'email_not_allowed');
  assert.equal(calls.length, 0);
});

/* ── 发送 ───────────────────────────────────────────────────────── */

test('发验证码：落库只存哈希，邮件里是 6 位码', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));

  const res = await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.email, 'me***@gmail.com');

  const { code, to, from } = codeFromCalls();
  assert.equal(to[0], 'me@gmail.com');
  assert.match(from, /hi@chenpeisheng\.cn/);
  assert.match(code, /^\d{6}$/);

  const row = db.raw.prepare('SELECT * FROM admin_email_codes WHERE email = ?').get('me@gmail.com');
  assert.ok(row, '应该写入验证码行');
  assert.notEqual(row.code_hash, code, '库里不能存明文');
  assert.equal(row.code_hash, await codeHash(env, 'me@gmail.com', code));
  assert.equal(row.attempts, 0);
  assert.ok(row.expires_at > Date.now());
});

test('60 秒内重发 → 429 cooldown，并给出等待秒数', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));

  await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  const again = await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  assert.equal(again.status, 429);
  const b = await again.json();
  assert.equal(b.error, 'cooldown');
  assert.ok(b.retry > 0 && b.retry <= 60);
});

test('同邮箱每小时最多 4 封，超出直接 429（冷却期不算）', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));
  const send = () => sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });

  for (let i = 0; i < 4; i++) {
    const r = await send();
    assert.equal(r.status, 200, '第 ' + (i + 1) + ' 封应发出');
    db.raw.prepare('UPDATE admin_email_codes SET sent_at = ? WHERE email = ?').run(Date.now() - 120000, 'me@gmail.com');
  }
  const fifth = await send();
  assert.equal(fifth.status, 429);
  assert.equal((await fifth.json()).error, 'rate_limited');
  assert.equal(calls.filter((c) => c.url.indexOf('resend') >= 0).length, 4, '第 5 次不能再外呼');
});

test('发信失败时撤销验证码行，不留下收不到的码', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ message: 'domain not verified' }, false));

  const res = await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'mail_rejected');
  const row = db.raw.prepare('SELECT * FROM admin_email_codes WHERE email = ?').get('me@gmail.com');
  assert.equal(row, undefined);
});

test('没配 RESEND_API_KEY → 503 mail_not_configured', async () => {
  const env = envOf(fakeDb(), { RESEND_API_KEY: '' });
  const res = await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'mail_not_configured');
});

/* ── 验证 ───────────────────────────────────────────────────────── */

test('验证码正确 → 下发会话 cookie，且验证码一次性', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));
  await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@qq.com' }), env });
  const { code } = codeFromCalls();

  const res = await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@qq.com', code }), env });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /pa_sess=/);
  assert.match(setCookie, /HttpOnly/);

  const value = setCookie.split(';')[0].slice(COOKIE.length + 1);
  assert.equal(await verifySession(env, value), true);

  const replay = await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@qq.com', code }), env });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error, 'code_not_found');
});

test('验证码错误 → 次数累加，第 5 次后锁死必须重发', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));
  await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });

  const wrong = await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@gmail.com', code: '000000' }), env });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).left, 4);

  for (let i = 0; i < 4; i++) {
    await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@gmail.com', code: '111111' }), env });
  }
  const locked = await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@gmail.com', code: '222222' }), env });
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).error, 'too_many_attempts');
});

test('验证码过期 → code_expired 并清行', async () => {
  const db = fakeDb();
  const env = envOf(db);
  stubFetch(() => jsonRes({ id: 'mail-1' }));
  await sendPost({ request: post('/api/admin/auth/email/send', { email: 'me@gmail.com' }), env });
  const { code } = codeFromCalls();
  db.raw.prepare('UPDATE admin_email_codes SET expires_at = ? WHERE email = ?').run(Date.now() - 1000, 'me@gmail.com');

  const res = await verifyPost({ request: post('/api/admin/auth/email/verify', { email: 'me@gmail.com', code }), env });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'code_expired');
  assert.equal(db.raw.prepare('SELECT * FROM admin_email_codes WHERE email = ?').get('me@gmail.com'), undefined);
});

test('登录方式探测：邮件与微信按配置如实回报，不泄漏完整白名单', async () => {
  const env = envOf(fakeDb(), {
    WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec', WECHAT_ALLOW_OPENIDS: 'oABC',
  });
  const res = await methodsGet({ request: new Request(ORIGIN + '/api/admin/auth/methods'), env });
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.email.enabled, true);
  assert.equal(d.email.hint, 'me***@gmail.com');
  assert.equal(d.wechat.qr, true);
  assert.equal(d.wechat.mp, false);
  assert.equal(d.inWechat, false);
  assert.ok(!JSON.stringify(d).includes('me@qq.com'), '不能把完整白名单吐出去');
});

/* ── 微信 ───────────────────────────────────────────────────────── */

test('微信登录未配置 → 503，不跳外站', async () => {
  const env = envOf(fakeDb());
  const res = await wechatStart({ request: new Request(ORIGIN + '/api/admin/auth/wechat?mode=qr'), env });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'wechat_not_configured');
});

test('微信登录排队：生成带签名 state 的 qrconnect 地址', async () => {
  const env = envOf(fakeDb(), {
    WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec', WECHAT_ALLOW_OPENIDS: 'oABC',
  });
  const res = await wechatStart({ request: new Request(ORIGIN + '/api/admin/auth/wechat?mode=qr'), env });
  assert.equal(res.status, 302);
  const loc = res.headers.get('Location');
  assert.match(loc, /^https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect\?/);
  assert.match(loc, /appid=wx123/);
  assert.match(loc, /scope=snsapi_login/);
  assert.match(loc, new RegExp('redirect_uri=' + encodeURIComponent(ORIGIN + '/api/admin/auth/wechat/callback').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(loc, /state=qr\./);
});

test('微信回调：白名单内的 openid 换到会话 cookie', async () => {
  const env = envOf(fakeDb(), {
    WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec', WECHAT_ALLOW_OPENIDS: 'oABC',
  });
  stubFetch((url) => {
    if (url.indexOf('/sns/oauth2/access_token') >= 0) {
      return jsonRes({ access_token: 'tok', openid: 'oABC', unionid: 'u1' });
    }
    return jsonRes({ nickname: '站长' });
  });

  const state = await signState(env, 'qr');
  const res = await wechatCallback({
    request: new Request(ORIGIN + '/api/admin/auth/wechat/callback?code=c1&state=' + encodeURIComponent(state)),
    env,
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/admin/');
  const setCookie = res.headers.get('Set-Cookie') || '';
  const value = setCookie.split(';')[0].slice(COOKIE.length + 1);
  assert.equal(await verifySession(env, value), true);
});

test('微信回调：白名单外的人不登录，把 openid 带回登录页', async () => {
  const env = envOf(fakeDb(), {
    WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec', WECHAT_ALLOW_OPENIDS: 'oABC',
  });
  stubFetch(() => jsonRes({ access_token: 'tok', openid: 'oOTHER' }));

  const state = await signState(env, 'qr');
  const res = await wechatCallback({
    request: new Request(ORIGIN + '/api/admin/auth/wechat/callback?code=c1&state=' + encodeURIComponent(state)),
    env,
  });
  assert.equal(res.status, 302);
  const loc = res.headers.get('Location');
  assert.match(loc, /^\/login\?error=wechat_not_allowed/);
  assert.match(loc, /openid=oOTHER/);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('微信回调：没配白名单 = 一律拒绝', async () => {
  const env = envOf(fakeDb(), { WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec' });
  assert.equal(wechatAllowed(env, 'oABC', ''), false);
  stubFetch(() => jsonRes({ access_token: 'tok', openid: 'oABC' }));
  const state = await signState(env, 'qr');
  const res = await wechatCallback({
    request: new Request(ORIGIN + '/api/admin/auth/wechat/callback?code=c1&state=' + encodeURIComponent(state)),
    env,
  });
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('微信回调：state 被篡改 / 过期都回登录页', async () => {
  const env = envOf(fakeDb(), { WECHAT_APP_ID: 'wx123', WECHAT_APP_SECRET: 'sec', WECHAT_ALLOW_OPENIDS: 'oABC' });
  stubFetch(() => jsonRes({ access_token: 'tok', openid: 'oABC' }));

  const bad = await wechatCallback({
    request: new Request(ORIGIN + '/api/admin/auth/wechat/callback?code=c1&state=qr.1.2.3'),
    env,
  });
  assert.equal(bad.headers.get('Location'), '/login?error=bad_state');

  const state = await signState(env, 'qr');
  const tampered = 'mp.' + state.split('.').slice(1).join('.');   // 改 mode 但签名还是 qr 的
  const res = await wechatCallback({
    request: new Request(ORIGIN + '/api/admin/auth/wechat/callback?code=c1&state=' + encodeURIComponent(tampered)),
    env,
  });
  assert.equal(res.headers.get('Location'), '/login?error=bad_state');
});
