/* 学历核验访问申请：纯函数 + 端到端写入路径回归
   全程 mock Resend，不真发邮件；D1 用 node:sqlite 内存库模拟线上同构 SQL。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildAccessNotice } from '../functions/lib/verify-access-notify.js';
import { onRequestPost, onRequestOptions } from '../functions/api/verify-access.js';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8877';

function fakeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const make = (params) => ({
        all: async () => ({ results: stmt.all(...params), success: true, meta: {} }),
        first: async (col) => {
          const row = stmt.all(...params)[0];
          if (!row) return null;
          return col ? (row[col] === undefined ? null : row[col]) : row;
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      });
      return Object.assign(make([]), { bind: (...params) => make(params) });
    },
  };
}

function envOf(extra = {}) {
  return Object.assign({
    DB: fakeDb(),
    ALLOWED_ORIGINS: ORIGIN,
    DEVICE_HASH_PEPPER: 'test-pepper',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Portfolio Resume <onboarding@resend.dev>',
  }, extra);
}

const BASE_BODY = {
  name: '张三',
  identity: 'hr',
  org: '某某科技有限公司 · 招聘部',
  contact: 'hr@example.com',
  purpose: 'background',
  reason: '我是某某科技 HR BP，正在推进该岗位录用流程，需要核验学信网学历以完成入职背调。',
  consent: true,
  device: { platform: 'MacIntel', screen: '1440x900', language: 'zh-CN', timezone: 'Asia/Shanghai' },
};

function post(body = BASE_BODY, headers = {}, env = envOf()) {
  return onRequestPost({
    env,
    request: new Request(ORIGIN + '/api/verify-access', {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Origin': ORIGIN,
        'User-Agent': 'Mozilla/5.0 TestBrowser/1.0',
        'CF-Connecting-IP': '203.0.113.7',
        'CF-IPCountry': 'CN',
        'Referer': ORIGIN + '/school.html?c=xinhua',
      }, headers),
      body: JSON.stringify(body),
    }),
  });
}

/* 捕获 Resend 请求，验证邮件内容而不真发 */
function mockResend(t, responseStatus = 200) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'em_test_1' }), {
      status: responseStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('buildAccessNotice：主题、收件正文、回复地址与 HTML 转义', () => {
  const mail = buildAccessNotice({
    name: '<script>alert(1)</script>',
    identity: 'HR / 招聘负责人',
    org: 'A & B 公司',
    contact: 'hr@example.com',
    purpose: '入职背景调查',
    reason: '需要核验学历\n第二行',
    created_at: Date.UTC(2026, 10, 25, 2, 30, 0),
  }, {
    origin: ORIGIN + '/school.html',
    ipCountry: 'CN', ipHash: 'abc123', userAgent: 'TestUA',
    device: 'platform=MacIntel | screen=1440x900', deviceId: 'dev-1',
  });

  assert.match(mail.subject, /^【学历核验】访问申请/);
  assert.match(mail.subject, /11-25 10:30/); // 北京时间
  assert.equal(mail.replyTo, 'hr@example.com');
  assert.match(mail.text, /当前身份：HR \/ 招聘负责人/);
  assert.match(mail.text, /IP 哈希：abc123/);
  assert.match(mail.text, /需要核验学历\n第二行/);
  /* 元信息里的尖括号会被 safeMeta 直接剔除，正文里的则走 HTML 转义 */
  assert.ok(!mail.html.includes('<script>'));
  assert.match(mail.html, /script alert\(1\) \/script/); // 姓名被净化为纯文本
  assert.match(mail.html, /A &amp; B 公司/);
  assert.match(mail.html, /TestUA/);
});

test('表单校验：姓名 / 身份 / 用途 / 理由 / 承诺缺一不可', async (t) => {
  mockResend(t);
  const cases = [
    [{ ...BASE_BODY, name: '张' }, /至少 2 个字/],
    [{ ...BASE_BODY, identity: 'hacker' }, /当前身份/],
    [{ ...BASE_BODY, purpose: 'hacker' }, /查看用途/],
    [{ ...BASE_BODY, reason: '太短了' }, /15 个字/],
    [{ ...BASE_BODY, consent: false }, /确认信息真实/],
  ];
  for (const [body, msg] of cases) {
    const res = await post(body);
    assert.equal(res.status, 400);
    const d = await res.json();
    assert.equal(d.ok, false);
    assert.match(d.message, msg);
  }
});

test('蜜罐：机器人填写隐藏字段时静默成功且不发信', async (t) => {
  const calls = mockResend(t);
  const res = await post({ ...BASE_BODY, website: 'https://spam.example' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).ok, true);
  assert.equal(calls.length, 0);
});

test('来源白名单拒绝外部站点', async () => {
  const res = await post(BASE_BODY, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'origin_not_allowed');
});

test('OPTIONS 返回预检头', async () => {
  const res = await onRequestOptions({
    env: envOf(),
    request: new Request(ORIGIN + '/api/verify-access', {
      method: 'OPTIONS', headers: { Origin: ORIGIN },
    }),
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-Device-Id/);
});

test('成功申请：邮件发往 hi@qingfin.cn，含身份 / 时间 / 设备 / UA / IP 哈希', async (t) => {
  const calls = mockResend(t);
  const res = await post(BASE_BODY, { 'X-Device-Id': 'test-device-0001' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');

  const mail = JSON.parse(calls[0].init.body);
  assert.deepEqual(mail.to, ['hi@qingfin.cn']);
  assert.equal(mail.reply_to, 'hr@example.com');
  const all = mail.subject + '\n' + mail.text + '\n' + mail.html;
  for (const needle of [
    '张三', 'HR / 招聘负责人', '某某科技有限公司', '入职背景调查',
    'Mozilla/5.0 TestBrowser/1.0', 'CN', 'school.html',
    'platform=MacIntel', 'timezone=Asia/Shanghai', 'test-device-0001',
  ]) {
    assert.ok(all.includes(needle), '邮件缺少：' + needle);
  }
  /* IP 只出现哈希，不出现明文 */
  assert.ok(!all.includes('203.0.113.7'));
  assert.match(all, /IP 哈希：[0-9a-f]{16}/);
});

test('未留邮箱时不设 reply_to', async (t) => {
  const calls = mockResend(t);
  await post({ ...BASE_BODY, contact: '请电话联系 13800000000' });
  const mail = JSON.parse(calls[0].init.body);
  assert.equal(mail.reply_to, undefined);
  assert.match(mail.text, /请电话联系/);
});

test('限流：同一 IP 10 分钟内第 4 次申请被拒', async (t) => {
  mockResend(t);
  const env = envOf();
  for (let i = 0; i < 3; i++) assert.equal((await post(BASE_BODY, {}, env)).status, 200);
  const res = await post(BASE_BODY, {}, env);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'rate_limited');
});

test('D1 未绑定时跳过限流，申请照常送达', async (t) => {
  const calls = mockResend(t);
  const env = envOf();
  delete env.DB;
  for (let i = 0; i < 5; i++) assert.equal((await post(BASE_BODY, {}, env)).status, 200);
  assert.equal(calls.length, 5);
});

test('Resend 未配置时接口仍返回成功（不让访客卡住）', async (t) => {
  const calls = mockResend(t);
  const env = envOf();
  delete env.RESEND_API_KEY;
  const res = await post(BASE_BODY, {}, env);
  assert.equal((await res.json()).ok, true);
  assert.equal(calls.length, 0);
});
