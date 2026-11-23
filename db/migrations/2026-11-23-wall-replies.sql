-- ──────────────────────────────────────────────────────────────────────
--  迁移：留言对话（回复 / 评论）（2026-11-23）
-- ──────────────────────────────────────────────────────────────────────
--  背景：留言墙原本只有「写留言」，后台只能查看 / 隐藏，宣传语「我看到都会回」
--        没有承载。新增一张回复表，让站长回复直接贴回原留言，访客也能继续
--        评论追问；两者都遵守设备隔离，只有原设备看得到。
--
--  执行（生产库，执行一次）：
--    npx wrangler d1 execute portfolio-db --remote --config wrangler.toml --file=db/migrations/2026-11-23-wall-replies.sql
--  本地：
--    npx wrangler d1 execute portfolio-db --local --config wrangler.toml --file=db/migrations/2026-11-23-wall-replies.sql
--
--  注意：全部使用 IF NOT EXISTS，可重复执行；新库直接跑 db/schema.sql 即可
--        （已含同结构）。历史留言没有回复，不受影响。
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wall_replies (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  message_id  TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'visitor',
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  device_hash TEXT NOT NULL DEFAULT 'legacy',
  status      TEXT NOT NULL DEFAULT 'visible'
);

CREATE INDEX IF NOT EXISTS idx_wall_replies_message ON wall_replies (message_id, seq);
CREATE INDEX IF NOT EXISTS idx_wall_replies_device ON wall_replies (device_hash, created_at);
