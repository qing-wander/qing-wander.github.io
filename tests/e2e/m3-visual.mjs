#!/usr/bin/env node
/* M3 index 视觉对比（复用 m2-visual 的 Node pngjs 结构差口径） */
import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync } from 'node:fs';

const OLD = 'http://127.0.0.1:8878';
const NEW = 'http://127.0.0.1:8879';
const THEMES = ['archive', 'blueprint', 'newsprint', 'noir'];
const OUT = '.temp/m3-visual';
const TH = 0.002;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function shot(ctx, base, theme, w, stable) {
  /* Chromium 全页捕获对含 3D 舞台页面有 ~80px 高度抖动（同页连拍两次可复现）；
     stable 模式：高度异常时重拍（最多 3 次），只接受与期望一致的那张 */
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = await shotOnce(ctx, base, theme, w);
    if (!stable || !buf.jitter) return buf;
  }
  return shotOnce(ctx, base, theme, w);
}

async function shotOnce(ctx, base, theme, w) {
  const page = await ctx.newPage();
  const info = { jitter: false };
  try {
    await page.goto(base + '/index.html?theme=' + theme, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
    /* 收掉入场动画与 3D 舞台的持续渲染差异（截图取稳定态，两版同姿势） */
    await page.evaluate(() => {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
      document.querySelectorAll('*').forEach((el) => {
        if (getComputedStyle(el).animationPlayState !== 'paused') el.style.animationPlayState = 'paused';
      });
      /* 3D 模型的 model-viewer 动画不受 CSS 控制（逐帧推进不可暂停），
         两版截取姿势天然不同 → 对比时隐藏舞台，只裁定版式回归。
         同理：marquee / works 无缝横滚的动画相位随加载时刻不同——
         冻结到零位（transform none + animation none），两版取同一静止帧 */
      const stage = document.getElementById('aiStage');
      if (stage) stage.style.visibility = 'hidden';
      const mq = document.querySelector('.marquee-track');
      if (mq) { mq.style.animation = 'none'; mq.style.transform = 'none'; }
      const wt = document.getElementById('worksGrid');
      if (wt) { wt.style.animation = 'none'; wt.style.transform = 'none'; }
    }).catch(() => {});
    await sleep(1400);
    const b64 = (await page.screenshot({ fullPage: true, type: 'png' })).toString('base64');
    return b64;
  } finally { await page.close(); }
}
void 0;

function diff(a, b) {
  const A = PNG.sync.read(Buffer.from(a, 'base64'));
  const B = PNG.sync.read(Buffer.from(b, 'base64'));
  const sameSize = A.width === B.width && A.height === B.height;
  const cmp = Math.min(A.data.length, B.data.length);
  let any = 0, strong = 0;
  for (let i = 0; i < cmp; i += 4) {
    const d = Math.max(Math.abs(A.data[i]-B.data[i]), Math.abs(A.data[i+1]-B.data[i+1]), Math.abs(A.data[i+2]-B.data[i+2]));
    if (d > 0) any++;
    if (d > 8) strong++;
  }
  return { sameSize, ratio: strong / (cmp/4), anyRatio: any / (cmp/4) };
}

let pass = 0, fail = 0;
try {
  mkdirSync(OUT, { recursive: true });
  const jobs = [];
  const mctx = await browser.newContext({ ...devices['iPhone 12'], deviceScaleFactor: 2 });
  for (const t of THEMES) jobs.push({ t, w: 390, ctx: mctx });
  for (const w of [680, 1024]) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    for (const t of THEMES) jobs.push({ t, w, ctx: c });
  }
  for (const job of jobs) {
    const label = `index·${job.t}·${job.w}`;
    const n = await shot(job.ctx, NEW, job.t, job.w);
    let o = await shot(job.ctx, OLD, job.t, job.w);
    /* Chromium 对该页捕获高度抖动：以 new 为基准，old 高度偏离 >4px 时重拍（最多 2 轮） */
    for (let k = 0; k < 2; k++) {
      const d0 = diff(o, n);
      if (d0.sameSize) break;
      o = await shot(job.ctx, OLD, job.t, job.w);
    }
    const d = diff(o, n);
    const ok = d.sameSize && d.ratio <= TH;
    if (ok) pass++; else fail++;
    console.log(`${ok ? '✓' : '✗'} ${label} 结构差 ${(d.ratio*100).toFixed(3)}%（含噪声 ${(d.anyRatio*100).toFixed(2)}%）${d.sameSize ? '' : ' [尺寸不同]'}`);
    if (!ok) {
      const fs = await import('node:fs');
      fs.writeFileSync(`${OUT}/${job.t}-${job.w}-old.png`, Buffer.from(o, 'base64'));
      fs.writeFileSync(`${OUT}/${job.t}-${job.w}-new.png`, Buffer.from(n, 'base64'));
    }
  }
  console.log(`\nindex 视觉对比：通过 ${pass} / 失败 ${fail}（阈值 ${TH*100}%）`);
  if (fail) process.exitCode = 1;
} finally { await browser.close(); }
