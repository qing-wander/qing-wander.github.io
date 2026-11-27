#!/usr/bin/env node
/**
 * M5 生产切换后 Lighthouse 对照（docs/react-refactor-plan.md §6-M5 / N5 不变量验收）
 *
 * 与 M0 基线（tests/e2e/baseline/lighthouse/）同脚本同口径重抓【React 版生产站】，
 * 结果存独立目录 tests/e2e/baseline/lighthouse-post-react/，不覆盖基线；
 * 结束时打印「基线 vs 本次」逐项对照表（N5：性能不降）。
 * ⚠ Lighthouse 单轮方差大（冷缓存轮显著偏低）；关键页建议跑 3 轮取中位数再下结论，
 *   且以「逐字一致页」（resume）的波动作为该环境的噪声带参照。
 *
 * 运行：node tests/e2e/perf-post.mjs
 *   BASE=https://qingfin.cn（默认；也可指向 pages.dev）
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const BASE = process.env.BASE || 'https://qingfin.cn';
const OUT_DIR = 'tests/e2e/baseline/lighthouse-post-react';
const BASELINE_SUMMARY = 'tests/e2e/baseline/lighthouse/summary.json';
const PAGES = [
  { name: 'index', url: `${BASE}/` },
  { name: 'resume', url: `${BASE}/resume.html` },
  { name: 'jd', url: `${BASE}/jd.html` },
  { name: 'company', url: `${BASE}/company.html?c=zhishu` },
];
const VARIANTS = [
  { key: 'mobile', flags: {} }, // Lighthouse 默认 = 移动仿真（4G 节流 + Moto G）—— §5.8 主验收档
  { key: 'desktop', flags: { preset: 'desktop' } },
];
/* Cloudflare 对非浏览器 UA 有拦截（curl 直接 403）——用真实 Chrome UA 头 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

mkdirSync(OUT_DIR, { recursive: true });
const summary = { capturedAt: new Date().toISOString(), base: BASE, engine: 'lighthouse@post-react(M5)', pages: [] };

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', `--user-agent=${UA}`, '--no-sandbox', '--disable-gpu'],
});

try {
  for (const page of PAGES) {
    for (const variant of VARIANTS) {
      const runName = `${page.name}.${variant.key}`;
      process.stdout.write(`▶ ${runName} … `);
      const result = await lighthouse(page.url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        maxWaitForFcp: 45_000,
        maxWaitForLoad: 120_000,
        ...variant.flags,
      });
      if (!result?.lhr) { console.log('✗ 无结果'); continue; }
      const lhr = result.lhr;
      writeFileSync(`${OUT_DIR}/${runName}.json`, JSON.stringify(lhr, null, 1));
      const c = lhr.categories;
      const a = lhr.audits;
      const row = {
        page: page.name,
        variant: variant.key,
        url: page.url,
        scores: {
          performance: Math.round((c.performance?.score ?? 0) * 100),
          accessibility: Math.round((c.accessibility?.score ?? 0) * 100),
          seo: Math.round((c.seo?.score ?? 0) * 100),
          'best-practices': Math.round((c['best-practices']?.score ?? 0) * 100),
        },
        metrics: {
          FCP: a['first-contentful-paint']?.displayValue ?? '',
          LCP: a['largest-contentful-paint']?.displayValue ?? '',
          TBT: a['total-blocking-time']?.displayValue ?? '',
          CLS: a['cumulative-layout-shift']?.displayValue ?? '',
          TTI: a['interactive']?.displayValue ?? '',
        },
        sha1: createHash('sha1').update(JSON.stringify(lhr)).digest('hex').slice(0, 12),
      };
      summary.pages.push(row);
      console.log(`perf ${row.scores.performance} · LCP ${row.metrics.LCP} · TBT ${row.metrics.TBT}`);
    }
  }
} finally {
  await chrome.kill();
}
writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify(summary, null, 2));

/* ── 与 M0 基线对照（N5：性能不降）── */
console.log(`\n✓ ${summary.pages.length} 份 → ${OUT_DIR}/`);
try {
  const baseline = JSON.parse(readFileSync(BASELINE_SUMMARY, 'utf8'));
  const byKey = new Map(baseline.pages.map((p) => [`${p.page}.${p.variant}`, p]));
  console.log('\n════ M0 基线 → M5 生产 React 版 对照（perf 分 / LCP）════');
  for (const p of summary.pages) {
    const b = byKey.get(`${p.page}.${p.variant}`);
    if (!b) { console.log(`  ${p.page}.${p.variant}: 无基线`); continue; }
    const d = p.scores.performance - b.scores.performance;
    const flag = d >= 0 ? '↑' : '↓';
    console.log(`  ${p.page}.${p.variant.padEnd(7)} perf ${b.scores.performance} → ${p.scores.performance} (${d >= 0 ? '+' : ''}${d} ${flag})  LCP ${b.metrics.LCP} → ${p.metrics.LCP}  TBT ${b.metrics.TBT} → ${p.metrics.TBT}`);
  }
} catch (e) {
  console.log('基线对照不可用：', e.message);
}
