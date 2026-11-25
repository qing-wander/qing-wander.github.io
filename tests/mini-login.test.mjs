/* 小程序扫码登录：ticket 生命周期 / 微信接口解析 / 白名单 / 会话签发
   ──────────────────────────────────────────────────────────────
   全部用内存 KV + 假 fetch，不碰生产 KV、不连微信服务器。
   重点断言三段链路：
   qr 生成 ticket → confirm 写入身份 → poll 一次性换成会话 Cookie。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE } from '../functions/lib/admin-auth.js';
import {
  miniConfig, miniEnabled, newTicket, validTicket, putTicket, getTicket, TICKET_TTL,
} from '../functions/lib/mini-login.js';
import { onRequestGet as qrGet } from '../functions/api/admin/auth/mini/qr.js';
import { onRequestPost as confirmPost } from '../functions/api/admin/auth/mini/confirm.js';
import { onRequestGet as pollGet } from '../functions/api/admin/auth/mini/poll.js';

const ORIGIN = 'https://chenpeisheng.cn';

function fakeKv() {
  const map = new Map();
  return {
    map,
    async put(key, value, opts) { map.set(key, { value, ttl: opts && opts.expirationTtl }); },
    async get(key) { return map.has(key) ? map.get(key).value : null; },
  };
}

function envOf(kv, extra) {
  return Object.assign({
    SITE_KV: kv || fakeKv(),
    WECHAT_MINI_APP_ID: 'wx3a03f69382d6bc49',
    WECHAT_MINI_APP_SECRET: 'test-mini-secret',
    WECHAT_ALLOW_OPENIDS: 'o_allowed',
    ADMIN_SESSION_SECRET: 'test-mini-session-secret',
  }, extra || {});
}

function req(path, opts = {}) {
  return new Request(ORIGIN + path, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body,
  });
}

function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function wxFetch(identity) {
  return installFetch((url) => {
    if (url.includes('/cgi-bin/token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    if (url.includes('getwxacodeunlimit')) {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (url.includes('jscode2session')) {
      return new Response(JSON.stringify(identity || { openid: 'o_allowed', unionid: '' }));
    }
    throw new Error('unexpected url: ' + url);
  });
}

async function jsonOf(res) {
  return res.json();
}

/* ── 配置与 ticket ─────────────────────────────────────────── */

test('miniConfig 只从 env 读，缺 Secret / KV 时不可用', () => {
  assert.deepEqual(miniConfig(envOf()), { appId: 'wx3a03f69382d6bc49', secret: 'test-mini-secret' });
  assert.equal(miniEnabled(envOf()), true);
  assert.equal(miniEnabled(envOf(fakeKv(), { WECHAT_MINI_APP_SECRET: '' })), false);
  assert.equal(miniEnabled(envOf(null, { SITE_KV: null })), false);
});

test('ticket 是 32 位 hex，随机且不认非法值', () => {
  const a = newTicket();
  const b = newTicket();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(validTicket(a), true);
  assert.equal(validTicket('abc'), false);
  assert.equal(validTicket('../evil'), false);
  assert.equal(validTicket(''), false);
});

test('KV 写入带 5 分钟 TTL；非法 ticket 直接不读', async () => {
  const kv = fakeKv();
  const t = newTicket();
  await putTicket(envOf(kv), t, { status: 'pending' });
  const key = Array.from(kv.map.keys())[0];
  assert.equal(key, 'mini:login:' + t);
  assert.equal(kv.map.get(key).ttl, TICKET_TTL);
  assert.deepEqual(await getTicket(envOf(kv), t), { status: 'pending' });
  assert.equal(await getTicket(envOf(kv), 'bad'), null);
});

/* ── 生成小程序码 ─────────────────────────────────────────── */

test('未配置时 qr 回 503，不假装可用', async () => {
  const env = envOf(fakeKv(), { WECHAT_MINI_APP_SECRET: '' });
  const res = await qrGet({ env });
  assert.equal(res.status, 503);
  assert.equal((await jsonOf(res)).error, 'mini_not_configured');
});

test('qr 生成 data:image/jpeg 小程序码，并把 pending ticket 存进 KV', async () => {
  const f = wxFetch();
  try {
    const kv = fakeKv();
    const env = envOf(kv);
    const res = await qrGet({ env });
    assert.equal(res.status, 200);
    const d = await jsonOf(res);
    assert.equal(d.ok, true);
    assert.match(d.image, /^data:image\/jpeg;base64,/);
    assert.equal(validTicket(d.ticket), true);
    assert.equal(d.expires_in, 300);
    assert.equal((await getTicket(env, d.ticket)).status, 'pending');
    assert.ok(f.calls.some((c) => c.url.includes('getwxacodeunlimit')));
  } finally { f.restore(); }
});

