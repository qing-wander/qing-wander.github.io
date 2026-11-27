import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, KEY_LIST, isKey, keyForFile, toSnapshot, validatePayload,
  readContent, writeContent, writeMany, deleteContent, listContent, MAX_PAYLOAD,
} from '../functions/lib/site-content.js';
import {
  onRequestGet as adminGet, onRequestPost as adminPost, onRequestDelete as adminDelete,
} from '../functions/api/admin/site-content.js';
import { onRequestGet as dataGet } from '../functions/data/[file].js';
import { signSession, COOKIE, TTL } from '../functions/lib/admin-auth.js';

function fakeDb() {
  const map = new Map();
  const makeExec = (args) => ({
    async first() { return map.get(args[0]) ? { ...map.get(args[0]) } : null; },
    async all() { return { results: [...map.values()].map((v) => ({ ...v })) }; },
    async run() {
      if (args.length && /DELETE/.test('')) map.delete(args[0]);
      return { success: true };
    },
  });
  const makeStmt = (sql) => ({
    bind(...args) {
      const e = makeExec(args);
      e.run = async () => {
        if (/INSERT INTO site_content/.test(sql)) {
          const [key, payload, updated_at, updated_by] = args;
          map.set(key, { key, payload, updated_at, updated_by });
        } else if (/DELETE FROM site_content/.test(sql)) {
          map.delete(args[0]);
        }
        return { success: true };
      };
      return e;
    },
    async all() { return { results: [...map.values()].map((v) => ({ ...v })) }; },
    async first() { return null; },
    async run() { return { success: true }; },
  });
  return { prepare: makeStmt, _map: map };
}

function envOf(db) {
  return { DB: db || fakeDb(), ADMIN_SESSION_SECRET: 'site-content-test-secret' };
}

async function adminEnv(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const token = await signSession(env, exp);
  return { env, cookie: COOKIE + '=' + token };
}

function req(url, opts = {}) {
  return new Request('https://qingfin.cn' + url, {
    method: opts.method || 'GET',
    headers: Object.assign({}, opts.headers || {}),
    body: opts.body,
  });
}

/* ── 白名单 / 序列化 ─────────────────────────────────────────── */

test('key 白名单固定，未知 key 一律拒绝', () => {
  assert.equal(KEY_LIST.length, 7);
  for (const k of KEY_LIST) assert.equal(isKey(k), true);
  assert.equal(isKey('admin_config'), false);
  assert.equal(isKey('__proto__'), false);
  assert.equal(isKey('constructor'), false);
  assert.equal(keyForFile('site-data.js'), 'site-data');
  assert.equal(keyForFile('evil.js'), null);
});

test('快照格式与 sync_*.py 一致，site-data 剔除 resume', () => {
  const payload = JSON.stringify({ hero: { nameCn: '测试' }, resume: { basics: {} } });
  const js = toSnapshot('site-data', payload);
  assert.match(js, /window\.SITE_DATA = /);
  const assigned = js.slice(js.indexOf('window.SITE_DATA = ') + 'window.SITE_DATA = '.length).trim().replace(/;$/, '');
  assert.equal(JSON.parse(assigned).resume, undefined);
  assert.equal(toSnapshot('contributions', '{}'), null); // 无全局变量的项不生成快照
});

test('payload 校验：空 / 非对象 / 坏 JSON / 超大都拒绝', () => {
  assert.equal(validatePayload('{}'), null);
  assert.equal(validatePayload(''), 'empty_payload');
  assert.equal(validatePayload('null'), 'payload_not_object');
  assert.equal(validatePayload('[]'), 'payload_not_object');
  assert.equal(validatePayload('{bad'), 'bad_json');
  assert.equal(validatePayload('x'.repeat(MAX_PAYLOAD + 1)), 'payload_too_large');
});

/* ── 读写 ─────────────────────────────────────────────────────── */

test('写入后可读，未配置的 key 返回 null', async () => {
  const db = fakeDb();
  const env = envOf(db);
  assert.equal(await readContent(env, 'site-data'), null);
  assert.equal(await writeContent(env, 'site-data', '{"hero":{}}', 'tester'), true);
  const row = await readContent(env, 'site-data');
  assert.equal(row.payload, '{"hero":{}}');
  assert.equal(row.updated_by, 'tester');
  assert.ok(row.updated_at > 0);
});

test('非法 key / 非法 payload 写不进去', async () => {
  const env = envOf();
  assert.equal(await writeContent(env, 'evil', '{}'), false);
  assert.equal(await writeContent(env, 'site-data', '{bad'), false);
  assert.equal(await writeContent(env, 'site-data', '[]'), false);
  assert.equal(await deleteContent(env, 'evil'), false);
});

test('批量导入跳过坏条目，返回成功数与失败清单', async () => {
  const env = envOf();
  const r = await writeMany(env, [
    { key: 'people', payload: '{"people":[]}' },
    { key: 'evil', payload: '{}' },
    { key: 'site-data', payload: '{bad' },
  ], 'seed');
  assert.equal(r.ok, 1);
  assert.deepEqual(r.failed.sort(), ['evil', 'site-data']);
  assert.ok(await readContent(env, 'people'));
});

test('删除后回到未配置状态，列表反映配置情况', async () => {
  const env = envOf();
  await writeContent(env, 'people', '{"people":[]}');
  let list = await listContent(env);
  assert.equal(list.find((x) => x.key === 'people').configured, true);
  assert.equal(list.find((x) => x.key === 'people').size, '{"people":[]}'.length);
  assert.equal(await deleteContent(env, 'people'), true);
  list = await listContent(env);
  assert.equal(list.some((x) => x.key === 'people'), false); // 删除后表里不再有这行
  assert.equal(await readContent(env, 'people'), null);
});

