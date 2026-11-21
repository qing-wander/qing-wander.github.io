/* ──────────────────────────────────────────────────────────────────────
   简历问答助手 · Cloudflare Pages Function（路由 /api/chat）
   ──────────────────────────────────────────────────────────────────────
   链路：问题 → /api/kb 同款混合检索（D1 FTS5 + Vectorize，RRF）→
         拼「只准依据片段」的提示词 → Worker resume-kb-api /chat（GLM-4.7-flash）→
         落 qa_logs（后台用来提炼用户都在问什么）

   为什么答案必须带 citations：作品集问答最怕模型自由发挥编个「阿里」出来。
   接口返回命中切片 id 列表，前端可以把「依据：proj-comein-01」挂出来，
   用户点开就能看到原文，对不上的地方一眼能发现。

   防幻觉靠四层，不靠提示词自觉：
     ① 检索层：覆盖闸门 + 相似度窗口（没有相关片段就不给模型任何资料）
     ② 空召回短路：hits=0 直接回固定话术，模型根本不参与，杜绝「没料硬编」
     ③ 提示词：公司名/学历/时间/数字照抄，未出现的直接说没有
     ④ 出参：citations 原样返回，页面可回链原文

   接口：
     POST /api/chat { q, top? , device_id? }  → { answer, citations[], empty, ms }
     OPTIONS

   环境变量：
     KB_WORKER_URL / KB_TOKEN   语义层 Worker 地址与共享令牌（已在 Pages 项目配置）
     DB                         D1（qa_logs / rate_limits）
   ────────────────────────────────────────────────────────────────────── */
import { retrieve } from './kb.js';
import { matchJD } from './jd.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const MODEL_LABEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';   // 推理型模型（GLM-4.7-flash 等）会把 token 烧在思维链上，别换

/* 主站 github.io 是纯静态托管，问答/JD 需要跨站调用这里的函数。
   没有 ACAO 时浏览器会先被 OPTIONS 预检拦掉，表现为前端「通道暂时不可用」；
   这里与 wall.js / deliver.js 用同一套来源白名单口径。 */
const DEFAULT_ORIGINS = [
  'https://shenge-work.github.io',
  'https://shenge-work.pages.dev',
  '*.shenge-work.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8877',
  'http://127.0.0.1:8877',
];

function allowedOrigins(env) {
  return String(env?.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, allow) {
  const o = String(origin || '').trim();
  if (!o) return false;
  const host = o.replace(/^https?:\/\//, '');
  return allow.some((rule) => {
    if (rule === o) return true;
    if (rule.indexOf('*.') === 0) {
      const suffix = rule.slice(1);
      return host.length > suffix.length && host.slice(-suffix.length) === suffix;
    }
    return false;
  });
}

function corsHeaders(request, env) {
  const origin = request?.headers?.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin, allowedOrigins(env))) h['Access-Control-Allow-Origin'] = String(origin).trim();
  return h;
}

const NO_HIT_ANSWER = '简历里没写这块，我不替候选人多说。要不你换个角度问，比如他做过的项目、技术栈或者工作经历？';

const LIMIT_PER_HOUR = 60;   // 单 IP 每小时问答上限，防刷模型额度
const MAX_Q = 200;           // 问题长度上限

/* 提示词里写死「不许动」的字段：这些是 resume.meta L0 锁定项，
   模型一旦改写（把「深圳进门财经科技股份有限公司」压成「进门财经」）就会失真。 */
export const LOCKED_FIELDS = '公司全称、岗位名称、起止时间、学校名称、学历、专业、以及片段里出现的任何数字';

/* 后台可配：admin_config 里 resume_chat 的 {model, prompt}。
   提示词只能「追加」，不能删掉 L0 硬约束 —— 运营可以调语气和长度，不能放开公司全称。 */
async function readChatConfig(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'resume_chat'").first();
    if (!row) return {};
    const v = JSON.parse(row.value);
    return { model: v.model, prompt: v.prompt };
  } catch (e) {
    return {};
  }
}

export function buildMessages(q, hits, extraPrompt) {
  const material = hits.map((h) => `[${h.id}] ${h.title ? h.title + '｜' : ''}${h.text}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        '你是陈培胜个人作品集里的简历问答助手，面向招聘方。',
        '只允许依据下面给出的【资料片段】回答；不得使用片段之外的知识，不得推测、补充、美化。',
        `硬约束：${LOCKED_FIELDS}必须原样照抄，一个字都不许改、不许缩写、不许合并。`,
        '片段里没有的信息，直接说「简历里没写这块」，不要编一个看起来合理的答案。',
        '回答用简体中文，2-4 句，口语，像人在介绍同事；不要小标题、不要罗列、不要重复整段原文。',
        '不要提「根据资料片段」这类话，直接说事。',
        extraPrompt ? `运营补充要求：${extraPrompt}` : '',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: `【资料片段】\n${material}\n\n【问题】${q}` },
  ];
}

async function callWorker(messages, env, model) {
  if (!env.KB_WORKER_URL || !env.KB_TOKEN) return { ok: false, reason: 'no-worker' };
  const r = await fetch(`${env.KB_WORKER_URL.replace(/\/$/, '')}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KB-Token': env.KB_TOKEN },
    body: JSON.stringify({ messages, max_tokens: 400, temperature: 0.2, ...(model ? { model } : {}) }),
  }).catch(() => null);
  if (!r || !r.ok) return { ok: false, reason: 'worker-http' };
  const d = await r.json().catch(() => ({}));
  return d.ok ? { ok: true, text: d.text, ms: d.ms } : { ok: false, reason: d.error || 'worker-bad' };
}

