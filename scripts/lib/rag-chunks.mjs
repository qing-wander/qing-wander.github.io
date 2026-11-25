/* ──────────────────────────────────────────────────────────────────────
   RAG 切片构建 · 共享纯函数
   ──────────────────────────────────────────────────────────────────────
   两个调用方：
     · scripts/build_rag_chunks.mjs  本地生成 chunks.json / 种子 SQL
     · worker/kb/rebuild.mjs          云端按 D1 真相源重建知识库

   只做「数据对象 → 切片」，不读写文件、不发网络请求，方便两边复用。
   ────────────────────────────────────────────────────────────────────── */
import { createHash } from 'node:crypto';
import { stripTags, tokenText, tokenize } from './rag-tokenize.mjs';

export const SOURCE_PATH = 'data/site-data.json';
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

export function buildChunks(data, opts = {}) {
  const sourcePath = opts.sourcePath || SOURCE_PATH;
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
    source_path: `${sourcePath}#/hero`,
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
      source_path: `${sourcePath}#/objective/cards`,
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
      source_path: `${sourcePath}#/resume/experience`,
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
      source_path: `${sourcePath}#/resume/education`,
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
      source_path: `${sourcePath}#/resume/education/verify`,
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
        source_path: `${sourcePath}#/resume/experience/${ei}/bullets/${bi}`,
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
      source_path: `${sourcePath}#/resume/projects/${pi}`,
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
        source_path: `${sourcePath}#/resume/projects/${pi}/bullets/${bi}`,
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
      source_path: `${sourcePath}#/resume/skills/${si}`,
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
      source_path: `${sourcePath}#/works/${wi}`,
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
      source_path: `${sourcePath}#/contact/cards`,
    });
  }

  const canonical = JSON.stringify(chunks.map((c) => [c.id, c.text]));
  const kbVersion = 'kb-' + createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  const withVersion = chunks.map((c) => ({ ...c, kb_version: kbVersion }));

  return {
    kb_version: kbVersion,
    generated_from: sourcePath,
    count: withVersion.length,
    total_chars: withVersion.reduce((n, c) => n + c.text.length, 0),
    chunks: withVersion,
  };
}

/* ── D1 种子 SQL：切片 + 词面索引，可重复执行 ── */
export function seedSQL(payload) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = [
    '-- AUTO-GENERATED by scripts/lib/rag-chunks.mjs —— 请勿手改',
    `-- kb_version: ${payload.kb_version} · chunks: ${payload.count}`,
    '-- 应用：npx wrangler d1 execute portfolio-db --remote --file=<RAG_OUT_DIR>/kb-chunks.seed.sql',
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
      `INSERT INTO kb_fts (chunk_id, tokens) VALUES (${q(c.id)}, ${q(ftsTokens(c))});`,
    );
  }
  return lines.join('\n') + '\n';
}

/* 词频表：每条需求做 IDF 加权覆盖判定时用（通用词 df 高 → 权重低，专业词权重高）。
   42 片的小语料，df 直接从切片算，不用外部统计。 */
export function termsOf(payload) {
  const df = new Map();
  for (const c of payload.chunks) {
    const toks = new Set(tokenize(c.title + ' ' + c.title + ' ' + c.text));
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

export function termsSQL(payload) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const df = termsOf(payload);
  const lines = [
    '-- AUTO-GENERATED by scripts/lib/rag-chunks.mjs —— 请勿手改',
    `-- kb_version: ${payload.kb_version} · terms: ${df.size} · docs: ${payload.count}`,
    '-- 应用：npx wrangler d1 execute portfolio-db --remote --file=<RAG_OUT_DIR>/kb-terms.seed.sql',
    '',
    'DELETE FROM kb_terms;',
    '',
  ];
  for (const [term, n] of [...df.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`INSERT INTO kb_terms (term, df, n_docs) VALUES (${q(term)}, ${n}, ${payload.count});`);
  }
  return lines.join('\n') + '\n';
}

/* ── 供 Worker 直接写库的结构化行（比拼 SQL 安全，走参数绑定） ── */

export function ftsTokens(chunk) {
  return tokenText(chunk.title + ' ' + chunk.title + ' ' + chunk.text);
}

export function chunkRows(payload) {
  return payload.chunks.map((c) => ({
    chunk: c,
    fts: ftsTokens(c),
    vectorText: `${c.title}\n${c.text}`.slice(0, 1800),
  }));
}

export function termRows(payload) {
  const df = termsOf(payload);
  return [...df.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([term, n]) => ({ term, df: n, n_docs: payload.count }));
}
