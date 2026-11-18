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

   存储：D1（绑定名 DB，表结构见 db/schema.sql）
     wall_messages     id / name / text / created_at，seq 负责排序与裁剪
     rate_limits       bucket='wall:ip:<hash>' 或 'wall:day'，固定窗口计数

   环境变量（Cloudflare Pages → Settings → Variables）：
     ALLOWED_ORIGINS   可选，逗号分隔（默认 github.io / pages.dev / localhost）
     WALL_ADMIN_TOKEN  可选，管理删除令牌；未配置时 DELETE 一律 404
     TURNSTILE_SECRET  可选，Cloudflare Turnstile 服务端密钥；未配置时跳过人机校验

   人机校验（2026-11-19 接入）：POST 可带 turnstileToken 字段。
     校验通过 → 走原额度（每 IP 10 分钟 3 条、全站每日 50 条）
     未通过 / 未带（脚本被墙、加载失败）→ 走严格额度（每 IP 每小时 1 条、每日 10 条）
     未配置 secret → 原额度，行为与接入前完全一致（向后兼容）
   刻意 fail-open：宁可少挡一点刷子，也不能让正常访客因为脚本加载失败就留言不了。

   绑定：D1 数据库绑定名 DB（Settings → Functions → D1 bindings）。
   未绑定时：GET 返回 open=false + reason=db_not_bound（前端显示「暂未开放」），
             POST / DELETE 返回 503。跑 scripts/wall-check.sh 可一键诊断。

   迁移说明（2026-11-19）：原先存 KV 的 `wall:messages` 单条 JSON 数组，
   每次留言都要整表重写，且 KV 免费额度只有 1,000 写/天；改 D1 后是一次
   INSERT + 一次裁剪，并发下不再互相覆盖，分页也变成真正的 SQL 分页。
   KV 里没有历史留言（迁库时实测为空），无需数据搬迁。
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
const IP_STRICT_WINDOW_MS = 3600000; // 未通过人机校验：每 IP 每小时最多 1 条
const IP_STRICT_LIMIT = 1;
const DAY_STRICT_LIMIT = 10;  // 且未通过校验的当天全站最多 10 条（不和正常额度互相挤占）
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

function ipOf(request) {
  const xff = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  return (xff.split(',')[0] || 'unknown').trim();
}

/* 限流键只留 IP 的 SHA-256 前 8 字节，库里不落明文 IP */
async function ipHash(request) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ipOf(request)));
    return Array.from(new Uint8Array(buf)).slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return 'unknown';
  }
}

/* 固定窗口计数：条件 UPDATE 只在未达上限时自增，返回 null 表示被限。
   被拒请求不再写库，也就不会把计数越堆越高、把访客永久锁死。 */
async function gate(db, bucket, window, limit, ttlSeconds) {
  const ttl = Math.max(60, ttlSeconds);
  const expires = Date.now() + ttl * 1000;
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

/* 人机校验（Cloudflare Turnstile）：返回 'ok' | 'unconfigured' | 'missing' | 'failed'
   · 未配置 TURNSTILE_SECRET → 'unconfigured'，按原额度放行（与接入前一致）
   · 校验请求本身异常（网络/边缘抖动）→ 'failed'，但不直接拒稿，而是降级到严格额度
   这是刻意的 fail-open：刷子最多多贴两条，而正常访客不会因为脚本被墙就彻底没法留言。 */
async function verifyTurnstile(env, token, ip) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return 'unconfigured';
  if (!token) return 'missing';
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', String(token).slice(0, 2048));
    if (ip && ip !== 'unknown') form.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const d = await r.json();
    return d && d.success ? 'ok' : 'failed';
  } catch (e) {
    return 'failed';
  }
}

const COLS = 'id, name, text, created_at AS ts';

/* 分页视图：GET / POST / DELETE 返回同一形状，前端不用分情况处理 */
function pageOf(messages, total, limit, offset) {
  const n = Number(total) || 0;
  return {
    ok: true,
    open: true,
    messages: messages,
    total: n,
    limit: limit,
    offset: offset,
    hasMore: offset + messages.length < n,
  };
}

