/* ──────────────────────────────────────────────────────────────────────
   简历知识库 · 语义层 Worker（resume-kb-api）
   ──────────────────────────────────────────────────────────────────────
   为什么单独开一个 Worker：
     Pages 项目的绑定配置（deployment_configs）目前不支持 Workers AI 与
     Vectorize，只能在 Dashboard 点，脚本无法自动化；而 Worker 的
     wrangler.toml 支持 `[ai]` 与 `[[vectorize]]`，`wrangler deploy` 即可
     生效。于是把「embedding + 向量检索」收进这个小 Worker，由 Pages
     Function `/api/kb` 在服务端调用（不是浏览器调用，所以 *.workers.dev
     在境内不可达也不影响）。

   接口（全部要求 X-KB-Token，仅内部调用）：
     POST /embed  { texts: string[] }        → { vectors: number[][] }
     POST /query  { text, topK? }            → { matches: [{id,score,metadata}] }
     GET  /health                            → { ok: true, model, index }

   免费额度：Workers AI bge-m3（Neurons 配额）与 Vectorize（查询单位）都在
   免费层覆盖；单次 42 片灌库 + 每日问答量级远在阈值内。
   ────────────────────────────────────────────────────────────────────── */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const MODEL = '@cf/baai/bge-m3';
/* 中文问答用 llama-3.3-70b-instruct-fp8-fast：
   实测同一个问题 GLM-4.7-flash 是推理型，586 个 completion token 大半是思维链，
   max_tokens=400 时正文直接为空；llama-3.3 只用 47 token、10.8 neurons 就出答案。
   若要换回 GLM，必须把 max_tokens 提到 1200+，否则答案会被思维链吃光。 */
const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const RERANK_MODEL = '@cf/baai/bge-reranker-base';

import { rebuildKb, kbStatus } from './rebuild.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, model: MODEL, index: 'resume-kb', hasAI: !!env.AI, hasVectorize: !!env.VECTORIZE });
    }

    /* 只有 Pages Function 拿着共享令牌能进；对外不开公网能力 */
    const token = request.headers.get('x-kb-token');
    if (!env.KB_TOKEN || !token || token !== env.KB_TOKEN) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

    if (url.pathname === '/status') {
      return json(await kbStatus(env));
    }

    /* 按 D1 真相源重建知识库（后台保存站点数据后自动调用，也可手动触发）。
       幂等：内容没变就只做一次原地 upsert，不会产生重复切片。 */
    if (url.pathname === '/rebuild') {
      const r = await rebuildKb(env);
      return json(r, r.ok ? 200 : 500);
    }

    if (url.pathname === '/embed') {
      const texts = Array.isArray(body.texts) ? body.texts.slice(0, 50) : [];
      if (!texts.length) return json({ ok: false, error: 'empty texts' }, 400);
      const r = await env.AI.run(MODEL, { text: texts });
      return json({ ok: true, vectors: r.data || [] });
    }

    if (url.pathname === '/query') {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return json({ ok: false, error: 'empty text' }, 400);
      const topK = Math.min(Math.max(Number(body.topK) || 20, 1), 50);
      const emb = await env.AI.run(MODEL, { text: [text] });
      const vector = emb?.data?.[0];
      if (!vector) return json({ ok: false, error: 'embed failed' }, 502);
      const res = await env.VECTORIZE.query(vector, { topK, returnMetadata: 'all', returnValues: false });
      return json({ ok: true, matches: res.matches || [] });
    }

    /* ── /rerank：bge-reranker-base 精排
       混合召回拿的是"可能相关"，精排解决的是"谁最相关"。
       query + 候选正文成对打分，按分重排；模型不可用时上层自动回落 RRF 顺序。 */
    if (url.pathname === '/rerank') {
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      const contexts = Array.isArray(body.contexts) ? body.contexts.slice(0, 20) : [];
      if (!query || !contexts.length) return json({ ok: false, error: 'empty input' }, 400);
      const t0 = Date.now();
      try {
        const r = await env.AI.run(RERANK_MODEL, {
          query,
          contexts: contexts.map((c) => ({ text: String(c).slice(0, 1200) })),
        });
        const scores = (r?.response || []).map((x) => Number(x.score) || 0);
        return json({ ok: true, scores, ms: Date.now() - t0 });
      } catch (e) {
        return json({ ok: false, error: 'rerank unavailable: ' + (e && e.message ? e.message : 'unknown') }, 502);
      }
    }

    if (url.pathname === '/chat') {
      const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
      if (!messages.length) return json({ ok: false, error: 'empty messages' }, 400);
      const model = typeof body.model === 'string' ? body.model : DEFAULT_CHAT_MODEL;
      const t0 = Date.now();
      try {
        const r = await env.AI.run(model, {
          messages,
          max_tokens: Math.min(Math.max(Number(body.max_tokens) || 400, 128), 1200),
          temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2,
        });
        /* Workers AI 走 OpenAI 兼容结构时正文在 choices[0].message.content */
        /* 三种返回形态都兜：OpenAI 兼容 message.content、旧版 response、choices[0].text */
        const text = String(r?.choices?.[0]?.message?.content || r?.response || r?.choices?.[0]?.text || '').trim();
        if (!text) return json({ ok: false, error: 'empty-text', model, ms: Date.now() - t0 }, 502);
        return json({ ok: true, model, text, usage: r?.usage || null, ms: Date.now() - t0 });
      } catch (e) {
        const message = e && e.message ? e.message : 'unknown';
        return json({ ok: false, error: 'ai-run-failed: ' + message, model, ms: Date.now() - t0 }, 502);
      }
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};
