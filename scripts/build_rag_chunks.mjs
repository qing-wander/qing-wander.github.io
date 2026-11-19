#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   RAG 切片构建 · build_rag_chunks.mjs
   ──────────────────────────────────────────────────────────────────────
   真相源：data/site-data.json（只读，不改内容）
   产物：  rag/chunks.json        检索用切片（带稳定 ID 与元数据）
           rag/kb-chunks.seed.sql D1 落库种子（kb_chunks + kb_fts 词面索引）

   为什么单独起一条链：
     knowledge/chunks.json 是腾讯云线上问答在用的 TF-IDF 语料，ID 按顺序编号
     （exp-01-01），内容一改顺序就漂。RAG 需要的是「能回链到原文」的稳定 ID，
     所以这里直接用 bullet id（exp-inmen-01 / proj-comein-03）当切片 id。

   用法：
     node scripts/build_rag_chunks.mjs            写盘
     node scripts/build_rag_chunks.mjs --check    只比对，漂移则退出码 1（CI 用）
     node scripts/build_rag_chunks.mjs --report   打印切片清单
   ────────────────────────────────────────────────────────────────────── */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTags, tokenText, tokenize } from './lib/rag-tokenize.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data/site-data.json');
const OUT_DIR = resolve(ROOT, 'rag');
const OUT_CHUNKS = resolve(OUT_DIR, 'chunks.json');
const OUT_SEED = resolve(OUT_DIR, 'kb-chunks.seed.sql');

const SOURCE_PATH = 'data/site-data.json';
const PUBLIC_VISIBILITY = 'public';
const LANG = 'zh';

/* 标签词典：只做技术名词归集，不生成任何原文没有的结论 */
const TAG_RULES = [
  ['Agent 基座', /agent\s*基座|通用\s*agent|qwenpaw|opencode/i],
  ['Multi-Agent', /multi-?agent|supervisor|re-?act|多智能体/i],
  ['LangGraph', /langgraph/i],
  ['LangChain', /langchain/i],
  ['LlamaIndex', /llamaindex/i],
  ['RAG', /\brag\b|检索增强|few-shot/i],
  ['MCP', /\bmcp\b/i],
  ['云沙箱', /沙箱|sandbox/i],
  ['AI 计费', /计费|账单校准|预扣/i],
  ['Flink', /flink/i],
  ['Kafka', /kafka/i],
  ['Milvus', /milvus/i],
  ['Redis', /redis/i],
  ['评测体系', /评测|langfuse|langsmith|埋点/i],
  ['SSE 流式', /\bsse\b|流式/i],
  ['IM 网关', /\bim\b|网关|飞书|企微|钉钉/i],
  ['支付', /stripe|支付|对账|订阅/i],
  ['海外触达', /tiktok|whatsapp|邮件|resend|sendgrid|\bses\b|送达率|预热/i],
  ['数据仓库', /dataworks|数仓|画像|知识库/i],
  ['Java 后端', /\bjava\b|jvm|spring/i],
  ['Python', /\bpython\b/i],
  ['Golang', /\bgolang\b|\bgo\b/i],
  ['TypeScript', /typescript|node/i],
  ['前端', /前端|react|vue/i],
];

const tagsOf = (text) => {
  const t = stripTags(text);
  return TAG_RULES.filter(([, re]) => re.test(t)).map(([name]) => name).slice(0, 6);
};

const clean = (html) => stripTags(html).trim();
const period = (p) => String(p || '').replace(/\s*—\s*/g, '—');

