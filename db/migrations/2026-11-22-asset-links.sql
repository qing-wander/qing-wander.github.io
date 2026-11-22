-- ──────────────────────────────────────────────────────────────────────
--  静态资源链接表（asset_links）
-- ──────────────────────────────────────────────────────────────────────
--  背景：静态资源（图片/视频/3D 模型）已从本地迁到腾讯云 CloudBase COS
--  免费对象存储。本表保存 file_key → 公开 URL 的映射，便于：
--    1) 集中管理所有外链，前端通过 data/asset-map.js 使用；
--    2) 将来切到 Cloudflare R2 时，只需按 file_key 批量 UPDATE url/source，
--       不改前端引用。
--
--  执行：
--    npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-22-asset-links.sql
--  幂等：CREATE IF NOT EXISTS + INSERT OR REPLACE，可重复执行。
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_links (
  file_key    TEXT PRIMARY KEY,        -- 相对路径，如 images/portrait.jpg
  url         TEXT NOT NULL,           -- 当前公开 URL
  source      TEXT NOT NULL DEFAULT 'cloudbase-cos',  -- cloudbase-cos | cloudflare-r2 | local
  bucket      TEXT,                    -- 存储桶
  content_type TEXT,
  size_bytes  INTEGER,
  uploaded_at INTEGER,                 -- unix 秒
  updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_asset_links_source ON asset_links (source);
