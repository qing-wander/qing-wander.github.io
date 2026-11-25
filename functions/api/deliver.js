/* ──────────────────────────────────────────────────────────────────────
   简历自动投递 API · Cloudflare Pages Function（路由 /api/deliver）
   ──────────────────────────────────────────────────────────────────────
   用途：resume.html「自动投递」——浏览简历的人（HR / 面试官 / 猎头 / 朋友）
   填表单，把「陈培胜的简历」发到指定邮箱：正文含动态称呼、简历提炼、可选 JD、
   在线简历入口，附件含 PDF 简历 + 可选证书（文件缺失则标注待补充）。

   ⚠️ 方向：收件人 = 访客填写的邮箱，不是站长邮箱。
   站长只可选收一份 BCC 备案（DELIVER_BCC），默认不发。

   为什么不墙：发信调用发生在 Cloudflare 节点（Pages Functions 运行时），
   访问 api.resend.com 无网络障碍；国内访客只访问 shenge-work.pages.dev。
   Resend API Key 只放 Cloudflare 环境变量（RESEND_API_KEY），永不进前端。

   接口：
     POST /api/deliver { to, recipient?, name?, email?, note?, jd?, attachments? }
       to           收件人邮箱，逗号 / 分号 / 空格分隔多个（最多 3 个）
       recipient    投递对象称呼（可选，如「张经理」；留空正文显示「您好」）
       name         投递人称呼（可选，如「张 HR / 某某公司」）
       email        投递人邮箱（可选，作为 Reply-To）
       note         附言（可选，最多 500 字）
       jd           岗位 JD（可选，最多 4000 字；无则不渲染 JD 区块）
       attachments  勾选的证书 key 数组（可选：idCard/diploma/degree/other）
     OPTIONS → 204

   环境变量（Cloudflare Pages → Settings → Variables）：
     RESEND_API_KEY   必填，未配置返回 503（前端自动走 mailto 兜底）
     RESEND_FROM      可选，默认 'Portfolio Resume <onboarding@resend.dev>'
     DELIVER_BCC      可选，站长收一份备案（如 hi@chenpeisheng.cn），留空则不发
     ALLOWED_ORIGINS  可选，逗号分隔（默认 github.io / pages.dev / localhost）

   绑定：SITE_KV（与留言墙共用；未绑定时跳过限额，不阻塞发信）

   限额（KV，防被当成发垃圾邮件的跳板）：
     每个收件人每日 2 封（deliver:to:<邮箱>:<yyyymmdd>）
     每个 IP 每日 5 封（deliver:ip:<ip>:<yyyymmdd>）
     全站每日 30 封（deliver:day:<yyyymmdd>）
   ────────────────────────────────────────────────────────────────────── */

import {
  CERT_SLOTS, RESUME_PDF_NAME, RESUME_PDF_PATH,
  buildDeliveryEmail, buildSubject,
} from '../lib/deliver-content.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Portfolio Resume <onboarding@resend.dev>';

const MAX_NAME = 24;
const MAX_NOTE = 500;
const MAX_RECIPIENTS = 3;
const TO_DAY_LIMIT = 2;
const IP_DAY_LIMIT = 5;
const DAY_LIMIT = 30;
const DAY_TTL = 172800;

const DEFAULT_ORIGINS = [
  'https://chenpeisheng.cn',
  'https://shenge-work.pages.dev',
  '*.shenge-work.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  /* 本地联调服务器 scripts/dev-api-server.mjs 的默认端口，与 wall.js 保持一致 */
  'http://localhost:8877',
  'http://127.0.0.1:8877',
];

const MAX_RECIPIENT = 40;
const MAX_JD = 4000;
const MAX_ATTACH_BYTES = 12 * 1024 * 1024; // 单附件上限，远低于 Resend 40MB/封
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, max);
}

function ipOf(request) {
  const xff = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  return (xff.split(',')[0] || 'unknown').trim();
}

async function bump(kv, key, ttl) {
  if (!kv) return null;
  try {
    const cur = Number(await kv.get(key)) || 0;
    const next = cur + 1;
    await kv.put(key, String(next), { expirationTtl: ttl });
    return next;
  } catch (e) {
    return null;
  }
}

/* 解析收件人：支持逗号 / 分号 / 空格分隔；去重、小写、逐个校验 */
function parseRecipients(raw) {
  const list = String(raw || '')
    .split(/[,;，；\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const uniq = [];
  for (const e of list) if (uniq.indexOf(e) < 0) uniq.push(e);
  if (!uniq.length) return { error: 'empty' };
  if (uniq.length > MAX_RECIPIENTS) return { error: 'too_many' };
  if (uniq.some((e) => e.length > 120 || !EMAIL_RE.test(e))) return { error: 'invalid' };
  return { list: uniq };
}

/* 邮件模板与主题已移至 functions/lib/deliver-content.js（纯函数、可测试） */

/* ArrayBuffer → base64（Workers 无 Buffer，分块避免栈溢出） */
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* 从本站静态资源取一个附件；取不到返回 null（不阻塞发信） */
async function fetchAttachment(request, path, filename) {
  try {
    const url = new URL(path, request.url);
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_ATTACH_BYTES) return null;
    return { filename, content: toBase64(buf) };
  } catch (e) {
    return null;
  }
}

/* 解析勾选的证书 key：只认白名单内的，去重 */
function parseCertKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((k) => String(k).trim()).filter((k) => k in CERT_SLOTS)));
}

