/* 本地联调服务器：静态文件 + 真实 functions/api 逻辑（内存 KV，拦截 Resend 发信） */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet as wallGet, onRequestPost as wallPost, onRequestDelete as wallDel, onRequestOptions as wallOpt } from '../functions/api/wall.js';
import { onRequestPost as deliverPost, onRequestOptions as deliverOpt } from '../functions/api/deliver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8877);
/* 内存 KV：模拟 expirationTtl，否则本地测不出「固定窗口限流到期自动解锁」。
   WALL_SEED=<n> 可预置 n 条历史留言，用来验收分页 / 加载更多。 */
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
const SEED = Number(process.env.WALL_SEED || 0);
if (SEED > 0) {
  const now = Date.now();
  const seed = Array.from({ length: Math.min(SEED, 100) }, (_, i) => ({
    id: 'wseed' + i,
    name: i % 4 === 0 ? '匿名访客' : '访客' + (i + 1),
    text: '这是本地联调用的第 ' + (i + 1) + ' 条留言，用来检查分页与加载更多是否正常。',
    ts: now - i * 3600000,
  }));
  KV.set('wall:messages', { value: JSON.stringify(seed), expiresAt: 0 });
  console.log('[seed] 预置 ' + seed.length + ' 条留言');
}
/* 本地模拟 Resend：只记录，不发真实邮件。
   MOCK_RESEND=unverified 时模拟「域名未验证」→ 422，用来验收 mailto 兜底。
   MOCK_RESEND=nokey 时模拟未配置 API Key → 503。 */
const MOCK = process.env.MOCK_RESEND || '';
const ENV = {
  SITE_KV,
  ALLOWED_ORIGINS: 'http://127.0.0.1:' + PORT + ',http://localhost:' + PORT,
  RESEND_FROM: process.env.RESEND_FROM || '',
  DELIVER_BCC: process.env.DELIVER_BCC || '',
  /* 本地默认给一个测试令牌，方便验收 DELETE；不设就等于线上「未配置」形态 */
  WALL_ADMIN_TOKEN: process.env.WALL_ADMIN_TOKEN || 'local-admin-token',
};
if (MOCK !== 'nokey') ENV.RESEND_API_KEY = 're_local_test';
/* WALL_NO_KV=1 模拟「Pages 里忘了绑定 SITE_KV」的线上形态，用来验收关闭态与 ?wallDebug=1 */
if (process.env.WALL_NO_KV === '1') {
  delete ENV.SITE_KV;
  console.log('[mock] 未绑定 SITE_KV：/api/wall 将返回 open=false, reason=kv_not_bound');
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
    if (p === '/api/wall') {
      const r = req.method === 'GET' ? await handler(wallGet, req)
        : req.method === 'POST' ? await handler(wallPost, req)
        : req.method === 'DELETE' ? await handler(wallDel, req)
        : await handler(wallOpt, req);
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