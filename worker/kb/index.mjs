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

    return json({ ok: false, error: 'not found' }, 404);
  },
};
