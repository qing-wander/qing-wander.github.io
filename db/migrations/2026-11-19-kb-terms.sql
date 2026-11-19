-- 词频表（2026-11-19）：JD 匹配做 IDF 加权覆盖判定
-- 由 scripts/build_rag_chunks.mjs 生成 rag/kb-terms.seed.sql（随切片一起重建）
CREATE TABLE IF NOT EXISTS kb_terms (
  term   TEXT PRIMARY KEY,
  df     INTEGER NOT NULL,
  n_docs INTEGER NOT NULL
);
