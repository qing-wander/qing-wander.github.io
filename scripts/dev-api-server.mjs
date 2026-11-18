/* 本地联调服务器：静态文件 + 真实 functions/api 逻辑
   （D1 用 node:sqlite 内存库模拟，KV 用内存 Map，Resend 发信被拦截）
   2026-11-19：留言墙 / 访问计数迁到 D1，本文件同步加了一层最小 D1 适配器，
   表结构与线上一致（db/schema.sql），保证本地测的是同一套 SQL。 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { onRequestGet as wallGet, onRequestPost as wallPost, onRequestDelete as wallDel, onRequestOptions as wallOpt } from '../functions/api/wall.js';
import { onRequestGet as visitsGet, onRequestPost as visitsPost, onRequestOptions as visitsOpt } from '../functions/api/visits.js';
import { onRequestPost as deliverPost, onRequestOptions as deliverOpt } from '../functions/api/deliver.js';
import { onRequestGet as adminWallGet, onRequestPost as adminWallPost, onRequestOptions as adminWallOpt } from '../functions/api/admin/wall/[[path]].js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8877);

/* ── D1 的最小本地实现：接口形状对齐 Cloudflare（prepare/bind/all/first/run） ──
   D1 的 first() 对 UPDATE ... RETURNING 也要能取到行，所以统一走 all() 再取首行。 */
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(await fs.readFile(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

const DB = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const make = (params) => ({
      all: async () => ({ results: stmt.all(...params), success: true, meta: {} }),
      first: async (col) => {
        const rows = stmt.all(...params);
        const r = rows && rows[0];
        if (!r) return null;
        return col ? (r[col] === undefined ? null : r[col]) : r;
      },
      run: async () => {
        const info = stmt.run(...params);
        return { success: true, meta: { changes: Number(info && info.changes) || 0 } };
      },
    });
    return Object.assign(make([]), { bind: (...params) => make(params) });
  },
};

/* 内存 KV：模拟 expirationTtl，deliver.js 的发信限额仍用它
   （线上也保持 KV，写量可控：日上限 30 封 ≈ 90 写/天） */
const KV = new Map();
const SITE_KV = {
  async get(k) {
    const e = KV.get(k);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt <= Date.now()) { KV.delete(k); return null; }
    return e.value;
  },
  async put(k, v, opts) {
    const ttl = opts && Number(opts.expirationTtl) > 0 ? Number(opts.expirationTtl) : 0;
    KV.set(k, { value: String(v), expiresAt: ttl ? Date.now() + ttl * 1000 : 0 });
  },
};

/* 设备隔离联调数据
   WALL_SEED=<n>        预置 n 条「本设备」留言（验收分页 / 加载更多）
   WALL_SEED_DEVICE=xx  指定这批留言归属的设备 ID（默认 dev-device-0001）
   另外固定写入 2 条 legacy 旧留言：它们在公开端不该出现，只在后台可见。
   设备哈希与线上同算法：HMAC-SHA256(DEVICE_HASH_PEPPER, device_id) 取前 32 位 hex。 */
const PEPPER = process.env.DEVICE_HASH_PEPPER || 'dev-only-pepper-change-me';
const hashDevice = (id) => createHmac('sha256', PEPPER).update(String(id)).digest('hex').slice(0, 32);

const SEED_DEVICE = process.env.WALL_SEED_DEVICE || 'dev-device-0001';
const SEED = Number(process.env.WALL_SEED || 0);
if (SEED > 0) {
  const now = Date.now();
  const n = Math.min(SEED, 100);
  const dh = hashDevice(SEED_DEVICE);
  const ins = sqlite.prepare(
    'INSERT INTO wall_messages (id, name, text, created_at, device_hash, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < n; i++) {
    ins.run(
      'wseed' + i,
      i % 4 === 0 ? '匿名访客' : '访客' + (i + 1),
      '这是本地联调用的第 ' + (i + 1) + ' 条留言，用来检查分页与加载更多是否正常。',
      now - i * 3600000,
      dh, 'visible', now - i * 3600000
    );
  }
  sqlite.prepare('INSERT INTO wall_devices (device_hash, first_seen, last_seen, post_count, ua) VALUES (?, ?, ?, ?, ?)')
    .run(dh, now - n * 3600000, now, n, 'local-seed');
  for (let i = 0; i < 2; i++) {
    ins.run('wlegacy' + i, '旧访客', '迁移前的公开墙旧留言 #' + (i + 1) + '（公开端不可见，仅后台可见）',
      now - (n + i) * 3600000, 'legacy', 'visible', now - (n + i) * 3600000);
  }
  console.log('[seed] 设备 ' + SEED_DEVICE + ' 预置 ' + n + ' 条留言 + 2 条 legacy 旧留言');
}

