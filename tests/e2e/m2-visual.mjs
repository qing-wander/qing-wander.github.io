#!/usr/bin/env node
/**
 * M2 视觉对比（docs/react-refactor-plan.md §6-M2 验收 / N1 视觉零变化）
 *
 * 同机双服对比，消除线上噪声：
 *   OLD：python http.server 服仓库根（旧版 jd/company/school/404.html）
 *   NEW：同上服 pages-build 混排产物 dist/（REACT_MIGRATED_PAGES 含 M2 四页）
 *
 * 页面集 × 四主题 × 三视口（390 hasTouch / 680 / 1024）双版 PNG 截图，
 * 浏览器内 canvas 逐像素 diff，输出差异像素比例（> 阈值即失败）+ diff 图到 .temp。
 *
 * 用法：
 *   node tests/e2e/m2-visual.mjs            # 全量
 *   node tests/e2e/m2-visual.mjs jd only    # 只测 jd 页（页面名过滤）
 */
import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OLD = process.env.OLD_BASE || 'http://127.0.0.1:8878';
const NEW = process.env.NEW_BASE || 'http://127.0.0.1:8879';
const ONLY = process.argv[2] || '';
const OUT_DIR = '.temp/m2-visual';
const THRESHOLD = Number(process.env.THRESHOLD || '0.002'); // 差异像素比例阈值（0.2%）

const THEMES = ['archive', 'blueprint', 'newsprint', 'noir'];
const PAGES = [
  { name: 'jd', path: '/jd.html', settle: 1400 },
  { name: 'company-zhishu', path: '/company.html?c=zhishu', settle: 2600 },
  { name: 'company-comein', path: '/company.html?c=comein', settle: 2600 },
  { name: 'school', path: '/school.html', settle: 2200 },
];
const MOBILE = { w: 390, device: 'iPhone 12' };
const DESKTOPS = [680, 1024];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
void sleep;

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function shot(context, base, p, theme, w, settle) {
  const page = await context.newPage();
  try {
    const url = base + p.path + (p.path.includes('?') ? '&' : '?') + 'theme=' + theme;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
    /* 字体 / 图片就绪：消除 webfont 加载竞态（字体在截图时刻缺席会让换行与行高全变） */
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
    await page.evaluate(async () => {
      const ims = Array.from(document.images);
      const withTimeout = (pr) => Promise.race([pr, new Promise((r) => setTimeout(r, 8000))]);
      /* 只等视口附近 + loading eager 的图（lazy 离屏图在 fullPage 截图时由 CDP 滚动触发） */
      const near = ims.filter((im) => im.loading !== 'lazy' || im.getBoundingClientRect().top < innerHeight * 1.5);
      await withTimeout(Promise.all(near.map((im) => im.complete ? 1 :
        new Promise((res) => { im.onload = im.onerror = () => res(); im.loading = 'eager'; }))));
    }).catch(() => {});
    await sleep(settle);
    /* 收掉入场动画（与线上基线采集同姿势） */
    await page.evaluate(() => {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
      document.querySelectorAll('*').forEach((el) => {
        if (getComputedStyle(el).animationPlayState !== 'paused') el.style.animationPlayState = 'paused';
      });
    }).catch(() => {});
    await sleep(150);
    const buf = await page.screenshot({ fullPage: true, type: 'png' });
    return buf.toString('base64');
  } finally {
    await page.close();
  }
}

/* Node 侧 PNG 无损解码逐像素 diff（浏览器 canvas 对 >8192px 高度图存在解码质量偏移，
   会制造 1%+ 假差异；pngjs 无损解码与 PIL 复算一致，为准绳） */
function computeDiff(oldB64, newB64) {
  const a = PNG.sync.read(Buffer.from(oldB64, 'base64'));
  const b = PNG.sync.read(Buffer.from(newB64, 'base64'));
  const sameSize = a.width === b.width && a.height === b.height;
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const da = a.data, db = b.data;
  const cmp = Math.min(da.length, db.length);
  let any = 0;      /* 任意差（含 ±1 抗锯齿噪声）：只记录不判定 */
  let strong = 0;   /* 结构性差异（任一通道 >8）：判定口径 */
  for (let i = 0; i < cmp; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 0) any++;
    if (d > 8) strong++;
  }
  const total = cmp / 4;
  return { sameSize, diff: strong, total, ratio: strong / total, anyRatio: any / total, b64: null };
}

const results = [];
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const pages = PAGES.filter((p) => !ONLY || p.name === ONLY || p.name.startsWith(ONLY));
  const jobs = [];
  /* 档一 390 hasTouch */
  const mctx = await browser.newContext({ ...devices[MOBILE.device], deviceScaleFactor: 2 });
  for (const p of pages) for (const t of THEMES) jobs.push({ p, t, w: MOBILE.w, ctx: mctx });
  for (const w of DESKTOPS) {
    const dctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    for (const p of pages) for (const t of THEMES) jobs.push({ p, t, w, ctx: dctx });
  }

  /* 并行窗口：同一 job 内 old→new 顺序截图保证同 context，各 job 间 4 并发 */
  let done = 0;
  const runJob = async (job) => {
    const label = `${job.p.name}·${job.t}·${job.w}`;
    const oldB64 = await shot(job.ctx, OLD, job.p, job.t, job.w, job.p.settle);
    const newB64 = await shot(job.ctx, NEW, job.p, job.t, job.w, job.p.settle);
    const d = computeDiff(oldB64, newB64);
    const pct = (d.ratio * 100).toFixed(3);
    const pass = d.sameSize && d.ratio <= THRESHOLD;
    results.push({ label, pass, pct: d.ratio, sameSize: d.sameSize });
    if (!pass) {
      writeFileSync(`${OUT_DIR}/${job.p.name}-${job.t}-${job.w}-old.png`, Buffer.from(oldB64, 'base64'));
      writeFileSync(`${OUT_DIR}/${job.p.name}-${job.t}-${job.w}-new.png`, Buffer.from(newB64, 'base64'));
    }
    console.log(`${pass ? '✓' : '✗'} ${label} 结构差 ${pct}%（含噪声 ${( (d.anyRatio || 0) * 100).toFixed(3)}%）${d.sameSize ? '' : ' [尺寸不同]'}`);
    done++;
  };
  const WINDOW = 4;
  for (let i = 0; i < jobs.length; i += WINDOW) {
    await Promise.all(jobs.slice(i, i + WINDOW).map((j) => runJob(j)));
  }
  void done;

  const failed = results.filter((r) => !r.pass);
  console.log(`\n视觉对比：通过 ${results.length - failed.length} / 失败 ${failed.length}（阈值 ${THRESHOLD * 100}%）`);
  if (failed.length) {
    console.log('失败清单：');
    for (const f of failed) console.log(`  ${f.label} → ${f.pct * 100 > 100 ? '尺寸' : (f.pct * 100).toFixed(3)}%`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
