/* 招呼文案：后端共享默认值 / 后台读写 / 公开读取 / 试听联动
   ──────────────────────────────────────────────────────────────
   全用内存 D1 + 假 fetch：不碰生产库、不连云函数。
   重点断言「一处改，三处生效」的中间两跳：
   后台 POST 写进 admin_config → 公开 GET 读到新值 → 试听默认文案用新值。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { signSession, COOKIE, TTL } from '../functions/lib/admin-auth.js';
import {
  DEFAULT_GREETING, MAX_GREETING_CHARS, normalizeGreeting, readGreeting,
} from '../functions/lib/greeting.js';
import { onRequestGet as adminGreetingGet, onRequestPost as adminGreetingPost } from '../functions/api/admin/greeting.js';
import { onRequestGet as publicGreetingGet, onRequestOptions as publicGreetingOpt } from '../functions/api/greeting.js';
import { onRequestPost as previewPost } from '../functions/api/admin/voice/preview.js';

const ORIGIN = 'https://qingfin.cn';
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const SECRET = 'test-greeting-session-secret';

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

function envOf(db) {
  return {
    DB: db || fakeDb(),
    ADMIN_SESSION_SECRET: SECRET,
    ALLOWED_ORIGINS: ORIGIN,
  };
}

async function cookieOf(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  return COOKIE + '=' + (await signSession(env, exp));
}

function req(path, opts = {}) {
  return new Request(ORIGIN + path, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body,
  });
}

function adminHeaders(cookie, extra = {}) {
  return Object.assign({ Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, extra);
}

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const out = await handler(call);
    return new Response(JSON.stringify(out.body), { status: out.status || 200 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

/* ── 共享默认值与校验 ───────────────────────────────────────── */

test('招呼文案默认值：与试听原默认一致，且长度在 TTS 上限内', () => {
  assert.equal(DEFAULT_GREETING, '你好，我是李清的数字分身。他的项目经历、技术栈和协作方式，都可以直接问我。');
  assert.ok(Array.from(DEFAULT_GREETING).length <= MAX_GREETING_CHARS);
  assert.equal(normalizeGreeting(DEFAULT_GREETING).text, DEFAULT_GREETING);
});

test('normalizeGreeting：空 / 超长 / HTML 都在本地挡掉', () => {
  assert.equal(normalizeGreeting('   ').error, 'empty_text');
  assert.equal(normalizeGreeting('字'.repeat(MAX_GREETING_CHARS + 1)).error, 'text_too_long');
  assert.equal(normalizeGreeting('你好<b>世界</b>').error, 'html_not_allowed');
  assert.equal(normalizeGreeting('  你好呀  ').text, '你好呀');
});

test('readGreeting：空库 / 没绑 D1 / 非法存量值都回默认', async () => {
  const empty = envOf();
  assert.deepEqual(await readGreeting(empty), { text: DEFAULT_GREETING, is_default: true, updated_at: 0 });

  assert.deepEqual(await readGreeting({}), { text: DEFAULT_GREETING, is_default: true, updated_at: 0 });

  const bad = envOf();
  await bad.DB.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)')
    .bind('ai_greeting', JSON.stringify({ text: '<script>alert(1)</script>' }), Date.now()).run();
  assert.equal((await readGreeting(bad)).is_default, true);
});

/* ── 后台读写 ───────────────────────────────────────────────── */

test('/api/admin/greeting：未登录 401，缺 CSRF 头 403', async () => {
  const env = envOf();
  const anon = await adminGreetingGet({ request: req('/api/admin/greeting'), env });
  assert.equal(anon.status, 401);

  const noCsrf = await adminGreetingPost({
    request: req('/api/admin/greeting', {
      method: 'POST',
      headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好' }),
    }),
    env,
  });
  assert.equal(noCsrf.status, 403);
});

test('/api/admin/greeting：GET 返回默认值 + 长度上限', async () => {
  const env = envOf();
  const res = await adminGreetingGet({
    request: req('/api/admin/greeting', { headers: { Cookie: await cookieOf(env) } }),
    env,
  });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.text, DEFAULT_GREETING);
  assert.equal(d.is_default, true);
  assert.equal(d.max_chars, MAX_GREETING_CHARS);
});

