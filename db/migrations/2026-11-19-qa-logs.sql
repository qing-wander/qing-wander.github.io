-- 问答日志（2026-11-19）
-- 用途：① 单 IP 限流 ② 后台提炼「用户都在问什么」
-- 应用：npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-19-qa-logs.sql
CREATE TABLE IF NOT EXISTS qa_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  query       TEXT NOT NULL,
  answer      TEXT,
  hit_ids     TEXT,
  hit_count   INTEGER NOT NULL DEFAULT 0,
  empty       INTEGER NOT NULL DEFAULT 0,
  model       TEXT,
  ms          INTEGER,
  ip_hash     TEXT,
  device_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_qa_logs_ts ON qa_logs (ts);
CREATE INDEX IF NOT EXISTS idx_qa_logs_ip ON qa_logs (ip_hash, ts);
