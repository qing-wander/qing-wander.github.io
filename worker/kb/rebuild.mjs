/* ──────────────────────────────────────────────────────────────────────
   知识库云端重建 · worker/kb/rebuild.mjs
   ──────────────────────────────────────────────────────────────────────
   为什么放在 Worker 而不是 CI：
     数据真相源已经是 D1 的 site_content（后台「站点数据」编辑），
     仓库里的 data/*.json 只是脱敏兜底副本。所以「内容变了就重建知识库」
     这件事必须发生在云端、由后端触发，而不是盯着 git push。
     放在 Worker 里还有个好处：AI 与 Vectorize 的绑定本来就在这，
     CI 不再需要 CLOUDFLARE_API_TOKEN，fork 只要换数据就行。

   流程（先算完再写，任何一步失败都不会把旧知识库清空）：
     ① 读 D1 site_content['site-data'] → 切片（scripts/lib/rag-chunks.mjs）
     ② 批量嵌入 bge-m3（每批 40 条）
     ③ D1：词表整表替换 → 切片 upsert + 清掉已删除的切片 + FTS 重建
     ④ Vectorize：upsert 新版本向量，删掉旧版本 / 已下线切片的向量

   幂等：同一份内容重复执行，kb_version 不变，写入结果一致。
   ────────────────────────────────────────────────────────────────────── */
import { buildChunks, chunkRows, termRows } from '../../scripts/lib/rag-chunks.mjs';

const MODEL = '@cf/baai/bge-m3';
const EMBED_BATCH = 40;
const MAX_TERMS_PER_STMT = 20;   /* 20×3=60 个绑定参数，低于 D1 的 100 上限 */
const MAX_CHUNKS_PER_STMT = 6;   /* 6×14=84 个绑定参数 */
const VECTOR_BATCH = 50;

/* ── D1 写入小工具 ─────────────────────────────────────────────── */

function chunkInsert(rows) {
  const cols = '(id, kind, section, entity_id, entity_type, title, text, url, tags, visibility, lang, kb_version, source_path, updated_at)';
  const ph = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  const out = [];
  for (let i = 0; i < rows.length; i += MAX_CHUNKS_PER_STMT) {
    const slice = rows.slice(i, i + MAX_CHUNKS_PER_STMT);
    const now = Date.now();
    const params = [];
    for (const { chunk: c } of slice) {
      params.push(
        c.id, c.kind, c.section, c.entity_id, c.entity_type, c.title, c.text,
        c.url, JSON.stringify(c.tags || []), c.visibility, c.lang, c.kb_version,
        c.source_path, now,
      );
    }
    out.push({ sql: `INSERT OR REPLACE INTO kb_chunks ${cols} VALUES ${slice.map(() => ph).join(',')}`, params });
  }
  return out;
}

function ftsInsert(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 20) {
    const slice = rows.slice(i, i + 20);
    const params = [];
    for (const r of slice) params.push(r.chunk.id, r.fts);
    out.push({
      sql: `INSERT INTO kb_fts (chunk_id, tokens) VALUES ${slice.map(() => '(?,?)').join(',')}`,
      params,
    });
  }
  return out;
}

function termInsert(rows, nDocs) {
  const out = [];
  for (let i = 0; i < rows.length; i += MAX_TERMS_PER_STMT) {
    const slice = rows.slice(i, i + MAX_TERMS_PER_STMT);
    const params = [];
    for (const t of slice) params.push(t.term, t.df, nDocs);
    out.push({
      sql: `INSERT OR REPLACE INTO kb_terms (term, df, n_docs) VALUES ${slice.map(() => '(?,?,?)').join(',')}`,
      params,
    });
  }
  return out;
}

function toStatements(db, defs) {
  return defs.map((d) => db.prepare(d.sql).bind(...d.params));
}

async function runBatch(db, defs) {
  if (!defs.length) return;
  await db.batch(toStatements(db, defs));
}

/* ── 主流程 ───────────────────────────────────────────────────── */

