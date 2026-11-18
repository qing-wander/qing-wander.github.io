#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   向量化 · rag_embed.mjs
   ──────────────────────────────────────────────────────────────────────
   把 rag/chunks.json 的 42 片向量化（@cf/baai/bge-m3，1024 维），
   产出 `rag/vectors.ndjson`（Vectorize 规定的 NDJSON），并可 --upload 直接灌库。

   凭证：优先环境变量 CF_API_TOKEN（长期，CI 用）；缺省时回退 wrangler
         OAuth 登录态（本地开发用，约 24 小时过期，过期后重跑 `wrangler login`）。

   用法：
     node scripts/rag_embed.mjs               # 只生成 vectors.ndjson
     node scripts/rag_embed.mjs --upload      # 生成后自动 wrangler vectorize insert
     node scripts/rag_embed.mjs --query "..." # 拿问题向量去 Vectorize 查一次（自检）
   ────────────────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHUNKS = resolve(ROOT, 'rag/chunks.json');
const OUT = resolve(ROOT, 'rag/vectors.ndjson');

const ACCOUNT = 'ead07d9f00f8e2ac69055a81cc198382';
const MODEL = '@cf/baai/bge-m3';
const INDEX = 'resume-kb';
const BATCH = 10; // 单请求条数：小批量更好排错，42 片也只需 5 次调用

function token() {
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN;
  const p = resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  throw new Error('没有可用凭证：设置 CF_API_TOKEN，或先 wrangler login');
}

async function embed(texts, tk) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) {
    throw new Error(`embedding 失败 ${r.status}：${JSON.stringify(d.errors || d).slice(0, 200)}`);
  }
  return d.result.data;
}

const metadataOf = (c) => ({
  kb_version: c.kb_version,
  section: c.section,
  kind: c.kind,
  entity_id: c.entity_id,
  entity_type: c.entity_type,
  visibility: c.visibility,
});

async function build() {
  const payload = JSON.parse(readFileSync(CHUNKS, 'utf8'));
  const tk = token();
  const lines = [];
  for (let i = 0; i < payload.chunks.length; i += BATCH) {
    const slice = payload.chunks.slice(i, i + BATCH);
    const vectors = await embed(slice.map((c) => c.text), tk);
    slice.forEach((c, j) => {
      lines.push(JSON.stringify({
        id: `${c.kb_version}:${c.id}`,   // 版本前缀 → 新旧版本可共存、可蓝绿切换
        values: vectors[j],
        metadata: metadataOf(c),
      }));
    });
    process.stdout.write(`  ${Math.min(i + BATCH, payload.chunks.length)}/${payload.chunks.length}\r`);
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`✓ ${lines.length} 条向量 → rag/vectors.ndjson（${MODEL}，1024 维，${payload.kb_version}）`);
}

function upload() {
  execFileSync('npx', ['--yes', 'wrangler', 'vectorize', 'insert', INDEX, '--file=rag/vectors.ndjson'], {
    cwd: ROOT, stdio: 'inherit',
  });
}

/** 语义自检：问题 → 向量 → Vectorize REST 查询（CLI 的 --vector 不收 JSON 字符串，故走 REST） */
async function query(text, topK = 5) {
  const tk = token();
  const [vec] = await embed([text], tk);
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: vec, topK, returnValues: false, returnMetadata: 'all' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(`查询失败 ${r.status}：${JSON.stringify(d.errors || d).slice(0, 200)}`);
  const matches = d.result?.matches || [];
  console.log(`Q：${text}`);
  for (const m of matches) {
    console.log(`  ${m.score.toFixed(4)}  ${m.metadata?.section || '-'}  ${m.id}`);
  }
  if (!matches.length) console.log('  （索引里没有向量）');
}

const args = process.argv.slice(2);
const qi = args.indexOf('--query');
if (qi >= 0) {
  await query(args[qi + 1]);
} else {
  await build();
  if (args.includes('--upload')) upload();
}
