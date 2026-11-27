#!/usr/bin/env node
/**
 * M0 视觉基线采集（docs/react-refactor-plan.md §6-M0 / §5.8 测试矩阵）
 *
 * 4 页面 × 4 主题（?theme=，优先级最高绕开 localStorage 锁定）× 4 视口全页截图：
 *   · 390 档：iPhone 12 设备描述符（hasTouch 触屏仿真档，独立 context）
 *   · 680 / 768 / 1024 档：共用一个桌面 context，setViewportSize 顺序切换
 *     （context 数 4→2，显著降低被 Cloudflare 风控/质询的概率）
 *
 * 抗风控（2026-11-25 实测：单 context 连续 16+ 次导航后，后续 context 收到
 * CF 质询页——5KB 假图 / ERR_CONNECTION_CLOSED）：
 *   · 质询检测：title 含 "Just a moment" / "Attention Required" → 退避重试
 *   · 重试：每张最多 3 次（2s / 6s / 12s 退避）
 *   · 节流：导航间随机 900–1700ms
 *   · 断点续传：默认跳过磁盘上已有的有效截图（≥24KB），重跑只补缺
 *
 * 输出：
 *   · tests/e2e/baseline/screenshots/<page>/<theme>-<w>.jpeg（不入库，.gitignore）
 *   · tests/e2e/baseline/visual-manifest.json（入库：全量文件清单 + sha1）
 *
 * ⚠ M0 基线抓的是【旧版站】；React 版页面迁移完成后用同一脚本重抓对照（N1）。
 * 运行：pnpm e2e:visual-baseline          （断点续传：已有有效图直接跳过）
 *       FRESH=1 pnpm e2e:visual-baseline （全量重采）
 */
import { mkdirSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE || 'https://qing-wander.pages.dev';
const SHOT_DIR = 'tests/e2e/baseline/screenshots';
const FRESH = !!process.env.FRESH;
const THEMES = ['archive', 'blueprint', 'newsprint', 'noir'];
const PAGES = [
  { name: 'index', url: `${BASE}/` },
  { name: 'resume', url: `${BASE}/resume.html` },
  { name: 'jd', url: `${BASE}/jd.html` },
  { name: 'company', url: `${BASE}/company.html?c=zhishu` },
];
const MOBILE = { w: 390, device: 'iPhone 12' };
const DESKTOP_WIDTHS = [680, 768, 1024];
// 有效截图下限：6KB 级别 = CF 质询页假图；真实最小页（jd）也在 100KB+
const MIN_VALID_BYTES = 24 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

function isChallenge(page) {
  const t = (page.url() || '') + ' ' + (page.title?.() ? '' : '');
  return false; // title() 是异步的，改由 goto 后的 url 判断 —— 见 loadPage 内实现
}

async function loadPage(page, url) {
  /** 成功导航并通过质询检测；返回 'ok' | 'challenge' | 'error' */
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1600); // 字体 / 入场余量
      const title = await page.title().catch(() => '');
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      if (/just a moment|attention required|请稍候|verifying/i.test(title)) return 'challenge';
      if (bodyText.length < 200 && /cloudflare|challenge/i.test(bodyText)) return 'challenge';
      if (resp && resp.status() >= 500) return 'error';
      return 'ok';
    } catch (err) {
      if (attempt === 2) return 'error';
      await sleep(3000 * (attempt + 1));
    }
  }
  return 'error';
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** 拍一张；带质询重试与节流。返回 true=成功 */
async function shoot(context, page, p, theme, w, label) {
  const file = `${SHOT_DIR}/${p.name}/${theme}-${w}.jpeg`;
  if (!FRESH && existsSync(file) && statSync(file).size >= MIN_VALID_BYTES) {
    console.log(`= ${label} 已有有效图，跳过`);
    return true;
  }
  for (let attempt = 0; attempt < 3; ) {
    const state = await loadPage(page, `${p.url}${p.url.includes('?') ? '&' : '?'}theme=${theme}`);
    if (state === 'ok') {
      await page.evaluate(() => { // 收掉入场动画，快照取稳定态
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
        document.querySelectorAll('*').forEach((el) => {
          if (getComputedStyle(el).animationPlayState !== 'paused') el.style.animationPlayState = 'paused';
        });
      }).catch(() => {});
      mkdirSync(`${SHOT_DIR}/${p.name}`, { recursive: true });
      await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 60 });
      const kb = Math.round(statSync(file).size / 1024);
      if (statSync(file).size < MIN_VALID_BYTES) {
        console.log(`⚠ ${label} 产物仅 ${kb}KB（疑似质询页），重试`);
        attempt++; await sleep(6000); continue;
      }
      console.log(`✓ ${label} ${kb}KB`);
      await sleep(rand(900, 1700)); // 节流：降低风控触发概率
      return true;
    }
    attempt++;
    const backoff = [2000, 6000, 12000][Math.min(attempt, 2)];
    console.log(`↻ ${label} ${state}，${backoff / 1000}s 退避重试 (${attempt}/3)`);
    await sleep(backoff);
  }
  console.log(`✗ ${label} 3 次重试后仍失败`);
  return false;
}