test('qr 遇到微信 errcode 回 502，不把错误 JSON 当图片发出去', async () => {
  const f = installFetch((url) => {
    if (url.includes('/cgi-bin/token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    if (url.includes('getwxacodeunlimit')) {
      return new Response(JSON.stringify({ errcode: 41001, errmsg: 'access_token missing' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('unexpected url');
  });
  try {
    const res = await qrGet({ env: envOf() });
    assert.equal(res.status, 502);
    assert.equal((await jsonOf(res)).error, 'wechat_qr_failed');
  } finally { f.restore(); }
});

/* ── 小程序回传确认 ───────────────────────────────────────── */

async function confirmWith(env, ticket, identity) {
  const f = wxFetch(identity);
  try {
    return await confirmPost({
      env,
      request: req('/api/admin/auth/mini/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, code: 'wx-code' }),
      }),
    });
  } finally { f.restore(); }
}

test('confirm 命中白名单 → ticket 变 confirmed', async () => {
  const env = envOf();
  const ticket = newTicket();
  await putTicket(env, ticket, { status: 'pending' });
  const res = await confirmWith(env, ticket);
  assert.equal(res.status, 200);
  assert.equal((await jsonOf(res)).ok, true);
  const rec = await getTicket(env, ticket);
  assert.equal(rec.status, 'confirmed');
  assert.equal(rec.openid, 'o_allowed');
});

test('confirm 未命中白名单 → denied，openid 留给网页轮询展示', async () => {
  const env = envOf();
  const ticket = newTicket();
  await putTicket(env, ticket, { status: 'pending' });
  const res = await confirmWith(env, ticket, { openid: 'o_stranger', unionid: '' });
  assert.equal((await jsonOf(res)).ok, true); // 不往小程序界面泄漏身份
  const rec = await getTicket(env, ticket);
  assert.equal(rec.status, 'denied');
  assert.equal(rec.openid, 'o_stranger');
});

test('confirm 拒绝非法 ticket 与过期 ticket', async () => {
  const env = envOf();
  const bad = await confirmPost({
    env,
    request: req('/api/admin/auth/mini/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: 'nope', code: 'x' }),
    }),
  });
  assert.equal(bad.status, 400);

  const missing = await confirmPost({
    env,
    request: req('/api/admin/auth/mini/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: newTicket(), code: 'x' }),
    }),
  });
  assert.equal(missing.status, 410);
});

/* ── 网页轮询与会话签发 ───────────────────────────────────── */

function poll(env, ticket) {
  return pollGet({ env, request: req('/api/admin/auth/mini/poll?ticket=' + ticket) });
}

test('poll 在 pending 阶段只回状态，不下发 Cookie', async () => {
  const env = envOf();
  const ticket = newTicket();
  await putTicket(env, ticket, { status: 'pending' });
  const res = await poll(env, ticket);
  assert.deepEqual(await jsonOf(res), { ok: false, status: 'pending' });
  assert.equal(res.headers.get('set-cookie'), null);
});

test('poll 把 confirmed 一次性换成会话 Cookie，再轮询拿不到', async () => {
  const env = envOf();
  const ticket = newTicket();
  await putTicket(env, ticket, { status: 'confirmed', openid: 'o_allowed' });

  const res = await poll(env, ticket);
  assert.equal((await jsonOf(res)).ok, true);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie && cookie.indexOf(COOKIE + '=') === 0);
  assert.match(cookie, /HttpOnly/);
  assert.equal((await getTicket(env, ticket)).status, 'used');

  const again = await poll(env, ticket);
  assert.equal((await jsonOf(again)).ok, false);
  assert.equal(again.headers.get('set-cookie'), null);
});

test('poll 把 denied 的 openid 交还网页，供首次配白名单', async () => {
  const env = envOf();
  const ticket = newTicket();
  await putTicket(env, ticket, { status: 'denied', openid: 'o_stranger', unionid: 'u_1' });
  const res = await poll(env, ticket);
  const d = await jsonOf(res);
  assert.equal(d.status, 'not_allowed');
  assert.equal(d.openid, 'o_stranger');
  assert.equal(d.unionid, 'u_1');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('poll 拒绝非法 ticket', async () => {
  const res = await poll(envOf(), 'not-a-ticket');
  assert.equal(res.status, 400);
  assert.equal((await jsonOf(res)).error, 'bad_ticket');
});
