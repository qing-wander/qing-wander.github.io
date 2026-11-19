/* /api/config —— 每个 AI 模块的模型与提示词
   ──────────────────────────────────────────────────────────────
   GET  列出模块（默认值 + 已存值），前端按模块渲染配置卡
   POST 保存单个模块 { key, model, prompt }

   为什么默认值写在代码里：新部署 / 新库也能直接跑，不用先灌种子。
   存 D1 而不是 Git：提示词是运营参数，改完立刻对线上生效；Git 里存的是简历内容。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, json, fail, requireAdmin } from '../../lib/admin.js';

/* 允许配置的模块 —— 白名单，避免前端随手塞个 key 进来污染库 */
export const MODULES = {
  resume_chat: {
    title: '简历问答（/api/chat）',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    note: '基于检索到的简历片段作答；空召回不调模型',
    prompt: '你是这份简历的问答助手。只能依据给定片段回答，不得编造。片段里没有的信息直接说“简历里没写这块”。回答控制在 3 句以内，引用片段用 [id] 标注。',
    max: 2000,
  },
  jd_match: {
    title: 'JD 匹配判定（/api/jd）',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    note: '一次调用判完所有需求点，严格 JSON 输出',
    prompt: '你是招聘匹配评估器。对每个需求点判断 coverage（covered/partial/gap），并给出证据片段 id。只输出 JSON，不要解释。',
    max: 2000,
  },
  summary_rewrite: {
    title: '简介改写（rewrite_summary.mjs）',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    note: '只改个人简介；数字/英文术语/语义块护栏由脚本判，不看模型脸色',
    prompt: '你是简历文案编辑。不得新增任何事实（数字、金额、公司名、产品名）；不得删除原文已有的事实点，尤其是团队/机构背景定位短语；保留全部英文术语原样；输出 ≤200 汉字，一段话，只输出正文。',
    max: 2000,
  },
  variant_plan: {
    title: '变体选材（plan_variant.mjs）',
    model: '本地 BM25（无模型）',
    note: '选材走算法，保证同一 JD 出同一份单子',
    prompt: '选材阶段不调用模型：JD 当查询在切片上跑 BM25，按阈值 × 最高分保留。',
    max: 2000,
  },
};

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  try {
    const rows = await env.DB.prepare('SELECT key, value, updated_at FROM admin_config').all();
    const stored = new Map((rows.results || []).map((r) => [r.key, r]));
    const modules = Object.keys(MODULES).map((key) => {
      const def = MODULES[key];
      let saved = {};
      try { saved = stored.has(key) ? JSON.parse(stored.get(key).value) : {}; } catch (e) { saved = {}; }
      return {
        key,
        title: def.title,
        note: def.note,
        model: saved.model || def.model,
        prompt: saved.prompt || def.prompt,
        is_default: !stored.has(key),
        updated_at: stored.has(key) ? stored.get(key).updated_at : 0,
      };
    });
    return json({ ok: true, modules });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }
  const key = String(body.key || '');
  const def = MODULES[key];
  if (!def) return fail('bad_key', '未知模块');
  const model = String(body.model || '').trim().slice(0, 120);
  const prompt = String(body.prompt || '').trim();
  if (!model) return fail('bad_model', '模型不能为空');
  if (!prompt) return fail('bad_prompt', '提示词不能为空');
  if (prompt.length > def.max) return fail('too_long', `提示词超过 ${def.max} 字`);
  try {
    await env.DB.prepare(
      `INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, JSON.stringify({ model, prompt }), Date.now()).run();
    return json({ ok: true, key, model, prompt });
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}

/* 给运行时读配置用（其他 Function 可 import 这个函数） */
export async function readModule(env, key) {
  const def = MODULES[key];
  if (!def) return null;
  try {
    const row = await env.DB.prepare('SELECT value FROM admin_config WHERE key = ?').bind(key).first();
    const saved = row ? JSON.parse(row.value) : {};
    return { model: saved.model || def.model, prompt: saved.prompt || def.prompt };
  } catch (e) {
    return { model: def.model, prompt: def.prompt };
  }
}
