/* ──────────────────────────────────────────────────────────────────────
   学历核验访问申请 API · Cloudflare Pages Function（路由 /api/verify-access）
   ──────────────────────────────────────────────────────────────────────
   背景：学校档案页的验证码 / 二维码默认加锁；访客填写「当前身份 + 查看用途
   + 查看理由 + 承诺」后，本站把申请连同申请时间、设备环境与网络 UA
   通过 Resend 发给简历本人，由本人反向核验身份后决定是否解锁。

   接口：
     POST /api/verify-access {name, identity, org, contact, purpose, reason,
                              consent, device, origin, website}
       → {ok:true, message, requestId} / {ok:false, error, message}
     GET  /api/verify-access?id=<申请ID>
       → {ok:true, status:'pending'|'approved'|'rejected'}；批准后解锁生效
     OPTIONS → 204（CORS 预检）

   防滥用：
     · 蜜罐字段 website：机器人填了就静默成功，不真发邮件；
     · D1 rate_limits：每 IP 10 分钟 3 次 / 全站每天 30 次（与留言墙同一张表，
       bucket 加 verify: 前缀互不干扰）；D1 未绑定时跳过限流，不阻塞申请；
     · IP 只以带 pepper 的 HMAC 哈希进入邮件，不落明文 IP。

   环境变量：
     RESEND_API_KEY      必填（与简历转发 / 留言墙共用），未配置则跳过发信
     RESEND_FROM         可选，默认 onboarding@resend.dev（未验证域名时只能发注册邮箱）
     VERIFY_ACCESS_TO    收件人，默认 hi@chenpeisheng.cn
     VERIFY_ACCESS_FROM  可选，单独指定本接口的发件人
     DEVICE_HASH_PEPPER  可选，IP 哈希盐；与留言墙共用
     VERIFY_ACCESS_SECRET 可选，审批链接 HMAC 密钥（强烈建议单独配置）
     ALLOWED_ORIGINS     可选，逗号分隔来源白名单
   ────────────────────────────────────────────────────────────────────── */

import { notifyAccessRequest } from '../lib/verify-access-notify.js';
import { newRequestId, signApproval } from '../lib/verify-access-token.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const MAX_NAME = 40;
const MAX_ORG = 80;
const MAX_CONTACT = 120;
const MAX_REASON = 600;
const MIN_REASON = 15;
const MAX_DEVICE_KEY = 60;
const MAX_DEVICE_VALUE = 120;
const IP_WINDOW_MS = 600000;   // 10 分钟
const IP_LIMIT = 3;
const DAY_LIMIT = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DEFAULT_ORIGINS = [
  'https://chenpeisheng.cn',
  'https://shenge-work.pages.dev',
  '*.shenge-work.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8877',
  'http://127.0.0.1:8877',
];

/* 前端传 code，邮件里写中文标签，避免访客自由输入「身份 / 用途」把邮件搞乱 */
const IDENTITY = {
  hr: 'HR / 招聘负责人',
  manager: '用人经理 / 业务负责人',
  interviewer: '面试官',
  headhunter: '猎头 / 招聘顾问',
  partner: '合作方 / 客户',
  researcher: '研究者 / 学生',
  other: '其他身份',
};
const PURPOSE = {
  recruit: '招聘流程评估',
  background: '入职背景调查',
  interview: '面试 / 技术评估',
  cooperation: '商务合作尽职调查',
  research: '学术研究 / 资料整理',
  other: '其他用途',
};

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
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

function corsHeaders(origin, allow) {
  const acao = isAllowedOrigin(origin, allow) ? String(origin).trim() : '';
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (acao) h['Access-Control-Allow-Origin'] = acao;
  return h;
}

function json(body, extra, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({}, JSON_HEADERS, extra || {}),
  });
}

/* 与留言墙同款净化：归一换行、剔除控制 / 零宽字符、按码点截断 */
function clean(s, max) {
  return Array.from(String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\u200c\u200e\u200f\u2060\u202a-\u202e\ufeff]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
    .slice(0, max).join('');
}

function ipOf(request) {
  const xff = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  return (xff.split(',')[0] || 'unknown').trim();
}

