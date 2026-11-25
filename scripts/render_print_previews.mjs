#!/usr/bin/env node
/**
 * 生成「打印效果预览」图片：预览源就是真实导出的 PDF，不再是 CSS 猜测。
 *
 *   node scripts/render_print_previews.mjs           # 生成
 *   node scripts/render_print_previews.mjs --check   # 校验预览图与 resume.html 同步（CI 无浏览器也能跑）
 *
 * 流程：resume.html → 剥掉本地链接改写脚本 → Chrome headless 打印 PDF
 *      → pypdf 拆页 + sips/pdftoppm 栅格化 → 彩色 PNG + 像素灰度 PNG
 *      → assets/print-preview/manifest.json（记录 resume.html 的 sha256）
 *
 * 生成的 PDF 同时覆盖 .temp/陈培胜-简历-2026.pdf，保证用户手里的文件和预览同源。
 * 以后 resume.html 或打印样式有改动，必须重跑本脚本并一并提交 assets/print-preview/。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const HTML = join(ROOT, 'resume.html');
const OUT = join(ROOT, 'assets', 'print-preview');
const MANIFEST = join(OUT, 'manifest.json');
const DELIVERED_PDF = join(ROOT, '.temp', '陈培胜-简历-2026.pdf');
const ATTACH_PDF = join(ROOT, 'assets', 'resume', 'chen-peisheng-resume-2026.pdf');
const CHECK_ONLY = process.argv.includes('--check');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function check() {
  if (!existsSync(HTML) || !existsSync(MANIFEST)) {
    console.error('::error::缺少 resume.html 或 assets/print-preview/manifest.json，先跑 node scripts/render_print_previews.mjs');
    return 1;
  }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const actual = sha256(readFileSync(HTML));
  if (m.source_sha256 !== actual) {
    console.error(`::error::打印预览图已过期：manifest 记录 ${m.source_sha256.slice(0, 12)}，resume.html 当前 ${actual.slice(0, 12)}。`);
    console.error('请运行 node scripts/render_print_previews.mjs 重新生成并提交 assets/print-preview/。');
    return 1;
  }
  for (let i = 1; i <= m.pdf_pages; i++) {
    for (const kind of ['color', 'bw']) {
      const f = join(OUT, `${kind}-${i}.png`);
      if (!existsSync(f)) {
        console.error(`::error::缺少预览图 ${f}`);
        return 1;
      }
    }
  }
  if (!existsSync(ATTACH_PDF)) {
    console.error(`::error::缺少邮件附件 PDF ${ATTACH_PDF}，先跑 node scripts/render_print_previews.mjs`);
    return 1;
  }
  console.log(`✓ 打印预览与 resume.html 同步（${m.pdf_pages} 页 × 2 版，sha256 ${actual.slice(0, 12)}；邮件附件 PDF 就位）`);
  return 0;
}

if (CHECK_ONLY) process.exit(check());

if (!existsSync(HTML)) {
  console.error('找不到 resume.html，先跑 node scripts/render_resume.mjs');
  process.exit(1);
}
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Chromium。设置 CHROME_PATH 指向浏览器可执行文件后重试。');
  process.exit(2);
}

const html = readFileSync(HTML, 'utf8');
/* 与用户手动导出 PDF 的做法一致：剥掉底部脚本，避免把学校档案链接改成本地相对路径 */
const stripped = html.replace(/<script>\s*\/\* 学校档案深链[\s\S]*?<\/script>/, '');
if (stripped === html) {
  console.error('未匹配到学校档案深链脚本，resume.html 结构可能已变；中止以免生成错误预览。');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'pv-src-'));
const tmpHtml = join(dir, 'resume.html');
const pdf = join(dir, 'resume.pdf');
try {
  writeFileSync(tmpHtml, stripped, 'utf8');
  const r = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000',
    `--print-to-pdf=${pdf}`,
    `file://${tmpHtml}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120_000 });
  if (r.error || !existsSync(pdf)) {
    console.error(`Chrome 打印 PDF 失败：${r.error?.message || '无输出文件'}`);
    process.exit(2);
  }

  const raster = spawnSync('python3', [
    join(ROOT, 'scripts', 'rasterize_print_preview.py'),
    pdf, OUT, sha256(readFileSync(HTML)),
  ], { encoding: 'utf8', stdio: 'inherit', timeout: 120_000 });
  if (raster.error || raster.status !== 0) {
    console.error('PDF 栅格化失败（需要 pypdf + Pillow，以及 sips 或 pdftoppm）');
    process.exit(2);
  }

  mkdirSync(dirname(DELIVERED_PDF), { recursive: true });
  copyFileSync(pdf, DELIVERED_PDF);
  console.log(`✓ 投递用 PDF 同步更新：${DELIVERED_PDF}`);

  /* 自动投递附件：同一份 PDF 落到部署目录，Functions 用 fetch 读它做邮件附件 */
  mkdirSync(dirname(ATTACH_PDF), { recursive: true });
  copyFileSync(pdf, ATTACH_PDF);
  console.log(`✓ 邮件附件 PDF 同步更新：${ATTACH_PDF}`);
  process.exit(check());
} finally {
  rmSync(dir, { recursive: true, force: true });
}
