/* 留言对话（站长回复 / 访客评论）回归测试
   全程 mock Resend，不真发邮件；D1 用 node:sqlite 内存库模拟线上同构 SQL。
   覆盖：评论写入与读取、跨设备越权、隐藏留言、重复评论、站长回复轮询提示、
        删除留言级联清理、评论通知邮件。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  buildReplyNotice, notifyWallReply,
} from '../functions/lib/wall-notify.js';
import {
  onRequestGet, onRequestPost, onRequestDelete,
} from '../functions/api/wall.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8877';
const DEVICE = 'test-device-0001';
const OTHER = 'other-device-0002';

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
    ALLOWED_ORIGINS: ORIGIN,
    DEVICE_HASH_PEPPER: 'test-pepper',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Portfolio Wall <onboarding@resend.dev>',
    WALL_ADMIN_TOKEN: 'test-admin-token',
  }, extra);
}

function request(method, body, device = DEVICE) {
  return new Request(ORIGIN + '/api/wall', {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN,
      'X-Device-Id': device,
      'X-Admin-Token': 'test-admin-token',
      'CF-Connecting-IP': '203.0.113.7',
      'User-Agent': 'wall-reply-test',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

/* 写一条留言，返回 { db, env, id } */
async function withMessage(db, env, text = '原始留言内容') {
  const res = await onRequestPost({ request: request('POST', { name: '访客', text }), env });
  assert.equal(res.status, 201);
  const page = await res.json();
  return { id: page.messages[0].id };
}

test('访客评论：写进原留言，GET 能读到 author=visitor 的对话', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);

    const res = await onRequestPost({
      request: request('POST', { replyTo: id, text: '我想再追问一句' }), env,
    });
    assert.equal(res.status, 201);
    const page = await res.json();
    assert.equal(page.kind, 'reply');
    assert.equal(page.messages[0].replies.length, 1);
    assert.equal(page.messages[0].replies[0].author, 'visitor');
    assert.equal(page.messages[0].replies[0].text, '我想再追问一句');

    const get = await onRequestGet({ request: request('GET', undefined), env });
    const listed = await get.json();
    assert.equal(listed.messages[0].replies.length, 1, '刷新后对话仍在');

    assert.equal(m.calls.length, 2, '留言 + 评论各发一封通知');
    const replyMail = JSON.parse(m.calls[1].init.body);
    assert.match(replyMail.subject, /新评论/);
    assert.ok(replyMail.html.includes('原始留言内容'), '邮件应带原留言上下文');
    assert.ok(replyMail.html.includes('focus=' + id), '邮件应带后台直达链接');
  } finally { m.restore(); }
});

test('设备隔离：别的设备不能评论，也看不到回复', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);

    const denied = await onRequestPost({
      request: request('POST', { replyTo: id, text: '串台评论' }, OTHER), env,
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'forbidden');

    const other = await onRequestGet({ request: request('GET', undefined, OTHER), env });
    assert.equal((await other.json()).total, 0);
    assert.equal(m.calls.length, 1, '越权评论不应触发通知');
  } finally { m.restore(); }
});

test('评论不存在 / 已隐藏的留言返回 404', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);

    const missing = await onRequestPost({
      request: request('POST', { replyTo: 'w-not-exist', text: '找不到' }), env,
    });
    assert.equal(missing.status, 404);

    db.raw.prepare("UPDATE wall_messages SET status='hidden' WHERE id=?").run(id);
    const hidden = await onRequestPost({
      request: request('POST', { replyTo: id, text: '隐藏了' }), env,
    });
    assert.equal(hidden.status, 404);
  } finally { m.restore(); }
});

test('重复评论：5 分钟内同文不再写入也不再发信', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);
    const body = { replyTo: id, text: '同一句追问' };

    const first = await onRequestPost({ request: request('POST', body), env });
    assert.equal(first.status, 201);
    const again = await onRequestPost({ request: request('POST', body), env });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, true);
    assert.equal(m.calls.length, 2, '重复评论不应再发通知');
  } finally { m.restore(); }
});

test('站长回复：公开端读到 owner，peek 返回 latestReply 供轮询提示', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);
    const before = await (await onRequestGet({
      request: new Request(ORIGIN + '/api/wall?peek=1', {
        headers: { 'X-Device-Id': DEVICE },
      }), env,
    })).json();
    assert.equal(before.latestReply, 0);

    /* 模拟后台 /api/messages/reply 写入 owner 回复 */
    const now = Date.now();
    const hash = db.raw.prepare('SELECT device_hash FROM wall_messages WHERE id=?').get(id).device_hash;
    db.raw.prepare(
      `INSERT INTO wall_replies (id, message_id, author, text, created_at, device_hash, status)
       VALUES (?, ?, 'owner', ?, ?, ?, 'visible')`
    ).run('rowner1', id, '收到，我晚点展开说说', now, hash);

    const page = await (await onRequestGet({ request: request('GET', undefined), env })).json();
    const replies = page.messages[0].replies;
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, 'owner');
    assert.equal(replies[0].text, '收到，我晚点展开说说');

    const after = await (await onRequestGet({
      request: new Request(ORIGIN + '/api/wall?peek=1', {
        headers: { 'X-Device-Id': DEVICE },
      }), env,
    })).json();
    assert.equal(after.latestReply, now);
  } finally { m.restore(); }
});

test('删除留言级联清掉对话', async () => {
  const db = fakeDb();
  const m = mockFetch(() => okResponse());
  try {
    const env = envOf(db);
    const { id } = await withMessage(db, env);
    await onRequestPost({ request: request('POST', { replyTo: id, text: '会被一起删掉' }), env });
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM wall_replies').get().n, 1);

    const del = await onRequestDelete({ request: request('DELETE', { id }), env });
    assert.equal(del.status, 200);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM wall_replies').get().n, 0);
  } finally { m.restore(); }
});

test('buildReplyNotice / notifyWallReply：转义访客内容且失败不外抛', () => {
  const mail = buildReplyNotice({
    messageId: 'w1', messageText: '原留言 <b>', name: '<script>x</script>',
    text: '评论 <img src=x>', created_at: Date.UTC(2026, 10, 23, 8, 0, 0),
  }, { origin: ORIGIN, deviceHash: 'abc' });
  assert.match(mail.subject, /新评论/);
  assert.ok(mail.html.includes('&lt;img src=x&gt;'), '评论内容必须转义');
  assert.ok(!mail.html.includes('<img'), 'HTML 不应出现原始标签');
  assert.ok(mail.text.includes('focus=w1'));
});
