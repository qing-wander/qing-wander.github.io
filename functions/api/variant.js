/* POST /api/variant —— 贴 JD 直接出「同版式简历变体」
   ──────────────────────────────────────────────────────────────
   输入：{ jd }（≥20 字）
   输出：{ ok, html, stats }  —— html 与正式 resume.html 同一模板，只换选材

   为什么放在边缘侧：后台要一键出变体，不该依赖本地跑脚本。
   模板与渲染函数由 scripts/embed_assets.mjs 生成到 functions/lib/，
   与 resume.html 的产出逐字节一致（有测试守着）。

   铁律不变：只删 bullet，不改文案；基本信息 / 教育 / 公司全称 / 时间一律不动，
   渲染前后逐字段比对，掉一个字段就直接 500，不返回半成品。
   ────────────────────────────────────────────────────────────── */
import { render } from '../lib/resume-render.js';
import siteData from '../lib/site-data.js';

const KEEP_RATIO = 0.15;
const MAX_EXP_BULLETS = 3;
const MAX_PROJECTS = 4;
const MAX_PROJ_BULLETS = 3;
const MAX_JD = 2000;

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/* 查询分词：中文 bigram + 英文/数字整词，与检索侧同源规则 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  const cjk = s.replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  for (const seg of cjk.split(' ')) {
    if (!seg) continue;
    if (/^[\u4e00-\u9fa5]+$/.test(seg)) {
      if (seg.length === 1) out.add(seg);
      for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
    } else if (seg.length >= 2) {
      out.add(seg);
    }
  }
  return [...out];
}

/* BM25：k1=1.2 / b=0.75，标题字段加权 ×2（与 /api/kb 的口径一致） */
function bm25(docs, query) {
  const q = tokenize(query);
  if (!q.length) return [];
  const N = docs.length;
  const df = new Map();
  const dl = [];
  const tf = [];
  for (const d of docs) {
    const toks = tokenize((d.title || '') + ' ' + (d.text || ''));
    const titleToks = tokenize(d.title || '');
    const f = new Map();
    for (const t of toks) f.set(t, (f.get(t) || 0) + 1);
    for (const t of titleToks) f.set(t, (f.get(t) || 0) + 1); // 标题再算一遍 = 加权
    for (const t of f.keys()) df.set(t, (df.get(t) || 0) + 1);
    tf.push(f);
    dl.push([...toks].length + [...titleToks].length || 1);
  }
  const avgdl = dl.reduce((a, b) => a + b, 0) / N;
  const rows = docs.map((d, i) => {
    let score = 0;
    for (const t of q) {
      const f = tf[i].get(t) || 0;
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * dl[i] / avgdl));
    }
    return { id: d.id, score };
  });
  return rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

function l0(resume) {
  return JSON.stringify({
    basics: resume.basics,
    education: resume.education,
    identity: resume.experience.map((e) => ({ id: e.id, company: e.company, companyNote: e.companyNote, role: e.role, period: e.period })),
    projects: resume.projects.map((p) => ({ id: p.id, name: p.name, url: p.url, subtitle: p.subtitle, period: p.period })),
  });
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
  const jd = String(body.jd || '').trim().slice(0, MAX_JD);
  if (jd.length < 20) return json({ ok: false, error: 'jd_too_short', message: 'JD 至少 20 字' }, 400);
  if (!env.DB) return json({ ok: false, error: 'db_not_bound' }, 503);

  let chunks = [];
  try {
    const r = await env.DB.prepare('SELECT id, title, text FROM kb_chunks').all();
    chunks = r.results || [];
  } catch (e) {
    return json({ ok: false, error: 'kb_unavailable' }, 503);
  }
  if (!chunks.length) return json({ ok: false, error: 'kb_empty' }, 503);

  const scored = bm25(chunks, jd);
  if (!scored.length) return json({ ok: false, error: 'no_overlap', message: '这份 JD 与档案没有交集' }, 400);

  const top = scored[0].score;
  const keepIds = new Set(scored.filter((s) => s.score >= top * KEEP_RATIO).map((s) => s.id));
  const scoreOf = (id) => scored.find((s) => s.id === id)?.score || 0;

  const source = siteData;
  const variant = structuredClone(source);
  const r = variant.resume;
  const before = l0(source.resume);

  const dropped = [];

  r.experience = r.experience.map((exp) => {
    const bullets = (exp.bullets || []).map((b) => ({ id: b.id, score: scoreOf(b.id) }));
    let picked = bullets.filter((b) => keepIds.has(b.id)).sort((a, b) => b.score - a.score).slice(0, MAX_EXP_BULLETS);
    if (!picked.length) picked = bullets.slice(0, 2);
    for (const b of bullets) if (!picked.some((k) => k.id === b.id)) dropped.push({ id: b.id, section: 'experience', entity: exp.id });
    return { ...exp, bullets: exp.bullets.filter((b) => picked.some((k) => k.id === b.id)) };
  });

  const projScore = (p) => (p.bullets || []).reduce((sum, b) => sum + scoreOf(b.id), 0);
  const keptProjects = [...r.projects].sort((a, b) => projScore(b) - projScore(a)).slice(0, MAX_PROJECTS);
  const keptIds = new Set(keptProjects.map((p) => p.id));
  for (const p of r.projects) if (!keptIds.has(p.id)) dropped.push({ id: p.id, section: 'project', entity: p.id, reason: '版面预算' });

  r.projects = r.projects.filter((p) => keptIds.has(p.id)).map((p) => {
    const bullets = (p.bullets || []).map((b) => ({ id: b.id, score: scoreOf(b.id) }));
    let picked = bullets.filter((b) => keepIds.has(b.id)).sort((a, b) => b.score - a.score).slice(0, MAX_PROJ_BULLETS);
    if (!picked.length) picked = bullets.slice(0, 2);
    for (const b of bullets) if (!picked.some((k) => k.id === b.id)) dropped.push({ id: b.id, section: 'project', entity: p.id });
    return { ...p, bullets: p.bullets.filter((b) => picked.some((k) => k.id === b.id)) };
  });

  /* 技能按 JD 命中度重排，只换顺序 */
  const skillOrder = [...r.skills].sort((a, b) => scoreOf(b.id) - scoreOf(a.id)).map((g) => g.id);
  const byId = new Map(r.skills.map((g) => [g.id, g]));
  r.skills = skillOrder.map((id) => byId.get(id)).filter(Boolean);

  if (l0(r) !== before) {
    return json({ ok: false, error: 'l0_changed', message: '内部错误：L0 字段被改动，已中止' }, 500);
  }
  if (r.experience.some((e) => !e.bullets.length)) {
    return json({ ok: false, error: 'empty_experience', message: '有经历段被删空，已中止' }, 500);
  }

  const html = render(variant);
  const bulletsBefore = source.resume.experience.reduce((n, e) => n + e.bullets.length, 0)
    + source.resume.projects.reduce((n, p) => n + p.bullets.length, 0);
  const bulletsAfter = r.experience.reduce((n, e) => n + e.bullets.length, 0)
    + r.projects.reduce((n, p) => n + p.bullets.length, 0);

  return json({
    ok: true,
    html,
    stats: {
      bullets_before: bulletsBefore,
      bullets_after: bulletsAfter,
      bullets_dropped: bulletsBefore - bulletsAfter,
      projects: r.projects.length,
      projects_total: source.resume.projects.length,
      dropped: dropped.length,
      bytes: html.length,
      top_score: Number(top.toFixed(2)),
      skills_order: skillOrder,
    },
  });
}
