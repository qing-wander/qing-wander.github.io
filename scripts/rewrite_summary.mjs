#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   按 JD 改写「个人简介」· rewrite_summary.mjs
   ──────────────────────────────────────────────────────────────────────
   只改一段话：resume.summary.html。其余（基本信息/经历/项目/技能/教育）一概不碰。

   三道护栏（都是代码判，不看模型脸色）：
     ① 数字守恒：输出里出现的数字必须全部来自原文（不得编"日活百万""提升 300%"）
     ② 篇幅上限：默认 ≤ 220 字（中文按码点计），超过直接拒收
     ③ 英文术语保留：原文里的英文专名（LangGraph / RAG / IM 等）至少保留 70%，
        否则模型容易把"Agent 工程化"写成"智能体工程化"，简历就变味了

   用法：
     node scripts/rewrite_summary.mjs --slug agent-2026
     node scripts/rewrite_summary.mjs --slug agent-2026 --dry-run   # 只打印不落盘
   产物：variants/<slug>.summary.json（{before, after, model, checks}）
   凭证：CF_API_TOKEN 优先，缺省用 wrangler OAuth（约 1 小时过期，过期重登）
   ────────────────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenize } from './lib/rag-tokenize.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data/site-data.json');
const OUT_DIR = resolve(ROOT, 'variants');
const ACCOUNT = 'ead07d9f00f8e2ac69055a81cc198382';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_CHARS = 220;

const args = process.argv.slice(2);
const i = args.indexOf('--slug');
const slug = i >= 0 ? args[i + 1] : null;
if (!slug) { console.error('用法：node scripts/rewrite_summary.mjs --slug <name>'); process.exit(1); }

const plan = JSON.parse(readFileSync(resolve(OUT_DIR, `${slug}.plan.json`), 'utf8'));
const source = JSON.parse(readFileSync(DATA, 'utf8'));
const before = source.resume.summary.html;
const jd = plan.jd_head || '';
if (!jd) { console.error('选材单里没有 jd_head，重新跑 plan_variant'); process.exit(1); }

function token() {
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN;
  const p = resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  throw new Error('没有可用凭证：CF_API_TOKEN 或先 wrangler login');
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, '');

/* 语义块召回：原文按 ；，、 切开，逐块算 bigram 覆盖率。
   只盯数字/英文术语不够——「红杉系初创 + 金融头部 AI 主力」这种定位短语被删掉时，
   数字和英文一个不少，但简历的分量已经没了。 */
function chunkRecall(before, after) {
  const chunks = String(before).split(/[；;，,、]/).map((c) => c.trim()).filter((c) => c.length >= 4);
  const hay = new Set(tokenize(after));
  const rows = chunks.map((c) => {
    const tokens = new Set(tokenize(c));
    let hit = 0;
    for (const t of tokens) if (hay.has(t)) hit += 1;
    return { chunk: c, recall: tokens.size ? hit / tokens.size : 1 };
  });
  return rows;
}
const digitsOf = (s) => (String(s).match(/\d+(?:\.\d+)?/g) || []);
const latinOf = (s) => (String(s).match(/[A-Za-z][A-Za-z0-9+#./-]*/g) || []);

const sys = [
  '你是简历文案编辑，只改「个人简介」这一段话，让它更贴合目标岗位。',
  '硬约束：',
  '1) 不得新增任何事实：数字、金额、年限、公司名、产品名、奖项都只能来自原文；',
  '2) 不得删除原文已有的事实点，尤其是「团队/机构背景 + 定位」这类短语（如“红杉系初创 + 金融头部 AI 主力”），必须保留；',
  '3) 保留全部英文术语原样（如 Agent、RAG、LangGraph、IM、SaaS），不要翻译成中文；',
  '4) 输出 ≤ 200 个汉字，一段话，不分行、不加标题、不加粗、不加表情；',
  '5) 只输出改写后的正文，不要解释、不要引号。',
].join('\n');

const usr = `【原文简介】\n${stripTags(before)}\n\n【目标岗位 JD（节选）】\n${jd.slice(0, 500)}\n\n请输出改写后的简介正文。`;

async function main() {
  const tk = token();
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      max_tokens: 400, temperature: 0.2,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) {
    console.error(`::error::模型调用失败 ${r.status} ${JSON.stringify(d.errors || d).slice(0, 160)}`);
    if (r.status === 401) console.error('  提示：OAuth token 过期，执行 npx wrangler whoami 刷新，或设 CF_API_TOKEN');
    process.exit(3);
  }
  const after = String(d.result?.choices?.[0]?.message?.content || d.result?.response || '').trim();
  if (!after) { console.error('::error::模型返回空文本（推理型模型会把 token 烧在思维链上）'); process.exit(3); }

  const checks = {
    chars: [...after].length,
    chars_limit: MAX_CHARS,
    digits_new: digitsOf(after).filter((n) => !digitsOf(before).includes(n)),
    digits_dropped: digitsOf(before).filter((n) => !digitsOf(after).includes(n)),
    latin_kept: latinOf(before).filter((t) => after.includes(t)).length,
    latin_total: latinOf(before).length,
  };

  const chunkRows = chunkRecall(stripTags(before), after);
  checks.chunks_min = Math.round(Math.min(...chunkRows.map((r) => r.recall)) * 100) / 100;
  const lostChunks = chunkRows.filter((r) => r.recall < 0.6);
  if (lostChunks.length) {
    for (const r of lostChunks) console.log(`  ⚠ 原文块保留不足（${(r.recall * 100).toFixed(0)}%）：${r.chunk}`);
  }

  const fail = [];
  if (lostChunks.length) fail.push(`有 ${lostChunks.length} 个原文语义块被删/改写过度（阈值 60%）`);
  if (checks.chars > MAX_CHARS) fail.push(`超长（${checks.chars} > ${MAX_CHARS}）`);
  if (checks.digits_new.length) fail.push(`冒出原文没有的数字：${checks.digits_new.join(', ')}`);
  if (checks.digits_total_ok === false) fail.push('原文数字丢失');
  if (checks.latin_total && checks.latin_kept / checks.latin_total < 0.7) fail.push(`英文术语保留不足（${checks.latin_kept}/${checks.latin_total}）`);

  console.log('原文：', stripTags(before));
  console.log('改写：', after);
  console.log(`字数 ${checks.chars}/${MAX_CHARS} · 数字新增 ${checks.digits_new.length} · 英文保留 ${checks.latin_kept}/${checks.latin_total}`);

  if (fail.length) {
    console.error('::error::改写未通过护栏：' + fail.join('；'));
    console.error('  改写稿未落盘，可调提示词后重跑');
    process.exit(4);
  }

  if (!args.includes('--dry-run')) {
    writeFileSync(resolve(OUT_DIR, `${slug}.summary.json`),
      JSON.stringify({ slug, before, after, model: MODEL, checks }, null, 2) + '\n');
    console.log(`✓ 文案 → variants/${slug}.summary.json（再跑 render_variant 合并）`);
  }
}

main();