export function buildChunks(data) {
  const r = data.resume || {};
  const chunks = [];
  const seen = new Set();

  const push = (chunk) => {
    if (!chunk.id) throw new Error('切片缺少 id');
    if (seen.has(chunk.id)) throw new Error('切片 id 重复：' + chunk.id);
    seen.add(chunk.id);
    const text = chunk.text.trim();
    if (!text) throw new Error(`${chunk.id} 正文为空`);
    chunks.push({
      id: chunk.id,
      kind: chunk.kind,
      section: chunk.section,
      entity_id: chunk.entity_id || chunk.id,
      entity_type: chunk.entity_type,
      title: chunk.title,
      text,
      url: chunk.url,
      tags: tagsOf(text),
      visibility: PUBLIC_VISIBILITY,
      lang: LANG,
      source_path: chunk.source_path,
    });
  };

  /* ── 个人定位 ── */
  const name = r.basics?.name || data.hero?.nameCn || '';
  const role = r.basics?.role || data.hero?.role || '';
  const bio = data.hero?.bio || '';
  const lead = clean(data.about?.lead || '');
  push({
    id: 'me-01',
    kind: 'profile',
    section: 'about',
    entity_id: 'me',
    entity_type: 'person',
    title: `${name} · ${role}`,
    text: `【${name} · ${role}】${bio} ${lead}`.replace(/\s+/g, ' '),
    url: 'index.html#about',
    source_path: `${SOURCE_PATH}#/hero`,
  });

  const cards = (data.objective?.cards || []).map((c) =>
    `${c.tag}：${c.role || c.roleSm}${c.roleSub ? ' · ' + c.roleSub : ''}——${c.desc}`);
  if (cards.length) {
    push({
      id: 'me-02',
      kind: 'profile',
      section: 'objective',
      entity_id: 'me',
      entity_type: 'person',
      title: `${name} · 求职意向与到岗`,
      text: `【${name} · 求职意向】${cards.join(' ')}`,
      url: 'index.html#objective',
      source_path: `${SOURCE_PATH}#/objective/cards`,
    });
  }

  const stats = (data.about?.stats || []).map((s) => `${s.count}${s.suffix || ''} ${s.label}`);
  const companies = (r.experience || []).map((e) => `${e.company}（${e.role} · ${period(e.period)}）`);
  if (companies.length) {
    push({
      id: 'me-03',
      kind: 'profile',
      section: 'experience',
      entity_id: 'me',
      entity_type: 'person',
      title: `${name} · 履历总览`,
      text: `【${name} · 履历总览】${stats.length ? stats.join(' · ') + '。' : ''}企业经历：${companies.join('；')}。`,
      url: 'resume.html',
      source_path: `${SOURCE_PATH}#/resume/experience`,
    });
  }

  /* ── 教育 ── */
  const edu = r.education || {};
  if (edu.school) {
    const bullets = (edu.bullets || []).map((b) => clean(b.html)).join(' ');
    push({
      id: 'edu-main',
      kind: 'education',
      section: 'education',
      entity_id: 'edu',
      entity_type: 'education',
      title: `${edu.school} · ${edu.note || ''}`.trim(),
      text: `【${edu.school} · ${period(edu.period)}】${edu.note || ''}。${bullets}`,
      url: 'resume.html',
      source_path: `${SOURCE_PATH}#/resume/education`,
    });
  }
  if (edu.verify?.code) {
    push({
      id: 'edu-verify',
      kind: 'education',
      section: 'education',
      entity_id: 'edu',
      entity_type: 'certificate',
      title: `${edu.verify.label}`,
      text: `【${edu.school} · 学历验证】${edu.verify.label}：${edu.verify.code}。${edu.verify.tip || ''}`,
      url: 'resume.html',
      source_path: `${SOURCE_PATH}#/resume/education/verify`,
    });
  }

  /* ── 工作经历：一条 bullet 一片，id 直接用 bullet id ── */
  (r.experience || []).forEach((e, ei) => {
    (e.bullets || []).forEach((b, bi) => {
      push({
        id: b.id,
        kind: 'experience_bullet',
        section: 'experience',
        entity_id: e.id,
        entity_type: 'experience',
        title: `${e.company} · ${e.role}`,
        text: `【${e.company} · ${e.role} · ${period(e.period)}】${clean(b.html)}`,
        url: 'resume.html',
        source_path: `${SOURCE_PATH}#/resume/experience/${ei}/bullets/${bi}`,
      });
    });
  });

  /* ── 项目：先放一句定位（lead），再逐条 bullet ── */
  (r.projects || []).forEach((p, pi) => {
    push({
      id: `${p.id}-lead`,
      kind: 'project_lead',
      section: 'projects',
      entity_id: p.id,
      entity_type: 'project',
      title: `${p.name} · ${p.subtitle || ''}`.trim(),
      text: `【${p.name} · ${p.subtitle || ''} · ${period(p.period)}】${p.lead || ''}`,
      url: 'resume.html',
      source_path: `${SOURCE_PATH}#/resume/projects/${pi}`,
    });
    (p.bullets || []).forEach((b, bi) => {
      push({
        id: b.id,
        kind: 'project_bullet',
        section: 'projects',
        entity_id: p.id,
        entity_type: 'project',
        title: `${p.name} · ${p.subtitle || ''}`.trim(),
        text: `【${p.name} · ${p.subtitle || ''} · ${period(p.period)}】${clean(b.html)}`,
        url: 'resume.html',
        source_path: `${SOURCE_PATH}#/resume/projects/${pi}/bullets/${bi}`,
      });
    });
  });

  /* ── 技能组：main + sub 合成一片，技能名进标题 ── */
  (r.skills || []).forEach((s, si) => {
    push({
      id: s.id,
      kind: 'skill_group',
      section: 'skills',
      entity_id: s.id,
      entity_type: 'skill',
      title: `专业技能 · ${s.name}`,
      text: `【专业技能 · ${s.name}】${clean(s.main)} ${clean(s.sub)}`.replace(/\s+/g, ' '),
      url: 'resume.html',
      source_path: `${SOURCE_PATH}#/resume/skills/${si}`,
    });
  });

  /* ── 首页作品：每个作品一片（含技术栈） ── */
  (data.works || []).forEach((w, wi) => {
    const tech = (w.tech || []).join(' · ');
    push({
      id: 'work-' + String(w.no || wi + 1).toLowerCase().replace(/[^a-z0-9]/g, ''),
      kind: 'work',
      section: 'works',
      entity_id: w.no || `work-${wi}`,
      entity_type: 'work',
      title: `${w.title} · ${w.titleEn || ''}`.trim(),
      text: `【作品 · ${w.title} · ${tech}】${w.desc || ''}`,
      url: 'index.html#works',
      source_path: `${SOURCE_PATH}#/works/${wi}`,
    });
  });

  /* ── 联系方式：白名单，手机号永不进库 ── */
  const contactBits = [];
  (data.contact?.cards || []).forEach((c) => {
    if (/tel|电话|手机/i.test(c.label + (c.href || ''))) return;
    if (!c.value) return;
    contactBits.push(`${c.label.replace(/\s*\/\s*/, ' / ')}：${c.value}`);
  });
  const email = (r.basics?.lines || []).flat().find((t) => t.href && t.href.startsWith('mailto:'));
  if (email && !/邮箱/.test(contactBits.join(''))) contactBits.push(`邮箱：${email.text}`);
  if (contactBits.length) {
    push({
      id: 'contact-01',
      kind: 'contact',
      section: 'contact',
      entity_id: 'contact',
      entity_type: 'contact',
      title: `${name} · 公开联系方式`,
      text: `【${name} · 联系方式】${contactBits.join('；')}。`,
      url: 'index.html#contact',
      source_path: `${SOURCE_PATH}#/contact/cards`,
    });
  }

  const canonical = JSON.stringify(chunks.map((c) => [c.id, c.text]));
  const kbVersion = 'kb-' + createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  const withVersion = chunks.map((c) => ({ ...c, kb_version: kbVersion }));

  return {
    kb_version: kbVersion,
    generated_from: SOURCE_PATH,
    count: withVersion.length,
    total_chars: withVersion.reduce((n, c) => n + c.text.length, 0),
    chunks: withVersion,
  };
}

