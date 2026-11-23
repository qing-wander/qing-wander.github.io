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

-- 留言设备（2026-11-19 设备隔离）：只存 HMAC 哈希，不存原始 device_id。
-- 网页读不到 MAC 地址，设备标识由前端 crypto.randomUUID() 生成并存 localStorage。
CREATE TABLE IF NOT EXISTS wall_devices (
  device_hash TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  post_count  INTEGER NOT NULL DEFAULT 0,
  ua          TEXT,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | blocked
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_wall_devices_last_seen ON wall_devices (last_seen);

-- 留言（seq 排序与裁剪；按 device_hash 分区；status 控制后台隐藏）
CREATE TABLE IF NOT EXISTS wall_messages (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  device_hash TEXT NOT NULL DEFAULT 'legacy',   -- 迁移前的旧留言统一归 legacy，只在后台可见
  status      TEXT NOT NULL DEFAULT 'visible',  -- visible | hidden
  admin_note  TEXT,
  updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wall_messages_device ON wall_messages (device_hash, seq);

-- 留言对话（2026-11-23 回复 / 评论）：一条留言下可有多条回复，按时间正序展示。
--   author = owner   站长在后台写的回复；author = visitor  访客在本设备写的追问 / 评论。
--   device_hash 与所属留言一致，公开端只查「本设备留言」的回复，保持设备隔离。
--   status 让后台能隐掉单条不当评论，不必删掉整条留言。
--   留言被删除或裁剪时由 API 级联清理，见 functions/api/wall.js。
CREATE TABLE IF NOT EXISTS wall_replies (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  message_id  TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'visitor',  -- owner | visitor
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  device_hash TEXT NOT NULL DEFAULT 'legacy',
  status      TEXT NOT NULL DEFAULT 'visible'   -- visible | hidden
);

CREATE INDEX IF NOT EXISTS idx_wall_replies_message ON wall_replies (message_id, seq);
CREATE INDEX IF NOT EXISTS idx_wall_replies_device ON wall_replies (device_hash, created_at);

-- 通用固定窗口限流（wall / visits 共用；bucket 形如 wall:ip:<hash>、wall:day）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT NOT NULL,
  window     TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, window)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires_at);
