/* 知识库云端重建 —— 离线契约测试
   ──────────────────────────────────────────────────────────────
   用假 D1 / AI / Vectorize 直接调 worker/kb 的 fetch，
   验证：切片与向量数量一致、先算后写、旧切片清理、版本切换清旧向量、
        失败时不清空旧知识库、令牌校验。
   ────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebuildKb, kbStatus } from '../worker/kb/rebuild.mjs';
import worker from '../worker/kb/index.mjs';

const siteData = JSON.parse(readFileSync(new URL('../data/site-data.json', import.meta.url), 'utf8'));

class StubDB {
  constructor(opts = {}) {
    this.writes = [];
    this.siteData = opts.siteData === undefined ? JSON.stringify(siteData) : opts.siteData;
    this.oldChunks = opts.oldChunks || [];
    this.failOn = opts.failOn || '';
  }

  prepare(sql) {
    const self = this;
    const stmt = {
      sql,
      params: [],
      bind(...p) { stmt.params = p; return stmt; },
      async first() {
        if (sql.includes('FROM site_content')) {
          if (self.siteData == null) return null;
          return { payload: self.siteData, updated_at: 1764000000000 };
        }
        if (sql.includes('FROM kb_chunks')) return { n: self.oldChunks.length, ver: 'kb-old', up: 1 };
        if (sql.includes('FROM kb_terms')) return { n: 1607 };
        return null;
      },
      async all() {
        if (sql.includes('SELECT id, kb_version FROM kb_chunks')) return { results: self.oldChunks };
        return { results: [] };
      },
      async run() { self.writes.push({ sql, params: stmt.params }); return { success: true }; },
    };
    return stmt;
  }

  async batch(stmts) {
    for (const s of stmts) {
      if (this.failOn && s.sql.includes(this.failOn)) throw new Error('boom');
      this.writes.push({ sql: s.sql, params: s.params });
    }
  }
}

function stubAI(opts = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, n: (input.text || []).length });
      if (opts.fail) throw new Error('ai down');
      const n = opts.dropOne ? (input.text.length - 1) : input.text.length;
      return { data: Array.from({ length: n }, () => new Array(8).fill(0.1)) };
    },
  };
}

function stubVectorize(opts = {}) {
  return {
    upserts: [],
    deleted: [],
    async upsert(v) {
      if (opts.fail) throw new Error('vectorize down');
      this.upserts.push(...v);
    },
    async deleteByIds(ids) { this.deleted.push(...ids); },
  };
}

const envOf = (opts = {}) => ({
  DB: opts.DB || new StubDB(opts),
  AI: opts.AI || stubAI(),
  VECTORIZE: opts.VEC || stubVectorize(),
});

test('重建：切片数与向量数一致，先算完再写库', async () => {
  const env = envOf();
  const r = await rebuildKb(env);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.count, 36);
  assert.equal(r.vectors, 36);
  assert.equal(env.AI.calls.length, 1, '36 片一批嵌入（每批上限 40）');
  assert.equal(env.VECTORIZE.upserts.length, 36);
  assert.ok(env.VECTORIZE.upserts.every((v) => /^kb-[0-9a-f]{8}:/.test(v.id)));
  assert.ok(r.kb_version.startsWith('kb-'));

  const chunkWrite = env.DB.writes.find((w) => w.sql.includes('INSERT OR REPLACE INTO kb_chunks'));
  assert.ok(chunkWrite, '应写入切片');
  assert.equal(chunkWrite.params.length % 14, 0);
  assert.ok(env.DB.writes.some((w) => w.sql === 'DELETE FROM kb_fts'), 'FTS 应整表重建');
  assert.ok(env.DB.writes.some((w) => w.sql.startsWith('INSERT OR REPLACE INTO kb_terms')));
});

test('重建：下线切片与旧版本向量都会被清掉', async () => {
  const oldChunks = [
    { id: 'me-01', kb_version: 'kb-00000000' },
    { id: 'deleted-chunk', kb_version: 'kb-00000000' },
  ];
  const env = envOf({ oldChunks });
  const r = await rebuildKb(env);
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1, '只应识别出一条下线切片');

  const del = env.DB.writes.find((w) => w.sql.startsWith('DELETE FROM kb_chunks WHERE id IN'));
  assert.deepEqual(del.params, ['deleted-chunk']);

  /* 版本变了 → 旧版本整套 id 都要从向量库删掉，避免同 id 两份 */
  assert.ok(env.VECTORIZE.deleted.includes('kb-00000000:me-01'));
  assert.ok(env.VECTORIZE.deleted.includes('kb-00000000:deleted-chunk'));
  assert.equal(env.VECTORIZE.deleted.length, 2);
});

test('重建：嵌入失败时不动 D1 与向量库', async () => {
  const env = envOf({ AI: stubAI({ dropOne: true }) });
  const r = await rebuildKb(env);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'embed_mismatch');
  assert.equal(env.DB.writes.length, 0);
  assert.equal(env.VECTORIZE.upserts.length, 0);
});

test('重建：D1 写失败不写向量库', async () => {
  const env = envOf({ DB: new StubDB({ failOn: 'INSERT OR REPLACE INTO kb_chunks' }) });
  const r = await rebuildKb(env);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'db_write_failed');
  assert.equal(env.VECTORIZE.upserts.length, 0);
});

test('重建：没有 site-data 时拒绝清空知识库', async () => {
  const env = envOf({ DB: new StubDB({ siteData: null }) });
  const r = await rebuildKb(env);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_site_data');
  assert.equal(env.DB.writes.length, 0);
});

test('重建：坏 JSON / 缺绑定都给结构化错误', async () => {
  assert.equal((await rebuildKb(envOf({ DB: new StubDB({ siteData: '{oops' }) }))).error, 'bad_site_data');
  assert.equal((await rebuildKb({ DB: new StubDB() })).error, 'no_ai');
  assert.equal((await rebuildKb({ DB: new StubDB(), AI: stubAI() })).error, 'no_vectorize');
});

test('Worker 路由：/rebuild 需要令牌，/health 公开', async () => {
  const env = { ...envOf(), KB_TOKEN: 'secret-token' };

  const health = await worker.fetch(new Request('https://kb.test/health'), env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const deny = await worker.fetch(new Request('https://kb.test/rebuild', {
    method: 'POST', body: '{}',
  }), env);
  assert.equal(deny.status, 401);

  const ok = await worker.fetch(new Request('https://kb.test/rebuild', {
    method: 'POST', headers: { 'X-KB-Token': 'secret-token' }, body: '{}',
  }), env);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).count, 36);
});

test('kbStatus：能识别知识库是否落后于站点数据', async () => {
  const env = { DB: new StubDB() };
  const s = await kbStatus(env);
  assert.equal(s.ok, true);
  assert.equal(s.count, 0);
  assert.equal(s.stale, true, '空知识库应判定为落后');
});