/* IP → 带 pepper 的 HMAC 哈希前 16 位：既做限流键，也进邮件，绝不落明文 */
async function ipHash(request, env) {
  try {
    const pepper = String(env.DEVICE_HASH_PEPPER || 'dev-only-pepper-change-me');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ipOf(request)));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch (e) {
    return 'unknown';
  }
}

/* 复用 db/schema.sql 的 rate_limits；insert ... returning 一次调用完成计数 */
async function gate(db, bucket, window, limit, ttlSeconds) {
  const expires = Date.now() + Math.max(60, ttlSeconds) * 1000;
  const row = await db.prepare(
    `INSERT INTO rate_limits (bucket, window, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (bucket, window) DO UPDATE SET
       count = rate_limits.count + 1,
       expires_at = excluded.expires_at
     WHERE rate_limits.count < ?
     RETURNING count`
  ).bind(bucket, window, expires, limit).first();
  return row ? Number(row.count) : null;
}

/* 前端只传浏览器公开环境：平台 / 屏幕 / 语言 / 时区 / 硬件并发 / 触控 / DPR */
function deviceText(raw) {
  if (!raw || typeof raw !== 'object') return '';
  var parts = [];
  const keys = ['platform', 'screen', 'colorDepth', 'language', 'timezone', 'cores', 'touch', 'dpr'];
  keys.forEach(function (k) {
    const v = clean(raw[k], MAX_DEVICE_VALUE);
    if (v) parts.push(k + '=' + v);
  });
  return parts.join(' | ').slice(0, 800);
}

