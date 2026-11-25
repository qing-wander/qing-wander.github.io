#!/usr/bin/env node
/* 把站点 JSON 数据一次性导入 D1 site_content 表。
   线上真相源是 D1；仓库里的 data/*.json 只是可替换的数据模板（脱敏副本）。
   fork 后把自己的 JSON 放进 DATA_DIR，跑一次本脚本即可完成「换数据」。

   用法：
     node scripts/seed-site-content.mjs                    # 导入全部
     node scripts/seed-site-content.mjs site-data          # 只导一项
     DATA_DIR=/path/to/my-data D1_DB_NAME=my-db node scripts/seed-site-content.mjs

   环境变量：
     D1_DB_NAME  数据库名，默认 portfolio-db
     D1_MODE     remote（默认）或 local
     DATA_DIR    JSON 所在目录，默认仓库 data/
     WRANGLER    可选，wrangler 可执行文件路径；默认走 npx wrangler */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DB = process.env.D1_DB_NAME || 'portfolio-db';
const MODE = process.env.D1_MODE === 'local' ? '--local' : '--remote';
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, 'data'));

const FILES = {
  'site-data': 'site-data.json',
  'company-profiles': 'company-profiles.json',
  'school-profiles': 'school-profiles.json',
  people: 'people.json',
  contributions: 'contributions.json',
  'work-details': 'work-details.json',
  'asset-manifest': 'asset-manifest.json',
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
  const path = resolve(DATA_DIR, FILES[key]);
  const raw = readFileSync(path, 'utf8');
  JSON.parse(raw); // 提前校验，坏 JSON 不要写进 D1
  const sql = statementsFor(key, raw).join('\n');

  const sqlFile = resolve(tmpdir(), `seed-site-${key}-${process.pid}.sql`);
  writeFileSync(sqlFile, sql);
  console.log(`[seed] ${key}: ${raw.length} chars`);
  const cmd = process.env.WRANGLER || 'npx';
  const args = process.env.WRANGLER
    ? ['d1', 'execute', DB, MODE, '--file', sqlFile]
    : ['--yes', 'wrangler', 'd1', 'execute', DB, MODE, '--file', sqlFile];
  const r = spawnSync(cmd, args, {
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
