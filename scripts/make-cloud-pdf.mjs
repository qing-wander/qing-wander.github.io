#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   生成「带真实手机号」的简历 PDF，并可选上传到 KV
   ──────────────────────────────────────────────────────────────────────
   背景：公开仓库里的 resume.html / PDF 都是脱敏副本（138 0000 0000）。
   访客看到的页面由中间件注入真号码；投递用的 PDF 不能带占位符，所以
   真实版单独生成、只存 KV（键 resume:pdf），不进 Git。

   用法：
     node scripts/make-cloud-pdf.mjs                       # 号码从 D1 读
     node scripts/make-cloud-pdf.mjs --phone "139 …"       # 手动指定
     node scripts/make-cloud-pdf.mjs --put                 # 生成后上传 KV
     node scripts/make-cloud-pdf.mjs --out /tmp/x.pdf      # 指定输出路径

   依赖本机 Chrome；上传依赖 wrangler（可用 WRANGLER 指定可执行文件）。
   ────────────────────────────────────────────────────────────────────── */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectResumePhone, phoneFromSiteData } from '../functions/lib/resume-inject.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'resume.html');
const DEFAULT_OUT = join(ROOT, '.temp', 'resume-cloud.pdf');
const KV_KEY = 'resume:pdf';
const DB = process.env.D1_DB_NAME || 'portfolio-db';
const KV_NS = process.env.SITE_KV_ID || 'f5253a16b4d84a20a32c0cd497b1f269';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq > 0 ? hit.slice(eq + 1) : (process.argv[process.argv.indexOf(hit) + 1] || fallback);
}

function wrangler() {
  if (process.env.WRANGLER) return { cmd: process.execPath, pre: [process.env.WRANGLER] };
  return { cmd: 'npx', pre: ['--yes', 'wrangler'] };
}

/* 从 D1 读真实手机号（读不到就返回空，让调用方报错） */
function phoneFromCloud() {
  const w = wrangler();
  const r = spawnSync(w.cmd, [
    ...w.pre, 'd1', 'execute', DB, '--remote', '--json',
    '--command', "SELECT payload FROM site_content WHERE key = 'site-data'",
  ], { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (r.status !== 0) {
    console.error('读取 D1 失败：' + String(r.stderr || r.stdout || '').slice(0, 300));
    return '';
  }
  try {
    const payload = JSON.parse(r.stdout)[0].results[0].payload;
    return phoneFromSiteData(JSON.parse(payload));
  } catch (e) {
    console.error('解析 D1 返回失败：' + e.message);
    return '';
  }
}

function main() {
  const out = resolve(arg('out', DEFAULT_OUT));
  let phone = arg('phone', '');
  if (!phone) phone = phoneFromCloud();
  if (!phone) {
    console.error('拿不到手机号：先在 D1 保存 site-data，或用 --phone 指定');
    process.exit(1);
  }

  const html = readFileSync(HTML, 'utf8');
  const stripped = html.replace(/<script>\s*\/\* 学校档案深链[\s\S]*?<\/script>/, '');
  if (stripped === html) {
    console.error('未匹配到学校档案深链脚本，resume.html 结构可能已变；中止');
    process.exit(1);
  }

  /* 打印源留在项目根目录：页面依赖相对路径的 css/js，放临时目录会 404 */
  const tmpHtml = join(ROOT, '_cloud-pdf-src.html');
  process.on('exit', () => rmSync(tmpHtml, { force: true }));
  writeFileSync(tmpHtml, injectResumePhone(stripped, phone), 'utf8');

  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) {
    console.error('未找到 Chrome/Chromium，可用 CHROME_PATH 指定');
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000', `--print-to-pdf=${out}`, `file://${tmpHtml}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120_000 });
  rmSync(tmpHtml, { force: true });
  if (r.error || !existsSync(out)) {
    console.error('Chrome 打印失败：' + (r.error ? r.error.message : '没有输出文件'));
    process.exit(2);
  }
  const size = statSync(out).size;
  console.log(`✓ 生成 ${out}（${(size / 1024).toFixed(0)} KB，号码 ${phone.slice(0, 3)}****${phone.slice(-2)}）`);

  if (!process.argv.includes('--put')) {
    console.log('  上传到 KV：加 --put 再跑一次');
    return;
  }
  const w = wrangler();
  const put = spawnSync(w.cmd, [
    ...w.pre, 'kv', 'key', 'put', KV_KEY, '--namespace-id', KV_NS, '--path', out, '--remote',
  ], { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (put.status !== 0) {
    console.error('上传 KV 失败：' + String(put.stderr || put.stdout || '').slice(0, 400));
    process.exit(3);
  }
  console.log(`✓ 已上传 KV：${KV_KEY}（${KV_NS}）`);
}

main();
