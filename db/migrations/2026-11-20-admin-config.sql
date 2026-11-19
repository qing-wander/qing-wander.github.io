-- 后台配置（2026-11-20）
-- 用途：每个 AI 模块的模型与提示词、主题开关等运行时配置。
-- 为什么不进 Git：提示词是运行期可调的运营参数，改动要即时生效；简历内容才是 Git 真相源。
-- 应用：npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-20-admin-config.sql
CREATE TABLE IF NOT EXISTS admin_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
