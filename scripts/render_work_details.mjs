#!/usr/bin/env node
/* 作品案例页渲染：data/work-details.json × data/site-data.json(works) → work/<id>.html
   ──────────────────────────────────────────────────────────────
   真相源：
     · data/work-details.json  —— 案例内容（定位 / 架构 / 难题 / 复盘…）
     · data/site-data.json     —— works 条目里的标题、编号、技术栈（避免两处漂移）
   生成物 work/*.html 不要手改；改完数据跑本脚本，CI 会做漂移检查。

   用法：
     node scripts/render_work_details.mjs           生成全部
     node scripts/render_work_details.mjs --check   只比对是否与数据一致
     node scripts/render_work_details.mjs --stdout portfolio   打到标准输出
   ────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_FILE = resolve(ROOT, 'data/site-data.json');
const DETAILS_FILE = resolve(ROOT, 'data/work-details.json');
const TEMPLATE_FILE = resolve(ROOT, 'templates/work-detail.template.html');
const OUT_DIR = resolve(ROOT, 'work');
const SITE_ORIGIN = 'https://chenpeisheng.cn';

const BANNER = [
  '<!-- 由 scripts/render_work_details.mjs 生成，请勿手改 -->',
  '<!-- 真相源：data/work-details.json + data/site-data.json(works)；模板：templates/work-detail.template.html -->',
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const raw = (s) => String(s == null ? '' : s);

function section(no, id, title, en, inner, lead) {
  return '  <section class="sec" id="' + id + '">' +
    '<div class="sec-head"><span class="sec-no">' + esc(no) + '</span>' +
    '<h2 class="sec-title">' + esc(title) + '</h2>' +
    '<span class="sec-en">' + esc(en) + '</span></div>' +
    (lead ? '<p class="sec-lead">' + esc(lead) + '</p>' : '') +
    inner + '</section>';
}

/* ── 01 概览 ── */
function overviewBlock(w, site) {
  const metrics = (w.heroMetrics || []).map((m) =>
    '<div class="kpi"><p class="kpi-num">' + esc(m.value) + '<small>' + esc(m.unit) + '</small></p>' +
    '<p class="kpi-label">' + esc(m.label) + '</p>' +
    '<p class="kpi-note">' + esc(m.note || '') + '</p></div>').join('');

  const tech = (site.tech || []).map((t) => '<span>' + esc(t) + '</span>').join('');
  const links = w.links || {};
  const actions = [
    links.live ? '<a class="btn btn-solid" href="' + esc(links.live) + '" target="_blank" rel="noopener noreferrer">' + esc(w.liveLabel || '在线访问') + ' ↗</a>' : '',
    links.repo ? '<a class="btn" href="' + esc(links.repo) + '" target="_blank" rel="noopener noreferrer">GitHub 源码 ↗</a>' : '',
    links.resume ? '<a class="btn" href="' + esc(links.resume) + '">网页简历 ↗</a>' : '',
  ].join('');

  const s = w.summary || {};
  const psr = [
    { k: 'PROBLEM', h: '问题', p: s.problem },
    { k: 'SOLUTION', h: '方案', p: s.solution },
    { k: 'RESULT', h: '结果', p: s.result },
  ].map((x) =>
    '<div class="psr-item" data-k="' + x.k + '"><h3>' + esc(x.h) + '</h3><p>' + esc(x.p) + '</p></div>').join('');

  return '  <header class="hero" id="overview">' +
    '<div class="hero-top"><span class="hero-no">' + esc(site.no) + '</span>' +
    '<span class="hero-kicker">CASE STUDY · 独立从 0 到 1</span></div>' +
    '<h1>' + esc(site.title) + '<span class="hero-en">' + esc(site.titleEn) + '</span></h1>' +
    '<p class="hero-tagline">' + esc(w.tagline) + '</p>' +
    '<div class="hero-meta">' +
      '<span class="is-key">' + esc(w.role) + '</span>' +
      '<span>' + esc(w.period) + '</span>' +
      '<span>' + esc(w.status) + '</span>' +
      tech +
    '</div>' +
    '<div class="hero-actions">' + actions + '</div>' +
    '<div class="kpis">' + metrics + '</div>' +
    '<div style="margin-top:26px"><div class="psr">' + psr + '</div></div>' +
    '</header>';
}

