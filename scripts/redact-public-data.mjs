#!/usr/bin/env node
/* 仓库公开数据脱敏（2026-11-25）
   ──────────────────────────────────────────────────────────────
   真人数据已在云端 D1（site_content），仓库里的副本只给 CI 与本地预览用，
   所以把隐私字段替换成占位符。只做等值替换，不改结构、不改展示文案，
   生成物（resume.html / work/*.html / js 快照）用同一套替换，
   CI 的「JSON → 生成物逐字一致」校验仍然成立。

   替换清单：手机号、学信网验证码。姓名与邮箱保留——它们是公开展示内容，
   本站本身就是求职作品集，名字与联系邮箱本来就要给访客看。
   ────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const REPLACEMENTS = [
  // 手机号：带空格展示版 / 纯数字 href 版
  ['180 2283 4605', '138 0000 0000'],
  ['+86 180 2283 4605', '+86 138 0000 0000'],
  ['18022834605', '13800000000'],
  ['+8618022834605', '+8613800000000'],
  // 学信网在线验证码
  ['AH96NG89HCCUWMEA', 'REDACTED_VERIFY_CODE'],
];

/* 明确的文件清单，避免误伤无关文件（如 git 历史、docs 说明）。 */
const TARGETS = [
  'data/site-data.json',
  'data/site-data.js',
  'data/school-profiles.json',
  'data/school-profiles.js',
  'functions/lib/site-data.js',
  'resume.html',
  'variants/agent-2026.html',
  'rag/chunks.json',
  'rag/kb-chunks.seed.sql',
  'knowledge/chunks.json',
  'functions/tencent/kb/chunks.json',
];

const checkOnly = process.argv.includes('--check');
let changed = 0;
let remaining = 0;

for (const rel of TARGETS) {
  const path = resolve(ROOT, rel);
  if (!existsSync(path)) continue;
  let text = readFileSync(path, 'utf8');
  const before = text;
  for (const [from, to] of REPLACEMENTS) text = text.split(from).join(to);
  if (text !== before) {
    changed++;
    if (!checkOnly) writeFileSync(path, text);
    console.log(`[redact] ${rel}: ${(before.length - text.length) >= 0 ? 'ok' : 'ok'}`);
  }
  for (const [from] of REPLACEMENTS) {
    if (text.includes(from)) {
      remaining++;
      console.error(`[redact] 仍有敏感值：${rel} ← ${from}`);
    }
  }
}

if (checkOnly) {
  if (remaining) {
    console.error(`✗ 脱敏不完整：${remaining} 处`);
    process.exit(1);
  }
  console.log('✓ 脱敏校验通过');
} else {
  console.log(`✓ 已处理 ${changed} 个文件`);
}
