/* 边缘中间件回归：爬虫 UA、蜜罐路径、数据同源校验、证书签名、安全头、接口限流
   直接调用 onRequest 并伪造 next()，不依赖真实 Cloudflare 环境。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequest, isBlockedUA, isBlockedPath, isDataPath, isCertPath, hasSameSiteSignal, BLOCKED_UA,
} from '../functions/_middleware.js';
import { certToken } from '../functions/lib/guard.js';

const ORIGIN = 'https://qingfin.cn';
const ENV = { DELIVER_CHALLENGE_SECRET: 'test-secret-do-not-use', ALLOWED_ORIGINS: ORIGIN };

function ctx(path, headers = {}, env = ENV) {
  return {
    request: new Request(ORIGIN + path, { headers }),
    env,
    next: async () => new Response('PAGE', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    waitUntil() {},
    passThroughOnException() {},
  };
}

/* ── 规则函数 ───────────────────────────────────────────────────── */

test('爬虫 / 脚本 UA 被识别，正常浏览器与搜索引擎放行', () => {
  assert.equal(isBlockedUA('python-requests/2.31.0'), true);
  assert.equal(isBlockedUA('Mozilla/5.0 (compatible; GPTBot/1.0)'), true);
  assert.equal(isBlockedUA('Mozilla/5.0 HeadlessChrome/120.0.0.0'), true);
  assert.equal(isBlockedUA('curl/8.4.0'), true);
  assert.equal(isBlockedUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131'), false);
  assert.equal(isBlockedUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), false);
  assert.equal(isBlockedUA('Mozilla/5.0 (compatible; bingbot/2.0)'), false);
  assert.equal(isBlockedUA(''), false);
  assert.ok(BLOCKED_UA.length > 20);
});

test('蜜罐与源码路径被拦，正常页面不受影响', () => {
  assert.equal(isBlockedPath('/.env'), true);
  assert.equal(isBlockedPath('/.git/config'), true);
  assert.equal(isBlockedPath('/wp-login.php'), true);
  assert.equal(isBlockedPath('/phpmyadmin/index.php'), true);
  assert.equal(isBlockedPath('/xmlrpc.php'), true);
  assert.equal(isBlockedPath('/functions/api/deliver.js'), true);
  assert.equal(isBlockedPath('/resume.html'), false);
  assert.equal(isBlockedPath('/assets/print-preview/color-1.png'), false);
  assert.equal(isBlockedPath('/data/site-data.json'), false);
});

test('敏感路径归类正确', () => {
  assert.equal(isDataPath('/data/site-data.json'), true);
  assert.equal(isDataPath('/data/school-profiles.js'), true);
  assert.equal(isDataPath('/css/main.css'), false);
  assert.equal(isCertPath('/assets/resume/certificates/id-card.pdf'), true);
  assert.equal(isCertPath('/assets/resume/chen-peisheng-resume-2026.pdf'), false);
});

test('同源信号判定：same-origin / 地址栏直开放行，跨站与无头拒绝', () => {
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), ORIGIN), true);
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json', { headers: { 'Sec-Fetch-Site': 'none' } }), ORIGIN), true);
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), ORIGIN), false);
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json', { headers: { Referer: ORIGIN + '/resume.html' } }), ORIGIN), true);
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json', { headers: { Referer: 'https://evil.example/x' } }), ORIGIN), false);
  assert.equal(hasSameSiteSignal(new Request(ORIGIN + '/data/x.json'), ORIGIN), false);
});

/* ── 端到端 ─────────────────────────────────────────────────────── */

test('脚本 UA 请求页面直接 403', async () => {
  const res = await onRequest(ctx('/resume.html', { 'User-Agent': 'python-requests/2.31' }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('搜索引擎照常收录，正常响应带安全头', async () => {
  const res = await onRequest(ctx('/resume.html', { 'User-Agent': 'Googlebot/2.1' }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'PAGE');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);
  assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('蜜罐路径 404，不暴露是否存在', async () => {
  for (const p of ['/.env', '/wp-login.php', '/functions/api/deliver.js', '/db/schema.sql']) {
    const res = await onRequest(ctx(p, { 'User-Agent': 'Mozilla/5.0 Chrome/131' }));
    assert.equal(res.status, 404, p);
  }
});

test('数据文件：同源可读，直连脚本与跨站被拒', async () => {
  const ok = await onRequest(ctx('/data/site-data.json', { 'Sec-Fetch-Site': 'same-origin' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('X-Robots-Tag').includes('noindex'), true);

  const noSignal = await onRequest(ctx('/data/site-data.json', { 'User-Agent': 'Mozilla/5.0 Chrome/131' }));
  assert.equal(noSignal.status, 403);

  const cross = await onRequest(ctx('/data/site-data.json', { 'Sec-Fetch-Site': 'cross-site' }));
  assert.equal(cross.status, 403);
});

test('简历证书：没有签名头一律 404，带服务端签名才放行', async () => {
  const path = '/assets/resume/certificates/id-card.pdf';
  const denied = await onRequest(ctx(path, { 'Sec-Fetch-Site': 'same-origin' }));
  assert.equal(denied.status, 404);

  const token = await certToken(ENV, path);
  const ok = await onRequest(ctx(path, { 'X-Cert-Token': token }));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'PAGE');

  const wrong = await onRequest(ctx(path, { 'X-Cert-Token': 'deadbeef' }));
  assert.equal(wrong.status, 404);
});

test('接口响应带 noindex，页面响应不带', async () => {
  const api = await onRequest(ctx('/api/wall', { 'User-Agent': 'Mozilla/5.0 Chrome/131' }));
  assert.match(api.headers.get('X-Robots-Tag'), /noindex/);
  const page = await onRequest(ctx('/index.html', { 'User-Agent': 'Mozilla/5.0 Chrome/131' }));
  assert.equal(page.headers.get('X-Robots-Tag'), null);
});

test('接口超限返回 429（D1 判定超限时）', async () => {
  const db = { prepare() { return { bind: () => ({ first: async () => null }) }; } };
  const res = await onRequest(ctx('/api/chat', { 'User-Agent': 'Mozilla/5.0 Chrome/131', Origin: ORIGIN }, Object.assign({}, ENV, { DB: db })));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'rate_limited');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('接口未超限时正常透传', async () => {
  const db = { prepare() { return { bind: () => ({ first: async () => ({ count: 1 }) }) }; } };
  const res = await onRequest(ctx('/api/chat', { 'User-Agent': 'Mozilla/5.0 Chrome/131' }, Object.assign({}, ENV, { DB: db })));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'PAGE');
});
