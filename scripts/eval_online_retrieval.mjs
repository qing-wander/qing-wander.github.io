#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   线上检索 A/B · eval_online_retrieval.mjs
   ──────────────────────────────────────────────────────────────────────
   为什么需要它：本地 rag_query.mjs 只量词面 BM25，量不到「混合召回 + 精排」
   的真实效果。这个脚本直接打线上 /api/kb，同一批金标题跑两遍：

     rerank=1（默认） vs rerank=0（关精排）

   只看 hit@1 / hit@3 的变化，不比绝对分（分数不同量纲，没意义）。

   用法：
     node scripts/eval_online_retrieval.mjs
     node scripts/eval_online_retrieval.mjs --base https://shenge-work.pages.dev
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = JSON.parse(readFileSync(resolve(ROOT, 'tests/golden-queries.json'), 'utf8'));
const BASE = (process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://shenge-work.pages.dev').replace(/\/$/, '');

async function ask(q, rerank, top = 3) {
  const url = `${BASE}/api/kb?q=${encodeURIComponent(q)}&top=${top}&rerank=${rerank ? 1 : 0}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function run(rerank) {
  const rows = [];
  for (const item of GOLDEN.queries) {
    const d = await ask(item.q, rerank);
    const ids = (d.hits || []).map((h) => h.id);
    const hit1 = ids.length > 0 && item.expect.includes(ids[0]);
    const hit3 = ids.some((id) => item.expect.includes(id));
    rows.push({ q: item.q, ids, hit1, hit3, reranked: !!d.reranked, empty: !ids.length });
  }
  const n = rows.length;
  return {
    rows,
    hit1: rows.filter((r) => r.hit1).length / n,
    hit3: rows.filter((r) => r.hit3).length / n,
    empty: rows.filter((r) => r.empty).length,
    rerankedRuns: rows.filter((r) => r.reranked).length,
  };
}

function pct(x) { return (x * 100).toFixed(0) + '%'; }

const off = await run(false);
const on = await run(true);

console.log(`金标题 ${off.rows.length} 条 · 线上 ${BASE}\n`);
console.log('题'.padEnd(30) + '关精排'.padEnd(22) + '开精排');
for (let i = 0; i < off.rows.length; i++) {
  const a = off.rows[i];
  const b = on.rows[i];
  const mark = (r) => (r.hit1 ? '✓' : r.hit3 ? '3' : '✗') + ' ' + (r.ids[0] || '—').slice(0, 16);
  const flag = a.hit1 !== b.hit1 ? '  ←变化' : '';
  console.log(String(i + 1).padStart(2) + '. ' + a.q.slice(0, 26).padEnd(28) + mark(a).padEnd(22) + mark(b) + flag);
}

console.log(`\nhit@1：${pct(off.hit1)} → ${pct(on.hit1)}`);
console.log(`hit@3：${pct(off.hit3)} → ${pct(on.hit3)}`);
console.log(`空召回：${off.empty} → ${on.empty} 条`);
console.log(`精排生效：${off.rerankedRuns} / ${on.rerankedRuns} 次`);
