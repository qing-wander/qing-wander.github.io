-- RAG 切片与词面索引（2026-11-19）
-- 切片由 scripts/build_rag_chunks.mjs 生成，种子文件 rag/kb-chunks.seed.sql
-- 应用：npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-19-kb-chunks.sql
-- 幂等：IF NOT EXISTS

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  section     TEXT NOT NULL,
  entity_id   TEXT,
  entity_type TEXT,
  title       TEXT,
  text        TEXT NOT NULL,
  url         TEXT,
  tags        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'public',
  lang        TEXT NOT NULL DEFAULT 'zh',
  kb_version  TEXT NOT NULL,
  source_path TEXT,
  updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_section ON kb_chunks (section);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_entity ON kb_chunks (entity_id);

-- 词面索引：写入端已把中文切成 bigram，这里只按空格切，不赌分词器
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  chunk_id UNINDEXED,
  tokens,
  tokenize='unicode61'
);
