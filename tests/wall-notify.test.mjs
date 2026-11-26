/* 留言墙新留言通知：纯函数 + 端到端写入路径回归
   全程 mock Resend，不真发邮件；D1 用 node:sqlite 内存库模拟线上同构 SQL。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  escapeHtml, formatBeijing, buildNotice, notifyWallMessage,
} from '../functions/lib/wall-notify.js';
import { onRequestPost } from '../functions/api/wall.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8877';

function fakeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  return {
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
    ALLOWED_ORIGINS: ORIGIN,
    DEVICE_HASH_PEPPER: 'test-pepper',
    RESEND_API_KEY: 're_test_key',
    WALL_NOTIFY_FROM: 'Portfolio Wall <onboarding@resend.dev>',
  }, extra);
}

function post(name, text) {
  return new Request(ORIGIN + '/api/wall', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN,
      'X-Device-Id': 'test-device-0001',
      'CF-Connecting-IP': '203.0.113.7',
      'User-Agent': 'wall-notify-test',
    },
    body: JSON.stringify({ name, text }),
  });
}

function mockFetch(responder) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

function okResponse(id = 'em_test') {
  return new Response(JSON.stringify({ id }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

test('转义与时间格式：访客内容不能以 HTML 形式注入邮件', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(formatBeijing(Date.UTC(2026, 10, 22, 10, 15, 3)), '2026-11-22 18:15:03 (UTC+8)');

  const mail = buildNotice(
    { id: 'w123', name: '<script>x</script>', text: '第一行\n<script>alert(1)</script>', created_at: Date.UTC(2026, 10, 22, 10, 0, 0) },
    { origin: ORIGIN, deviceHash: 'abc' }
  );
  assert.match(mail.subject, /^【留言墙】/);
  assert.ok(mail.html.includes('&lt;script&gt;'), 'HTML 应转义脚本标签');
  assert.ok(!mail.html.includes('<script>'), 'HTML 不应出现原始脚本标签');
  assert.ok(mail.html.includes('white-space:pre-wrap'), '正文应保留换行');
  assert.ok(mail.text.includes('第一行\n<script>alert(1)</script>'), '纯文本应保留原文');
});

test('notifyWallMessage：按默认收件人发信并携带邮件正文', async () => {
  const m = mockFetch(() => okResponse('em_123'));
  try {
    const res = await notifyWallMessage(envOf(fakeDb()), { id: 'w1', name: '小李', text: '你好，留言测试', created_at: Date.now() }, { origin: ORIGIN });
    assert.deepEqual(res, { ok: true, id: 'em_123', to: 'hi@chenpeisheng.cn' });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, 'https://api.resend.com/emails');
    const payload = JSON.parse(m.calls[0].init.body);
    assert.deepEqual(payload.to, ['hi@chenpeisheng.cn']);
    assert.match(payload.from, /onboarding@resend\.dev/);
    assert.match(payload.subject, /小李/);
    assert.ok(payload.html.includes('你好，留言测试'));
    assert.equal(m.calls[0].init.headers.Authorization, 'Bearer re_test_key');
  } finally { m.restore(); }
});

test('notifyWallMessage：可用 WALL_NOTIFY_TO / WALL_NOTIFY_FROM 覆盖', async () => {
  const m = mockFetch(() => okResponse());
  try {
    await notifyWallMessage(
      envOf(fakeDb(), { WALL_NOTIFY_TO: 'owner@example.com', WALL_NOTIFY_FROM: 'Wall <wall@example.com>' }),
      { id: 'w2', name: '匿名访客', text: '测试覆盖配置', created_at: Date.now() }, {}
    );
    const payload = JSON.parse(m.calls[0].init.body);
    assert.deepEqual(payload.to, ['owner@example.com']);
    assert.equal(payload.from, 'Wall <wall@example.com>');
  } finally { m.restore(); }
});

test('notifyWallMessage：无 key 直接跳过，Resend 报错也不抛异常', async () => {
  const m = mockFetch(() => new Response(JSON.stringify({ message: 'bad' }), { status: 422 }));
  try {
    const skipped = await notifyWallMessage(envOf(fakeDb(), { RESEND_API_KEY: '' }), { text: 'hi' }, {});
    assert.deepEqual(skipped, { ok: false, reason: 'no_api_key' });
    assert.equal(m.calls.length, 0);

    const failed = await notifyWallMessage(envOf(fakeDb()), { text: 'hi' }, {});
    assert.equal(failed.ok, false);
    assert.equal(failed.status, 422);
  } finally { m.restore(); }
});

test('wall.js：留言写入成功后发一封，重复提交不再发', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const first = await onRequestPost({ request: post('张三', '第一次留言内容'), env });
    assert.equal(first.status, 201);
    assert.equal((await first.json()).messages[0].text, '第一次留言内容');
    assert.equal(m.calls.length, 1);
    const payload = JSON.parse(m.calls[0].init.body);
    assert.deepEqual(payload.to, ['hi@chenpeisheng.cn']);
    assert.ok(payload.text.includes('第一次留言内容'));

    const again = await onRequestPost({ request: post('张三', '第一次留言内容'), env });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, true);
    assert.equal(m.calls.length, 1, '重复提交不应再发通知');
  } finally { m.restore(); }
});

test('wall.js：Resend 不可用时留言仍正常写入', async () => {
  const m = mockFetch(() => { throw new Error('network down'); });
  try {
    const res = await onRequestPost({ request: post('李四', '网络异常也要能留言'), env: envOf(fakeDb()) });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).messages[0].text, '网络异常也要能留言');
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test('wall.js：ctx.waitUntil 存在时挂后台任务，不阻塞留言响应', async () => {
  let settled = false;
  const m = mockFetch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    settled = true;
    return okResponse();
  });
  try {
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };
    const res = await onRequestPost({ request: post('王五', '后台发信测试'), env: envOf(fakeDb()), ctx });
    assert.equal(res.status, 201);
    assert.equal(pending.length, 1);
    assert.equal(settled, false, '响应返回时发信任务应仍在后台');
    await Promise.all(pending);
    assert.equal(settled, true);
  } finally { m.restore(); }
});
