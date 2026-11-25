/* AI 语音：音色白名单 / 合成转发 / 后台切换 / 试听接口
   ──────────────────────────────────────────────────────────────
   全部用内存 D1 + 假 fetch，不连云函数、不碰生产库。
   fetch 被替换成可编程的桩，用来断言「转发出去的 body 里带了 correct voice」，
   这是整个功能的关键——音色选错等于没做。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { signSession, COOKIE, TTL } from '../functions/lib/admin-auth.js';
import {
  VOICES, DEFAULT_VOICE, DEFAULT_VOICE_BY_GENDER, isGender, isKnownVoice, synthesize, ttsEndpoint,
} from '../functions/lib/tts.js';
import { onRequestGet as voiceGet, onRequestOptions as voiceOptions } from '../functions/api/voice.js';
import { onRequestGet as adminVoiceGet, onRequestPost as adminVoicePost } from '../functions/api/admin/voice.js';
import { onRequestPost as previewPost } from '../functions/api/admin/voice/preview.js';

const ORIGIN = 'https://chenpeisheng.cn';
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const SECRET = 'test-admin-session-secret';

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
    ADMIN_PASSWORD: 'unused-emergency-password',
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

/* 可编程的 fetch 桩：记录每次请求，返回预设响应 */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const out = await handler(call);
    return new Response(JSON.stringify(out.body), { status: out.status || 200 });
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

const OK_AUDIO = { ok: true, audio: 'QUJD', mime: 'audio/mpeg', voice: DEFAULT_VOICE, chars: 2, cached: false };

/* ── 白名单与转发 ───────────────────────────────────────────────── */

