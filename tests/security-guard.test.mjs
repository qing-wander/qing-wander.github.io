/* 公共防护库回归：凭证签发 / 过期 / 篡改 / 换 IP / 用途不符 / PoW / 限流
   （注：tests/guard.test.mjs 是 bullet 改写护栏，与此不同，故另起文件名。）
   目标是把「脚本能不能绕过验证」这件事钉死在测试里。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  issueProof, verifyProof, hmacHex, ipTag, limit, gate, kvBump,
  hourKey, minuteKey, dayKey, tooLarge, certToken, isAllowedOrigin, allowedOrigins,
} from '../functions/lib/guard.js';

const ORIGIN = 'https://chenpeisheng.cn';
const ENV = { DELIVER_CHALLENGE_SECRET: 'test-secret-do-not-use' };

function req(headers = {}, url = ORIGIN + '/api/deliver') {
  return new Request(url, { headers });
}
function reqWithIp(ip, extra = {}) {
  return req(Object.assign({ 'CF-Connecting-IP': ip }, extra));
}

/* 本地解题：与服务端同一算法，用 node:crypto 同步算，几千次迭代毫秒级 */
function solve(token, difficulty) {
  if (!difficulty) return '';
  const prefix = '0'.repeat(difficulty);
  for (let i = 0; i < 500000; i++) {
    const n = i.toString(36);
    if (createHash('sha256').update(token + ':' + n).digest('hex').startsWith(prefix)) return n;
  }
  throw new Error('解不出 PoW（难度过高？）');
}

async function fresh(env = ENV, ip = '203.0.113.7') {
  const r = reqWithIp(ip);
  const p = await issueProof(env, r, 'deliver');
  return { token: p.token, nonce: solve(p.token, p.difficulty), p };
}

test('合法凭证通过校验', async () => {
  const { token, nonce } = await fresh();
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token, nonce }, 'deliver');
  assert.equal(out.ok, true);
});

test('缺凭证 / 空凭证 → verification_required', async () => {
  assert.equal((await verifyProof(ENV, req(), undefined, 'deliver')).error, 'verification_required');
  assert.equal((await verifyProof(ENV, req(), {}, 'deliver')).error, 'verification_required');
  assert.equal((await verifyProof(ENV, req(), { token: '' }, 'deliver')).error, 'verification_required');
});

test('不用 PoW 直接提交 → verification_required', async () => {
  const p = await issueProof(ENV, reqWithIp('203.0.113.7'), 'deliver');
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token: p.token, nonce: '' }, 'deliver');
  assert.equal(out.ok, false);
  assert.equal(out.error, 'verification_required');
});

test('PoW 解错 → verification_failed', async () => {
  const p = await issueProof(ENV, reqWithIp('203.0.113.7'), 'deliver');
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token: p.token, nonce: 'zzz' }, 'deliver');
  assert.equal(out.error, 'verification_failed');
});

test('篡改载荷或签名 → verification_failed', async () => {
  const { token, nonce } = await fresh();
  const parts = token.split('.');
  const tampered = [parts[0], String(Number(parts[1]) + 999), parts[2], parts[3], parts[4]].join('.');
  const badSig = parts.slice(0, 4).concat('0'.repeat(32)).join('.');
  assert.equal((await verifyProof(ENV, reqWithIp('203.0.113.7'), { token: tampered, nonce }, 'deliver')).error, 'verification_failed');
  assert.equal((await verifyProof(ENV, reqWithIp('203.0.113.7'), { token: badSig, nonce }, 'deliver')).error, 'verification_failed');
});

test('换密钥签的凭证不被接受（防伪造）', async () => {
  const other = { DELIVER_CHALLENGE_SECRET: 'another-secret' };
  const { token, nonce } = await fresh(other);
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token, nonce }, 'deliver');
  assert.equal(out.error, 'verification_failed');
});

test('换 IP 使用 → verification_failed（凭证绑定来源 IP）', async () => {
  const { token, nonce } = await fresh(ENV, '203.0.113.7');
  const out = await verifyProof(ENV, reqWithIp('198.51.100.9'), { token, nonce }, 'deliver');
  assert.equal(out.error, 'verification_failed');
});

test('用途不符（拿投递凭证去打别的接口）→ verification_failed', async () => {
  const { token, nonce } = await fresh();
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token, nonce }, 'wall');
  assert.equal(out.error, 'verification_failed');
});