/* ── 后台接口鉴权 ────────────────────────────────────────────── */

test('后台接口未登录一律 401', async () => {
  const env = envOf();
  for (const handler of [adminGet, adminPost, adminDelete]) {
    const res = await handler({ request: req('/api/admin/site-content'), env });
    assert.equal(res.status, 401);
  }
});

test('后台 POST 缺 CSRF 头被拒', async () => {
  const env = envOf();
  const { cookie } = await adminEnv(env);
  const res = await adminPost({
    request: req('/api/admin/site-content', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ key: 'people', text: '{}' }),
    }),
    env,
  });
  assert.equal(res.status, 403);
});

test('后台 GET 列表不暴露正文，?key= 才给正文', async () => {
  const env = envOf();
  await writeContent(env, 'people', '{"people":[{"name":"张三"}]}');
  const { cookie } = await adminEnv(env);
  const listRes = await adminGet({ request: req('/api/admin/site-content', { headers: { Cookie: cookie } }), env });
  const list = await listRes.json();
  assert.equal(list.ok, true);
  assert.equal(list.keys.length, 7);
  assert.equal(JSON.stringify(list).includes('张三'), false);

  const oneRes = await adminGet({
    request: req('/api/admin/site-content?key=people', { headers: { Cookie: cookie } }), env,
  });
  const one = await oneRes.json();
  assert.equal(one.configured, true);
  assert.equal(one.text.includes('张三'), true);
});

test('后台 POST 保存 + DELETE 恢复默认', async () => {
  const env = envOf();
  const { cookie } = await adminEnv(env);
  const headers = { Cookie: cookie, 'X-Admin-Request': '1' };
  const saveRes = await adminPost({
    request: req('/api/admin/site-content', {
      method: 'POST', headers,
      body: JSON.stringify({ key: 'people', text: '{"people":[]}' }),
    }), env,
  });
  assert.equal(saveRes.status, 200);
  assert.equal((await saveRes.json()).ok, true);
  assert.ok((await readContent(env, 'people')).payload);

  const delRes = await adminDelete({
    request: req('/api/admin/site-content?key=people', { method: 'DELETE', headers }), env,
  });
  assert.equal(delRes.status, 200);
  assert.equal(await readContent(env, 'people'), null);
});

test('后台拒绝未知 key 与不合法 JSON', async () => {
  const env = envOf();
  const { cookie } = await adminEnv(env);
  const headers = { Cookie: cookie, 'X-Admin-Request': '1' };
  for (const body of [{ key: 'evil', text: '{}' }, { key: 'site-data', text: '{bad' }]) {
    const res = await adminPost({
      request: req('/api/admin/site-content', { method: 'POST', headers, body: JSON.stringify(body) }), env,
    });
    assert.equal(res.status, 400);
  }
});

/* ── 公开 /data/* 路由 ───────────────────────────────────────── */

test('公开路由返回云端快照，标记 X-Content-Source', async () => {
  const env = envOf();
  await writeContent(env, 'site-data', JSON.stringify({ hero: { nameCn: '云端姓名' }, resume: {} }));
  const res = await dataGet({ request: req('/data/site-data.js'), env, params: { file: 'site-data.js' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Source'), 'cloud');
  assert.match(res.headers.get('Content-Type'), /javascript/);
  const text = await res.text();
  assert.ok(text.includes('云端姓名'));
  assert.equal(text.includes('"resume"'), false);
});

test('公开路由：JSON 项直出原文，未知文件交给静态资源，未配置回退静态副本', async () => {
  const env = envOf();
  await writeContent(env, 'contributions', '{"total":42}');
  const ok = await dataGet({ request: req('/data/contributions.json'), env, params: { file: 'contributions.json' } });
  assert.equal(await ok.text(), '{"total":42}');
  assert.match(ok.headers.get('Content-Type'), /json/);

  /* 白名单之外（蛇图 SVG、asset-map.js…）必须 next() 交回静态资源，
     否则线上 /data/snake.svg 会被这条通配路由打成 404 */
  const seen = [];
  const passthrough = await dataGet({
    request: req('/data/snake.svg'),
    env,
    params: { file: 'snake.svg' },
    next: async () => { seen.push('next'); return new Response('<svg/>', { status: 200 }); },
  });
  assert.deepEqual(seen, ['next']);
  assert.equal(passthrough.status, 200);

  /* 静态目录里也没有的路径，静态层自己会给 404；直调（无 next）时仍兜 404 */
  const missing = await dataGet({ request: req('/data/evil.js'), env, params: { file: 'evil.js' } });
  assert.equal(missing.status, 404);

  /* 未配置时 fetch 回退副本：用 monkey-patch 的 fetch 验证请求路径正确 */
  const origFetch = globalThis.fetch;
  let fallbackUrl = '';
  globalThis.fetch = async (u) => {
    fallbackUrl = String(u);
    return new Response('{"fallback":true}', { status: 200 });
  };
  try {
    const fb = await dataGet({ request: req('/data/people.js'), env: envOf(), params: { file: 'people.js' } });
    assert.equal(fallbackUrl.endsWith('/data/fallback/people.js'), true);
    assert.equal((await fb.text()).includes('fallback'), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('D1 异常时公开路由不抛 500，回退静态副本', async () => {
  const brokenEnv = { DB: { prepare() { throw new Error('db down'); } } };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('window.FALLBACK = 1;', { status: 200 });
  try {
    const res = await dataGet({
      request: req('/data/site-data.js'), env: brokenEnv, params: { file: 'site-data.js' },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).includes('FALLBACK'), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});
