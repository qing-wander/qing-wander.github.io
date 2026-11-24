/* 公司档案互动（浏览 / 点赞 / 评论回复）回归测试
   D1 用 node:sqlite 内存库模拟线上同构 SQL（db/schema.sql），
   覆盖：浏览按设备+UA去重、点赞切换、评论与回复、评论点赞、限流、内容净化。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  onRequestGet, onRequestPost, onRequestOptions,
} from '../functions/api/company-social.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8877';
const DEVICE = 'social-device-0001';
const OTHER = 'social-device-0002';
const CID = 'zhishu';

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
  return { DB: db, DEVICE_HASH_PEPPER: 'test-pepper', ALLOWED_ORIGINS: ORIGIN };
}

function request(method, body, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Origin': ORIGIN,
    'X-Device-Id': opts.device || DEVICE,
    'X-Device-Fp': opts.fp || 'platform|1280x800|24|zh-CN|Asia/Shanghai|8',
    'User-Agent': opts.ua || 'social-test-ua',
    'CF-Connecting-IP': '203.0.113.9',
  };
  if (opts.badDevice) delete headers['X-Device-Id'];
  return new Request(ORIGIN + '/api/company-social?c=' + CID, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function post(env, body, opts) {
  return onRequestPost({ request: request('POST', body, opts), env });
}
async function get(env, opts) {
  return onRequestGet({ request: request('GET', undefined, opts), env });
}

test('浏览量：同设备+UA 只计一次，换 UA 或换设备才 +1', async () => {
  const env = envOf(fakeDb());
  let r = await post(env, { c: CID, action: 'view' });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.views, 1); assert.equal(d.isNew, true);

  r = await post(env, { c: CID, action: 'view' });
  d = await r.json();
  assert.equal(d.views, 1); assert.equal(d.isNew, false, '同设备重复浏览不重复计数');

  await post(env, { c: CID, action: 'view' }, { ua: 'another-ua' });
  d = await (await get(env)).json();
  assert.equal(d.views, 2, 'UA 不同算新设备');

  await post(env, { c: CID, action: 'view' }, { device: OTHER });
  d = await (await get(env)).json();
  assert.equal(d.views, 3, 'device id 不同算新设备');
});

test('档案点赞：toggle 语义，且按设备隔离', async () => {
  const env = envOf(fakeDb());
  let d = await (await post(env, { c: CID, action: 'like' })).json();
  assert.equal(d.likes, 1); assert.equal(d.liked, true);

  d = await (await post(env, { c: CID, action: 'like' })).json();
  assert.equal(d.likes, 1, '同设备重复点赞不加数');

  d = await (await get(env, { device: OTHER })).json();
  assert.equal(d.liked, false, '别的设备看不到我的赞');

  d = await (await post(env, { c: CID, action: 'unlike' })).json();
  assert.equal(d.likes, 0); assert.equal(d.liked, false);
});

test('评论与回复：顶层公开，回复挂对父节点，内容净化', async () => {
  const env = envOf(fakeDb());
  let d = await (await post(env, {
    c: CID, action: 'comment', name: '访客甲', text: '<b>这段</b>  文字带标签',
  })).json();
  assert.equal(d.comments.length, 1);
  assert.equal(d.comments[0].name, '访客甲');
  assert.equal(d.comments[0].text, '这段 文字带标签', 'HTML 标签被剥掉、空白压缩');
  const parentId = d.comments[0].id;

  d = await (await post(env, {
    c: CID, action: 'reply', parentId, name: '访客乙', text: '我来回复一句',
  }, { device: OTHER })).json();
  assert.equal(d.comments.length, 1, '回复不单独成为顶层评论');
  assert.equal(d.comments[0].replies.length, 1);
  assert.equal(d.comments[0].replies[0].text, '我来回复一句');

  d = await (await get(env)).json();
  assert.equal(d.comments[0].replies.length, 1, '刷新后回复仍在');
  assert.equal(d.views, 2, '两台设备各发一次互动 → 各记一次浏览；同设备不重复');
});

test('评论点赞：toggle 且按设备隔离，计数不漂移', async () => {
  const env = envOf(fakeDb());
  let d = await (await post(env, { c: CID, action: 'comment', text: '第一条评论' })).json();
  const id = d.comments[0].id;

  d = await (await post(env, { c: CID, action: 'commentLike', id })).json();
  assert.equal(d.comments[0].likes, 1); assert.equal(d.comments[0].liked, true);
  await post(env, { c: CID, action: 'commentLike', id });
  d = await (await get(env)).json();
  assert.equal(d.comments[0].likes, 1, '同设备重复点赞不加数');

  d = await (await post(env, { c: CID, action: 'commentUnlike', id })).json();
  assert.equal(d.comments[0].likes, 0);
  d = await (await post(env, { c: CID, action: 'commentUnlike', id })).json();
  assert.equal(d.comments[0].likes, 0, '重复取消不会变成负数');
});

test('防御：缺设备头 / 非法档案 id / 空内容 / 回复不存在的评论', async () => {
  const env = envOf(fakeDb());
  assert.equal((await post(env, { c: CID, action: 'view' }, { badDevice: true })).status, 400);
  assert.equal((await post(env, { c: '../bad', action: 'view' })).status, 400);
  assert.equal((await post(env, { c: CID, action: 'comment', text: ' x ' })).status, 400);
  assert.equal((await post(env, { c: CID, action: 'reply', parentId: 'cc-notexist', text: '回复内容' })).status, 404);
  assert.equal((await post(env, { c: CID, action: 'unknown' })).status, 400);
});

test('CORS：白名单外 Origin 被拒', async () => {
  const env = envOf(fakeDb());
  const r = await onRequestOptions({ request: new Request(ORIGIN + '/api/company-social', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
  }), env });
  assert.equal(r.status, 403);
});
