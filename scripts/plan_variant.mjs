#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   按 JD 出「选材单」· plan_variant.mjs
   ──────────────────────────────────────────────────────────────────────
   只做选材，不改写文案：拿 JD 当查询，在 42 片切片里做 BM25 打分，
   据此决定「每段经历留哪几条 bullet、项目留哪几个、留几条」。

   为什么选材和改写分开：
     · 选材是可控的（同一 JD → 同一份单子），可以 diff、可以审；
     · 改写交给 AI 单独一步，失败了只影响措辞，不会把公司名/时间搞乱。

   用法：
     node scripts/plan_variant.mjs --jd jd.txt --slug agent-2026
     node scripts/plan_variant.mjs --jd jd.txt --slug agent-2026 --json
   产物：variants/<slug>.plan.json
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { search } from './rag_query.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHUNKS = resolve(ROOT, 'rag/chunks.json');
const DATA = resolve(ROOT, 'data/site-data.json');
const OUT_DIR = resolve(ROOT, 'variants');

/* 保留阈值：相对最高分的比例。低于这个分说明 JD 压根没提到，删掉。
   0.15 是试出来的——再高会把「顺手做过」的边角料也删掉，版面反而更空。 */
const KEEP_RATIO = 0.15;

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const jdFile = getArg('--jd');
const slug = getArg('--slug') || 'variant';
if (!jdFile) {
  console.error('用法：node scripts/plan_variant.mjs --jd jd.txt --slug <name>');
  process.exit(1);
}

const jd = readFileSync(resolve(process.cwd(), jdFile), 'utf8');
const payload = JSON.parse(readFileSync(CHUNKS, 'utf8'));
const data = JSON.parse(readFileSync(DATA, 'utf8'));

const scored = search(payload, jd, 50);
if (!scored.length) {
  console.error('JD 与档案完全没有交集：检查文本是否为空 / 是否是别的岗位');
  process.exit(2);
}
const top = scored[0].score;
const keepIds = new Set(scored.filter((s) => s.score >= top * KEEP_RATIO).map((s) => s.id));

/* 每段经历至少留 1 条、最多 3 条；项目最多留 4 个、每个最多 3 条——这是 2 页的版面预算 */
const MAX_EXP_BULLETS = 3;
const MAX_PROJECTS = 4;
const MAX_PROJ_BULLETS = 3;

const r = data.resume;
const plan = {
    slug,
    jd_chars: jd.length,
    kb_version: payload.kb_version,
    top_score: Number(top.toFixed(3)),
    keep: { experience: {}, projects: {}, skills: [], about: [] },
    dropped: [],
};

/* 经历：按 bullet 得分排，保底第一条 */
for (const exp of r.experience) {
    const bullets = (exp.bullets || []).map((b) => ({ id: b.id, score: scored.find((s) => s.id === b.id)?.score || 0 }));
    const picked = bullets.filter((b) => keepIds.has(b.id)).sort((a, b) => b.score - a.score).slice(0, MAX_EXP_BULLETS);
    /* 保底：一条都没命中也要留两条最能体现职责的（否则这段经历变成空壳） */
    const withFallback = picked.length ? picked : bullets.slice(0, 2);
    plan.keep.experience[exp.id] = withFallback.map((b) => b.id);
    for (const b of bullets) if (!withFallback.some((k) => k.id === b.id)) plan.dropped.push({ id: b.id, section: 'experience', entity: exp.id });
}

/* 项目：先按项目整体分排序，取前 4 个 */
const projScore = (p) => (p.bullets || []).reduce((sum, b) => sum + (scored.find((s) => s.id === b.id)?.score || 0), 0);
const projects = [...r.projects].sort((a, b) => projScore(b) - projScore(a));
const keptProjects = projects.slice(0, MAX_PROJECTS);
for (const p of keptProjects) {
    const bullets = (p.bullets || []).map((b) => ({ id: b.id, score: scored.find((s) => s.id === b.id)?.score || 0 }));
    const picked = bullets.filter((b) => keepIds.has(b.id)).sort((a, b) => b.score - a.score).slice(0, MAX_PROJ_BULLETS);
    plan.keep.projects[p.id] = (picked.length ? picked : bullets.slice(0, 2)).map((b) => b.id);
}
for (const p of r.projects) {
    if (!keptProjects.some((k) => k.id === p.id)) {
        plan.dropped.push({ id: p.id, section: 'project', entity: p.id, reason: '版面预算（项目数超 4）' });
    }
}

plan.summary = {
    experiences: r.experience.length,
    projects_kept: keptProjects.length,
    projects_total: r.projects.length,
    dropped_count: plan.dropped.length,
};

mkdirSync(OUT_DIR, { recursive: true });
const out = resolve(OUT_DIR, `${slug}.plan.json`);
writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');

if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
} else {
    console.log(`✓ 选材单 → variants/${slug}.plan.json`);
    console.log(`  经历 ${plan.summary.experiences} 段 · 项目 ${keptProjects.length}/${r.projects.length} · 删掉 ${plan.dropped.length} 条`);
    for (const [id, bullets] of Object.entries(plan.keep.experience)) console.log(`  ${id}: ${bullets.join(', ')}`);
    for (const [id, bullets] of Object.entries(plan.keep.projects)) console.log(`  ${id}: ${bullets.join(', ')}`);
}