test('音色白名单：默认音色在册，乱填的 ID 一律不认', () => {
  assert.equal(DEFAULT_VOICE, 101001);
  assert.ok(VOICES.length >= 8);
  assert.equal(isKnownVoice(DEFAULT_VOICE), true);
  assert.equal(isKnownVoice('101001'), true);
  assert.equal(isKnownVoice(999999), false);
  assert.equal(isKnownVoice(0), false);
  assert.equal(isKnownVoice(null), false);
  /* 清单里不许有重复 ID —— 重复会让 admin 出现两张一样的卡 */
  const ids = VOICES.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('synthesize：空文本 / 超长 / 白名单外都在本地挡掉，不发请求', async () => {
  const stub = stubFetch(() => ({ body: OK_AUDIO }));
  try {
    const env = envOf();
    assert.equal((await synthesize(env, { text: '   ' })).error, 'empty_text');
    assert.equal((await synthesize(env, { text: '字'.repeat(151) })).error, 'text_too_long');
    assert.equal((await synthesize(env, { text: '你好', voice: 424242 })).error, 'unknown_voice');
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('synthesize：转发给云函数时带 mode/voice/text，Origin 用主站域名', async () => {
  const stub = stubFetch(() => ({ body: OK_AUDIO }));
  try {
    const env = envOf();
    const r = await synthesize(env, { text: '你好', voice: 101004, kind: 'greet' });
    assert.equal(r.ok, true);
    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.url, ttsEndpoint(env));
    assert.deepEqual(call.body, { mode: 'tts', text: '你好', kind: 'greet', voice: 101004 });
    assert.equal(call.init.headers.Origin, ORIGIN);
  } finally { stub.restore(); }
});

test('synthesize：云函数报错时把 code 与文案原样带回来', async () => {
  const stub = stubFetch(() => ({ status: 502, body: { ok: false, error: 'tts_failed', code: 'UnsupportedVoiceType', message: '云端语音暂时不可用' } }));
  try {
    const r = await synthesize(envOf(), { text: '你好', voice: 101001 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'UnsupportedVoiceType');
    assert.equal(r.status, 502);
    assert.match(r.message, /云端语音/);
  } finally { stub.restore(); }
});

test('synthesize：连不上归成 tts_unreachable（502），不抛异常', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connect timeout'); };
  try {
    const r = await synthesize(envOf(), { text: '你好' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'tts_unreachable');
    assert.equal(r.status, 502);
  } finally { globalThis.fetch = original; }
});

/* ── 公开 /api/voice ────────────────────────────────────────────── */

test('/api/voice：没配置过回默认音色，且允许缓存 60 秒', async () => {
  const res = await voiceGet({ request: req('/api/voice', { headers: { Origin: ORIGIN } }), env: envOf() });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.voice, DEFAULT_VOICE);
  assert.equal(d.ok, true);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('/api/voice：读到后台存的音色；存了非法值则回落默认', async () => {
  const env = envOf();
  await env.DB.prepare("INSERT INTO admin_config (key, value, updated_at) VALUES ('ai_voice', ?, ?)")
    .bind(JSON.stringify({ voice: 101013 }), Date.now()).run();
  let d = await (await voiceGet({ request: req('/api/voice'), env })).json();
  assert.equal(d.voice, 101013);
  assert.equal(d.name, '智辉');

  await env.DB.prepare("UPDATE admin_config SET value = ? WHERE key = 'ai_voice'")
    .bind(JSON.stringify({ voice: 888888 })).run();
  d = await (await voiceGet({ request: req('/api/voice'), env })).json();
  assert.equal(d.voice, DEFAULT_VOICE, '库里被人塞了野值也不能让前端拿到');
});

test('/api/voice：OPTIONS 预检返回 204 且带 CORS 头', async () => {
  const res = await voiceOptions({ request: req('/api/voice', { method: 'OPTIONS', headers: { Origin: ORIGIN } }) });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

/* ── 后台切换 ───────────────────────────────────────────────────── */

test('/api/admin/voice：未登录 401；登录后给出清单与当前音色', async () => {
  const env = envOf();
  const anon = await adminVoiceGet({ request: req('/api/admin/voice'), env });
  assert.equal(anon.status, 401);

  const res = await adminVoiceGet({ request: req('/api/admin/voice', { headers: { Cookie: await cookieOf(env) } }), env });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.voice, DEFAULT_VOICE);
  assert.equal(d.is_default, true);
  assert.equal(d.voices.length, VOICES.length);
  assert.ok(d.upstream.indexOf('http') === 0);
});

test('/api/admin/voice：切换写库，公开接口随即读到；voice=0 恢复默认', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);

  const bad = await adminVoicePost({
    request: req('/api/admin/voice', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ voice: 123456 }) }),
    env,
  });
  assert.equal(bad.status, 400);

  const noCsrf = await adminVoicePost({
    request: req('/api/admin/voice', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: 101013 }) }),
    env,
  });
  assert.equal(noCsrf.status, 403, '缺 X-Admin-Request 必须被 CSRF 挡下');

  const ok = await adminVoicePost({
    request: req('/api/admin/voice', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ voice: 101013 }) }),
    env,
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).voice, 101013);

  const pub = await (await voiceGet({ request: req('/api/voice'), env })).json();
  assert.equal(pub.voice, 101013, '后台切换后公开站必须立刻读到');

  const back = await adminVoicePost({
    request: req('/api/admin/voice', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ voice: 0 }) }),
    env,
  });
  assert.equal((await back.json()).is_default, true);
  const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'ai_voice'").first();
  assert.equal(row, null, '恢复默认要把记录删掉，而不是存一个 0');
  const pub2 = await (await voiceGet({ request: req('/api/voice'), env })).json();
  assert.equal(pub2.voice, DEFAULT_VOICE);
});

/* ── 试听 ───────────────────────────────────────────────────────── */

test('/api/admin/voice/preview：未登录 401，缺 CSRF 403', async () => {
  const env = envOf();
  const anon = await previewPost({
    request: req('/api/admin/voice/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好' }) }),
    env,
  });
  assert.equal(anon.status, 401);

  const noCsrf = await previewPost({
    request: req('/api/admin/voice/preview', { method: 'POST', headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好' }) }),
    env,
  });
  assert.equal(noCsrf.status, 403);
});

