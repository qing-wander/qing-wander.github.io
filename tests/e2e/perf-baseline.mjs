#!/usr/bin/env node
/**
 * M0 性能基线采集（docs/react-refactor-plan.md §6-M0 / §5.8）
 *
 * 对线上站 4 个核心页各跑 Lighthouse 移动档（默认 Moto G4 + slow 4G 仿真，主验收档）
 * 与桌面档（--preset=desktop），JSON 存档 tests/e2e/baseline/lighthouse/，
 * 汇总分数写入 summary.json —— 后续 M1-M5 每阶段与本基线对比（N5 不变量）。
 *
 * 运行：pnpm e2e:perf-baseline
 *   BASE=https://qing-wander.pages.dev node tests/e2e/perf-baseline.mjs
 * ⚠ M0 基线抓的是【旧版站】；React 版验收时用同一脚本重抓对照。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const BASE = process.env.BASE || 'https://qing-wander.pages.dev';
const OUT_DIR = 'tests/e2e/baseline/lighthouse';
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
// Cloudflare 对非浏览器 UA 有拦截（curl 直接 403）——用真实 Chrome UA 头
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

mkdirSync(OUT_DIR, { recursive: true });
const summary = { capturedAt: new Date().toISOString(), base: BASE, engine: 'lighthouse@pre-react(M0)', pages: [] };

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
        maxWaitForFcp: 30_000,
        maxWaitForLoad: 60_000,
        ...variant.flags,
      });
      if (!result?.lhr) { console.log('✗ 无结果'); continue; }
      const lhr = result.lhr;
      const file = `${OUT_DIR}/${runName}.json`;
      writeFileSync(file, JSON.stringify(lhr, null, 1));
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
console.log(`\n✓ ${summary.pages.length} 份基线 → ${OUT_DIR}/（M1-M5 各阶段验收对照用）`);
