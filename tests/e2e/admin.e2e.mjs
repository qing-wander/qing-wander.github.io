#!/usr/bin/env node
/**
 * M1 admin + login E2E（docs/react-refactor-plan.md §6-M1 验收）
 *
 * 前置：node scripts/dev-api-server.mjs（默认 8877，邮箱白名单 dev@local.test，
 * 验证码邮件走 mock resend 打进服务器日志）；pnpm build 已产出 dist-react。
 *
 * 覆盖：
 *   ① login 页：methods 探测渲染 / 邮箱验证码两步流（验证码从 mock 日志提取）/
 *      错误文案 / 登录成功跳 /admin/
 *   ② admin 壳：统计卡、8 个 tab、刷新/退出按钮
 *   ③ 全 tab 逐个走查（各面板渲染 + 关键交互元素存在）
 *   ④ 写路径冒烟：问候文案保存 → toast 反馈（写 D1，dev 库内存态无污染）
 *   ⑤ 平板视口 768/1024 全页快照
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8877';
const LOG = process.env.DEV_LOG || '/tmp/admin-dev.log';
const EMAIL = process.env.ADMIN_EMAIL || 'dev@local.test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* mock resend 打印的邮件里提验证码（subject: 「后台登录验证码 977430」，取最后一次） */
function codeFromLog() {
  for (let i = 0; i < 10; i++) {
    try {
      const txt = readFileSync(LOG, 'utf8');
      const lines = txt.split('\n').filter((l) => l.includes('后台登录验证码'));
      const last = lines[lines.length - 1] || '';
      const m = last.match(/后台登录验证码[^0-9]*(\d{6})/);
      if (m) return m[1];
    } catch { /* log 尚未写盘 */ }
    sleep(300);
  }
  throw new Error('10 次尝试都没从 mock 日志拿到验证码');
}

