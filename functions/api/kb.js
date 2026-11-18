/* ──────────────────────────────────────────────────────────────────────
   简历知识库检索 API · Cloudflare Pages Function（路由 /api/kb）
   ──────────────────────────────────────────────────────────────────────
   一层接口，两路召回，RRF 融合：
     ① 词面：D1 `kb_fts`（写入端已把中文切成 bigram，这里只做 MATCH 拼接）
     ② 语义：Vectorize `resume-kb`（bge-m3 1024 维 cosine）——可选，
             有 AI 绑定或 CF_API_TOKEN 才启用，否则退化为纯词面。

   为什么用 RRF 而不是直接比分数：BM25 与 cosine 不同量纲，硬加权要调参；
   RRF（k=60）只看名次不看绝对分，天然稳。

   防幻觉的四道闸门（都在这一层做，模型层只负责组织语言）：
     · 覆盖闸门：命中 token < 2 不返回（短查询放宽到 1）
     · 意图赦免：问「几年经验 / 换过几家公司 / 学历 / 联系 / 技能」这类口语问题时，
                 对应章节放宽到 1，避免明明有料却空召回
     · 相似度地板：语义命中 cosine < 0.55 视为噪音（bge-m3 对无关文本也有 ~0.45-0.52 底噪，
                 实测「他会 Kubernetes 吗」撞出 0.50 的假命中，必须靠地板挡掉）
     · 空召回直答：两路都没料 → 返回 empty，前端回「简历里没写这块」，不许模型编

   接口：
     GET /api/kb?q=…&top=5&debug=1   → 命中切片（id / 标题 / 正文 / 来源路径 / 分数）
     OPTIONS                          → CORS 预检

   环境变量（全部可选，缺了就降级，不报错）：
     AI                 Workers AI 绑定（首选，走 env.AI.run）
     CF_API_TOKEN       没绑定时的兜底：直接打 Workers AI + Vectorize REST
     CF_ACCOUNT_ID      默认内置
   ────────────────────────────────────────────────────────────────────── */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const MODEL = '@cf/baai/bge-m3';
const INDEX = 'resume-kb';
const DEFAULT_ACCOUNT = 'ead07d9f00f8e2ac69055a81cc198382';
const RRF_K = 60;
const SIM_FLOOR = 0.55;

const CJK = /[\u4e00-\u9fff]/;

/* 与 scripts/lib/rag-tokenize.mjs 同源：中文按字 bigram，英数按整词。
   Functions 目录不能跨目录 import（Pages 会把每个 .js 当路由入口），所以这里内联一份。 */
export function tokenize(text) {
  const out = [];
  const s = String(text || '').toLowerCase();
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (CJK.test(c)) {
      const next = s[i + 1];
      if (next && CJK.test(next)) out.push(c + next);
      i += 1;
    } else if (/[a-z0-9]/.test(c)) {
      let w = '';
      while (i < s.length && /[a-z0-9+#./-]/.test(s[i])) { w += s[i]; i += 1; }
      if (w) out.push(w);
    } else {
      i += 1;
    }
  }
  return out;
}

/* 口语问法的章节意图：命中后放宽覆盖闸门，并给同章节结果一点名次补偿 */
const INTENTS = [
  { re: /(几年|多少年|工作经历|履历|几家公司|换过|就职|任职)/, sections: ['experience', 'about'] },
  { re: /(项目|作品)/, sections: ['projects', 'works'] },
  { re: /(学历|毕业|学校|专业|大学|奖学金|统招)/, sections: ['education'] },
  { re: /(联系|邮箱|电话|微信|github|作品集)/i, sections: ['contact'] },
  { re: /(技能|技术栈|会什么|熟悉什么)/, sections: ['skills'] },
];

export const hintedSections = (query) =>
  new Set(INTENTS.filter((i) => i.re.test(query)).flatMap((i) => i.sections));

/** RRF 融合：只看名次，rffScore = Σ 1/(K + rank) */
export function rrf(lists, k = RRF_K) {
  const acc = new Map();
  for (const { items, weight = 1 } of lists) {
    items.forEach((id, idx) => {
      acc.set(id, (acc.get(id) || 0) + weight / (k + idx + 1));
    });
  }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score }));
}

async function embed(query, env) {
  if (env.AI?.run) {
    const r = await env.AI.run(MODEL, { text: [query] });
    return r?.data?.[0] || null;
  }
  const tk = env.CF_API_TOKEN;
  if (!tk) return null;
  const acct = env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [query] }),
  });
  const d = await r.json().catch(() => ({}));
  return d?.result?.data?.[0] || null;
}