test('/api/admin/greeting：POST 保存 → 公开 GET 读到新值 → 恢复默认', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);
  const custom = '你好，欢迎来看我的 Agent 项目。';

  const saved = await adminGreetingPost({
    request: req('/api/admin/greeting', {
      method: 'POST', headers: adminHeaders(cookie), body: JSON.stringify({ text: '  ' + custom + '  ' }),
    }),
    env,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, text: custom, is_default: false });

  /* 中间跳 ①：公开站读到后台刚写的值 */
  const pub = await publicGreetingGet({ request: req('/api/greeting'), env });
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('Cache-Control'), 'public, max-age=60');
  const pubBody = await pub.json();
  assert.equal(pubBody.text, custom);
  assert.equal(pubBody.is_default, false);

  /* 中间跳 ②：后台 GET 也读到自定义，并带更新时间 */
  const admin = await adminGreetingGet({
    request: req('/api/admin/greeting', { headers: { Cookie: cookie } }), env,
  });
  const adminBody = await admin.json();
  assert.equal(adminBody.text, custom);
  assert.equal(adminBody.is_default, false);
  assert.ok(adminBody.updated_at > 0);

  /* 恢复默认 = 删记录，公开端回代码默认值 */
  const reset = await adminGreetingPost({
    request: req('/api/admin/greeting', {
      method: 'POST', headers: adminHeaders(cookie), body: JSON.stringify({ reset: true }),
    }),
    env,
  });
  assert.equal((await reset.json()).is_default, true);
  const pub2 = await publicGreetingGet({ request: req('/api/greeting'), env });
  assert.equal((await pub2.json()).text, DEFAULT_GREETING);
});

test('/api/admin/greeting：空 / 超长 / HTML 一律拒绝且不落库', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);
  const post = (text) => adminGreetingPost({
    request: req('/api/admin/greeting', {
      method: 'POST', headers: adminHeaders(cookie), body: JSON.stringify({ text }),
    }),
    env,
  });
  assert.equal((await post('  ')).status, 400);
  assert.equal((await post('字'.repeat(151))).status, 400);
  assert.equal((await post('你好<br>世界')).status, 400);

  const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'ai_greeting'").first();
  assert.equal(row, null, '被拒的请求不能写进 D1');
});

/* ── 公开端 CORS 与兜底 ─────────────────────────────────────── */

test('/api/greeting：OPTIONS 带 CORS；没绑 D1 也回 200 默认文案', async () => {
  const opt = await publicGreetingOpt({
    request: req('/api/greeting', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } }),
    env: envOf(),
  });
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  const noDb = await publicGreetingGet({ request: req('/api/greeting'), env: {} });
  assert.equal(noDb.status, 200);
  assert.equal((await noDb.json()).text, DEFAULT_GREETING);
});

/* ── 试听联动 ───────────────────────────────────────────────── */

test('/api/admin/voice/preview：未传 text 时用后台招呼文案；传了则用传入值', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);
  const custom = '这是后台改过的招呼文案，试听要念这一句。';
  await adminGreetingPost({
    request: req('/api/admin/greeting', {
      method: 'POST', headers: adminHeaders(cookie), body: JSON.stringify({ text: custom }),
    }),
    env,
  });

  const stub = stubFetch(() => ({ body: { ok: true, audio: 'QUJD', mime: 'audio/mpeg', voice: 101001, chars: 10 } }));
  try {
    const callPreview = (text) => previewPost({
      request: req('/api/admin/voice/preview', {
        method: 'POST',
        headers: adminHeaders(cookie),
        body: JSON.stringify(text ? { text } : {}),
      }),
      env,
    });

    const def = await callPreview();
    assert.equal(def.status, 200);
    assert.equal(stub.calls[0].body.text, custom);

    await callPreview('临时试听别的句子');
    assert.equal(stub.calls[1].body.text, '临时试听别的句子');
  } finally {
    stub.restore();
  }
});
