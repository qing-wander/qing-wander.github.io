#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   按选材单渲染简历变体 · render_variant.mjs
   ──────────────────────────────────────────────────────────────────────
   输入：data/site-data.json（唯一真相源）+ variants/<slug>.plan.json（选材单）
   输出：variants/<slug>.html

   铁律（写死在这里，不靠提示词自觉）：
     · 样式与布局只有一个：复用 templates/resume.template.html，与正式简历同源
     · L0 字段一律不动：公司全称 / 岗位名 / 起止时间 / 学校 / 学历 / 专业 / 基本信息
       渲染前后逐字段比对，只要有一处不同就红掉，不产出文件
     · 只删不改：选材单只决定「留哪条 bullet」，正文一个字都不重写

   用法：
     node scripts/render_variant.mjs --slug agent-2026
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from './render_resume.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data/site-data.json');
const OUT_DIR = resolve(ROOT, 'variants');

const args = process.argv.slice(2);
const i = args.indexOf('--slug');
const slug = i >= 0 ? args[i + 1] : null;
if (!slug) {
  console.error('用法：node scripts/render_variant.mjs --slug <name>');
  process.exit(1);
}

const planFile = resolve(OUT_DIR, `${slug}.plan.json`);
if (!existsSync(planFile)) {
  console.error(`缺少选材单 ${planFile}，先跑 node scripts/plan_variant.mjs --jd ... --slug ${slug}`);
  process.exit(1);
}

const source = JSON.parse(readFileSync(DATA, 'utf8'));
const plan = JSON.parse(readFileSync(planFile, 'utf8'));

/* 深拷贝医生：只动 bullets 数组，其余字段原样保留 */
const variant = structuredClone(source);
const r = variant.resume;
const sr = source.resume;

/* L0 快照：渲染前后必须完全相等 */
const l0 = (resume) => ({
  basics: JSON.stringify(resume.basics),
  education: JSON.stringify(resume.education),
  identity: JSON.stringify(resume.experience.map((e) => ({
    id: e.id, company: e.company, companyNote: e.companyNote, role: e.role, period: e.period,
  }))),
  projects: JSON.stringify(resume.projects.map((p) => ({ id: p.id, name: p.name, url: p.url, subtitle: p.subtitle, period: p.period }))),
});
const before = l0(sr);

/* 1) 经历：只过滤 bullet，公司/职位/时间不动 */
r.experience = r.experience.map((exp) => {
  const keep = plan.keep.experience?.[exp.id];
  if (!keep) return exp;
  return { ...exp, bullets: exp.bullets.filter((b) => keep.includes(b.id)) };
});

/* 2) 项目：按计划裁项目与 bullet */
const keptProjectIds = Object.keys(plan.keep.projects || {});
r.projects = r.projects
  .filter((p) => (keptProjectIds.length ? keptProjectIds.includes(p.id) : true))
  .map((p) => {
    const keep = plan.keep.projects?.[p.id];
    if (!keep) return p;
    return { ...p, bullets: p.bullets.filter((b) => keep.includes(b.id)) };
  });

/* 3) 技能 / 简介 / 教育 不动 —— AI 改写留到后续单独一步 */

const after = l0(r);
for (const k of Object.keys(before)) {
  if (before[k] !== after[k]) {
    console.error(`::error::L0 字段被改动：${k}`);
    console.error('  变体只允许删 bullet，基本信息/公司/职位/时间/学校/学历必须原样');
    process.exit(2);
  }
}

if (r.experience.some((e) => !e.bullets.length)) {
  console.error('::error::有经历段被删空了，版面会出现空壳');
  process.exit(2);
}

const html = render(variant);
mkdirSync(OUT_DIR, { recursive: true });
const out = resolve(OUT_DIR, `${slug}.html`);
writeFileSync(out, html);

const bulletsBefore = sr.experience.reduce((n, e) => n + e.bullets.length, 0) + sr.projects.reduce((n, p) => n + p.bullets.length, 0);
const bulletsAfter = r.experience.reduce((n, e) => n + e.bullets.length, 0) + r.projects.reduce((n, p) => n + p.bullets.length, 0);
console.log(`✓ 变体 → variants/${slug}.html（${Buffer.byteLength(html)} bytes）`);
console.log(`  bullet ${bulletsBefore} → ${bulletsAfter}（删 ${bulletsBefore - bulletsAfter} 条）· 项目 ${sr.projects.length} → ${r.projects.length}`);
console.log('  L0 校验通过：基本信息 / 公司 / 职位 / 时间 / 学校 / 学历 全部未变');
