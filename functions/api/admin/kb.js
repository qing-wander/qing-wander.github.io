/* /api/admin/kb —— 知识库状态与手动重建
   ──────────────────────────────────────────────────────────────
   GET  读取 D1 里的知识库状态（切片数 / 版本 / 是否落后于站点数据）
   POST 调 worker/kb 的 /rebuild，按 D1 真相源重建切片 + 向量

   为什么走 Worker：Workers AI / Vectorize 的绑定在 worker/kb 里
   （Pages 项目的 deployment_configs 不支持这两类绑定）。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, fail, json, requireAdmin } from '../../lib/admin-auth.js';
import { callKbWorker, kbWorkerReady } from '../../lib/kb-sync.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;

  if (!env.DB) return json({ ok: false, error: 'db_not_bound', message: '没有绑定 D1' }, 503);

  try {
    const agg = await env.DB
      .prepare('SELECT COUNT(*) AS n, MAX(kb_version) AS ver, MAX(updated_at) AS up FROM kb_chunks')
      .first();
    const terms = await env.DB.prepare('SELECT COUNT(*) AS n FROM kb_terms').first();
    const src = await env.DB.prepare("SELECT updated_at FROM site_content WHERE key = 'site-data'").first();
    const updatedAt = Number(agg && agg.up) || 0;
    const sourceAt = src ? Number(src.updated_at) || 0 : 0;
    return json({
      ok: true,
      count: Number(agg && agg.n) || 0,
      terms: Number(terms && terms.n) || 0,
      kb_version: (agg && agg.ver) || '',
      updated_at: updatedAt,
      source_updated_at: sourceAt,
      stale: !!(sourceAt && updatedAt < sourceAt),
      worker_ready: kbWorkerReady(env),
    });
  } catch (e) {
    return json({
      ok: false,
      error: 'db_not_ready',
      message: 'kb_chunks 表不存在，先执行 db/schema.sql',
    }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  /* 两条鉴权路径：
     ① 后台会话（浏览器点按钮）——requireAdmin + CSRF
     ② 运维令牌（命令行 / 部署脚本）：X-KB-Token 与 env.KB_TOKEN 相同即可。
        Worker 是 workers.dev，境内直连不通，所以给运维留一条走本站域名的口子。 */
  const serviceToken = request.headers.get('X-KB-Token') || '';
  const byService = !!(env.KB_TOKEN && serviceToken && serviceToken === env.KB_TOKEN);

  if (!byService) {
    const deny = await requireAdmin(request, env);
    if (deny) return deny;
    const csrf = assertCsrf(request);
    if (csrf) return csrf;
  }

  if (!kbWorkerReady(env)) {
    return fail('not_configured', '未配置 KB_WORKER_URL / KB_TOKEN，无法重建知识库');
  }

  const r = await callKbWorker(env, '/rebuild', { timeout: 30000 });
  if (!r.ok) {
    return json({ ok: false, error: r.error || 'rebuild_failed', message: r.message || '重建失败' }, 502);
  }
  return json(r);
}