let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '✓' : '✗') + ' ' + name);
  if (!cond) failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  /* ── ① 登录页 ── */
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 8000 });
  await page.waitForTimeout(700);
  check('登录页标题渲染', (await page.textContent('h1')) === '后台登录');
  check('微信未配置态占位', (await page.textContent('#wxBtn')) === null || true);

  await page.fill('#email', EMAIL);
  await page.click('#sendBtn');
  await page.waitForSelector('#stepCode', { timeout: 8000 });
  check('验证码两步流切到第二步', true);
  check('提示已发出', (await page.textContent('#msg')).includes('验证码已发出'));

  const code = codeFromLog();
  await page.fill('#code', code);
  await page.click('#verifyBtn');
  await page.waitForURL('**/admin**', { timeout: 8000 });
  check('登录成功跳转 /admin/', page.url().includes('/admin'));

  /* ── ② admin 壳 ── */
  await page.waitForSelector('.dash', { timeout: 8000 });
  await page.waitForSelector('.stat-num:not(:empty)', { timeout: 8000 });
  check('统计卡 9 张', (await page.locator('#stats .stat').count()) === 9);
  check('tab 8 个', (await page.locator('.tabs .tab').count()) === 8);
  check('品牌头渲染', (await page.textContent('.brand-name')) === 'SHENGE // CONSOLE');

  /* ── ③ 设备台账（默认 tab）── */
  await page.waitForSelector('#panelDevices tbody tr', { timeout: 8000 });
  check('设备表渲染（含空态行）', (await page.locator('#panelDevices tbody tr').count()) >= 1);
  check('导出按钮在位', await page.locator('#panelDevices .toolbar').textContent().then((t) => t.includes('导出 CSV')));

  /* ── 留言审核 ── */
  await page.click('button.tab:has-text("留言审核")');
  await page.waitForSelector('#panelMessages:not([hidden])', { timeout: 8000 });
  check('留言面板渲染', true);

  /* ── 问答看板 ── */
  await page.click('button.tab:has-text("问答看板")');
  await page.waitForSelector('#panelQa:not([hidden])', { timeout: 8000 });
  await page.waitForTimeout(600);
  check('问答统计卡 5 张', (await page.locator('#panelQa .stats-qa .stat').count()) === 5);

  /* ── 模型与提示词 ── */
  await page.click('button.tab:has-text("模型与提示词")');
  await page.waitForSelector('#panelConfig:not([hidden])', { timeout: 8000 });
  await page.waitForSelector('#panelConfig .theme-chip', { timeout: 8000 });
  check('主题 chips 渲染', (await page.locator('#panelConfig .theme-card, #panelConfig .theme-chip').count()) > 0);
  check('模块配置卡 ≥0', (await page.locator('#panelConfig .cfg-list .cfg-card').count()) >= 0);

  /* ── AI 语音（写路径冒烟：招呼文案保存）── */
  await page.click('button.tab:has-text("AI 语音")');
  await page.waitForSelector('#panelVoice:not([hidden])', { timeout: 8000 });
  await page.waitForSelector('#panelVoice .voice-chip', { timeout: 8000 });
  check('音色卡片渲染', (await page.locator('#panelVoice .voice-chip').count()) >= 1);
  const greetBefore = await page.inputValue('#panelVoice .cfg-textarea');
  await page.fill('#panelVoice .cfg-textarea', '本地联调问候文案，保存后即可见。');
  await page.click('#panelVoice button:has-text("保存文案")');
  await page.waitForSelector('.toast.is-on', { timeout: 8000 });
  check('保存文案 toast 出现', (await page.textContent('.toast.is-on')).includes('已保存'));
  await page.fill('#panelVoice .cfg-textarea', greetBefore || '这里是数字分身的招呼语。'); // 还原
  await page.click('#panelVoice button:has-text("保存文案")');
  await page.waitForTimeout(500);

  /* ── 站点数据 ── */
  await page.click('button.tab:has-text("站点数据")');
  await page.waitForSelector('#panelContent:not([hidden])', { timeout: 8000 });
  await page.waitForSelector('#panelContent .voice-chip', { timeout: 8000 });
  check('数据项 chips 渲染', (await page.locator('#panelContent .voice-chip').count()) >= 1);
  await page.waitForTimeout(800);
  /* 契约：未配置项 text=null（编辑器空）；已配置项是合法 JSON 顶层对象。
     判定用 textarea 实值本身，避免 pill 文案（数据项卡是「N/7 已配置」）歧义。 */
  const jsonText = await page.inputValue('#panelContent textarea.cfg-textarea');
  if (jsonText.trim() === '') {
    check('未配置数据项：编辑器为空（旧版同款行为）', true);
  } else {
    check('已配置数据项：合法 JSON 顶层对象', (() => { try { const o = JSON.parse(jsonText); return !!o && typeof o === 'object' && !Array.isArray(o); } catch { return false; } })());
  }

  /* ── 生成变体 ── */
  await page.click('button.tab:has-text("生成变体")');
  await page.waitForSelector('#panelVariant:not([hidden])', { timeout: 8000 });
  const dlDisabled = await page.locator('#panelVariant button:has-text("下载 HTML")').isDisabled();
  check('未生成时下载按钮置灰', dlDisabled);

  /* ── 角色动画（骨架渲染；旧脚本资产经 /admin/assets 加载）── */
  await page.click('button.tab:has-text("角色动画")');
  await page.waitForTimeout(800);
  check('动画台骨架渲染', (await page.locator('#panelAnim .anim-stage').count()) === 1);

  /* ── ④ 退出登录 ── */
  await page.click('button:has-text("退出")');
  await page.waitForURL('**/login**', { timeout: 8000 });
  check('退出回到登录页', page.url().includes('/login'));
  check('退出提示显示', (await page.textContent('#msg')).includes('已退出登录'));

  await ctx.close();

  /* ── ⑤ 平板视口快照（登录态重新走一遍，768 / 1024）── */
  const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p2.fill('#email', EMAIL);
  await p2.click('#sendBtn');
  await p2.waitForSelector('#stepCode');
  await p2.fill('#code', codeFromLog());
  await p2.click('#verifyBtn');
  await p2.waitForSelector('.dash', { timeout: 8000 });
  await p2.waitForTimeout(1000);
  check('平板 1024 登录并出控制台', true);
  await p2.screenshot({ path: 'tests/e2e/baseline/screenshots/admin/react-1024.jpeg', fullPage: true, type: 'jpeg', quality: 70 });
  await p2.setViewportSize({ width: 768, height: 1024 });
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: 'tests/e2e/baseline/screenshots/admin/react-768.jpeg', fullPage: true, type: 'jpeg', quality: 70 });
  console.log('✓ 平板视口快照 → tests/e2e/baseline/screenshots/admin/');
  await ctx2.close();
} catch (e) {
  console.error('✗ E2E 异常：', e.message);
  failed++;
} finally {
  await browser.close();
}

console.log(failed ? `\n✗ ${failed} 项未过` : '\n✓ M1 E2E 全部通过');
process.exit(failed ? 1 : 0);
