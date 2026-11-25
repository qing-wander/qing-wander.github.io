/* 自动投递接口回归：动态称呼 / JD 有无 / PDF+证书附件 / 转义 / 限额
   mock Resend 与本站静态资源，不真发邮件、不依赖磁盘上的 PDF。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../functions/api/deliver.js';
import {
  buildDeliveryEmail, buildSubject, greetingOf, resumeDigest,
  CERT_SLOTS, RESUME_PDF_NAME,
} from '../functions/lib/deliver-content.js';

const ORIGIN = 'http://127.0.0.1:8877';
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

function envOf(extra = {}) {
  return Object.assign({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Portfolio Resume <onboarding@resend.dev>',
    ALLOWED_ORIGINS: ORIGIN,
    SITE_KV: null,
  }, extra);
}

/* 捕获 Resend 请求；站点静态资源按路径返回假 PDF / 404 */
function mockNet(availablePaths = ['/assets/resume/chen-peisheng-resume-2026.pdf']) {
  const calls = { resend: null };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.resend.com')) {
      calls.resend = { url: u, opts, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
    }
    const path = new URL(u).pathname;
    if (availablePaths.includes(path)) {
      return new Response(PDF_BYTES, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function post(body, env = envOf(), headers = {}) {
  return onRequestPost({
    env,
    request: new Request(ORIGIN + '/api/deliver', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Origin: ORIGIN }, headers),
      body: JSON.stringify(body),
    }),
  });
}

const BASE = { to: 'hr@example.com' };

/* ── 纯内容函数 ────────────────────────────────────────────────── */

test('称呼：填写则「某某，您好」，留空则泛化「您好」', () => {
  assert.equal(greetingOf(''), '您好');
  assert.equal(greetingOf('   '), '您好');
  assert.equal(greetingOf('张经理'), '张经理，您好');
});

test('主题随称呼动态变化', () => {
  assert.equal(buildSubject({ recipient: '' }), '陈培胜 · AI Agent 工程师 · 简历自动投递');
  assert.match(buildSubject({ recipient: '李 HR' }), /致 李 HR/);
});

test('简历提炼信息来自数据源，含姓名/能力/项目', () => {
  const d = resumeDigest();
  assert.equal(d.name, '陈培胜');
  assert.ok(d.role.includes('AI Agent'));
  assert.ok(d.skills.length >= 3);
  assert.ok(d.projects.length >= 1);
});

test('JD 为空不渲染区块；有 JD 显示 details 折叠且标签被剥离', () => {
  const base = { to: [], recipient: '', note: '', jd: '', attachedLabels: [], pendingLabels: [] };
  assert.ok(!buildDeliveryEmail(base).html.includes('TARGET JD'));
  const withJd = buildDeliveryEmail({ ...base, jd: '<script>alert(1)</script>\n岗位要求：5 年' });
  assert.match(withJd.html, /TARGET JD/);
  assert.match(withJd.html, /<details>/);
  assert.ok(!withJd.html.includes('<script>')); // 输入标签被 plain() 剥离，剩纯文本
  assert.match(withJd.html, /alert\(1\)<br>岗位要求：5 年/); // 换行保留，供邮件里分段显示
});

test('正文始终列附件清单，标注待补充项', () => {
  const m = buildDeliveryEmail({
    to: [], recipient: '', note: '', jd: '',
    attachedLabels: ['学历证书'], pendingLabels: ['学位证书'],
  });
  assert.match(m.html, /附件清单/);
  assert.match(m.html, new RegExp(RESUME_PDF_NAME.replace('-', '\\-')));
  assert.match(m.html, /学历证书/);
  assert.match(m.html, /学位证书.*待补充/);
  assert.match(m.text, /附件：/);
});

test('XSS 注入：投递人/称呼/附言都被转义', () => {
  const m = buildDeliveryEmail({
    to: ['a@b.com'],
    recipient: '<b>张</b>',
    name: '<img src=x onerror=alert(1)>',
    note: '<script>bad()</script>',
    jd: '', attachedLabels: [], pendingLabels: [],
  });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(!m.html.includes('onerror=alert'));
  assert.match(m.html, /张，您好/); // 标签被剥离，只留纯文本「张」
});

