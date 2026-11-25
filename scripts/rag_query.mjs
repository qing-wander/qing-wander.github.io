#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   检索自测 · rag_query.mjs
   ──────────────────────────────────────────────────────────────────────
   目的：在没有向量库的情况下也能量出「词面检索到底准不准」。
   打分用 BM25（标题权重 ×2），与写入 D1 FTS5 的 token 完全同源，
   所以这里的 topK 就是线上关键词召回的上限参考。

   用法：
     node scripts/rag_query.mjs --q "云沙箱 多租户隔离"
     node scripts/rag_query.mjs --q "..." --top 5 --json
     node scripts/rag_query.mjs --golden tests/golden-queries.json    # 跑金标集算 hit@3
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './lib/rag-tokenize.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAG_DIR = resolve(process.env.RAG_OUT_DIR || resolve(ROOT, '.temp/rag'));
const CHUNKS = resolve(RAG_DIR, 'chunks.json');

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 2;
const HINT_BONUS = 1.6;

/* 章节意图：口语化问题（「他几年经验」「换过几家公司」）词面几乎不打中正文，
   靠意图把对应段落兜上来，避免明明有料却答「没写」。 */
const INTENTS = [
  { re: /(几年|多少年|工作经历|履历|几家公司|换过|就职|任职)/, sections: ['experience', 'about'] },
  { re: /(项目|作品)/, sections: ['projects', 'works'] },
  { re: /(学历|毕业|学校|专业|大学|奖学金|统招)/, sections: ['education'] },
  { re: /(联系|邮箱|电话|微信|github|作品集)/i, sections: ['contact'] },
  { re: /(技能|技术栈|会什么|熟悉什么)/, sections: ['skills'] },
];

const hintedSections = (query) =>
  new Set(INTENTS.filter((i) => i.re.test(query)).flatMap((i) => i.sections));

export function loadChunks(file = CHUNKS) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function buildIndex(payload) {
  const docs = payload.chunks.map((c) => {
    const titleTokens = tokenize(c.title);
    const bodyTokens = tokenize(c.text);
    const tokens = [];
    for (let i = 0; i < TITLE_WEIGHT; i++) tokens.push(...titleTokens);
    tokens.push(...bodyTokens);
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { chunk: c, tf, len: tokens.length };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const avgdl = docs.reduce((n, d) => n + d.len, 0) / Math.max(docs.length, 1);
  return { docs, df, avgdl, n: docs.length };
}

const idf = (df, n) => Math.log(1 + (n - df + 0.5) / (df + 0.5));

/** @returns {{id:string,score:number,matched:number,text:string}[]} */
export function search(payload, query, top = 5) {
  const { docs, df, avgdl, n } = buildIndex(payload);
  const qTokens = Array.from(new Set(tokenize(query)));
  /* 词面覆盖面闸门：只命中一个词（比如「深圳」这种地名）不足以说明相关。
     短查询（≤2 个 token）放宽到 1，避免「邮箱」这类单词查询被误杀。 */
  const minMatched = Math.min(qTokens.length <= 2 ? 1 : 2, qTokens.length);
  const hints = hintedSections(query);
  const scored = docs.map((d) => {
    let score = 0;
    let matched = 0;
    for (const t of qTokens) {
      const f = d.tf.get(t);
      if (!f) continue;
      matched++;
      const w = idf(df.get(t) || 0, n);
      score += w * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgdl));
    }
    const inHint = hints.has(d.chunk.section);
    if (inHint && matched > 0) score += HINT_BONUS * matched;
    const need = inHint ? 1 : minMatched;
    return { id: d.chunk.id, score, matched, need, text: d.chunk.text };
  });
  return scored
    .filter((s) => s.score > 0 && s.matched >= s.need)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

function main() {
  const args = process.argv.slice(2);
  const payload = loadChunks();

  if (args.includes('--golden')) {
    const file = args[args.indexOf('--golden') + 1] || 'tests/golden-queries.json';
    const golden = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));
    let hit3 = 0;
    let hit1 = 0;
    const misses = [];
    for (const item of golden.queries) {
      const hits = search(payload, item.q, 3).map((h) => h.id);
      const ok3 = hits.some((id) => item.expect.includes(id));
      const ok1 = item.expect.includes(hits[0]);
      if (ok3) hit3++;
      if (ok1) hit1++;
      if (!ok3) misses.push(`${item.q} → ${hits.join(', ') || '(空)'}；期望 ${item.expect.join(' / ')}`);
    }
    const rate3 = hit3 / golden.queries.length;
    const rate1 = hit1 / golden.queries.length;
    console.log(`hit@1 ${(rate1 * 100).toFixed(1)}% · hit@3 ${(rate3 * 100).toFixed(1)}% · ${golden.queries.length} 题`);
    misses.forEach((m) => console.log('  ✗ ' + m));
    process.exit(rate3 >= (golden.gateHit3 ?? 0.9) ? 0 : 1);
  }

  const qi = args.indexOf('--q');
  if (qi < 0) {
    console.error('用法：node scripts/rag_query.mjs --q "问题" [--top N] [--json]');
    process.exit(2);
  }
  const query = args[qi + 1];
  const topIdx = args.indexOf('--top');
  const top = topIdx > 0 ? Number(args[topIdx + 1]) : 5;
  const hits = search(payload, query, top);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ query, kb_version: payload.kb_version, hits }, null, 2));
    return;
  }
  console.log(`Q：${query}（${payload.kb_version}）`);
  if (!hits.length) console.log('  （无命中，线上应直接回「简历里没写这块」）');
  hits.forEach((h, i) => console.log(`  ${i + 1}. ${h.score.toFixed(2)}  ${h.id}\n     ${h.text.slice(0, 90)}…`));
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
