/* ──────────────────────────────────────────────────────────────────────
   JD 匹配 · Cloudflare Pages Function（路由 /api/jd，同时被 /api/chat 的 jd 模式复用）
   ──────────────────────────────────────────────────────────────────────
   与腾讯云那套的区别：
     · 召回换成混合检索（D1 FTS5 BM25 + Vectorize cosine，RRF 融合），不做大模型"感觉一下"
     · 判定是**字面可核验**的：每条要求都算出「正文覆盖了它多少个词」，不靠模型打分
     · 因此 0 次 LLM 调用（除追问文案外都是模板），单次 1-3 秒，且完全可复现

   判定口径（每条需求点一行）：
     covered  覆盖：命中片段里出现了该要求 ≥60% 的词，且召回得分进前 3
     partial  部分：30%-60%，或只命中通用词（如"熟悉""经验"）
     gap      缺口：<30%，档案里确实没有这块

   总分：covered=1 / partial=0.55 / gap=0 取平均 → 0-100。敢列缺口比满分有说服力。

   入参：POST { jd }（≤1500 字）
   出参（与页面 js/jd-match.js 既有契约一致）：
     { ok, match:{ overall:{score,verdict,summary}, stats:{covered,partial,gap},
                   rows:[{req,status,evidence:[{point,title,id}],gap,probe}] },
       meta:{requirements,recalled,ms} }
   ────────────────────────────────────────────────────────────────────── */
import { retrieve, tokenize } from './kb.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const MAX_JD = 1500;
const MAX_REQ = 14;
const CONCURRENCY = 6;      // 同时打多少条需求的召回，太高会被 D1/Vectorize 排队
const TOP_K = 4;            // 每条需求取前 4 片：覆盖判定用并集，多一片能救回跨段落的要求

/* df ≤ 3 的词视为「稀有」：idf = ln(1 + (42 - 3 + 0.5) / (3 + 0.5)) ≈ 2.39。
   一条要求如果连一个稀有词都没命中，说明只是「负责 / 管理 / 经验」这种通用词撞上了，
   最多判 partial，不能算覆盖。 */
const RARE_IDF = 2.39;
/* 词表里没有的词 = 档案从未出现过 = 最稀有。以前错给成最低权重 1，
   结果「发票 / 增值税 / 中级会计师」几乎不扣分，反而「企业」(df=2) 权重很高，
   把一份财务 JD 抬到 44 分。现在按 df=0 的理论上限罚。 */
const UNSEEN_IDF = Math.log(1 + (42 + 0.5) / 0.5);

/* 通用词：命中它们不算"有这块经验"，否则「熟悉」「经验」「负责」会让所有要求都变 covered */
const STOPWORDS = new Set([
  '熟悉', '了解', '掌握', '负责', '参与', '具备', '以上', '优先', '经验', '能力', '相关',
  '工作', '岗位', '要求', '职责', '负责', '良好', '优秀', '团队', '业务', '系统', '开发',
  /* 跨领域通用名词：财务 JD 会因为这些词撞上技术档案，反之亦然 */
  '企业', '成本', '平台', '服务', '数据', '流程', '方案', '项目', '产品', '客户', '行业',
]);