/* ── D1 种子 SQL：切片 + 词面索引，可重复执行 ── */
export function seedSQL(payload) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = [
    '-- AUTO-GENERATED by scripts/build_rag_chunks.mjs —— 请勿手改',
    `-- kb_version: ${payload.kb_version} · chunks: ${payload.count}`,
    '-- 应用：npx wrangler d1 execute portfolio-db --remote --file=rag/kb-chunks.seed.sql',
    '',
    'DELETE FROM kb_chunks;',
    'DELETE FROM kb_fts;',
    '',
  ];
  for (const c of payload.chunks) {
    lines.push(
      'INSERT INTO kb_chunks (id, kind, section, entity_id, entity_type, title, text, url, tags, visibility, lang, kb_version, source_path) VALUES (' +
      [
        q(c.id), q(c.kind), q(c.section), q(c.entity_id), q(c.entity_type), q(c.title),
        q(c.text), q(c.url), q(JSON.stringify(c.tags)), q(c.visibility), q(c.lang),
        q(c.kb_version), q(c.source_path),
      ].join(', ') + ');',
    );
    lines.push(
      `INSERT INTO kb_fts (chunk_id, tokens) VALUES (${q(c.id)}, ${q(tokenText(c.title + ' ' + c.title + ' ' + c.text))});`,
    );
  }
  return lines.join('\n') + '\n';
}