async function semanticSearch(query, env, top = 20) {
  const vec = await embed(query, env).catch(() => null);
  if (!vec) return null;
  if (env.VECTORIZE?.query) {
    const r = await env.VECTORIZE.query(vec, { topK: top, returnMetadata: 'all', returnValues: false });
    return (r?.matches || []).filter((m) => m.score >= SIM_FLOOR).map((m) => m.id);
  }
  const tk = env.CF_API_TOKEN;
  if (!tk) return null;
  const acct = env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/vectorize/v2/indexes/${INDEX}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: vec, topK: top, returnValues: false, returnMetadata: 'all' }),
  });
  const d = await r.json().catch(() => ({}));
  return (d?.result?.matches || []).filter((m) => m.score >= SIM_FLOOR).map((m) => m.id);
}

/* 词面：把 token 拼成 OR 查询（FTS5 的 MATCH 语法里 OR 必须大写） */
async function lexicalSearch(tokens, env, top = 20) {
  if (!env.DB || !tokens.length) return [];
  const expr = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
  const rows = await env.DB.prepare(
    'SELECT chunk_id, bm25(kb_fts) AS s FROM kb_fts WHERE tokens MATCH ?1 ORDER BY s LIMIT ?2',
  ).bind(expr, top).all();
  return (rows?.results || []).map((r) => ({ id: r.chunk_id, bm25: r.s }));
}

async function loadChunks(ids, env) {
  if (!ids.length || !env.DB) return [];
  const ph = ids.map((_, i) => `?${i + 1}`).join(',');
  const rows = await env.DB.prepare(
    `SELECT id, section, entity_id, entity_type, title, text, source_path, kb_version
       FROM kb_chunks WHERE id IN (${ph})`,
  ).bind(...ids).all();
  return rows?.results || [];
}

export async function retrieve(query, env, top = 5) {
  const tokens = Array.from(new Set(tokenize(query)));
  const hints = hintedSections(query);
  const floor = tokens.length <= 2 ? 1 : 2;

  const [lex, rawSem] = await Promise.all([
    lexicalSearch(tokens, env),
    semanticSearch(query, env).catch(() => null),
  ]);
  /* Vectorize 的 id 带 kb_version: 前缀（便于新旧版本共存），D1 里是不带前缀的主键 */
  const sem = rawSem ? rawSem.map((id) => String(id).replace(/^[^:]+:/, '')) : null;

  /* 覆盖闸门：一条结果在正文里要打中足够多的 query token 才算数。
     先取回候选正文，再逐个核对命中数（D1 里没有份量统计表，这样最省事）。 */
  const candIds = Array.from(new Set([...lex.map((r) => r.id), ...(sem || [])]));
  if (!candIds.length) return { hits: [], tokens, semantic: !!sem };
  const rows = await loadChunks(candIds, env);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const cover = (row) => {
    const hay = tokenize(`${row.title || ''} ${row.title || ''} ${row.text || ''}`);
    let hit = 0;
    for (const t of tokens) if (hay.includes(t)) hit += 1;
    return hit;
  };
  const need = (row) => (hints.has(row.section) ? 1 : floor);

  const lexList = lex.map((r) => r.id).filter((id) => {
    const row = byId.get(id);
    return row && cover(row) >= need(row);
  });
  const semList = (sem || []).filter((id) => {
    const row = byId.get(id);
    return row && cover(row) >= need(row);
  });

  const fused = rrf([
    { items: lexList, weight: 1 },
    ...(semList.length ? [{ items: semList, weight: 1 }] : []),
  ]).slice(0, top);

  return {
    hits: fused.map((f) => {
      const row = byId.get(f.id);
      return { id: f.id, rrf: Number(f.score.toFixed(5)), ...row };
    }),
    tokens,
    semantic: !!(sem && sem.length),
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const top = Math.min(Math.max(Number(url.searchParams.get('top') || 5), 1), 10);
  if (!q) return new Response(JSON.stringify({ ok: false, error: 'missing q' }), { status: 400, headers: JSON_HEADERS });
  const r = await retrieve(q, env, top);
  return new Response(JSON.stringify({
    ok: true, q, semantic: r.semantic, tokens: r.tokens,
    count: r.hits.length,
    hits: r.hits.length ? r.hits : [],
    empty: r.hits.length === 0,   // true → 前端直接回「简历里没写这块」
  }), { headers: JSON_HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}