const failed = [];
try {
  // ── 档一：iPhone 12 设备描述符（hasTouch）──
  {
    const ctx = await browser.newContext({ ...devices[MOBILE.device], deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const p of PAGES) for (const theme of THEMES) {
      if (!(await shoot(ctx, page, p, theme, MOBILE.w, `${p.name}·${theme}·${MOBILE.device}`))) {
        failed.push(`${p.name}/${theme}-${MOBILE.w}`);
      }
    }
    await ctx.close();
  }
  // ── 档二～四：同一桌面 context 内切视口（680/768/1024）──
  {
    const ctx = await browser.newContext({ viewport: { width: DESKTOP_WIDTHS[0], height: 900 } });
    const page = await ctx.newPage();
    for (const w of DESKTOP_WIDTHS) {
      await page.setViewportSize({ width: w, height: w === 768 ? 1024 : 900 });
      for (const p of PAGES) for (const theme of THEMES) {
        if (!(await shoot(ctx, page, p, theme, w, `${p.name}·${theme}·${w}px`))) {
          failed.push(`${p.name}/${theme}-${w}`);
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

// ── 全量清单（磁盘现状，含历次成功产物）──
function sha1(buf) { return createHash('sha1').update(buf).digest('hex').slice(0, 12); }
const manifest = { capturedAt: new Date().toISOString(), base: BASE, engine: 'pre-react(M0)', method: 'fullPage jpeg q60; settle 1.6s; 3D 舞台不保证入镜（对照采集一致性优先）', shots: [] };
for (const p of PAGES) {
  const dir = `${SHOT_DIR}/${p.name}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^(archive|blueprint|newsprint|noir)-(\d+)\.jpeg$/);
    if (!m) continue;
    const buf = (await import('node:fs')).readFileSync(`${dir}/${f}`);
    manifest.shots.push({
      page: p.name, theme: m[1], w: +m[2], file: `${p.name}/${f}`,
      kb: Math.round(buf.length / 1024), sha1: sha1(buf),
      valid: buf.length >= MIN_VALID_BYTES ? undefined : false,
    });
  }
}
manifest.summary = {
  total: manifest.shots.length,
  valid: manifest.shots.filter((s) => s.valid !== false).length,
  suspect: manifest.shots.filter((s) => s.valid === false).length,
  failedThisRun: failed.length,
};
writeFileSync('tests/e2e/baseline/visual-manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\n✓ 清单：磁盘 ${manifest.summary.total} 张（有效 ${manifest.summary.valid}，可疑 ${manifest.summary.suspect}）`);
if (failed.length) { console.log(`✗ 本次仍缺 ${failed.length} 张：${failed.join(', ')}`); process.exitCode = 1; }
