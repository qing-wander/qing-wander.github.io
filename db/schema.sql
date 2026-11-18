-- ──────────────────────────────────────────────────────────────────────
--  作品集站点 · D1 数据库结构（portfolio-db）
-- ──────────────────────────────────────────────────────────────────────
--  用途：把原先压在 Workers KV 上的三类数据搬到 D1，解决 KV 免费额度
--        1,000 写/天的天花板（D1 免费额度是 100,000 行写/天）。
--
--  执行：
--    npx wrangler d1 execute portfolio-db --remote --file=db/schema.sql
--  本地：
--    npx wrangler d1 execute portfolio-db --local --file=db/schema.sql
--
--  幂等：全部 IF NOT EXISTS / INSERT OR IGNORE，可重复执行。
-- ──────────────────────────────────────────────────────────────────────

-- 计数器汇总（单行读改写，替代 KV 的 total / visitors 两个 key）
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO counters (name, value) VALUES ('total', 0);
INSERT OR IGNORE INTO counters (name, value) VALUES ('visitors', 0);

-- 访客去重（替代 KV 里 180 天 TTL 的 visitor 键；过期靠 last_seen 清理）
CREATE TABLE IF NOT EXISTS visitors (
  id         TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors (last_seen);

-- 留言墙（seq 只用来排序与裁剪，业务 id 仍由接口生成）
CREATE TABLE IF NOT EXISTS wall_messages (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 通用固定窗口限流（wall / visits 共用；bucket 形如 wall:ip:<hash>、wall:day）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT NOT NULL,
  window     TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, window)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires_at);