export function splitRequirements(jd) {
  const lines = String(jd || '').replace(/\r/g, '').split(/\n+/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    for (const seg of line.split(/[；;]/)) {
      let s = seg
        .replace(/^\s*(?:[-•·*—]|\(?\d{1,2}[.、)）]|[（(]\d{1,2}[)）])\s*/, '')
        .replace(/\s+/g, ' ')
        .replace(/[。，,、：:]+$/, '')
        .trim();
      if (s.length < 4) continue;
      if (s.length > 90) s = s.slice(0, 90);
      /* 「任职要求」「岗位职责」这类标题不是需求点，混进来会把分母拉爆、分数失真 */
      if (/^(?:岗位|职位|任职要求|任职资格|岗位职责|工作职责|工作内容|团队方向|职位描述|加分项|优先条件)\s*[：:]?$/.test(s)) continue;
      if (/^(?:岗位|职位|团队方向|项目方向)\s*[：:]/.test(s)) continue;
      if (seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(s);
      if (out.length >= MAX_REQ) return out;
    }
  }
  return out;
}

/* 内容词：去掉通用词与单字，剩下的才是「这条要求到底要什么」 */
export function contentTokens(text) {
  return Array.from(new Set(tokenize(text))).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

/* 一条要求在给定片段里的覆盖率。
   ratio 用 IDF 加权：通用词（df 高）几乎不贡献，专业词（df 低）权重高，
   所以「熟悉」「系统」这类词撑不起一条要求，而「多租户」「Milvus」能。 */
export function coverageOf(req, chunkText, idfMap = new Map()) {
  return coverageOfSet(req, [chunkText], idfMap);
}

/* 多片段并集覆盖：一条要求常被拆在「技能片 + 项目片」两处，
   只看单片段会把「本科 + Java + 5 年经验」这种明显满足的要求判成部分匹配。 */
export function coverageOfSet(req, texts, idfMap = new Map()) {
  const reqTokens = contentTokens(req);
  if (!reqTokens.length) return { ratio: 0, hit: 0, total: 0 };
  const hay = new Set(texts.flatMap((t) => tokenize(t || '')));
  const w = (t) => (idfMap.has(t) ? idfMap.get(t) : UNSEEN_IDF);
  const total = reqTokens.reduce((sum, t) => sum + w(t), 0) || 1;
  let matched = 0;
  let hit = 0;
  let rare = 0;                                  // 命中稀有词（df ≤ 3）的个数
  for (const t of reqTokens) {
    if (!hay.has(t)) continue;
    matched += w(t);
    hit += 1;
    if (w(t) >= RARE_IDF) rare += 1;
  }
  return { ratio: matched / total, hit, total: reqTokens.length, rare };
}

/* 一次把这条 JD 涉及的所有词频捞回来（一条 SQL 一批，避免 N 次往返） */
export async function loadIdf(reqs, env) {
  const terms = Array.from(new Set(reqs.flatMap((r) => contentTokens(r))));
  if (!terms.length || !env.DB) return new Map();
  const map = new Map();
  const N = 42;   // 切片总数；kb_terms 里也存了 n_docs，这里只做常数
  for (let i = 0; i < terms.length; i += 80) {
    const batch = terms.slice(i, i + 80);
    const ph = batch.map((_, k) => `?${k + 1}`).join(',');
    const rows = await env.DB.prepare(`SELECT term, df FROM kb_terms WHERE term IN (${ph})`)
      .bind(...batch).all().catch(() => null);
    for (const r of rows?.results || []) {
      map.set(r.term, Math.log(1 + (N - r.df + 0.5) / (r.df + 0.5)));
    }
  }
  return map;
}

/* 判定以「稀有词命中数」为主、覆盖率为辅：
   长 JD 一句话十几个词，全句覆盖率天然低，但"有没有这块能力"其实由少数专业词决定。
     · ≥2 个稀有词 + 覆盖率 ≥0.35 → 覆盖
     · ≥1 个稀有词 + 覆盖率 ≥0.55 → 覆盖（长句里大部分词都中了）
     · ≥1 个稀有词 → 部分
     · 0 个稀有词 → 缺口（只是通用词撞上而已） */
export function statusOfMatch(rare, ratio) {
  if (rare >= 2 && ratio >= 0.35) return 'covered';
  if (rare >= 1 && ratio >= 0.55) return 'covered';
  if (rare >= 1) return 'partial';
  return 'gap';
}

export function statusOf(ratio) {
  if (ratio >= 0.55) return 'covered';
  if (ratio >= 0.25) return 'partial';
  return 'gap';
}

/* 证据里的「点」：取片段正文第一个短句，太长就截断，方便对照表一眼看懂 */
function pointOf(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const first = flat.split(/[。；;]/)[0] || flat;
  return first.length > 46 ? first.slice(0, 46) + '…' : first;
}

/* 缺口说明：把要求里最"实"的词列出来，告诉用户缺的是哪块，而不是笼统说"不匹配" */
function gapOf(req) {
  const tokens = Array.from(new Set(tokenize(req))).filter((t) => !STOPWORDS.has(t) && t.length > 1);
  return tokens.length ? `档案里没有对应段落（缺 ${tokens.slice(0, 3).join('、')}）` : '档案里没有对应段落';
}

const verdictOf = (score) =>
  score >= 80 ? '高度匹配' : score >= 60 ? '基本匹配' : score >= 35 ? '部分匹配' : '差距较大';

function summaryOf(stats) {
  return `${stats.covered} 条要求有直接证据，${stats.partial} 条部分对应，${stats.gap} 条是缺口。缺口照实列出，可据此判断要不要补材料。`;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
}

/* 让模型在一次调用里判完所有需求点（不是每条一次，省额度也省延迟）。
   片段带 id，模型只能对着这些片段判；解析失败就退回确定性判定。 */
const JUDGE_SYSTEM = [
  '你是招聘匹配评估器，任务是拿候选人档案片段去核对 JD 需求点。',
  '逐条判定，只允许三档：',
  '  covered —— 片段里有直接对应的事实（技术名词、做过的事、数量级都对得上）',
  '  partial —— 相关但只覆盖一部分，或方向相近不等于做过',
  '  gap     —— 片段里没有对应事实',
  '只依据给定片段判断，不得推测、不得补全；片段提到相似但不相同的东西必须判 partial。',
  '输出严格 JSON 数组，不要解释、不要代码块、不要多余文字，格式：',
  '[{"i":0,"status":"covered"},{"i":1,"status":"gap"}]',
].join('\n');

/* 后台可配：admin_config.jd_match 的 {model, prompt}。
   提示词只能追加在判定规则之后 —— 判定口径（covered/partial/gap + 严格 JSON）不允许被运营改掉。 */
async function readJdConfig(env) {
  try {
    const row = await env.DB?.prepare("SELECT value FROM admin_config WHERE key = 'jd_match'").first();
    if (!row) return {};
    const v = JSON.parse(row.value);
    return { model: v.model, prompt: v.prompt };
  } catch (e) {
    return {};
  }
}

export function buildJudgeMessages(requirements, hitsByReq, extraPrompt) {
  const material = requirements.map((req, i) => {
    const ev = (hitsByReq[i] || []).slice(0, 2)
      .map((h) => `  [${h.id}] ${(h.title ? h.title + '｜' : '')}${String(h.text || '').slice(0, 110)}`)
      .join('\n');
    return `#${i} 需求：${req}\n${ev || '  （无片段）'}`;
  }).join('\n\n');
  return [
    { role: 'system', content: extraPrompt ? JUDGE_SYSTEM + '\n运营补充要求：' + extraPrompt : JUDGE_SYSTEM },
    { role: 'user', content: `候选人档案片段与 JD 需求点：\n\n${material}\n\n请逐条输出判定 JSON。` },
  ];
}

export function parseJudge(text, n) {
  const raw = String(text || '');
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let arr;
  try { arr = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = new Array(n).fill(null);
  for (const item of arr) {
    const i = Number(item?.i);
    const st = String(item?.status || '');
    if (i >= 0 && i < n && ['covered', 'partial', 'gap'].includes(st)) out[i] = st;
  }
  return out;
}

async function judgeByModel(requirements, hitsByReq, env, cfg) {
  if (!env.KB_WORKER_URL || !env.KB_TOKEN) return null;
  cfg = cfg || {};
  const r = await fetch(`${env.KB_WORKER_URL.replace(/\/$/, '')}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KB-Token': env.KB_TOKEN },
    body: JSON.stringify({
      messages: buildJudgeMessages(requirements, hitsByReq, cfg.prompt),
      max_tokens: 600, temperature: 0,
      ...(cfg.model ? { model: cfg.model } : {}),
    }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.ok ? parseJudge(d.text, requirements.length) : null;
}

export async function matchJD(jd, env) {
  const t0 = Date.now();
  const requirements = splitRequirements(jd);
  if (!requirements.length) return { ok: false, error: 'empty jd' };

  const idfMap = await loadIdf(requirements, env);
  const results = await pool(requirements, CONCURRENCY, (req) => retrieve(req, env, TOP_K, { relax: true, noRerank: false }));

  const rows = requirements.map((req, i) => {
    const hits = results[i]?.hits || [];
    if (!hits.length) {
      return { req, status: 'gap', evidence: [], gap: gapOf(req), probe: `他能胜任「${req.slice(0, 18)}」这块吗？` };
    }
    const texts = hits.map((h) => `${h.title || ''} ${h.text || ''}`);
    const union = coverageOfSet(req, texts, idfMap);
    const ev = hits.map((h, k) => {
      const c = coverageOf(req, texts[k], idfMap);
      return { point: pointOf(h.text), title: h.title || h.id, id: h.id, ratio: c.ratio };
    });
    const status = statusOfMatch(union.rare, union.ratio);   // 兜底判定
    return {
      req,
      status,
      /* 证据永远给前 2，哪怕单片覆盖率不高——对照表要让人能点开原文自己判断 */
      evidence: status === 'gap' ? [] : ev.slice(0, 2),
      gap: status === 'gap' ? gapOf(req) : '',
      probe: status === 'covered' ? '' : `他在「${req.slice(0, 16)}」上的具体做法？`,
    };
  });

  /* 模型判定优先：词表小的时候 df 不可靠（「审计」只出现一次也被当专业词），
     单靠覆盖率会把财务 JD 判成 55 分。模型一次调用判完，解析失败才用兜底结果。 */
  const jdCfg = await readJdConfig(env);
  const judged = await judgeByModel(requirements, results.map((r) => r?.hits || []), env, jdCfg);
  if (judged) {
    rows.forEach((row, i) => {
      if (!judged[i]) return;
      row.status = judged[i];
      row.gap = judged[i] === 'gap' ? gapOf(row.req) : '';
      if (judged[i] === 'gap') row.evidence = [];
    });
  }

  const stats = { covered: 0, partial: 0, gap: 0 };
  for (const r of rows) stats[r.status] += 1;
  const score = Math.round(((stats.covered + stats.partial * 0.55) / rows.length) * 100);
  const recalled = new Set(rows.flatMap((r) => r.evidence.map((e) => e.id))).size;

  return {
    ok: true,
    match: {
      overall: { score, verdict: verdictOf(score), summary: summaryOf(stats) },
      stats,
      rows,
    },
    meta: { requirements: requirements.length, recalled, judge: judged ? 'model' : 'auto', ms: Date.now() - t0 },
  };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const jd = String(body.jd || '').trim().slice(0, MAX_JD);
  if (jd.length < 20) return json({ ok: false, error: 'JD 太短，贴完整的岗位职责与任职要求' }, 400);
  const r = await matchJD(jd, env);
  if (!r.ok) return json(r, 400);
  return json(r);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