async function listPage(db, limit, offset) {
  const rows = await db.prepare(
    `SELECT ${COLS} FROM wall_messages ORDER BY seq DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const cnt = await db.prepare('SELECT COUNT(*) AS n FROM wall_messages').first();
  return pageOf(rows.results || [], cnt ? cnt.n : 0, limit, offset);
}

/* 裁剪到 CAP 条：只留最新 100 条，早期留言自动滚掉 */
async function trim(db) {
  await db.prepare(
    `DELETE FROM wall_messages
      WHERE seq < (SELECT MIN(seq) FROM (
        SELECT seq FROM wall_messages ORDER BY seq DESC LIMIT ?
      ))`
  ).bind(CAP).run();
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
  const db = env.DB;
  if (!db) {
    /* 未绑定 D1：明确给出原因，站长可用 scripts/wall-check.sh 或 ?wallDebug=1 定位 */
    return json({
      ok: true, open: false, reason: 'db_not_bound', messages: [],
      total: 0, limit: 0, offset: 0, hasMore: false,
    }, cors);
  }

  const url = new URL(request.url);

  /* 诊断标志：告诉前端/自检脚本「人机校验是否已配置」，只回布尔、不暴露密钥。
     若部署后这里长期是 false，说明 Pages 的 TURNSTILE_SECRET 没注入函数运行时。 */
  const flags = { turnstile: !!env.TURNSTILE_SECRET };

  try {
    /* 轻量轮询：只回总数与最新一条的 id，不传正文，前端据此判断「有新留言」 */
    if (url.searchParams.get('peek') === '1') {
      const cnt = await db.prepare('SELECT COUNT(*) AS n FROM wall_messages').first();
      const first = await db.prepare(
        'SELECT id, created_at AS ts FROM wall_messages ORDER BY seq DESC LIMIT 1'
      ).first();
      return json({
        ok: true, open: true, total: cnt ? cnt.n : 0,
        latest: first ? { id: first.id, ts: first.ts } : null,
        turnstile: flags.turnstile,
      }, cors);
    }

    const limit = intParam(url.searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
    const offset = intParam(url.searchParams.get('offset'), 0, CAP - 1, 0);
    return json(Object.assign(await listPage(db, limit, offset), flags), cors);
  } catch (e) {
    return json({ ok: false, open: false, error: 'db_error' }, cors, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  if (!isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, corsHeaders(origin, allow), 403);
  }
  const cors = corsHeaders(origin, allow);
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'wall_not_configured', message: '留言墙存储未配置（D1 绑定缺失）' }, cors, 503);

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
  /* 先判人机校验，再决定用哪一档额度：通过 / 未配置走正常档，其余走严格档。
     两档用不同 bucket 名，避免刷子把正常访客的每日额度吃光。 */
  const trust = await verifyTurnstile(env, body.turnstileToken, ipOf(request));
  const strict = trust !== 'ok' && trust !== 'unconfigured';
  const ipKey = await ipHash(request);
  const ipWindow = strict ? IP_STRICT_WINDOW_MS : IP_WINDOW_MS;
  const win = Math.floor(now / ipWindow);
  const winEnd = (win + 1) * ipWindow;
  const dayStart = new Date(now);
  const dayKey = dayStart.toISOString().slice(0, 10);
  const dayEnd = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + 1);

  try {
    const ipOk = await gate(db, (strict ? 'wall:ip:strict:' : 'wall:ip:') + ipKey, String(win),
      strict ? IP_STRICT_LIMIT : IP_LIMIT, Math.ceil((winEnd - now) / 1000) + 60);
    if (ipOk === null) {
      return json({
        ok: false, error: 'rate_limited', message: '留言有点频繁，稍后再试',
        verifyRequired: strict,
        retryAfter: Math.max(1, Math.ceil((winEnd - now) / 1000)),
      }, cors, 429);
    }
    const dayOk = await gate(db, strict ? 'wall:day:strict' : 'wall:day', dayKey,
      strict ? DAY_STRICT_LIMIT : DAY_LIMIT, Math.ceil((dayEnd - now) / 1000) + 3600);
    if (dayOk === null) {
      return json({
        ok: false, error: 'rate_limited', message: '今日留言已达上限，明天再来',
        verifyRequired: strict,
      }, cors, 429);
    }

    /* 幂等兜底：前端禁用了按钮，但双击 / 网络重试 / 脚本直连仍可能重复提交 */
    const dup = await db.prepare(
      `SELECT 1 AS hit FROM wall_messages
        WHERE name = ? AND text = ? AND created_at > ? LIMIT 1`
    ).bind(name, text, now - DUP_WINDOW_MS).first();
    if (dup) {
      return json(Object.assign({ duplicate: true }, await listPage(db, DEFAULT_LIMIT, 0)), cors, 200);
    }

    const item = {
      id: 'w' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      name: name,
      text: text,
      created_at: now,
    };

    const ins = await db.prepare(
      'INSERT INTO wall_messages (id, name, text, created_at) VALUES (?, ?, ?, ?)'
    ).bind(item.id, item.name, item.text, item.created_at).run();
    if (!ins || !ins.success) {
      return json({ ok: false, error: 'db_error' }, cors, 500);
    }

    await trim(db);
    return json(await listPage(db, DEFAULT_LIMIT, 0), cors, 201);
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, cors, 500);
  }
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

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'wall_not_configured' }, cors, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  let id = String((body && body.id) || '');
  if (!id) {
    try { id = String(new URL(request.url).searchParams.get('id') || ''); } catch (e) { id = ''; }
  }
  if (!id) return json({ ok: false, error: 'bad_request', message: '缺少 id' }, cors, 400);

  try {
    const del = await db.prepare('DELETE FROM wall_messages WHERE id = ?').bind(id).run();
    if (!del || !del.meta || del.meta.changes === 0) {
      return json({ ok: false, error: 'not_found', message: '留言不存在' }, cors, 404);
    }
    return json(await listPage(db, DEFAULT_LIMIT, 0), cors);
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, cors, 500);
  }
}
