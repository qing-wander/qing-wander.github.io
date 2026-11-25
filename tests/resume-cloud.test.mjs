/* 简历手机号注入 + 云端 PDF —— 离线契约测试
   ──────────────────────────────────────────────────────────────
   公开仓库里只有占位符（138 0000 0000），真号码来自 D1；
   投递/下载用的真实 PDF 存 KV，没上传时回落到仓库脱敏副本。
   ────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PHONE_PLACEHOLDERS, injectResumePhone, phoneFromSiteData, resumePhone,
} from '../functions/lib/resume-inject.js';
import { onRequestGet as pdfGet } from '../functions/api/resume-pdf.js';
import { onRequest as middleware } from '../functions/_middleware.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const PHONE = '+86 180 2283 4605';

test('占位符四种形态都能替换成真实号码', () => {
  let html = 'TEL ' + PHONE_PLACEHOLDERS.join(' | ');
  html = injectResumePhone(html, PHONE);
  for (const ph of PHONE_PLACEHOLDERS) assert.equal(html.includes(ph), false, '残留占位符：' + ph);
  assert.ok(html.includes('+86 180 2283 4605'));
  assert.ok(html.includes('180 2283 4605'));
  assert.ok(html.includes('18022834605'));
});

test('号码为空时原样返回，不把页面搞坏', () => {
  const src = '电话 138 0000 0000';
  assert.equal(injectResumePhone(src, ''), src);
});

test('从站点数据取 tel 卡片的展示号码', () => {
  const data = {
    contact: { cards: [{ label: 'EMAIL', href: 'mailto:a@b.c', value: 'a@b.c' }, { label: 'TEL', href: 'tel:+8618022834605', value: PHONE }] },
  };
  assert.equal(phoneFromSiteData(data), PHONE);
  assert.equal(phoneFromSiteData({}), '');
});

test('resumePhone 从 D1 的 site-data 里读；缺库返回空串', async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind() { return this; },
        async first() {
          return { payload: JSON.stringify({ contact: { cards: [{ href: 'tel:18022834605', value: '180 2283 4605' }] } }) };
        },
      }),
    },
  };
  assert.equal(await resumePhone(env), '180 2283 4605');
  assert.equal(await resumePhone({}), '');
  assert.equal(await resumePhone({ DB: { prepare: () => ({ async first() { throw new Error('x'); } }) } }), '');
});

test('/resume 响应前注入真号码，并标记来源与缓存', async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind() { return this; },
        async first() {
          return { payload: JSON.stringify({ contact: { cards: [{ href: 'tel:+8618022834605', value: PHONE }] } }) };
        },
      }),
    },
  };
  const req = new Request('https://chenpeisheng.cn/resume', { headers: { 'User-Agent': UA } });
  const res = await middleware({
    request: req,
    env,
    next: async () => new Response('<p>电话 138 0000 0000</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Source'), 'cloud');
  assert.equal(html.includes('138 0000 0000'), false);
  assert.ok(html.includes('180 2283 4605'));
});

test('/api/resume-pdf：KV 有真 PDF 就用它，没有回落到静态副本', async () => {
  const kv = { SITE_KV: { async get() { return new Uint8Array([37, 80, 68, 70]).buffer; } } };
  const hit = await pdfGet({ request: new Request('https://x/api/resume-pdf'), env: kv });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('Content-Type'), 'application/pdf');
  assert.equal(hit.headers.get('X-Content-Source'), 'cloud');
  assert.ok(/filename\*=UTF-8''/.test(hit.headers.get('Content-Disposition')));

  const empty = { SITE_KV: { async get() { return null; } } };
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  try {
    const fb = await pdfGet({ request: new Request('https://x/api/resume-pdf'), env: empty });
    assert.equal(fb.status, 200);
    assert.equal(fb.headers.get('X-Content-Source'), 'fallback');
  } finally { globalThis.fetch = orig; }
});

test('仓库里的 resume.html 确实只剩占位符（防回归）', () => {
  const html = readFileSync(new URL('../resume.html', import.meta.url), 'utf8');
  assert.ok(html.includes('138 0000 0000'), '占位符不在了：脱敏脚本或模板变了');
  assert.equal(/\+?8618022834605|18022834605/.test(html), false, '仓库里出现了真实手机号');
});