/* 词频表：每条需求做 IDF 加权覆盖判定时用（通用词 df 高 → 权重低，专业词权重高）。
   42 片的小语料，df 直接从切片算，不用外部统计。 */
export function termsSQL(payload) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const df = new Map();
  for (const c of payload.chunks) {
    const toks = new Set(tokenize(c.title + ' ' + c.title + ' ' + c.text));
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const lines = [
    '-- AUTO-GENERATED by scripts/build_rag_chunks.mjs —— 请勿手改',
    `-- kb_version: ${payload.kb_version} · terms: ${df.size} · docs: ${payload.count}`,
    '-- 应用：npx wrangler d1 execute portfolio-db --remote --file=rag/kb-terms.seed.sql',
    '',
    'DELETE FROM kb_terms;',
    '',
  ];
  for (const [term, n] of [...df.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`INSERT INTO kb_terms (term, df, n_docs) VALUES (${q(term)}, ${n}, ${payload.count});`);
  }
  return lines.join('\n') + '\n';
}

const serialise = (payload) => JSON.stringify(payload, null, 2) + '\n';

function main() {
  const args = process.argv.slice(2);
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const payload = buildChunks(data);
  const json = serialise(payload);
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
    const okJson = existsSync(OUT_CHUNKS) && readFileSync(OUT_CHUNKS, 'utf8') === json;
    const okSql = existsSync(OUT_SEED) && readFileSync(OUT_SEED, 'utf8') === sql;
    const OUT_TERMS = resolve(OUT_DIR, 'kb-terms.seed.sql');
    const okTerms = existsSync(OUT_TERMS) && readFileSync(OUT_TERMS, 'utf8') === terms;
    if (!okJson || !okSql || !okTerms) {
      console.error(`::error::RAG 切片产物与 data/site-data.json 不一致（${[!okJson && 'chunks.json', !okSql && 'kb-chunks.seed.sql', !okTerms && 'kb-terms.seed.sql'].filter(Boolean).join('、')}）`);
      console.error('修法：node scripts/build_rag_chunks.mjs');
      process.exit(1);
    }
    console.log(`✓ RAG 切片一致：${payload.count} 片 · ${payload.kb_version}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_CHUNKS, json);
  writeFileSync(OUT_SEED, sql);
  writeFileSync(resolve(OUT_DIR, 'kb-terms.seed.sql'), terms);
  console.log(`✓ 写出 ${payload.count} 片（${payload.total_chars} 字）· ${payload.kb_version}`);
  console.log(`  rag/chunks.json · rag/kb-chunks.seed.sql · rag/kb-terms.seed.sql`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
