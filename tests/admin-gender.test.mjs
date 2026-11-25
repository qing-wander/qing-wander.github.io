/* 展示套装（男版 / 女版）：后台配置 + 公开只读下发
   ──────────────────────────────────────────────────────────────
   全部用内存 D1 + 假会话，不连云函数、不碰生产库。
   关键口径：后台选定的套装公开站必须立刻读到；非法值回落 null；
   访客端没有任何写入口，POST 只走后台鉴权 + CSRF。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { signSession, COOKIE, TTL } from '../functions/lib/admin-auth.js';
import { onRequestGet as publicGet } from '../functions/api/gender.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/gender.js';

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

/* ── 公开 GET /api/gender ──────────────────────────────────────── */

test('/api/gender：没配置过回 null，允许缓存 60 秒且跨域可读', async () => {
  const res = await publicGet({ request: req('/api/gender', { headers: { Origin: ORIGIN } }), env: envOf() });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.gender, null);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('/api/gender：读到后台存的套装；存了非法值则回落 null', async () => {
  const env = envOf();
  await env.DB.prepare("INSERT INTO admin_config (key, value, updated_at) VALUES ('gender', ?, ?)")
    .bind(JSON.stringify({ gender: 'female' }), Date.now()).run();
  let d = await (await publicGet({ request: req('/api/gender'), env })).json();
  assert.equal(d.gender, 'female');

  await env.DB.prepare("UPDATE admin_config SET value = ? WHERE key = 'gender'")
    .bind(JSON.stringify({ gender: 'robot' })).run();
  d = await (await publicGet({ request: req('/api/gender'), env })).json();
  assert.equal(d.gender, null, '非法套装必须回落 null');
});

/* ── 后台 GET /api/admin/gender ─────────────────────────────────── */

test('/api/admin/gender：未登录 401', async () => {
  const res = await adminGet({ request: req('/api/admin/gender'), env: envOf() });
  assert.equal(res.status, 401);
});

test('/api/admin/gender：登录后返回当前套装与可选列表', async () => {
  const env = envOf();
  const res = await adminGet({
    request: req('/api/admin/gender', { headers: { Cookie: await cookieOf(env) } }),
    env,
  });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.gender, '');
  assert.equal(d.genders.length, 2);
  assert.deepEqual(d.genders.map((g) => g.id), ['male', 'female']);
});

/* ── 后台 POST /api/admin/gender ─────────────────────────────────── */

test('/api/admin/gender：未登录 401，缺 CSRF 头 403', async () => {
  const env = envOf();
  const anon = await adminPost({
    request: req('/api/admin/gender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gender: 'male' }) }),
    env,
  });
  assert.equal(anon.status, 401);

  const noCsrf = await adminPost({
    request: req('/api/admin/gender', { method: 'POST', headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ gender: 'male' }) }),
    env,
  });
  assert.equal(noCsrf.status, 403, '缺 X-Admin-Request 必须被 CSRF 挡下');
});

test('/api/admin/gender：保存女版后公开站立刻读到；非法值被拒', async () => {
  const env = envOf();
  const cookie = await cookieOf(env);

  const ok = await adminPost({
    request: req('/api/admin/gender', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ gender: 'female' }) }),
    env,
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).gender, 'female');

  const pub = await (await publicGet({ request: req('/api/gender'), env })).json();
  assert.equal(pub.gender, 'female', '后台切换后公开站必须立刻读到');

  const bad = await adminPost({
    request: req('/api/admin/gender', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ gender: 'robot' }) }),
    env,
  });
  assert.equal(bad.status, 400, '未知套装必须被拒');
  const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'gender'").first();
  assert.match(row.value, /female/, '被拒的非法值不能覆盖原配置');
});

test('/api/admin/gender：清空套装后公开站回落 null（跟随站点数据默认）', async () => {
  const env = envOf();
  await env.DB.prepare("INSERT INTO admin_config (key, value, updated_at) VALUES ('gender', ?, ?)")
    .bind(JSON.stringify({ gender: 'male' }), Date.now()).run();

  const back = await adminPost({
    request: req('/api/admin/gender', { method: 'POST', headers: { Cookie: await cookieOf(env), 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ gender: '' }) }),
    env,
  });
  assert.equal(back.status, 200);
  assert.equal((await back.json()).gender, '');

  const pub = await (await publicGet({ request: req('/api/gender'), env })).json();
  assert.equal(pub.gender, null);
});