/* 本地模拟 Resend：只记录，不发真实邮件。
   MOCK_RESEND=unverified 时模拟「域名未验证」→ 422，用来验收 mailto 兜底。
   MOCK_RESEND=nokey 时模拟未配置 API Key → 503。 */
const MOCK = process.env.MOCK_RESEND || '';
const ENV = {
  DB,
  SITE_KV,
  ALLOWED_ORIGINS: 'http://127.0.0.1:' + PORT + ',http://localhost:' + PORT,
  RESEND_FROM: process.env.RESEND_FROM || '',
  DELIVER_BCC: process.env.DELIVER_BCC || '',
  /* 本地默认给一个测试令牌，方便验收 DELETE；不设就等于线上「未配置」形态 */
  WALL_ADMIN_TOKEN: process.env.WALL_ADMIN_TOKEN || 'local-admin-token',
  /* 设备哈希盐：本地与线上必须各自配置；这里给的默认值只够本地联调 */
  DEVICE_HASH_PEPPER: PEPPER,
  /* 人机校验：默认不配 → 走正常额度（与线上未配置 secret 时一致）。
     想验严格档就 TURNSTILE_SECRET=test 起服务，此时不带 token 的 POST 会降到每 IP 每小时 1 条。 */
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || '',
};
if (MOCK !== 'nokey') ENV.RESEND_API_KEY = 're_local_test';
/* WALL_NO_DB=1 模拟「Pages 里忘了绑定 D1」的线上形态，用来验收关闭态 */
if (process.env.WALL_NO_DB === '1' || process.env.WALL_NO_KV === '1') {
  delete ENV.DB;
  console.log('[mock] 未绑定 D1：/api/wall 将返回 open=false, reason=db_not_bound');
}

const REAL_FETCH = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.resend.com')) {
    const payload = init && init.body ? String(init.body) : '';
    console.log('[mock resend]', payload);
    if (MOCK === 'unverified') {
      return new Response(JSON.stringify({ name: 'validation_error', message: 'You can only send testing emails to your own email address' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 'em_local_test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return REAL_FETCH(url, init);
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mjs': 'text/javascript' };

async function handler(fn, nodeReq) {
  const request = await toReq(nodeReq);
  return await fn({ request, env: ENV });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const p = url.pathname;
  try {
    if (p === '/api/admin/wall' || p.startsWith('/api/admin/wall/')) {
      const r = req.method === 'POST' ? await handler(adminWallPost, req)
        : req.method === 'GET' ? await handler(adminWallGet, req)
        : await handler(adminWallOpt, req);
      return send(res, r);
    }
    if (p === '/api/wall') {
      const r = req.method === 'GET' ? await handler(wallGet, req)
        : req.method === 'POST' ? await handler(wallPost, req)
        : req.method === 'DELETE' ? await handler(wallDel, req)
        : await handler(wallOpt, req);
      return send(res, r);
    }
    if (p === '/api/visits') {
      const r = req.method === 'POST' ? await handler(visitsPost, req)
        : req.method === 'GET' ? await handler(visitsGet, req)
        : await handler(visitsOpt, req);
      return send(res, r);
    }
    if (p === '/api/deliver') {
      const r = req.method === 'POST' ? await handler(deliverPost, req) : await handler(deliverOpt, req);
      return send(res, r);
    }
    let file = p === '/' ? '/index.html' : p;
    const abs = path.join(ROOT, decodeURIComponent(file));
    if (!abs.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await fs.readFile(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e && e.code === 'ENOENT') { res.writeHead(404).end('not found'); return; }
    res.writeHead(500).end(String(e && e.stack || e));
  }
}).listen(PORT, () => console.log('ready http://127.0.0.1:' + PORT));

async function toReq(nodeReq) {
  const chunks = [];
  for await (const c of nodeReq) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(nodeReq.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : v);
  if (!headers.get('origin')) headers.set('Origin', 'http://127.0.0.1:' + PORT);
  return new Request('http://127.0.0.1:' + PORT + nodeReq.url, {
    method: nodeReq.method,
    headers,
    body: body.length ? body : undefined,
  });
}

async function send(res, r) {
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}
