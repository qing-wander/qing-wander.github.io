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
const PHONE = '+86 173 2963 5456';

test('占位符四种形态都能替换成真实号码', () => {
  let html = 'TEL ' + PHONE_PLACEHOLDERS.join(' | ');
  html = injectResumePhone(html, PHONE);
  for (const ph of PHONE_PLACEHOLDERS) assert.equal(html.includes(ph), false, '残留占位符：' + ph);
  assert.ok(html.includes('+86 173 2963 5456'));
  assert.ok(html.includes('17329635456'));
});

test('号码为空时原样返回，不把页面搞坏', () => {
  const src = '电话 138 0000 0000';
  assert.equal(injectResumePhone(src, ''), src);
});

test('从站点数据取 tel 卡片的展示号码', () => {
  const data = {
    contact: { cards: [{ label: 'EMAIL', href: 'mailto:a@b.c', value: 'a@b.c' }, { label: 'TEL', href: 'tel:+8617329635456', value: PHONE }] },
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
          return { payload: JSON.stringify({ contact: { cards: [{ href: 'tel:17329635456', value: PHONE }] } }) };
        },
      }),
    },
  };
  assert.equal(await resumePhone(env), PHONE);
  assert.equal(await resumePhone({}), '');
  assert.equal(await resumePhone({ DB: { prepare: () => ({ async first() { throw new Error('x'); } }) } }), '');
});

test('/resume 响应前注入真号码，并标记来源与缓存', async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind() { return this; },
        async first() {
          return { payload: JSON.stringify({ contact: { cards: [{ href: 'tel:+8617329635456', value: PHONE }] } }) };
        },
      }),
    },
  };
  const req = new Request('https://qing-wander.github.io/resume', { headers: { 'User-Agent': UA } });
  const res = await middleware({
    request: req,
    env,
    next: async () => new Response('<p>电话 138 0000 0000</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Source'), 'cloud');
  assert.equal(html.includes('138 0000 0000'), false);
  assert.ok(html.includes('173 2963 5456'));
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

test('仓库里的 resume.html 只出现本站联系号码，不带上游作者号码', () => {
  const html = readFileSync(new URL('../resume.html', import.meta.url), 'utf8');
  /* 本站（李清）采用实名公开联系方式：允许真实号码或脱敏占位符，
     但绝不能把上游作者的号码随模板带进来。 */
  assert.ok(
    /173\s?2963\s?5456|138\s0000\s0000/.test(html),
    '简历页缺少联系号码（真实号或占位符都算）',
  );
  assert.equal(/\+?8617329635456|17329635456/.test(html), false, '仓库里出现了上游作者手机号');
});
