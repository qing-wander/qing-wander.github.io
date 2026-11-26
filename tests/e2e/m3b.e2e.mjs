#!/usr/bin/env node
/**
 * M3-B（分片二）AI 面板 React 化专项 E2E
 * 前置：混排 dist 在 :8879（REACT_MIGRATED_PAGES 含 index.html）
 * 与 m3.e2e.mjs（骨架/板块级）互补，本文件只测「React 岛接管面板」的专属行为：
 *   守卫生效、水合成功（注入按钮存活）、greeting 拉取、断连重试、追问、复制 MD。
 */
import { chromium } from 'playwright';

const NEW = process.env.NEW_BASE || 'http://127.0.0.1:8879';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (name, cond) => { console.log((cond ? '✓' : '✗') + ' ' + name); cond ? passed++ : failed++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));

  /* greeting 与 /api/chat 的 mock 必须在加载前注册 */
  await page.route('**/api/greeting', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, text: '自定义招呼语第一行\n第二行在此' }),
  }));
  let jdHits = 0; /* 断连重试计数：Playwright 重发请求是新 request 对象，不能挂在 request 上 */
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    if (body && body.mode === 'jd') {
      jdHits += 1;
      if (jdHits === 1) { /* 第一次：模拟网络闪断 */ return route.abort('connectionfailed'); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        match: { overall: { score: 65, verdict: '中段命中', summary: '两覆盖一缺口。' },
          rows: [{ req: 'Agent 平台架构', status: 'covered', evidence: [{ point: 'CP.AI 平台', title: '工作经历｜进门财经｜平台' }] },
                 { req: '一线大厂背景', status: 'gap', gap: '无大厂履历', probe: '没有大厂背景，你怎么补这块？' }],
          stats: { covered: 1, partial: 0, gap: 1 } },
        meta: { recalled: 5, requirements: 2, merged: 2 } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, answer: '追问的答案是六个系统。', sources: [],
    }) });
  });

  await page.goto(NEW + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.CP_AI_REACT_READY === true, null, { timeout: 20000 });
  await page.waitForTimeout(2200); /* ai-skins boot */

  /* ① 守卫与水合 */
  const g1 = await page.evaluate(() => ({
    guard: !!window.CP_AI_REACT,
    endpoint: window.CP_AI_ENDPOINT === '/api/chat',
    jdLegacy: typeof window.CP_JD_UI,
    fabOutsideIsland: !document.querySelector('astro-island #aiFab'),
    panelInsideIsland: !!document.querySelector('astro-island #aiPanel'),
    winBtn: !!document.getElementById('aiWinSize'),
    voiceToggle: !!document.querySelector('.ai-voice-toggle'),
    aivoice: !!window.AIVoice,
    stage: !!document.getElementById('aiStage'),
  }));
  check('CP_AI_REACT 守卫注入', !!g1.guard);
  check('CP_AI_ENDPOINT 契约（main.js 守卫分支设置）', g1.endpoint);
  check('jd-match.js 未底载（无 window.CP_JD_UI）', g1.jdLegacy === 'undefined');
  check('FAB 静态直出（岛外，元素身份稳定）', g1.fabOutsideIsland);
  check('面板 aside 在岛内（单根岛水合）', g1.panelInsideIsland);
  check('水合未重建 DOM：aiWinSize 存活', g1.winBtn);
  check('水合未重建 DOM：ai-voice 音量按钮存活', g1.voiceToggle);
  check('ai-voice.js 正常初始化（window.AIVoice）', g1.aivoice);
  check('3D 舞台创建（ai-skins 引用未孤儿化）', g1.stage);

  /* ② FAB 直点开面板 + greeting 异步文案生效 */
  await page.evaluate(() => document.getElementById('aiFab').click());
  await page.waitForTimeout(600);
  const welcome = await page.evaluate(() => (document.querySelector('.ai-msg-bot .ai-bubble')?.textContent || ''));
  check('greeting mock 文案生效（含第二行）', welcome.includes('自定义招呼语第一行') && welcome.includes('第二行在此'));

  /* ③ quick chips 点击提交（问答回答 mock） */
  await page.click('.ai-quick .ai-chip:not(.ai-chip-mode)');
  await page.waitForTimeout(800);
  const ans = await page.evaluate(() => (document.querySelector('.ai-msg-bot:last-of-type .ai-bubble')?.textContent || ''));
  check('quick chip 提交 → 问答回答', ans.includes('追问的答案是六个系统'));

  /* ④ JD 模式：示例填入 → 断连自动重试一次 → 结果卡 → 追问 */
  await page.click('[data-ai-mode="jd"]');
  await page.waitForTimeout(400);
  const lead = await page.evaluate(() => (document.querySelector('.ai-msg-bot:last-of-type .ai-bubble')?.textContent || ''));
  check('JD 切换引导消息（quota 文案）', lead.includes('30–1500 字') && lead.includes('每人 10 分钟 4 次'));
  await page.click('[data-jd-sample="agent"]');
  await page.waitForTimeout(300);
  const filled = await page.evaluate(() => (document.getElementById('aiInput')?.value || '').length);
  check('JD 示例填入输入框（不直接发）', filled >= 200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500); /* 第一次 abort + 900ms 重试 + 响应 */
  const retryMsg = await page.evaluate(() => Array.from(document.querySelectorAll('.ai-msg-bot .ai-bubble')).map(e => e.textContent).join('|'));
  check('断连自动重试提示出现', retryMsg.includes('通道闪断，正在自动重试一次'));
  const jdCard = await page.evaluate(() => ({
    card: !!document.querySelector('.ai-jd-card'),
    score: document.querySelector('.ai-jd-score b')?.textContent,
    probeBtn: !!document.querySelector('.ai-jd-probe'),
    copyBtn: !!document.querySelector('[data-jd-copy]'),
    openBtn: !!document.querySelector('[data-jd-open]'),
  }));
  check('JD 重试后结果卡渲染（score 65）', jdCard.card && jdCard.score === '65');
  check('缺口行追问按钮', jdCard.probeBtn);

  /* ⑥ 复制 Markdown（mock clipboard）—— 必须在追问切回 qa 之前（jd 分栏在 qa 模式下被 CSS 隐藏） */
  await page.evaluate(() => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
    window.__copied = () => copied;
  });
  await page.click('[data-jd-copy]');
  await page.waitForTimeout(400);
  const copiedText = await page.evaluate(() => window.__copied());
  check('复制 Markdown（含总分与需求行）', /65/.test(copiedText || '') && /Agent/.test(copiedText || ''));
  const copyLabel = await page.evaluate(() => document.querySelector('[data-jd-copy]').textContent);
  check('复制按钮文案反馈', copyLabel.includes('已复制'));

  /* ⑤ 追问按钮：切回 qa 并提交（probe 文本为问题） */
  await page.click('.ai-jd-probe');
  await page.waitForTimeout(900);
  const probeFlow = await page.evaluate(() => ({
    modeClass: document.getElementById('aiPanel').classList.contains('ai-mode-jd'),
    lastBot: (document.querySelector('.ai-msg-bot:last-of-type .ai-bubble')?.textContent || '').slice(0, 20),
    lastUser: (document.querySelector('.ai-msg-user:last-of-type .ai-bubble')?.textContent || '').slice(0, 20),
  }));
  check('追问切回 qa 模式', !probeFlow.modeClass);
  check('追问直接提交并收到答案', probeFlow.lastBot.includes('追问的答案'));

  /* ⑦ 模式切回 qa（面板类/placeholder 联动）—— 追问已切 qa，这里验证联动状态 */
  await page.click('[data-ai-mode="qa"]');
  await page.waitForTimeout(300);
  const modeBack = await page.evaluate(() => ({
    cls: document.getElementById('aiPanel').classList.contains('ai-mode-jd'),
    ph: document.getElementById('aiInput').placeholder,
    chips: Array.from(document.querySelectorAll('.ai-quick .ai-chip')).map(e => e.textContent).join(','),
  }));
  check('切回 qa：面板类复位 + placeholder 复位', !modeBack.cls && modeBack.ph.includes('Agent 项目'));
  check('qa 快捷 chips 恢复 4 问 + JD 切钮', modeBack.chips.includes('0→1 系统') && modeBack.chips.includes('JD 匹配 ↗'));
  const jdKept = await page.evaluate(() => document.querySelectorAll('#aiBody [data-mode="jd"]').length);
  check('切回 qa 后 jd 消息/卡仍保留在分栏 DOM', jdKept >= 3);

  /* ⑧ Esc 关面板 + body 锁解除 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc 关面板', await page.evaluate(() => document.getElementById('aiPanel').hidden && !document.body.classList.contains('ai-lock')));

  console.log(`\nM3-B E2E：通过 ${passed} / 失败 ${failed}`);
  if (errs.length) console.log('页面错误：', errs.slice(0, 3).join(' | '));
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
}
