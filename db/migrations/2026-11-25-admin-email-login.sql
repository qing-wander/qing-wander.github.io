-- 后台免密登录：邮箱验证码表
-- 应用：
--   npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-25-admin-email-login.sql
--
-- 说明：
--   · code_hash 是 HMAC-SHA256(secret, email|code)，明文验证码只出现在邮件里；
--   · 每邮箱一行，重新发送即覆盖旧码（旧码同时失效）；
--   · attempts 记录错误次数，到 5 次作废，防止暴力枚举。
CREATE TABLE IF NOT EXISTS admin_email_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL
);
