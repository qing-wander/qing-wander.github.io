-- 站点内容云端真相源：公开仓库脱敏后，真人数据存这里，后台可编辑。
-- 部署后在 Cloudflare D1 执行本文件（或用后台「站点数据」导入）。
CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
