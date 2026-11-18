-- ──────────────────────────────────────────────────────────────────────
--  迁移：留言板设备隔离（2026-11-19）
-- ──────────────────────────────────────────────────────────────────────
--  背景：留言板从「全站公开墙」改为「按设备隔离的私密留言本」。
--        老表 wall_messages 没有 device_hash / status 字段，需要补列；
--        同时新增 wall_devices 记录设备维度（只存 HMAC 哈希）。
--
--  执行（生产库，执行一次）：
--    npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-19-wall-device-isolation.sql
--  本地：
--    npx wrangler d1 execute portfolio-db --local --file=db/migrations/2026-11-19-wall-device-isolation.sql
--
--  注意：ALTER TABLE ADD COLUMN 重复执行会报「duplicate column name」，
--        这个文件只该跑一次。新库直接跑 db/schema.sql 即可（已包含新结构）。
--
--  迁移后：历史留言 device_hash = 'legacy'，公开端读不到，只在后台
--          /api/admin/wall/messages 里可见（可人工判断是否需要清理）。
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE wall_messages ADD COLUMN device_hash TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE wall_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE wall_messages ADD COLUMN admin_note TEXT;
ALTER TABLE wall_messages ADD COLUMN updated_at INTEGER;

UPDATE wall_messages SET device_hash = 'legacy' WHERE device_hash IS NULL OR device_hash = '';

CREATE INDEX IF NOT EXISTS idx_wall_messages_device ON wall_messages (device_hash, seq);

CREATE TABLE IF NOT EXISTS wall_devices (
  device_hash TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  post_count  INTEGER NOT NULL DEFAULT 0,
  ua          TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_wall_devices_last_seen ON wall_devices (last_seen);
