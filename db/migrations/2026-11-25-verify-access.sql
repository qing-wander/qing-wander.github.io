-- ──────────────────────────────────────────────────────────────────────
--  学历核验访问授权表（2026-11-25）
-- ──────────────────────────────────────────────────────────────────────
--  用途：邮件审批 → 服务端授权 → 访客页面轮询解锁。
--
--  执行（生产库，一次）：
--    npx wrangler d1 execute portfolio-db --remote --config wrangler.toml --file=db/migrations/2026-11-25-verify-access.sql
--  本地：
--    npx wrangler d1 execute portfolio-db --local --config wrangler.toml --file=db/migrations/2026-11-25-verify-access.sql
--
--  幂等：CREATE IF NOT EXISTS，可重复执行。新库直接跑 db/schema.sql 即可。
--  注意：D1 绑定必须在 Pages 控制台挂到 shenge-work 项目上（binding = DB），
--        否则申请仍会发邮件，但无法走审批解锁链路。
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verify_access_requests (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL DEFAULT 'xinhua',
  name         TEXT NOT NULL,
  identity     TEXT NOT NULL,
  org          TEXT,
  contact      TEXT,
  purpose      TEXT NOT NULL,
  reason       TEXT NOT NULL,
  meta         TEXT,
  device_hash  TEXT,
  created_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  approved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verify_access_status ON verify_access_requests (status, created_at);
