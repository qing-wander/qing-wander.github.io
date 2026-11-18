#!/usr/bin/env node
/**
 * 真页数校验：用无头 Chrome 把 resume.html 打成 PDF，数真实页数。
 *
 * 为什么不用字数预算近似：「3800 字以内」只是经验值，字体、行距、分栏一变就不准。
 * 把「PDF ≤ 2 页」这条硬约束交给打印引擎自己判定，才拦得住漂移。
 *
 * 用法：
 *   node scripts/check_resume_pages.mjs            # 校验，超页则非 0 退出
 *   node scripts/check_resume_pages.mjs --info     # 只打印页数
 *   CHROME_PATH=/path/to/chrome node ...           # 指定浏览器
 *   MAX_PAGES=3 node ...                           # 临时放宽上限
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const HTML = join(ROOT, 'resume.html');
const MAX_PAGES = Number(process.env.MAX_PAGES || 2);
const INFO_ONLY = process.argv.includes('--info');

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

if (!existsSync(HTML)) {
  console.error(`::error::找不到 ${HTML}，先跑 node scripts/render_resume.mjs`);
  process.exit(1);
}

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Chromium。设置 CHROME_PATH 指向浏览器可执行文件后重试。');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'resume-pdf-'));
const pdf = join(dir, 'resume.pdf');

try {
  const r = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000',
    `--print-to-pdf=${pdf}`,
    `file://${HTML}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120_000 });

  if (r.error || !existsSync(pdf)) {
    console.error(`Chrome 打印 PDF 失败：${r.error?.message || '无输出文件'}`);
    process.exit(2);
  }

  const buf = readFileSync(pdf);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const sizeKb = Math.round(buf.length / 1024);

  if (INFO_ONLY) {
    console.log(`resume.html → PDF ${pages} 页，${sizeKb} KB（上限 ${MAX_PAGES} 页）`);
    process.exit(0);
  }

  if (pages > MAX_PAGES) {
    console.error(`::error::简历 PDF 打成 ${pages} 页，超过 ${MAX_PAGES} 页上限`);
    process.exit(1);
  }
  console.log(`✓ 简历 PDF ${pages} 页（上限 ${MAX_PAGES} 页），${sizeKb} KB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