/* 访客轮询审批结果：只回状态，不回申请人隐私字段。
   id 是 128-bit 随机串，猜不到；批准状态由服务端的签名链接写入。 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  const cors = corsHeaders(origin, allow);
  if (origin && !isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, cors, 403);
  }
  const id = String(new URL(request.url).searchParams.get('id') || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    return json({ ok: false, error: 'bad_request' }, cors, 400);
  }
  if (!env.DB) {
    return json({ ok: false, error: 'db_not_bound' }, cors, 200);
  }
  try {
    const row = await env.DB.prepare(
      'SELECT status, school_id, approved_at FROM verify_access_requests WHERE id = ?'
    ).bind(id).first();
    if (!row) return json({ ok: false, error: 'not_found' }, cors, 200);
    return json({
      ok: true,
      status: row.status,
      schoolId: row.school_id || '',
      approvedAt: row.approved_at || 0,
    }, cors, 200);
  } catch (e) {
    console.warn('[verify-access] 查询审批状态失败', (e && e.message) || e);
    return json({ ok: false, error: 'db_error' }, cors, 200);
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins(context.env)) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  const cors = corsHeaders(origin, allow);
  if (origin && !isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, cors, 403);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'bad_request', message: '请求体不是合法 JSON' }, cors, 400);
  }

  /* 蜜罐：真人看不到这个字段；机器人填了就静默成功，不暴露拦截原因 */
  if (clean(body.website, 200)) return json({ ok: true, message: '申请已提交' }, cors, 200);

  const name = clean(body.name, MAX_NAME);
  if (Array.from(name).length < 2) {
    return json({ ok: false, error: 'bad_request', message: '请填写你的姓名 / 称呼（至少 2 个字）' }, cors, 400);
  }
  const identity = Object.prototype.hasOwnProperty.call(IDENTITY, body.identity) ? body.identity : '';
  if (!identity) {
    return json({ ok: false, error: 'bad_request', message: '请选择当前身份' }, cors, 400);
  }
  const purpose = Object.prototype.hasOwnProperty.call(PURPOSE, body.purpose) ? body.purpose : '';
  if (!purpose) {
    return json({ ok: false, error: 'bad_request', message: '请选择查看用途' }, cors, 400);
  }
  const reason = clean(body.reason, MAX_REASON);
  if (Array.from(reason).length < MIN_REASON) {
    return json({
      ok: false, error: 'bad_request',
      message: '查看理由请至少写 ' + MIN_REASON + ' 个字，方便本人核实身份',
    }, cors, 400);
  }
  if (body.consent !== true) {
    return json({ ok: false, error: 'bad_request', message: '请先确认信息真实、仅用于所填用途' }, cors, 400);
  }

  const org = clean(body.org, MAX_ORG);
  const contact = clean(body.contact, MAX_CONTACT);
  const ua = clean(request.headers.get('User-Agent'), 300);
  const referrer = clean(request.headers.get('Referer') || body.origin, 120);
  const now = Date.now();

  /* 限流失败（D1 异常）不阻塞申请：宁可多一封邮件，也不让访客卡住 */
  const hash = await ipHash(request, env);
  if (env.DB) {
    try {
      const win = Math.floor(now / IP_WINDOW_MS);
      const winEnd = (win + 1) * IP_WINDOW_MS;
      const ipOk = await gate(env.DB, 'verify:ip:' + hash, String(win), IP_LIMIT,
        Math.ceil((winEnd - now) / 1000) + 60);
      if (ipOk === null) {
        return json({
          ok: false, error: 'rate_limited',
          message: '申请提交较频繁，请 10 分钟后再试',
          retryAfter: Math.max(1, Math.ceil((winEnd - now) / 1000)),
        }, cors, 429);
      }
      const d = new Date(now);
      const dayKey = d.toISOString().slice(0, 10);
      const dayEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      const dayOk = await gate(env.DB, 'verify:day', dayKey, DAY_LIMIT,
        Math.ceil((dayEnd - now) / 1000) + 3600);
      if (dayOk === null) {
        return json({ ok: false, error: 'rate_limited', message: '今日申请已达上限，明天再试' }, cors, 429);
      }
    } catch (e) {
      console.warn('[verify-access] 限流表不可用，跳过限流', (e && e.message) || e);
    }
  }

  /* 申请 ID 同时作为访客轮询凭据；审批链接另带 HMAC 签名，二者权限不同 */
  const id = newRequestId();
  let schoolId = 'xinhua';
  try {
    const fromQuery = new URL(body.origin || referrer || request.url).searchParams.get('c');
    if (fromQuery && /^[a-z0-9_-]{1,40}$/i.test(fromQuery)) schoolId = fromQuery;
  } catch (e) {}

  const item = {
    name, identity: IDENTITY[identity], org, contact,
    purpose: PURPOSE[purpose], reason, created_at: now,
  };
  const meta = {
    origin: referrer,
    ipCountry: clean(request.headers.get('CF-IPCountry'), 40),
    ipHash: hash,
    userAgent: ua,
    device: deviceText(body.device),
    deviceId: clean(request.headers.get('X-Device-Id'), 64),
  };

  let approval = null;
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO verify_access_requests
           (id, school_id, name, identity, org, contact, purpose, reason, meta, device_hash, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(
        id, schoolId, item.name, item.identity, item.org, item.contact, item.purpose, item.reason,
        JSON.stringify(meta), hash, now
      ).run();
      const token = await signApproval(id, env, now);
      const approveUrl = new URL('/api/verify-access-approve', new URL(request.url).origin);
      approveUrl.searchParams.set('id', id);
      approveUrl.searchParams.set('exp', String(token.exp));
      approveUrl.searchParams.set('sig', token.sig);
      approval = {
        url: approveUrl.toString(),
        expiresAt: new Date(now + token.ttl * 1000).toISOString().slice(0, 10),
      };
    } catch (e) {
      console.warn('[verify-access] 申请记录写入失败，邮件将不带审批链接', (e && e.message) || e);
    }
  } else {
    console.warn('[verify-access] 未绑定 D1，邮件将不带审批链接（无法在线解锁）');
  }

  const sent = await notifyAccessRequest(env, item, meta, approval);
  if (!sent.ok) console.warn('[verify-access] 邮件通知未送达：' + sent.reason);

  /* 发信失败也返回成功：访客无法补救，重复提交只会制造更多噪音 */
  return json({
    ok: true,
    message: approval
      ? '申请已提交，本人核验身份后会直接为你解锁，请留在此页等待'
      : '申请已提交，本人核验身份后会与你联系',
    requestId: approval ? id : '',
  }, cors, 200);
}
