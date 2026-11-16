/* ──────────────────────────────────────────────────────────────────────
   留言墙 API · Cloudflare Pages Function（路由 /api/wall）
   ──────────────────────────────────────────────────────────────────────
   用途：主页「留言墙」板块——不想直接联系站长的人，匿名留言表达看法。

   接口：
     GET    /api/wall                          → { ok, open, messages, total, limit, offset, hasMore }
     GET    /api/wall?limit=20&offset=20       → 分页取更早的留言
     GET    /api/wall?peek=1                   → { ok, open, total, latest }  轻量轮询，不传正文
     POST   /api/wall {name?, text}            → 提交留言（白名单 + 限流 + 去重），返回第一页
     DELETE /api/wall {id} + X-Admin-Token     → 管理员删留言，返回第一页
     OPTIONS                                  → 204  CORS 预检

   存储：KV（Pages 项目绑定的 SITE_KV）
     wall:messages              JSON 数组，最新在前，最多留 CAP 条
     wall:rl:<窗口号>:<ipHash>  固定时间窗内的 IP 计数（不存 IP 明文）
     wall:day:<yyyymmdd>        全局每日计数

   环境变量（Cloudflare Pages → Settings → Variables）：
     ALLOWED_ORIGINS   可选，逗号分隔（默认 github.io / pages.dev / localhost）
     WALL_ADMIN_TOKEN  可选，管理删除令牌；未配置时 DELETE 一律 404

   绑定：KV namespace 绑定名 SITE_KV（Settings → Functions → KV bindings）。
   未绑定时：GET 返回 open=false + reason=kv_not_bound（前端显示「暂未开放」），
             POST / DELETE 返回 503。跑 scripts/wall-check.sh 可一键诊断。

   设计取舍：KV 是「最终一致 + 非原子读改写」，极端并发下两条留言可能互相覆盖。
   本函数在写前重读一次缩小竞争窗口，个人站点的量级足够；要严格不丢需换
   Durable Objects（付费计划）。限流键按固定时间窗编号，避免被拒请求反复
   刷新 TTL 把访客永久锁死。
   ────────────────────────────────────────────────────────────────────── */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const MAX_TEXT = 300;         // 留言正文上限（按 Unicode 码点计，emoji 算 1 个）
const MIN_TEXT = 2;           // 正文最少字数
const MAX_NAME = 16;          // 称呼长度上限
const CAP = 100;              // 墙上最多保留条数
const DEFAULT_LIMIT = 20;     // 每页默认条数
const MAX_LIMIT = 50;         // 单页上限
const IP_WINDOW_MS = 600000;  // 每 IP 限流窗口 10 分钟（固定窗，不是滑窗）
const IP_LIMIT = 3;           // 每 IP 每窗口最多 3 条
const DAY_LIMIT = 50;         // 全局每日最多 50 条
const DUP_WINDOW_MS = 300000; // 5 分钟内相同「称呼 + 内容」视为重复提交
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
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

function intParam(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/* 内容净化：
   · 归一换行、保留 \n / \t（旧版会连换行一起删掉，多行留言被压成一行）
   · 剔除其余控制字符与零宽字符（防隐藏文本 / 排版攻击）
   · 按 Unicode 码点截断，避免在 emoji 代理对中间切一刀产生乱码
   · 连续 3 个以上空行收敛为 2 个，防止刷屏 */
function clean(s, max) {
  return Array.from(String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    /* 保留 \u200d（ZWJ），否则 👨‍👩‍👧 这类组合 emoji 会被拆散 */
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\u200c\u200e\u200f\u2060\u202a-\u202e\ufeff]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
    .slice(0, max).join('');
}

/* KV 里的历史数据可能被别的工具写坏，只把结构合法的条目交给前端 */
function normalizeMessages(arr) {
  return (Array.isArray(arr) ? arr : []).filter(function (m) {
    return m && typeof m === 'object' && typeof m.text === 'string' &&
      typeof m.id === 'string' && typeof m.ts === 'number';
  });
}

async function readMessages(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get('wall:messages');
    return normalizeMessages(JSON.parse(raw || '[]'));
  } catch (e) {
    return [];
  }
}

async function writeMessages(kv, arr) {
  await kv.put('wall:messages', JSON.stringify(arr));
}

/* 分页视图：GET / POST / DELETE 返回同一形状，前端不用分情况处理 */
function pageOf(messages, limit, offset) {
  const page = messages.slice(offset, offset + limit);
  return {
    ok: true,
    open: true,
    messages: page,
    total: messages.length,
    limit: limit,
    offset: offset,
    hasMore: offset + page.length < messages.length,
  };
}

function ipOf(request) {
  const xff = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  return (xff.split(',')[0] || 'unknown').trim();
}

/* 限流键只留 IP 的 SHA-256 前 8 字节，KV 里不落明文 IP */
async function ipHash(request) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ipOf(request)));
    return Array.from(new Uint8Array(buf)).slice(0, 8)
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  } catch (e) {
    return 'unknown';
  }
}

/* 固定窗口计数：先判断是否已达上限，只有放行才自增。
   被拒请求不再写 KV，也就不会反复刷新 TTL 把访客永久锁死。 */
async function gate(kv, key, limit, ttlSeconds) {
  if (!kv) return true;
  try {
    const cur = Number(await kv.get(key)) || 0;
    if (cur >= limit) return false;
    await kv.put(key, String(cur + 1), { expirationTtl: Math.max(60, ttlSeconds) });
    return true;
  } catch (e) {
    return true; /* KV 读写出错时不拦正常访客 */
  }
}

