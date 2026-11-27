/* 管理后台回复接口回归：会话/令牌鉴权、CSRF、写入 owner 回复、
   列表附带对话、待回复筛选、focus 直达、删除回复。
   D1 用 node:sqlite 内存库模拟，不连生产。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost, onRequestDelete } from '../functions/api/admin/messages/reply.js';
import { onRequestGet } from '../functions/api/admin/messages.js';
import { onRequestGet as statsGet } from '../functions/api/admin/stats.js';
import { onRequestPost as wallPost } from '../functions/api/wall.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ADMIN = 'https://qingfin.cn';   // 主站已接管后台，接口与页面同源
const SITE = 'http://127.0.0.1:8877';
const TOKEN = 'test-admin-token';

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
    WALL_ADMIN_TOKEN: TOKEN,
    ADMIN_SESSION_SECRET: 'test-session-secret',
    ALLOWED_ORIGINS: SITE,
    DEVICE_HASH_PEPPER: 'test-pepper',
    RESEND_API_KEY: '',   // 不发信，专注回复链路
  }, extra);
}

function adminReq(method, path, body, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Origin': ADMIN,
    'X-Admin-Request': '1',
  };
  if (!opts.noToken) headers['X-Admin-Token'] = TOKEN;
  return new Request(ADMIN + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedMessage(db, env, text = '想请教一个项目细节') {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 }); // 防止真实网络调用
  try {
    const res = await wallPost({
      request: new Request(SITE + '/api/wall', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'Origin': SITE,
          'X-Device-Id': 'admin-test-device-0001', 'CF-Connecting-IP': '203.0.113.9',
        },
        body: JSON.stringify({ name: '访客', text }),
      }),
      env,
    });
    assert.equal(res.status, 201);
    return (await res.json()).messages[0].id;
  } finally { globalThis.fetch = previous; }
}

test('鉴权与 CSRF：无令牌 / 缺自定义头都拒绝', async () => {
  const db = fakeDb();
  const env = envOf(db);
  const id = await seedMessage(db, env);

  const noToken = await onRequestPost({
    request: adminReq('POST', '/api/messages/reply', { messageId: id, text: '不该写进去' }, { noToken: true }), env,
  });
  assert.equal(noToken.status, 401);

  const noCsrf = new Request(ADMIN + '/api/messages/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: JSON.stringify({ messageId: id, text: '也不该写进去' }),
  });
  assert.equal((await onRequestPost({ request: noCsrf, env })).status, 403);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM wall_replies').get().n, 0);
});

test('站长回复：写入 owner，列表返回对话与「已回」标记', async () => {
  const db = fakeDb();
  const env = envOf(db);
  const id = await seedMessage(db, env);

  const res = await onRequestPost({
    request: adminReq('POST', '/api/messages/reply', { messageId: id, text: '这块我可以展开讲讲' }), env,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.reply.author, 'owner');
  assert.equal(body.replies.length, 1);

  const list = await (await onRequestGet({
    request: adminReq('GET', '/api/messages'), env,
  })).json();
  assert.equal(list.messages[0].reply_count, 1);
  assert.equal(list.messages[0].owner_replied, true);
  assert.equal(list.messages[0].replies[0].text, '这块我可以展开讲讲');
});

test('待回复 / 已回复筛选与 focus 直达', async () => {
  const db = fakeDb();
  const env = envOf(db);
  const a = await seedMessage(db, env, '第一条待回复');
  const b = await seedMessage(db, env, '第二条会被回复');
  await onRequestPost({
    request: adminReq('POST', '/api/messages/reply', { messageId: b, text: '已回复' }), env,
  });

  const pending = await (await onRequestGet({
    request: adminReq('GET', '/api/messages?status=pending'), env,
  })).json();
  assert.equal(pending.total, 1);
  assert.equal(pending.messages[0].id, a);

  const replied = await (await onRequestGet({
    request: adminReq('GET', '/api/messages?status=replied'), env,
  })).json();
  assert.equal(replied.total, 1);
  assert.equal(replied.messages[0].id, b);

  const focused = await (await onRequestGet({
    request: adminReq('GET', '/api/messages?focus=' + a), env,
  })).json();
  assert.equal(focused.total, 1);
  assert.equal(focused.messages[0].id, a);
});

test('概览统计：pending_replies 与 replies', async () => {
  const db = fakeDb();
  const env = envOf(db);
  await seedMessage(db, env, '还没回的留言');
  const before = await (await statsGet({ request: adminReq('GET', '/api/stats'), env })).json();
  assert.equal(before.stats.pending_replies, 1);

  const id = db.raw.prepare('SELECT id FROM wall_messages LIMIT 1').get().id;
  await onRequestPost({
    request: adminReq('POST', '/api/messages/reply', { messageId: id, text: '回了' }), env,
  });
  const after = await (await statsGet({ request: adminReq('GET', '/api/stats'), env })).json();
  assert.equal(after.stats.pending_replies, 0);
  assert.equal(after.stats.replies, 1);
});

test('删除回复：回到待回复状态', async () => {
  const db = fakeDb();
  const env = envOf(db);
  const id = await seedMessage(db, env);
  const posted = await (await onRequestPost({
    request: adminReq('POST', '/api/messages/reply', { messageId: id, text: '误发的回复' }), env,
  })).json();

  const del = await onRequestDelete({
    request: adminReq('DELETE', '/api/messages/reply', { id: posted.reply.id }), env,
  });
  assert.equal(del.status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM wall_replies').get().n, 0);

  const list = await (await onRequestGet({
    request: adminReq('GET', '/api/messages?status=pending'), env,
  })).json();
  assert.equal(list.total, 1);
});

test('回复内容校验：空 / 单字 / 留言不存在', async () => {
  const db = fakeDb();
  const env = envOf(db);
  const id = await seedMessage(db, env);
  const cases = [
    [{ messageId: id, text: '' }, 400],
    [{ messageId: id, text: '嗯' }, 400],
    [{ messageId: 'w-not-exist', text: '找不到留言' }, 404],
  ];
  for (const [body, status] of cases) {
    const r = await onRequestPost({
      request: adminReq('POST', '/api/messages/reply', body), env,
    });
    assert.equal(r.status, status);
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM wall_replies').get().n, 0);
});