test('/api/admin/voice/preview：合成成功返回 base64，且不改动线上配置', async () => {
  const env = envOf();
  const stub = stubFetch(() => ({ body: { ...OK_AUDIO, voice: 101004, chars: 6 } }));
  try {
    const res = await previewPost({
      request: req('/api/admin/voice/preview', {
        method: 'POST',
        headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
        body: JSON.stringify({ voice: 101004, text: '你好，试听一下' }),
      }),
      env,
    });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.ok, true);
    assert.equal(d.audio, 'QUJD');
    assert.equal(d.voice, 101004);
    assert.equal(d.name, '智云');
    assert.equal(stub.calls[0].body.voice, 101004);
    const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'ai_voice'").first();
    assert.equal(row, null, '试听绝不能顺手把音色改了');
  } finally { stub.restore(); }
});

test('/api/admin/voice/preview：文本超长按 150 字截断后再发', async () => {
  const env = envOf();
  const stub = stubFetch(() => ({ body: OK_AUDIO }));
  try {
    await previewPost({
      request: req('/api/admin/voice/preview', {
        method: 'POST',
        headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
        body: JSON.stringify({ voice: DEFAULT_VOICE, text: '字'.repeat(400) }),
      }),
      env,
    });
    assert.equal(stub.calls[0].body.text.length, 150);
  } finally { stub.restore(); }
});

test('/api/admin/voice/preview：一小时 60 次后限流（429）', async () => {
  const env = envOf();
  const stub = stubFetch(() => ({ body: OK_AUDIO }));
  const cookie = await cookieOf(env);
  const call = () => previewPost({
    request: req('/api/admin/voice/preview', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: JSON.stringify({ voice: DEFAULT_VOICE, text: '你好' }),
    }),
    env,
  });
  try {
    let last = null;
    for (let i = 0; i < 61; i++) last = await call();
    assert.equal(last.status, 429);
    /* 被挡下的那次不应该再去烧云函数的字符额度 */
    assert.equal(stub.calls.length, 60);
  } finally { stub.restore(); }
});

/* ── 性别套装 ───────────────────────────────────────────────────── */

test('音色清单带 gender，男女套装默认音色各自成套', () => {
  assert.equal(VOICES.filter((v) => v.gender === 'female').length, 5);
  assert.equal(VOICES.filter((v) => v.gender === 'male').length, 5);
  assert.equal(DEFAULT_VOICE_BY_GENDER.female, 101001);
  assert.equal(DEFAULT_VOICE_BY_GENDER.male, 101013);
  assert.equal(isGender('male'), true);
  assert.equal(isGender('other'), false);
});

test('/api/voice?gender= 按性别取音色，互不串味；后台可分别设置', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);

  let d = await (await voiceGet({ request: req('/api/voice?gender=female'), env })).json();
  assert.equal(d.voice, 101001, '女版默认应为女声');
  assert.equal(d.gender, 'female');
  d = await (await voiceGet({ request: req('/api/voice?gender=male'), env })).json();
  assert.equal(d.voice, 101013, '男版默认应为男声');
  assert.equal(d.gender, 'male');

  const set = await adminVoicePost({
    request: req('/api/admin/voice', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: JSON.stringify({ gender: 'male', voice: 101004 }),
    }),
    env,
  });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).gender, 'male');

  d = await (await voiceGet({ request: req('/api/voice?gender=male'), env })).json();
  assert.equal(d.voice, 101004);
  d = await (await voiceGet({ request: req('/api/voice?gender=female'), env })).json();
  assert.equal(d.voice, 101001, '改男版不能影响女版');

  const admin = await (await adminVoiceGet({
    request: req('/api/admin/voice', { headers: { Cookie: cookie } }), env,
  })).json();
  assert.equal(admin.male_voice, 101004);
  assert.equal(admin.female_voice, 101001);
  assert.equal(admin.male_is_default, false);
  assert.equal(admin.female_is_default, true);

  const back = await adminVoicePost({
    request: req('/api/admin/voice', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: JSON.stringify({ gender: 'male', voice: 0 }),
    }),
    env,
  });
  assert.equal((await back.json()).is_default, true);
  const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'ai_voice_male'").first();
  assert.equal(row, null, '恢复默认应删掉男版专属记录');
});
