#!/usr/bin/env node
/* 把仓库里的真人数据一次性导入 D1 site_content 表。
   用途：脱敏仓库前先备份真人数据到云端；之后后台「站点数据」可继续编辑。

   用法：
     node scripts/seed-site-content.mjs            # 导入全部
     node scripts/seed-site-content.mjs site-data  # 只导一项

   依赖 wrangler（已在本机 npx 缓存里），走 --remote 写生产 D1。 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const WRANGLER = resolve(process.env.HOME,
  '.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/bin/wrangler.js');
const DB = 'portfolio-db';

const FILES = {
  'site-data': 'data/site-data.json',
  'company-profiles': 'data/company-profiles.json',
  'school-profiles': 'data/school-profiles.json',
  people: 'data/people.json',
  contributions: 'data/contributions.json',
  'work-details': 'data/work-details.json',
  'asset-manifest': 'data/asset-manifest.json',
};

/* SQLite 字符串字面量：单引号翻倍即可；JSON 里不会有裸 NUL。 */
const sqlQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const only = process.argv[2];
const keys = only ? [only] : Object.keys(FILES);
for (const k of keys) {
  if (!FILES[k]) throw new Error('未知数据项：' + k);
}

/* 一次一条、走 --file：D1 对单条 SQL 语句长度有限制（~50KB），
   company-profiles 105KB 会报 SQLITE_TOOBIG。大 payload 拆成 8KB 分片，
   先写空串再逐片 payload||chunk 拼接，每片都是短语句。 */
const CHUNK = 8000;

function statementsFor(key, raw) {
  const ts = Date.now();
  const head =
    `INSERT INTO site_content (key, payload, updated_at, updated_by) VALUES (` +
    `${sqlQuote(key)}, '', ${ts}, 'seed') ` +
    `ON CONFLICT(key) DO UPDATE SET payload='', updated_at=${ts}, updated_by='seed';`;
  const out = [head];
  for (let i = 0; i < raw.length; i += CHUNK) {
    out.push(`UPDATE site_content SET payload = payload || ${sqlQuote(raw.slice(i, i + CHUNK))} WHERE key=${sqlQuote(key)};`);
  }
  return out;
}

for (const key of keys) {
  const path = resolve(ROOT, FILES[key]);
  const raw = readFileSync(path, 'utf8');
  JSON.parse(raw); // 提前校验，坏 JSON 不要写进 D1
  const sql = statementsFor(key, raw).join('\n');

  const sqlFile = resolve(tmpdir(), `seed-site-${key}-${process.pid}.sql`);
  writeFileSync(sqlFile, sql);
  console.log(`[seed] ${key}: ${raw.length} chars`);
  const r = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, '--remote', '--file', sqlFile], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  unlinkSync(sqlFile);
  process.stdout.write(r.stdout || '');
  if (r.stderr && r.stderr.includes('ERROR')) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`[seed] ${key} 失败`);
    process.exit(r.status || 1);
  }
}
console.log('[seed] done');
