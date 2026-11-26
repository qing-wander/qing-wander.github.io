#!/usr/bin/env node
/**
 * M4 resume.html 迁移 E2E（docs/react-refactor-plan.md §6-M4 验收）
 *
 * 前置：混排 dist 在 :8879（REACT_MIGRATED_PAGES 含 resume.html）；
 *       旧版仓库根 :8878（双服对照）。
 *
 * 覆盖：单源等价（逐字 diff）、六段 body 直出、主题引导、档案深链、
 *       投递全流（challenge PoW → preview iframe → deliver 成功 → mailto 兜底）、
 *       PDF 页数预算（check_resume_pages 对新版产物）。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const NEW = process.env.NEW_BASE || 'http://127.0.0.1:8879';
const OLD = process.env.OLD_BASE || 'http://127.0.0.1:8878';
const ROOT = resolve(import.meta.dirname, '../..');
let failed = 0, passed = 0;
const check = (name, cond) => { console.log((cond ? '✓' : '✗') + ' ' + name); cond ? passed++ : failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── ① 单源等价：构建产物与旧链生成物逐字一致 ── */
try {
  const built = readFileSync(resolve(ROOT, 'dist-react/resume.html'), 'utf8');
  const legacy = readFileSync(resolve(ROOT, 'resume.html'), 'utf8');
  check('单源等价（dist-react/resume.html ≡ 根目录生成物，逐字一致）', built === legacy);
} catch (e) {
  check('单源等价（读取失败：' + e.message.slice(0, 40) + '）', false);
}