test('过期凭证 → verification_expired', async () => {
  const past = Math.floor(Date.now() / 1000) - 30;
  const tag = await ipTag(reqWithIp('203.0.113.7'), ENV, 12);
  const payload = ['deliver', past, tag, 'abc'].join('.');
  const sig = (await hmacHex(ENV.DELIVER_CHALLENGE_SECRET, payload)).slice(0, 32);
  const out = await verifyProof(ENV, reqWithIp('203.0.113.7'), { token: payload + '.' + sig, nonce: '0' }, 'deliver');
  assert.equal(out.error, 'verification_expired');
});

test('难度设为 0 时只要凭证、不要求 PoW（可用于离线降级）', async () => {
  const env = { DELIVER_CHALLENGE_SECRET: 'test-secret-do-not-use', DELIVER_POW_DIFFICULTY: '0' };
  const p = await issueProof(env, reqWithIp('203.0.113.7'), 'deliver');
  assert.equal(p.difficulty, 0);
  const out = await verifyProof(env, reqWithIp('203.0.113.7'), { token: p.token }, 'deliver');
  assert.equal(out.ok, true);
});

test('难度可配置且有上限', async () => {
  const p = await issueProof({ DELIVER_CHALLENGE_SECRET: 'x', DELIVER_POW_DIFFICULTY: '99' }, req(), 'deliver');
  assert.equal(p.difficulty, 5);
});

/* ── 限流 ──────────────────────────────────────────────────────── */

function fakeDb(row) {
  return {
    prepare() {
      return { bind: () => ({ first: async () => row }) };
    },
  };
}

test('D1 返回空行 → 判定超限；返回计数行 → 放行', async () => {
  const entries = [{ bucket: 'x', window: hourKey(), limit: 3, ttl: 60 }];
  assert.ok(await limit({ DB: fakeDb(null) }, entries), '空行代表已超限，必须拦住');
  assert.equal(await limit({ DB: fakeDb({ count: 1 }) }, entries), null);
  assert.equal(await limit({ DB: fakeDb({ count: 3 }) }, entries), null, '等于上限仍放行');
});

test('D1 抛错时 fail-open（可用性优先）', async () => {
  const boom = { prepare() { throw new Error('d1 down'); } };
  assert.equal(await limit({ DB: boom }, [{ bucket: 'x', window: hourKey(), limit: 3, ttl: 60 }]), null);
});

test('无 D1 时退 KV 计数', async () => {
  const store = new Map();
  const kv = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
  };
  const entries = [{ bucket: 'kvtest', window: hourKey(), limit: 2, ttl: 60 }];
  assert.equal(await limit({ SITE_KV: kv }, entries), null, '第 1 次放行');
  assert.equal(await limit({ SITE_KV: kv }, entries), null, '第 2 次放行');
  assert.ok(await limit({ SITE_KV: kv }, entries), '第 3 次超限');
});

test('gate / kvBump 基础行为：0 表示超限，null 表示存储异常', async () => {
  assert.equal(await gate(fakeDb({ count: 2 }), 'b', 'w', 5, 60), 2);
  assert.equal(await gate(fakeDb(null), 'b', 'w', 5, 60), 0);
  assert.equal(await kvBump(null, 'k', 60), null);
});

test('请求体上限：超过 64KB 判为过大', () => {
  const big = new Request(ORIGIN + '/api/deliver', { method: 'POST', headers: { 'Content-Length': '70000' } });
  const small = new Request(ORIGIN + '/api/deliver', { method: 'POST', headers: { 'Content-Length': '1200' } });
  assert.equal(tooLarge(big), true);
  assert.equal(tooLarge(small), false);
  assert.equal(tooLarge(new Request(ORIGIN + '/api/deliver')), false);
});

test('时间窗键：分钟 / 小时 / 日各自单调', () => {
  const t = Date.UTC(2026, 10, 25, 6, 30);
  assert.equal(minuteKey(t), 'm' + Math.floor(t / 60000));
  assert.equal(hourKey(t), 'h' + Math.floor(t / 3600000));
  assert.equal(dayKey(t), 'd2026-11-25');
});

test('证书签名头与路径强绑定', async () => {
  const a = await certToken(ENV, '/assets/resume/certificates/id-card.pdf');
  const b = await certToken(ENV, '/assets/resume/certificates/degree.pdf');
  assert.equal(a.length, 32);
  assert.notEqual(a, b);
  assert.equal(a, await certToken(ENV, '/assets/resume/certificates/id-card.pdf'));
});

test('来源白名单支持通配子域，且拒绝外站', () => {
  const allow = allowedOrigins({});
  assert.equal(isAllowedOrigin('https://chenpeisheng.cn', allow), true);
  assert.equal(isAllowedOrigin('https://abc.shenge-work.pages.dev', allow), true);
  assert.equal(isAllowedOrigin('https://evil.example', allow), false);
  assert.equal(isAllowedOrigin('', allow), false);
});