/* 简易限流：直接数 qa_logs 里这一小时该 IP 的请求数，够用且不需要额外表 */
async function overLimit(ipHash, env) {
  if (!env.DB || !ipHash) return false;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM qa_logs WHERE ip_hash = ?1 AND ts > ?2',
  ).bind(ipHash, Date.now() - 3600_000).first().catch(() => null);
  return (row?.n || 0) >= LIMIT_PER_HOUR;
}

async function logQa(env, row) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO qa_logs (ts, query, answer, hit_ids, hit_count, empty, model, ms, ip_hash, device_hash)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
  ).bind(row.ts, row.query, row.answer, row.hitIds, row.hitCount, row.empty ? 1 : 0,
    row.model, row.ms, row.ipHash, row.deviceHash).run().catch(() => null);
}

async function hashIp(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  if (!ip) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, request, env); }

  /* 页面上的旧契约发的是 { question }，这里两种字段都收，省得前端为一个字段改两处 */
  /* JD 匹配与问答共用同一端点（页面就是这么发的），按 mode 分流 */
  if (body.mode === 'jd') {
    const jd = String(body.jd || '').trim().slice(0, 1500);
    if (jd.length < 20) return json({ ok: false, error: 'JD 太短，贴完整的岗位职责与任职要求' }, 400, request, env);
    const r = await matchJD(jd, env);
    return json(r, r.ok ? 200 : 400, request, env);
  }

  const q = String(body.q || body.question || '').trim().slice(0, MAX_Q);
  if (!q) return json({ ok: false, error: 'missing q' }, 400, request, env);

  const ipHash = await hashIp(request);
  if (await overLimit(ipHash, env)) {
    return json({ ok: false, error: 'rate limited', answer: '问得有点快，歇一分钟再问？' }, 429, request, env);
  }

  const top = Math.min(Math.max(Number(body.top) || 4, 1), 6);
  const r = await retrieve(q, env, top);

  /* ② 空召回短路：没有资料就不叫模型，避免「没料硬编」 */
  if (!r.hits.length) {
    await logQa(env, {
      ts: Date.now(), query: q, answer: NO_HIT_ANSWER, hitIds: '', hitCount: 0,
      empty: true, model: '-', ms: Date.now() - t0, ipHash, deviceHash: body.device_id ? 'dev' : '',
    });
    return json({ ok: true, answer: NO_HIT_ANSWER, citations: [], sources: [], empty: true, ms: Date.now() - t0 }, 200, request, env);
  }

  const cfg = await readChatConfig(env);
  const call = await callWorker(buildMessages(q, r.hits, cfg.prompt), env, cfg.model);
  const answer = call.ok ? call.text : '这条我暂时答不上来（模型服务不可用），你可以直接看页面上的原文。';
  /* citations 带上切片原文（截 400 字）：前端「依据」可展开核对，
     这是「可验证」承诺的另一半 —— 只有 id 的来源用户没法自己查证 */
  const citations = r.hits.map((h) => ({
    id: h.id, title: h.title, section: h.section, source_path: h.source_path,
    text: String(h.text || '').slice(0, 400),
  }));

  await logQa(env, {
    ts: Date.now(), query: q, answer, hitIds: citations.map((c) => c.id).join(','),
    hitCount: citations.length, empty: false, model: call.ok ? MODEL_LABEL : '-',
    ms: Date.now() - t0, ipHash, deviceHash: body.device_id ? 'dev' : '',
  });

  /* sources 是页面既有渲染逻辑认的字段（取 title 显示成标签），citations 给新版/后台用 */
  return json({
    ok: true, answer,
    citations,
    sources: citations.map((c) => ({ title: c.title || c.id, id: c.id, path: c.source_path, excerpt: String(c.text || '').slice(0, 300) })),
    empty: false, semantic: r.semantic, ms: Date.now() - t0,
  }, 200, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, {
    status: 204,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) },
  });
}

const json = (data, status = 200, request = null, env = {}) => new Response(
  JSON.stringify(data),
  { status, headers: { ...JSON_HEADERS, ...(request ? corsHeaders(request, env) : {}) } },
);