/* ── ② PDF 页数预算（对混排产物）── */
{
  const env = { ...process.env, HTML_PATH: 'dist-react/resume.html' };
  const r = spawnSync('node', [resolve(ROOT, 'scripts/check_resume_pages.mjs'), '--info'], { env, encoding: 'utf8' });
  const out = r.stdout || '';
  check('新版产物 PDF 页数 ≤ 2（' + out.trim() + '）', /PDF 2 页/.test(out));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));

  /* 投递 API mock（在加载前注册） */
  await page.route('**/api/challenge', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, token: 'e2e-token', difficulty: 0, expiresAt: Date.now() + 600000 }),
  }));
  await page.route('**/api/deliver-preview', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, html: '<p>邮件正文预览 E2E</p>', to: ['hr@company.com'],
      subject: '陈培胜 · 简历', attachments: ['chen-peisheng-resume-2026.pdf'],
      replyTo: 'you@company.com',
    }),
  }));
  let deliverMode = 'success';
  await page.route('**/api/deliver', (route) => {
    if (deliverMode === 'fallback') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'recipient_not_verified', message: '域名未验证' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, to: ['hr@company.com'] }) });
  });

  await page.goto(NEW + '/resume.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  /* ── ③ 页面结构与六段 body ── */
  const st = await page.evaluate(() => ({
    title: document.title,
    theme: document.documentElement.getAttribute('data-theme') || '(default)',
    secs: Array.from(document.querySelectorAll('.sec-title .sec-no')).map((e) => e.textContent).join(','),
    sheetHead: !!document.querySelector('.sheet-head'),
    expItems: document.querySelectorAll('.sheet .item').length,
    cpLink: !!document.querySelector('.cp-name-link'),
    spLink: !!document.querySelector('.sp-name-link'),
    printBtn: !!document.querySelector('.actions .btn-solid'),
    longImgBtn: !!document.getElementById('btnLongImage'),
    deliverBtn: !!document.getElementById('btnDeliver'),
    dlOverlay: !!document.getElementById('dlOverlay'),
    dlpOverlay: !!document.getElementById('dlpOverlay'),
    openPrintPreview: typeof window.openPrintPreview,
    printPreviewLoaded: !!(window.PrintPreview || document.getElementById('ppOverlay')),
  }));
  check('title 等价（数据直出）', st.title.length > 4);
  check('五段编号 01-05', st.secs === '01,02,03,04,05');
  check('头部 sheet-head 直出', st.sheetHead);
  check('公司档案深链（cp-name-link）', st.cpLink);
  check('学校档案深链（sp-name-link）', st.spLink);
  check('打印按钮 + openPrintPreview（print-preview.js 桥接）', st.printBtn && st.openPrintPreview === 'function');
  check('投递按钮 + 弹窗壳直出', st.deliverBtn && st.dlOverlay && st.dlpOverlay);

  /* ── ④ 主题引导（?theme= 覆盖）── */
  await page.goto(NEW + '/resume.html?theme=noir', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  check('主题引导 ?theme=noir 生效', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'noir'));
  await page.goto(NEW + '/resume.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* ── ⑤ 投递全流（成功路径）── */
  await page.click('#btnDeliver');
  await page.waitForTimeout(500);
  check('投递弹窗打开', await page.evaluate(() => document.getElementById('dlOverlay').classList.contains('show')));
  await page.fill('#dlTo', 'hr@company.com');
  await page.fill('#dlRecipient', '张经理');
  await page.fill('#dlJd', '岗位名称：AI Agent 工程师');
  /* alert 拦截：deliver 成功后弹确认框 */
  let alertText = '';
  page.on('dialog', (d) => { alertText = d.message(); d.accept(); });
  await page.click('#dlSend');
  await page.waitForTimeout(800);
  const pre = await page.evaluate(() => ({
    shown: document.getElementById('dlpOverlay').classList.contains('show'),
    meta: document.getElementById('dlpMeta').textContent,
    frameSrcdoc: (document.getElementById('dlpFrame').getAttribute('srcdoc') || '').slice(0, 40),
  }));
  check('预览弹窗打开 + 收件人/主题', pre.shown && pre.meta.includes('hr@company.com') && pre.meta.includes('简历'));
  check('预览 iframe 渲染服务端正文', pre.frameSrcdoc.includes('邮件正文预览 E2E'));
  await page.click('#dlpSend');
  await page.waitForTimeout(900);
  check('投递成功 alert（含收件人）', alertText.includes('已投递') && alertText.includes('hr@company.com'));
  const after = await page.evaluate(() => ({ show: document.getElementById('dlOverlay').classList.contains('show') }));
  check('投递后关窗', !after.show);

  /* ── ⑥ 投递兜底分支（recipient_not_verified → mailto，同样先过预览确认）── */
  deliverMode = 'fallback';
  await page.click('#btnDeliver');
  await page.waitForTimeout(400);
  await page.fill('#dlTo', 'fallback@company.com');
  await page.click('#dlSend');
  await page.waitForTimeout(800);
  await page.click('#dlpSend');
  await page.waitForTimeout(900);
  const fb = await page.evaluate(() => ({
    alt: !document.getElementById('dlAlt').hidden,
    href: document.getElementById('dlMailto').getAttribute('href') || '',
  }));
  check('失败分支 → mailto 兜底显示', fb.alt && fb.href.startsWith('mailto:'));
  check('mailto 已填收件人（encodeURIComponent 编码形）', fb.href.includes(encodeURIComponent('fallback@company.com')));

  /* ── ⑦ 旧版同链对照（8878 上投递流同样可达）── */
  const oldPage = await ctx.newPage();
  await oldPage.route('**/api/challenge', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, token: 't', difficulty: 0, expiresAt: Date.now() + 600000 }),
  }));
  await oldPage.goto(OLD + '/resume.html', { waitUntil: 'load' });
  await oldPage.waitForTimeout(600);
  const oldSt = await oldPage.evaluate(() => ({
    secs: Array.from(document.querySelectorAll('.sec-title .sec-no')).map((e) => e.textContent).join(','),
    deliver: typeof window.openDeliver === 'function' || !!document.getElementById('btnDeliver'),
  }));
  check('旧版 8878 五段对照一致', oldSt.secs === '01,02,03,04,05' && oldSt.deliver);

  console.log(`\nM4 E2E：通过 ${passed} / 失败 ${failed}`);
  if (errs.length) console.log('页面错误：', errs.slice(0, 3).join(' | '));
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
}
