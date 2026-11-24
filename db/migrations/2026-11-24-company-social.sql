-- 公司档案互动：浏览量 / 点赞 / 评论回复（2026-11-24）
-- 应用：npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-24-company-social.sql
-- 幂等：全部 IF NOT EXISTS，可重复执行。
-- 设备唯一口径：前端随机 device id + 设备指纹 + UA → 服务端 HMAC-SHA256（32 位 hex），
-- 只存哈希不存原文；同标识对同档案只计一次浏览 / 一次赞。
-- 与 db/schema.sql 的「公司档案互动」段保持一致，schema.sql 是新库的完整基线。

-- 每家公司、每个设备+UA 只计一次浏览
CREATE TABLE IF NOT EXISTS company_views (
  company_id   TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  PRIMARY KEY (company_id, visitor_hash)
);
CREATE INDEX IF NOT EXISTS idx_company_views_company ON company_views (company_id);

-- 档案点赞：每设备+UA 每家公司最多一条，取消即删行
CREATE TABLE IF NOT EXISTS company_likes (
  company_id   TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (company_id, visitor_hash)
);

-- 评论与回复：parent_id 为空 = 顶层评论；展示时按纯文本渲染
CREATE TABLE IF NOT EXISTS company_comments (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  parent_id    TEXT,
  name         TEXT NOT NULL,
  text         TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  likes_count  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_company_comments_company
  ON company_comments (company_id, created_at);

-- 评论点赞：每设备+UA 每评论最多一条，取消即删行
CREATE TABLE IF NOT EXISTS company_comment_likes (
  comment_id   TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (comment_id, visitor_hash)
);