/* ── 02 定位 ── */
function positioningBlock(w) {
  const p = w.positioning || {};
  const notFor = (p.notFor || []).map((x) => '<li>' + esc(x) + '</li>').join('');
  return section('02', 'positioning', '产品定位', 'POSITIONING',
    '<div class="pos-grid">' +
      '<div class="pos card pos-for"><h3>为谁做</h3><p>' + esc(p.forWho) + '</p></div>' +
      '<div class="pos card pos-not"><h3>明确不做</h3><ul>' + notFor + '</ul></div>' +
    '</div>' +
    '<p class="pos-why">为什么这样取舍：' + esc(p.why) + '</p>',
    '一个页面该不该有某个功能，先看它服务谁，再看它是否值得维护。');
}

/* ── 03 架构 ── */
function architectureBlock(w) {
  const a = w.architecture || {};
  const rows = (a.layers || []).map((l) =>
    '<div class="arch-row"><div class="arch-key"><b>' + esc(l.name) + '</b><small>' + esc(l.key) + '</small></div>' +
    '<div class="arch-body"><p class="arch-role">' + esc(l.role) + '</p>' +
    '<div class="arch-items">' + (l.items || []).map((i) => '<span>' + esc(i) + '</span>').join('') + '</div></div></div>').join('');

  const flow = (a.flow || []).map((f, i) =>
    (i ? '<span class="flow-arrow">→</span>' : '') + '<span class="flow-step">' + esc(f) + '</span>').join('');

  return section('03', 'architecture', '整体架构', 'ARCHITECTURE',
    '<div class="arch">' + rows + '</div>' +
    '<div class="flow">' + flow + '</div>',
    a.intro);
}

/* ── 04 技术选型 ── */
function stackBlock(w) {
  const rows = (w.stackChoices || []).map((s) =>
    '<tr><td class="ch">' + esc(s.choice) + '</td>' +
    '<td class="why">' + esc(s.why) + '</td>' +
    '<td class="rj">' + esc(s.rejected) + '</td></tr>').join('');
  return section('04', 'stack', '技术选型', 'STACK & TRADE-OFFS',
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    '<th>选择</th><th>为什么</th><th>放弃了什么</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
    '每个选择都写清代价；没有代价的技术选型，通常意味着没想过。');
}

/* ── 05 能力 ── */
function capabilitiesBlock(w) {
  const cards = (w.capabilities || []).map((c) =>
    '<article class="cap"><div class="cap-top"><h3>' + esc(c.name) + '</h3><span class="cap-dot" aria-hidden="true"></span></div>' +
    '<p class="cap-row"><b>解决什么</b>' + esc(c.problem) + '</p>' +
    '<p class="cap-row"><b>怎么实现</b>' + esc(c.how) + '</p>' +
    '<p class="cap-proof">' + esc(c.proof) + '</p></article>').join('');
  return section('05', 'capabilities', '能力拆解', 'WHAT IT DOES',
    '<div class="caps">' + cards + '</div>',
    '六个模块，每个都从「解决什么问题」讲起，最后落到可验证的位置。');
}

/* ── 06 数据链路 ── */
function pipelineBlock(w) {
  const p = w.pipeline || {};
  const steps = (p.steps || []).map((s) =>
    '<div class="step"><span class="step-no">' + esc(s.no) + '</span>' +
    '<h4>' + esc(s.name) + '</h4><p>' + esc(s.desc) + '</p></div>').join('');
  const tree = (p.tree || []).map((t) => esc(t)).join('\n');
  return section('06', 'pipeline', '数据源与实现方案', 'DATA PIPELINE',
    '<div class="steps">' + steps + '</div>' +
    '<div class="tree"><pre>' + tree + '</pre></div>',
    p.title);
}

