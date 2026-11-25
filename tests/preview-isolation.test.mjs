/* 预览环境隔离 —— 配置契约测试
   ──────────────────────────────────────────────────────────────
   背景：wrangler.toml 只有顶层绑定时，预览部署会退回生产 D1，
   预览站于是拿到了真实手机号。这条测试把「预览必须独立」钉死：
   只要有人把 [env.preview] 删掉、或指回生产 id，测试就红。
   ────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

/* 只取 [env.preview] 之后的部分，避免误匹配顶层绑定 */
const previewAt = toml.indexOf('[env.preview]');
const preview = previewAt >= 0 ? toml.slice(previewAt) : '';
const top = previewAt >= 0 ? toml.slice(0, previewAt) : toml;

const pick = (text, re) => (text.match(re) || [])[1] || '';

test('wrangler.toml 必须声明 [env.preview]，否则预览会复用生产绑定', () => {
  assert.ok(previewAt > 0, '缺少 [env.preview] 段落');
  assert.match(preview, /\[\[env\.preview\.d1_databases\]\]/, '预览缺少 D1 绑定');
  assert.match(preview, /\[\[env\.preview\.kv_namespaces\]\]/, '预览缺少 KV 绑定');
});

test('预览的 D1 与 KV 必须和生产不同（同一 id = 预览能读写线上数据）', () => {
  const topD1 = pick(top, /database_id\s*=\s*"([^"]+)"/);
  const prevD1 = pick(preview, /database_id\s*=\s*"([^"]+)"/);
  const topKv = pick(top, /\bid\s*=\s*"([^"]+)"/);
  const prevKv = pick(preview, /\bid\s*=\s*"([^"]+)"/);
  assert.ok(topD1 && prevD1 && topKv && prevKv, '没解析到绑定 id');
  assert.notEqual(prevD1, topD1, '预览 D1 与生产相同');
  assert.notEqual(prevKv, topKv, '预览 KV 与生产相同');
});

test('预览库名带 preview 后缀，避免在控制台里认错', () => {
  assert.match(preview, /database_name\s*=\s*"[^"]*preview[^"]*"/);
});