export async function onRequestOptions({ request, env }) {
  const allow = allowedOrigins(env);
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin'), allow) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  if (!isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, corsHeaders(origin, allow), 403);
  }
  const cors = corsHeaders(origin, allow);

  /* Resend 未配置：引导前端走 mailto 兜底 */
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: 'resend_not_configured', message: '自动发信尚未配置（缺 RESEND_API_KEY），可用邮件客户端发送' }, cors, 503);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'bad_request', message: '请求体不是合法 JSON' }, cors, 400);
  }

  const parsed = parseRecipients(body.to);
  if (parsed.error === 'empty') {
    return json({ ok: false, error: 'bad_request', message: '请填写收件人邮箱' }, cors, 400);
  }
  if (parsed.error === 'too_many') {
    return json({ ok: false, error: 'bad_request', message: '一次最多发给 ' + MAX_RECIPIENTS + ' 个收件人' }, cors, 400);
  }
  if (parsed.error === 'invalid') {
    return json({ ok: false, error: 'bad_request', message: '收件人邮箱格式不正确' }, cors, 400);
  }

  const d = {
    to: parsed.list,
    recipient: clean(body.recipient, MAX_RECIPIENT),
    name: clean(body.name, MAX_NAME),
    email: clean(body.email, 120).toLowerCase(),
    note: clean(body.note, MAX_NOTE),
    jd: clean(body.jd, MAX_JD),
    certs: parseCertKeys(body.attachments),
    attachedLabels: [],
    pendingLabels: [],
  };
  if (d.email && !EMAIL_RE.test(d.email)) {
    return json({ ok: false, error: 'bad_request', message: '你的邮箱格式不正确（可留空）' }, cors, 400);
  }

  /* 限额：每个收件人 / 每 IP / 全站（KV 未绑定则跳过，不阻塞发信） */
  const kv = env.SITE_KV;
  const today = new Date().toISOString().slice(0, 10);
  for (const addr of d.to) {
    const cnt = await bump(kv, 'deliver:to:' + addr + ':' + today, DAY_TTL);
    if (cnt != null && cnt > TO_DAY_LIMIT) {
      return json({ ok: false, error: 'rate_limited', message: '该邮箱今天已收到多封同样邮件，换个邮箱或明天再试' }, cors, 429);
    }
  }
  const day = await bump(kv, 'deliver:day:' + today, DAY_TTL);
  if (day != null && day > DAY_LIMIT) {
    return json({ ok: false, error: 'rate_limited', message: '今日转发已达上限，请明日再试或直接邮件联系' }, cors, 429);
  }
  const ipCnt = await bump(kv, 'deliver:ip:' + ipOf(request) + ':' + today, DAY_TTL);
  if (ipCnt != null && ipCnt > IP_DAY_LIMIT) {
    return json({ ok: false, error: 'rate_limited', message: '你今天已转发多次，请直接邮件联系' }, cors, 429);
  }

  /* 附件：PDF 简历始终附上；勾选的证书文件缺失时标注「待补充」，不阻塞发信 */
  const attachments = [];
  const pdf = await fetchAttachment(request, RESUME_PDF_PATH, RESUME_PDF_NAME);
  if (pdf) attachments.push(pdf);
  for (const key of d.certs) {
    const slot = CERT_SLOTS[key];
    const file = await fetchAttachment(request, slot.path, slot.filename);
    if (file) { attachments.push(file); d.attachedLabels.push(slot.label); }
    else d.pendingLabels.push(slot.label);
  }

  const mail = buildDeliveryEmail(d);
  const payload = {
    from: env.RESEND_FROM || DEFAULT_FROM,
    to: d.to,
    subject: buildSubject(d),
    html: mail.html,
    text: mail.text,
  };
  if (attachments.length) payload.attachments = attachments;
  if (d.email) payload.reply_to = d.email;
  if (env.DELIVER_BCC) payload.bcc = [String(env.DELIVER_BCC).trim()];

  let resp;
  try {
    resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ ok: false, error: 'resend_network', message: '发信请求失败（网络异常）' }, cors, 502);
  }

  if (resp.status >= 400) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch (e) {}
    /* 403/422 常见于「未验证域名 / 收件人不在测试白名单」——前端据此切 mailto */
    const restricted = resp.status === 403 || resp.status === 422;
    return json({
      ok: false,
      error: restricted ? 'recipient_not_verified' : 'resend_error',
      status: resp.status,
      message: restricted
        ? '自动发信仅支持已验证域名，先用邮件客户端发送'
        : 'Resend 返回错误' + (detail ? '：' + detail : ''),
    }, cors, 502);
  }

  let id = '';
  try { id = (await resp.json()).id || ''; } catch (e) {}

  return json({ ok: true, id: id, to: d.to }, cors, 201);
}