/* ── 07 难题 ── */
function issuesBlock(w) {
  const cards = (w.issues || []).map((is) => {
    const row = (k, label, cls) => '<div class="issue-row"><span class="issue-k">' + label + '</span>' +
      '<p class="issue-v' + (cls ? ' ' + cls : '') + '">' + esc(is[k]) + '</p></div>';
    return '<article class="issue"><div class="issue-head"><span class="issue-id">' + esc(is.id) + '</span>' +
      '<h3>' + esc(is.title) + '</h3></div><div class="issue-body">' +
      row('symptom', 'SYMPTOM · 症状') +
      row('diagnosis', 'DIAGNOSIS · 诊断') +
      row('fix', 'FIX · 处置') +
      row('result', 'RESULT · 结果', 'is-result') +
      '</div></article>';
  }).join('');
  return section('07', 'issues', '难题档案', 'PROBLEM FILES',
    cards,
    '三个真正卡住过进度的问题：现象、怎么定位、最后怎么解决、留下了什么。');
}

/* ── 08 成果 ── */
function outcomesBlock(w) {
  const o = w.outcomes || {};
  const metrics = (o.metrics || []).map((m) =>
    '<div class="metric"><p class="metric-num">' + esc(m.value) + '<small>' + esc(m.unit) + '</small></p>' +
    '<p class="metric-label">' + esc(m.label) + '</p></div>').join('');
  const ev = (o.evidence || []).map((e) =>
    '<a href="' + esc(e.href) + '"' + (/^https?:/.test(e.href) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(e.label) + ' ↗</a>').join('');
  return section('08', 'outcomes', '成果', 'OUTCOMES',
    '<div class="metrics">' + metrics + '</div>' +
    '<div class="evidence">' + ev + '</div>',
    '数字都来自仓库与线上，点开即可核对。');
}

/* ── 09 亮点 ── */
function highlightsBlock(w) {
  const list = (w.highlights || []).map((h, i) =>
    '<div class="hl"><span class="hl-no">' + String(i + 1).padStart(2, '0') + '</span>' +
    '<div><h3>' + esc(h.title) + '</h3><p>' + esc(h.so) + '</p></div></div>').join('');
  return section('09', 'highlights', '亮点', 'WHY IT WORKS',
    '<div class="hls">' + list + '</div>');
}

/* ── 10 路线 ── */
function roadmapBlock(w) {
  const r = w.roadmap || {};
  const col = (cls, title, items) =>
    '<div class="road-col ' + cls + '"><h3>' + title + '</h3><ul>' +
    (items || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
  return section('10', 'roadmap', '迭代路线', 'ROADMAP',
    '<div class="road">' +
      col('now', 'NOW · 正在做', r.now) +
      col('next', 'NEXT · 接下来', r.next) +
      col('later', 'LATER · 之后', r.later) +
    '</div>');
}

/* ── 11 复盘 ── */
function retroBlock(w) {
  const r = w.retro || {};
  const learned = '<ol>' + (r.learned || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>';
  const reusable = '<ol>' + (r.reusable || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>';
  const links = w.links || {};
  const cta = '<div class="cta" style="margin-top:22px">' +
    '<p>想聊实现细节，或者看别的案例？简历与源码都在外面。</p>' +
    '<div class="hero-actions" style="margin:0">' +
      (links.resume ? '<a class="btn" href="' + esc(links.resume) + '">看网页简历</a>' : '') +
      (links.repo ? '<a class="btn btn-solid" href="' + esc(links.repo) + '" target="_blank" rel="noopener noreferrer">读源码 ↗</a>' : '') +
    '</div></div>';

  return section('11', 'retro', '复盘沉淀', 'RETROSPECTIVE',
    '<blockquote class="quote">' + esc(r.quote) + '</blockquote>' +
    '<div class="retro-grid">' +
      '<div class="retro-col"><h3>LEARNED · 学到了什么</h3>' + learned + '</div>' +
      '<div class="retro-col"><h3>REUSABLE · 沉淀下的资产</h3>' + reusable + '</div>' +
    '</div>' + cta);
}

function renderBody(w, site) {
  return [
    overviewBlock(w, site),
    positioningBlock(w),
    architectureBlock(w),
    stackBlock(w),
    capabilitiesBlock(w),
    pipelineBlock(w),
    issuesBlock(w),
    outcomesBlock(w),
    highlightsBlock(w),
    roadmapBlock(w),
    retroBlock(w),
  ].join('\n');
}

function jsonld(w, site, canonical) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.title,
    alternateName: site.titleEn,
    applicationCategory: 'WebApplication',
    operatingSystem: 'Web',
    url: canonical,
    description: (w.seo || {}).description || '',
    author: { '@type': 'Person', name: '陈培胜' },
    inLanguage: 'zh-CN',
  };
  /* SEO 描述里若出现 </script> 会截断内联 JSON-LD，统一转义尖括号 */
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function renderOne(id, w, site) {
  const tpl = readFileSync(TEMPLATE_FILE, 'utf8');
  const canonical = SITE_ORIGIN + '/work/' + id + '.html';
  const seo = w.seo || {};
  const out = tpl
    .replace(/\{\{WORK_SEO_TITLE\}\}/g, () => esc(seo.title || site.title))
    .replace(/\{\{WORK_SEO_DESC\}\}/g, () => esc(seo.description || w.tagline))
    .replace(/\{\{WORK_OG_DESC\}\}/g, () => esc(seo.ogDescription || seo.description || w.tagline))
    .replace(/\{\{WORK_CANONICAL\}\}/g, () => esc(canonical))
    .replace(/\{\{WORK_JSONLD\}\}/g, () => jsonld(w, site, canonical))
    .replace(/\{\{WORK_NO\}\}/g, () => esc(site.no))
    .replace(/\{\{WORK_TITLE_EN\}\}/g, () => esc(site.titleEn))
    .replace(/\{\{WORK_BODY\}\}/g, () => renderBody(w, site));
  if (/\{\{WORK_[A-Z_]+\}\}/.test(out)) throw new Error('模板里还有未替换的 {{WORK_*}} 占位');
  return out.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + BANNER.join('\n') + '\n');
}

function collect() {
  const site = JSON.parse(readFileSync(SITE_FILE, 'utf8'));
  const details = JSON.parse(readFileSync(DETAILS_FILE, 'utf8'));
  const worksById = {};
  for (const w of site.works || []) if (w.detailId) worksById[w.detailId] = w;
  const jobs = [];
  for (const [id, w] of Object.entries(details.works || {})) {
    const siteWork = worksById[id];
    if (!siteWork) {
      throw new Error('work-details 里有「' + id + '」，但 site-data.json 没有任何 works 条目声明 detailId="' + id + '"');
    }
    jobs.push({ id, w, site: siteWork });
  }
  return jobs;
}

function main() {
  const args = process.argv.slice(2);
  const jobs = collect();
  if (!jobs.length) throw new Error('没有需要生成的案例页');

  if (args.includes('--stdout')) {
    process.stdout.write(jobs[0] ? renderOne(jobs[0].id, jobs[0].w, jobs[0].site) : '');
    return;
  }

  let drift = 0;
  const check = args.includes('--check');
  if (!check) mkdirSync(OUT_DIR, { recursive: true });

  for (const job of jobs) {
    const html = renderOne(job.id, job.w, job.site);
    const file = resolve(OUT_DIR, job.id + '.html');
    if (check) {
      let cur = '';
      try { cur = readFileSync(file, 'utf8'); } catch (e) { cur = ''; }
      if (cur !== html) {
        console.error('[render_work_details] work/' + job.id + '.html 与数据不一致，请运行 node scripts/render_work_details.mjs');
        drift += 1;
      }
    } else {
      writeFileSync(file, html);
      console.log('[render_work_details] 已生成 work/' + job.id + '.html（' + Buffer.byteLength(html) + ' bytes）');
    }
  }

  /* 数据里已删除的案例，把对应文件也清掉，避免线上残留旧页 */
  if (!check && existsSync(OUT_DIR)) {
    const keep = new Set(jobs.map((j) => j.id + '.html'));
    for (const f of readdirSync(OUT_DIR)) {
      if (f.endsWith('.html') && !keep.has(f)) {
        console.log('[render_work_details] 提示：work/' + f + ' 没有对应数据了，请手动删除');
      }
    }
  }

  if (check) {
    if (drift) process.exit(1);
    console.log('[render_work_details] work/*.html 与数据一致 ✓');
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();