/* ── 接口端到端 ────────────────────────────────────────────────── */

test('OPTIONS 返回 CORS', async () => {
  const res = await onRequestOptions({ request: new Request(ORIGIN + '/api/deliver', {
    method: 'OPTIONS', headers: { Origin: ORIGIN },
  }), env: envOf() });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
});

test('来源不在白名单 → 403', async () => {
  const res = await post(BASE, envOf(), { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('空收件人 / 非法邮箱 → 400', async () => {
  assert.equal((await post({ to: '' })).status, 400);
  assert.equal((await post({ to: 'not-an-email' })).status, 400);
});

test('未配置 Resend → 503', async () => {
  const res = await post(BASE, envOf({ RESEND_API_KEY: '' }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'resend_not_configured');
});

test('成功发送：正文含动态称呼、PDF 附件、JD、在线简历入口', async () => {
  const net = mockNet();
  try {
    const res = await post({
      ...BASE, recipient: '王经理', jd: '岗位：Agent 工程师', note: '请查收', attachments: ['idCard'],
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.to, ['hr@example.com']);

    const sent = net.calls.resend.body;
    assert.match(sent.subject, /致 王经理/);
    assert.match(sent.html, /王经理，您好/);
    assert.match(sent.html, /TARGET JD/);
    assert.match(sent.html, /resume\.html/);
    assert.match(sent.html, /附件清单/);
    assert.ok(Array.isArray(sent.attachments) && sent.attachments.length === 1);
    assert.equal(sent.attachments[0].filename, RESUME_PDF_NAME);
    assert.equal(Buffer.from(sent.attachments[0].content, 'base64').toString(), '%PDF-1.7');
    /* 身份证文件不存在 → 正文标注待补充，不阻塞发信 */
    assert.match(sent.html, /身份证复印件.*待补充/);
    assert.equal(sent.text.includes('岗位：Agent 工程师'), true);
  } finally {
    net.restore();
  }
});

test('勾选多个证书：有的附上、缺的标注；未勾选不渲染', async () => {
  const dipPath = CERT_SLOTS.diploma.path;
  const net = mockNet(['/assets/resume/chen-peisheng-resume-2026.pdf', dipPath]);
  try {
    const res = await post({ ...BASE, attachments: ['diploma', 'degree', 'other'] });
    assert.equal(res.status, 201);
    const sent = net.calls.resend.body;
    assert.equal(sent.attachments.length, 2); // PDF + 学历证书
    assert.deepEqual(sent.attachments.map((a) => a.filename), [RESUME_PDF_NAME, CERT_SLOTS.diploma.filename]);
    assert.match(sent.html, /学历证书/);
    assert.match(sent.html, /学位证书.*待补充/);
    assert.match(sent.html, /其他相关资质证书.*待补充/);
  } finally {
    net.restore();
  }
});

test('无效证书 key 被忽略（只认白名单）', async () => {
  const net = mockNet();
  try {
    const res = await post({ ...BASE, attachments: ['../../etc/passwd', 'idCard', 123] });
    assert.equal(res.status, 201);
    const sent = net.calls.resend.body;
    assert.equal(sent.attachments.length, 1); // 只有 PDF，非法 key 全丢弃
  } finally {
    net.restore();
  }
});

test('JD 留空不渲染区块；称呼留空显示「您好」', async () => {
  const net = mockNet();
  try {
    const res = await post(BASE);
    assert.equal(res.status, 201);
    const sent = net.calls.resend.body;
    assert.ok(!sent.html.includes('TARGET JD'));
    assert.match(sent.html, /您好/);
    assert.ok(!sent.subject.includes('致 '));
  } finally {
    net.restore();
  }
});

test('Resend 403/422 → recipient_not_verified（前端走 mailto 兜底）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.resend.com')) return new Response('{"message":"not verified"}', { status: 403 });
    return new Response(PDF_BYTES, { status: 200 });
  };
  try {
    const res = await post(BASE);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'recipient_not_verified');
  } finally {
    globalThis.fetch = orig;
  }
});
