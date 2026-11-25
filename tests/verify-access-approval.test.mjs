/* 学历核验「邮件审批 → 服务端授权 → 轮询解锁」端到端回归
   全程 mock Resend；D1 用 node:sqlite 内存库，SQL 与线上同构。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildAccessNotice } from '../functions/lib/verify-access-notify.js';
import { signApproval, verifyApproval } from '../functions/lib/verify-access-token.js';
import { onRequestPost as submitPost, onRequestGet as statusGet } from '../functions/api/verify-access.js';
import { onRequestGet as approveGet, onRequestPost as approvePost } from '../functions/api/verify-access-approve.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8877';

function liveDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const make = (params) => ({
        all: async () => ({ results: stmt.all(...params), success: true, meta: {} }),
        first: async () => stmt.all(...params)[0] || null,
        run: async () => ({ success: true, meta: { changes: Number(stmt.run(...params).changes) || 0 } }),
      });
      return Object.assign(make([]), { bind: (...params) => make(params) });
    },
  };
}

function envOf(db = liveDb()) {
  return {
    DB: db,
    ALLOWED_ORIGINS: ORIGIN,
    DEVICE_HASH_PEPPER: 'test-pepper',
    VERIFY_ACCESS_SECRET: 'test-approval-secret',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Portfolio <onboarding@resend.dev>',
  };
}

const BODY = {
  name: '李四', identity: 'hr', org: '某某科技', contact: 'hr@example.com',
  purpose: 'background', reason: '我是某某科技 HR，正在推进该候选人的录用背调，需要核验学历信息。',
  consent: true,
};

function mockResend(t) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'em_test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

async function submit(env, body = BODY) {
  return submitPost({
    env,
    request: new Request(ORIGIN + '/api/verify-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Origin: ORIGIN,
        'User-Agent': 'Mozilla/5.0 TestBrowser/1.0',
        Referer: ORIGIN + '/school.html?c=xinhua',
      },
      body: JSON.stringify(body),
    }),
  });
}

async function status(env, id) {
  const res = await statusGet({
    env,
    request: new Request(ORIGIN + '/api/verify-access?id=' + id, { headers: { Origin: ORIGIN } }),
  });
  return { res, body: await res.json() };
}

async function approveGetPage(env, params) {
  const q = new URLSearchParams(params).toString();
  const res = await approveGet({ env, request: new Request(ORIGIN + '/api/verify-access-approve?' + q) });
  return { res, html: await res.text() };
}

async function approvePostPage(env, params, decision) {
  const body = new URLSearchParams({ ...params, decision });
  const res = await approvePost({
    env,
    request: new Request(ORIGIN + '/api/verify-access-approve', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    }),
  });
  return { res, html: await res.text() };
}

test('签名令牌：正确签名通过，篡改 id / 过期 / 错误密钥都拒绝', async () => {
  const env = envOf();
  const id = 'a'.repeat(32);
  const token = await signApproval(id, env);
  assert.equal(await verifyApproval(id, token.exp, token.sig, env), true);
  assert.equal(await verifyApproval('b'.repeat(32), token.exp, token.sig, env), false);
  assert.equal(await verifyApproval(id, token.exp, token.sig.slice(1), env), false);
  assert.equal(await verifyApproval(id, Math.floor(Date.now() / 1000) - 1, token.sig, env), false);
  assert.equal(await verifyApproval(id, token.exp, token.sig, { ...env, VERIFY_ACCESS_SECRET: 'another-secret' }), false);
});

test('buildAccessNotice：带审批按钮与纯文本链接，链接字符串被转义', () => {
  const url = ORIGIN + '/api/verify-access-approve?id=' + 'a'.repeat(32) + '&exp=1&sig=abc';
  const mail = buildAccessNotice(
    { name: '李四', identity: 'HR', created_at: Date.now(), reason: '理由' },
    { ipHash: 'abcd' },
    { url, expiresAt: '2026-12-02' }
  );
  assert.match(mail.text, /批准 \/ 拒绝解锁/);
  assert.match(mail.text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(mail.html, /审查并决定是否解锁/);
  assert.match(mail.html, /&amp;exp=1&amp;sig=abc/);
});

test('端到端：提交 → 邮件带审批链接 → 本人批准 → 轮询状态变 approved', async (t) => {
  const calls = mockResend(t);
  const env = envOf();
  const res = await submit(env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.requestId, /^[0-9a-f]{32}$/);
  assert.equal(calls.length, 1);

  const mail = JSON.parse(calls[0].init.body);
  const link = mail.text.match(/https?:\/\/[^\s]+\/api\/verify-access-approve\?id=[0-9a-f]{32}&exp=\d+&sig=[0-9a-f]{64}/);
  assert.ok(link, '邮件里没有签名审批链接');
  const params = Object.fromEntries(new URL(link[0]).searchParams);
  assert.equal(params.id, data.requestId);

  /* 刚提交时只是 pending */
  const pending = await status(env, data.requestId);
  assert.equal(pending.body.status, 'pending');

  /* GET 审批页有按钮，但不改变状态（防邮件客户端预读误批） */
  const page = await approveGetPage(env, params);
  assert.match(page.html, /核实无误，批准解锁/);
  assert.match(page.html, /李四/);
  assert.equal((await status(env, data.requestId)).body.status, 'pending');

  /* 篡改签名应拒绝 */
  const bad = await approveGetPage(env, { ...params, sig: '0'.repeat(64) });
  assert.match(bad.html, /链接无效或已过期/);

  /* 本人点批准 */
  const done = await approvePostPage(env, params, 'approve');
  assert.match(done.html, /已批准解锁/);
  assert.equal((await status(env, data.requestId)).body.status, 'approved');

  /* 同一链接不能重复操作 */
  const again = await approvePostPage(env, params, 'approve');
  assert.match(again.html, /链接无效或已过期|此链接已失效/);
});

test('拒绝申请：轮询状态变 rejected，访客页面据此提示未获批准', async (t) => {
  mockResend(t);
  const env = envOf();
  const { requestId } = await (await submit(env)).json();
  const row = await env.DB.prepare('SELECT id, created_at FROM verify_access_requests WHERE id = ?').bind(requestId).first();
  const token = await signApproval(requestId, env, row.created_at);
  const params = { id: requestId, exp: String(token.exp), sig: token.sig };
  const done = await approvePostPage(env, params, 'reject');
  assert.match(done.html, /已拒绝申请/);
  assert.equal((await status(env, requestId)).body.status, 'rejected');
});

test('GET 状态接口校验 id 格式与来源白名单', async () => {
  const env = envOf();
  const bad = await statusGet({
    env,
    request: new Request(ORIGIN + '/api/verify-access?id=not-a-hex', { headers: { Origin: ORIGIN } }),
  });
  assert.equal(bad.status, 400);
  const blocked = await statusGet({
    env,
    request: new Request(ORIGIN + '/api/verify-access?id=' + 'a'.repeat(32), { headers: { Origin: 'https://evil.example' } }),
  });
  assert.equal(blocked.status, 403);
});
