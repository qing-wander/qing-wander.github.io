/* 知识库同步（Pages → KB Worker）
   ──────────────────────────────────────────────────────────────
   数据真相源在 D1，切片/向量由 worker/kb 的 /rebuild 在云端重建。
   这里只负责「带令牌调一下」，业务侧不关心实现细节：

     · kbWorkerReady(env)          是否配了 KB_WORKER_URL / KB_TOKEN
     · callKbWorker(env, path, ..) 通用调用（失败不抛，返回结构化结果）
     · syncKb(env)                 触发重建，供 waitUntil 兜底调用

   设计原则：知识库是「锦上添花」——同步失败绝不能让保存数据失败，
   也不能让访客端白屏。所有异常都收敛成 { ok:false, error, message }。
   ────────────────────────────────────────────────────────────── */

export function kbWorkerReady(env) {
  return !!(env && env.KB_WORKER_URL && env.KB_TOKEN);
}

function baseUrl(env) {
  return String((env && env.KB_WORKER_URL) || '').replace(/\/+$/, '');
}

export async function callKbWorker(env, path, opts = {}) {
  if (!kbWorkerReady(env)) {
    return {
      ok: false,
      error: 'not_configured',
      message: '未配置 KB_WORKER_URL / KB_TOKEN，知识库不会自动重建（词面检索仍可用）',
    };
  }
  const url = baseUrl(env) + path;
  const timeout = opts.timeout || 25000;
  try {
    const res = await fetch(url, {
      method: opts.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KB-Token': String(env.KB_TOKEN),
      },
      body: opts.body === undefined ? '{}' : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data) {
      return { ok: false, error: 'bad_response', message: `知识库服务返回了非 JSON（HTTP ${res.status}）` };
    }
    if (!res.ok && data.ok !== false) data.ok = false;
    if (!res.ok && !data.message) data.message = `知识库服务 HTTP ${res.status}`;
    return data;
  } catch (e) {
    const msg = e && e.name === 'TimeoutError'
      ? '知识库服务超时（内容较大时可能需要 30 秒以上，稍后看状态即可）'
      : (e && e.message ? e.message : '调用知识库服务失败');
    return { ok: false, error: 'network', message: msg };
  }
}

/* 保存站点数据后的后台触发：不阻塞响应，失败只写日志 */
export function syncKb(env) {
  return callKbWorker(env, '/rebuild').then((r) => {
    if (!r.ok) console.warn('[kb-sync]', r.error || 'failed', r.message || '');
    return r;
  }).catch(() => ({ ok: false, error: 'unknown' }));
}