function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function onRequestOptions({ request, env }) {
  const allow = allowedOrigins(env);
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin'), allow) });
}

export async function onRequestGet({ request, env }) {
  const cors = { 'Access-Control-Allow-Origin': '*', Vary: 'Origin' };
  const messages = await readMessages(env.SITE_KV);
  if (messages === null) {
    /* 未绑定 KV：明确给出原因，站长可用 scripts/wall-check.sh 或 ?wallDebug=1 定位 */
    return json({
      ok: true, open: false, reason: 'kv_not_bound', messages: [],
      total: 0, limit: 0, offset: 0, hasMore: false,
    }, cors);
  }

  const url = new URL(request.url);
  /* 轻量轮询：只回总数与最新一条的 id，不传正文，前端据此判断「有新留言」 */
  if (url.searchParams.get('peek') === '1') {
    const first = messages[0] || null;
    return json({
      ok: true, open: true, total: messages.length,
      latest: first ? { id: first.id, ts: first.ts } : null,
    }, cors);
  }

  const limit = intParam(url.searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
  const offset = intParam(url.searchParams.get('offset'), 0, CAP - 1, 0);
  return json(pageOf(messages, limit, offset), cors);
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  if (!isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, corsHeaders(origin, allow), 403);
  }
  const cors = corsHeaders(origin, allow);
  const kv = env.SITE_KV;
  if (!kv) return json({ ok: false, error: 'wall_not_configured', message: '留言墙存储未配置（Pages KV 绑定缺失）' }, cors, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'bad_request', message: '请求体不是合法 JSON' }, cors, 400);
  }

  const text = clean(body.text, MAX_TEXT);
  if (!text) return json({ ok: false, error: 'bad_request', message: '留言内容不能为空' }, cors, 400);
  if (Array.from(text).length < MIN_TEXT) {
    return json({ ok: false, error: 'bad_request', message: '再多写两个字吧（至少 2 个字）' }, cors, 400);
  }
  const name = clean(body.name, MAX_NAME) || '匿名访客';

  const now = Date.now();
  const win = Math.floor(now / IP_WINDOW_MS);
  const winEnd = (win + 1) * IP_WINDOW_MS;
  const dayStart = new Date(now);
  const dayKey = 'wall:day:' + dayStart.toISOString().slice(0, 10);
  const dayEnd = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + 1);

  const ipOk = await gate(kv, 'wall:rl:' + win + ':' + (await ipHash(request)), IP_LIMIT,
    Math.ceil((winEnd - now) / 1000) + 60);
  if (!ipOk) {
    return json({
      ok: false, error: 'rate_limited', message: '留言有点频繁，稍后再试',
      retryAfter: Math.max(1, Math.ceil((winEnd - now) / 1000)),
    }, cors, 429);
  }
  const dayOk = await gate(kv, dayKey, DAY_LIMIT, Math.ceil((dayEnd - now) / 1000) + 3600);
  if (!dayOk) {
    return json({ ok: false, error: 'rate_limited', message: '今日留言已达上限，明天再来' }, cors, 429);
  }

  let messages = await readMessages(kv) || [];

  /* 幂等兜底：前端禁用了按钮，但双击 / 网络重试 / 脚本直连仍可能重复提交 */
  const dup = messages.slice(0, 10).some(function (m) {
    return m.name === name && m.text === text && (now - m.ts) < DUP_WINDOW_MS;
  });
  if (dup) {
    return json(Object.assign({ duplicate: true }, pageOf(messages, DEFAULT_LIMIT, 0)), cors, 200);
  }

  const item = {
    id: 'w' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    name: name,
    text: text,
    ts: now,
  };

  /* 写前重读：若期间有别人插了一条，以最新列表为基准合并，缩小 KV 非原子写的丢数据窗口 */
  const latest = await readMessages(kv);
  if (latest && latest.length !== messages.length) messages = latest;
  const next = [item].concat(messages).slice(0, CAP);
  await writeMessages(kv, next);

  return json(pageOf(next, DEFAULT_LIMIT, 0), cors, 201);
}

export async function onRequestDelete({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  if (!isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, corsHeaders(origin, allow), 403);
  }
  const cors = corsHeaders(origin, allow);

  const token = env.WALL_ADMIN_TOKEN;
  if (!token) return json({ ok: false, error: 'not_found' }, cors, 404); /* 未配置管理令牌：能力不暴露 */
  if (!safeEqual(request.headers.get('X-Admin-Token'), token)) {
    return json({ ok: false, error: 'forbidden' }, cors, 403);
  }

  const kv = env.SITE_KV;
  if (!kv) return json({ ok: false, error: 'wall_not_configured' }, cors, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  let id = String((body && body.id) || '');
  if (!id) {
    try { id = String(new URL(request.url).searchParams.get('id') || ''); } catch (e) { id = ''; }
  }
  if (!id) return json({ ok: false, error: 'bad_request', message: '缺少 id' }, cors, 400);

  const messages = (await readMessages(kv)) || [];
  const next = messages.filter((m) => m.id !== id);
  if (next.length === messages.length) {
    return json({ ok: false, error: 'not_found', message: '留言不存在' }, cors, 404);
  }
  await writeMessages(kv, next);
  return json(pageOf(next, DEFAULT_LIMIT, 0), cors);
}
