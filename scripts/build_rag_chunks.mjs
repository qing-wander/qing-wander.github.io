#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   RAG 切片构建 · build_rag_chunks.mjs
   ──────────────────────────────────────────────────────────────────────
   真相源：data/site-data.json（只读，不改内容）
   产物：  写到 RAG_OUT_DIR（默认 .temp/rag，已 gitignore，不入库）
           chunks.json            检索用切片（带稳定 ID 与元数据）
           kb-chunks.seed.sql     D1 落库种子（kb_chunks + kb_fts 词面索引）
           kb-terms.seed.sql      D1 词频种子

   线上知识库平时由 Cloudflare Worker（worker/kb 的 /rebuild）直接读 D1
   site_content 重建，不依赖本脚本、也不依赖 CI；本脚本只用于：
     · 冷启动（scripts/db-init.sh 建库后灌种子）
     · 本地排查 / --report 看切片清单

   切片算法本身在 scripts/lib/rag-chunks.mjs，Worker 复用同一份，避免漂移。

   用法：
     node scripts/build_rag_chunks.mjs            写盘
     node scripts/build_rag_chunks.mjs --check    按数据源现算并做闸门校验
     node scripts/build_rag_chunks.mjs --report   打印切片清单
   ────────────────────────────────────────────────────────────────────── */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChunks, seedSQL, termsSQL } from './lib/rag-chunks.mjs';

export { buildChunks, seedSQL, termsSQL } from './lib/rag-chunks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data/site-data.json');
const OUT_DIR = resolve(process.env.RAG_OUT_DIR || resolve(ROOT, '.temp/rag'));
const OUT_CHUNKS = resolve(OUT_DIR, 'chunks.json');
const OUT_SEED = resolve(OUT_DIR, 'kb-chunks.seed.sql');

const serialise = (payload) => JSON.stringify(payload, null, 2) + '\n';

function main() {
  const args = process.argv.slice(2);
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const payload = buildChunks(data);
  const sql = seedSQL(payload);
  const terms = termsSQL(payload);

  if (args.includes('--report')) {
    console.log(`kb_version ${payload.kb_version} · ${payload.count} 片 · ${payload.total_chars} 字`);
    const bySection = payload.chunks.reduce((m, c) => ((m[c.section] = (m[c.section] || 0) + 1), m), {});
    console.log(Object.entries(bySection).map(([k, v]) => `${k}=${v}`).join(' · '));
    payload.chunks.forEach((c) => console.log(`${c.id.padEnd(20)} ${String(c.text.length).padStart(4)}  ${c.title}`));
    return;
  }

  if (args.includes('--check')) {
    /* 产物不再入库，--check 改为「从数据源现算一次并做闸门校验」，
       不再比对磁盘上的旧文件。 */
    const raw = JSON.stringify(payload);
    const bad = [];
    if (!payload.count) bad.push('切片为空');
    if (/(?:180\s?2283\s?4605|18022834605|AH96NG89HCCUWMEA)/.test(raw)) bad.push('产物含未脱敏字段');
    if (new Set(payload.chunks.map((c) => c.id)).size !== payload.count) bad.push('切片 id 重复');
    if (bad.length) {
      console.error('::error::RAG 生成校验失败：' + bad.join('、'));
      process.exit(1);
    }
    console.log(`✓ RAG 生成校验通过：${payload.count} 片 · ${payload.kb_version}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_CHUNKS, serialise(payload));
  writeFileSync(OUT_SEED, sql);
  writeFileSync(resolve(OUT_DIR, 'kb-terms.seed.sql'), terms);
  console.log(`✓ 写出 ${payload.count} 片（${payload.total_chars} 字）· ${payload.kb_version}`);
  console.log(`  ${OUT_DIR}/chunks.json · kb-chunks.seed.sql · kb-terms.seed.sql`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
