/* Pages → KB Worker 调用封装 —— 离线契约测试
   ──────────────────────────────────────────────────────────────
   知识库同步是「锦上添花」：不论网络/配置/服务端出什么问题，
   都必须返回结构化结果，绝不能让保存站点数据的请求挂掉。
   ────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callKbWorker, kbWorkerReady, syncKb } from '../functions/lib/kb-sync.js';

const env = { KB_WORKER_URL: 'https://kb.example.com/', KB_TOKEN: 't0ken' };

test('未配置时直接返回 not_configured，不发请求', async () => {
  assert.equal(kbWorkerReady({}), false);
  assert.equal(kbWorkerReady({ KB_WORKER_URL: 'x' }), false);
  const r = await callKbWorker({}, '/rebuild');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_configured');
});

test('带上令牌打到 /rebuild，去掉多余的尾部斜杠', async () => {
  const orig = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, method: init.method, token: init.headers['X-KB-Token'], body: init.body };
    return new Response(JSON.stringify({ ok: true, count: 42 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const r = await callKbWorker(env, '/rebuild');
    assert.equal(r.ok, true);
    assert.equal(r.count, 42);
    assert.equal(seen.url, 'https://kb.example.com/rebuild');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.token, 't0ken');
    assert.equal(seen.body, '{}');
  } finally { globalThis.fetch = orig; }
});

test('服务端 500 / 非 JSON / 网络异常都收敛成 ok:false', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'db_write_failed', message: '写 D1 失败' }), { status: 500 });
    let r = await callKbWorker(env, '/rebuild');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'db_write_failed');

    globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
    r = await callKbWorker(env, '/rebuild');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'bad_response');

    globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
    r = await syncKb(env);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'network');
  } finally { globalThis.fetch = orig; }
});
