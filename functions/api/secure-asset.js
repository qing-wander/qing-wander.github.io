/* /api/secure-asset —— 短时效签名链接 → 私有材料取流
   ──────────────────────────────────────────────────────────────────────
   这是「加密材料」链路里唯一能碰到原件二进制的出口。前端刷新 / 续签时
   拿到的 URL 全部指向这里，而不是对象存储的裸地址。

   每次请求都会重新校验：
     ① URL 签名（绑定申请 ID + 材料 ID + 设备 + 过期秒 + 资源）；
     ② 过期时间（默认 5 分钟，且不允许更长的有效期）；
     ③ D1 里该申请确实已批准、未超 24 小时、设备一致；
     ④ 材料确实属于该资源且已上传；
     ⑤ 单个授权每分钟取流次数（防止拿到链接后疯狂刷对象存储）。

   响应一律 no-store，且不带任何存储后端的地址 / 密钥信息。
   ────────────────────────────────────────────────────────────────────── */
import { allowedOrigins, corsHeaders, gate, JSON_HEADERS, minuteKey } from '../lib/guard.js';
import { findMaterial, readAsset } from '../lib/secure-assets.js';
import {
  approvalState, ASSET_RATE_PER_MIN, parseResource, verifyAssetToken,
} from '../lib/secure-access.js';

const ID_RE = /^[0-9a-f]{32}$/i;
const AID_RE = /^[a-z0-9_-]{1,64}$/i;
const SIG_RE = /^[0-9a-f]{64}$/i;

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({}, JSON_HEADERS, extra || {}),
  });
}

function csrfHeaders(origin, env) {
  return corsHeaders(origin, allowedOrigins(env), 'GET, OPTIONS');
}

function deny(origin, env, code, status) {
  return json({ ok: false, error: code }, status, csrfHeaders(origin, env));
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: csrfHeaders(origin, context.env),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const q = url.searchParams;
  const rid = String(q.get('rid') || '').trim();
  const aid = String(q.get('aid') || '').trim();
  const exp = String(q.get('exp') || '').trim();
  const dev = String(q.get('dev') || '').trim();
  const sig = String(q.get('sig') || '').trim();

  if (!ID_RE.test(rid) || !AID_RE.test(aid) || !/^\d{10}$/.test(exp) || !SIG_RE.test(sig)) {
    return deny(origin, env, 'bad_request', 400);
  }
  if (!env.DB) return deny(origin, env, 'not_configured', 503);

  /* ① 申请状态：只用签名链接里的 rid 查库，resource / device 一律以库为准，
        避免攻击者自己拼一个「已批准的资源」来取别的材料。 */
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT status, school_id, approved_at, meta FROM verify_access_requests WHERE id = ?'
    ).bind(rid).first();
  } catch (e) {
    return deny(origin, env, 'db_error', 503);
  }
  if (!row) return deny(origin, env, 'not_found', 404);

  const resource = parseResource(row.school_id);
  const state = approvalState(row, Date.now(), dev);
  if (state.status !== 'approved' || state.deviceMismatch) {
    return deny(origin, env, state.deviceMismatch ? 'device_mismatch' : 'not_authorized', 403);
  }

  /* ② 签名必须在知道真实 resource 之后验，签名里含 resource 与设备 */
  if (!(await verifyAssetToken({ rid, aid, exp, dev, sig, resource }, env))) {
    return deny(origin, env, 'invalid_signature', 403);
  }

  /* ③ 材料归属与状态 */
  const material = findMaterial(resource, aid);
  if (!material || material.status !== 'available') {
    return deny(origin, env, 'asset_not_found', 404);
  }

  /* ④ 限流：D1 异常时放行（与站内其它限流一致，不把正常访问打死） */
  if (env.DB) {
    try {
      const win = minuteKey();
      const count = await gate(env.DB, 'secure-asset:' + rid, win, ASSET_RATE_PER_MIN, 120);
      /* gate: 0 = 超限，null = 存储异常（放行，可用性优先） */
      if (count === 0) return deny(origin, env, 'rate_limited', 429);
    } catch (e) {
      /* rate_limits 表缺失 / 数据库抖动：跳过限流 */
    }
  }

  /* ⑤ 从私有对象存储取流；KV / COS 由元数据里的 backend 决定 */
  const asset = await readAsset(env, aid);
  if (!asset) return deny(origin, env, 'asset_unavailable', 404);

  const headers = {
    'Content-Type': asset.contentType,
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Disposition': "inline; filename*=UTF-8''" +
      encodeURIComponent(material.label + '-' + aid + '.jpg'),
    'X-Asset-Expires-At': String(Number(exp) * 1000),
  };
  const acao = csrfHeaders(origin, env)['Access-Control-Allow-Origin'];
  if (acao) headers['Access-Control-Allow-Origin'] = acao;
  return new Response(asset.bytes, { status: 200, headers });
}