export async function rebuildKb(env, opts = {}) {
  const started = Date.now();
  if (!env || !env.DB) return { ok: false, error: 'no_db', message: 'Worker 没绑定 D1' };
  if (!env.AI) return { ok: false, error: 'no_ai', message: 'Worker 没绑定 Workers AI' };
  if (!env.VECTORIZE) return { ok: false, error: 'no_vectorize', message: 'Worker 没绑定 Vectorize' };

  const row = await env.DB.prepare("SELECT payload, updated_at FROM site_content WHERE key = 'site-data'").first();
  if (!row || !row.payload) {
    return { ok: false, error: 'no_site_data', message: 'D1 里没有 site-data，先在后台保存一次站点数据' };
  }

  let data;
  try { data = JSON.parse(row.payload); }
  catch (e) { return { ok: false, error: 'bad_site_data', message: 'site-data 不是合法 JSON' }; }

  let payload;
  try { payload = buildChunks(data); }
  catch (e) { return { ok: false, error: 'chunk_failed', message: e && e.message ? e.message : '切片失败' }; }
  if (!payload.count) return { ok: false, error: 'empty_chunks', message: '切片为空，拒绝清空知识库' };

  const rows = chunkRows(payload);
  const terms = termRows(payload);

  /* 旧状态：切片 id 与版本，用来清掉下线内容与旧版本向量 */
  let oldRows = [];
  try {
    const old = await env.DB.prepare('SELECT id, kb_version FROM kb_chunks').all();
    oldRows = old.results || [];
  } catch (e) {
    return { ok: false, error: 'db_not_ready', message: 'kb_chunks 表不存在，请先跑 db/schema.sql' };
  }
  const oldVersion = oldRows.length ? String(oldRows[0].kb_version || '') : '';
  const newIds = new Set(payload.chunks.map((c) => c.id));
  const staleIds = oldRows.map((r) => r.id).filter((id) => !newIds.has(id));

  /* ② 嵌入：整批算完再写库 */
  const vectors = [];
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const texts = rows.slice(i, i + EMBED_BATCH).map((r) => r.vectorText);
    let r;
    try { r = await env.AI.run(MODEL, { text: texts }); }
    catch (e) { return { ok: false, error: 'embed_failed', message: '嵌入失败：' + (e && e.message ? e.message : 'unknown') }; }
    const got = (r && r.data) || [];
    if (got.length !== texts.length) {
      return { ok: false, error: 'embed_mismatch', message: `嵌入条数不符（期望 ${texts.length}，实际 ${got.length}）` };
    }
    vectors.push(...got);
  }

  /* ③ D1：词表 → 切片/索引 */
  try {
    await runBatch(env.DB, [
      { sql: 'DELETE FROM kb_terms', params: [] },
      ...termInsert(terms, payload.count),
    ]);
    await runBatch(env.DB, [
      ...chunkInsert(rows),
      ...(staleIds.length
        ? [{ sql: `DELETE FROM kb_chunks WHERE id IN (${staleIds.map(() => '?').join(',')})`, params: staleIds }]
        : []),
      { sql: 'DELETE FROM kb_fts', params: [] },
      ...ftsInsert(rows),
    ]);
  } catch (e) {
    return { ok: false, error: 'db_write_failed', message: '写 D1 失败：' + (e && e.message ? e.message : 'unknown') };
  }

  /* ④ Vectorize：新版本写入，旧版本清掉 */
  let vectorError = null;
  try {
    const vecs = payload.chunks.map((c, i) => ({
      id: `${payload.kb_version}:${c.id}`,
      values: vectors[i],
      metadata: {
        kind: c.kind,
        section: c.section,
        title: c.title,
        url: c.url || '',
        tags: (c.tags || []).join(','),
        kb_version: c.kb_version,
      },
    }));
    for (let i = 0; i < vecs.length; i += VECTOR_BATCH) {
      await env.VECTORIZE.upsert(vecs.slice(i, i + VECTOR_BATCH));
    }
    /* 版本一致 → 只需删下线切片；版本变了 → 旧版本整套删掉，避免同 id 两份 */
    const toDelete = (oldVersion && oldVersion !== payload.kb_version ? oldRows.map((r) => r.id) : staleIds)
      .map((id) => `${oldVersion}:${id}`);
    for (let i = 0; i < toDelete.length; i += VECTOR_BATCH) {
      await env.VECTORIZE.deleteByIds(toDelete.slice(i, i + VECTOR_BATCH));
    }
  } catch (e) {
    vectorError = e && e.message ? e.message : 'unknown';
  }

  return {
    ok: !vectorError,
    kb_version: payload.kb_version,
    count: payload.count,
    chars: payload.total_chars,
    terms: terms.length,
    terms_changed: true,
    removed: staleIds.length,
    old_version: oldVersion,
    vectors: vectorError ? 0 : vectors.length,
    vector_error: vectorError,
    source_updated_at: row.updated_at || null,
    ms: Date.now() - started,
  };
}

/* 后台展示用：当前知识库状态（不触发重建） */
export async function kbStatus(env) {
  if (!env || !env.DB) return { ok: false, error: 'no_db' };
  try {
    const agg = await env.DB.prepare(
      'SELECT COUNT(*) AS n, MAX(kb_version) AS ver, MAX(updated_at) AS at FROM kb_chunks'
    ).first();
    const terms = await env.DB.prepare('SELECT COUNT(*) AS n FROM kb_terms').first();
    const src = await env.DB.prepare("SELECT updated_at FROM site_content WHERE key = 'site-data'").first();
    return {
      ok: true,
      count: Number(agg && agg.n) || 0,
      kb_version: (agg && agg.ver) || '',
      updated_at: Number(agg && agg.at) || 0,
      terms: Number(terms && terms.n) || 0,
      source_updated_at: src ? Number(src.updated_at) || 0 : 0,
      stale: !!(src && agg && Number(agg.at || 0) < Number(src.updated_at || 0)),
    };
  } catch (e) {
    return { ok: false, error: 'db_not_ready', message: e && e.message ? e.message : 'db error' };
  }
}
