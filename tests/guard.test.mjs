/* bullet 改写护栏 —— 每道关卡都要有反例，否则等于没有护栏 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkBullet, termsOf } from '../functions/lib/bullet-guard.js';

const site = JSON.parse(readFileSync(new URL('../data/site-data.json', import.meta.url), 'utf8'));
const vocab = new Set(termsOf(JSON.stringify(site)));

const O = '把支付回调链路的 RT 从 800ms 压到 120ms，SLA 由 99.5% 提升至 99.95%';

test('数字丢失必须拒收', () => {
  const v = checkBullet(O, '优化支付回调链路，RT 从 800ms 压到 120ms，显著提升可用性', vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('丢数字')));
});

test('编造数字必须拒收', () => {
  const v = checkBullet(O, '把支付回调链路的 RT 从 800ms 压到 120ms，SLA 提升至 99.99%', vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('编数字')));
});

test('凭空加技术栈必须拒收', () => {
  const v = checkBullet(O, '基于 Kubeflow 重构支付回调链路，RT 从 800ms 压到 120ms，SLA 由 99.5% 提升至 99.95%', vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('编造术语')));
});

test('英文术语大面积丢失必须拒收', () => {
  const v = checkBullet(O, '优化支付回调链路，响应时间从 800ms 压到 120ms，稳定性由 99.5% 提升至 99.95%', vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('术语保留')));
});

test('只剩结论、洗掉原意必须拒收', () => {
  const v = checkBullet(O, '负责支付系统的稳定性建设与性能治理', vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('语义召回') || r.includes('丢数字')));
});

test('合规的措辞微调应当放行', () => {
  const C = '将支付回调链路 RT 从 800ms 优化至 120ms，SLA 由 99.5% 提高到 99.95%';
  const v = checkBullet(O, C, vocab);
  assert.equal(v.ok, true);
  assert.equal(v.text, C);
});

test('长度膨胀必须拒收（PDF 两页靠它兜）', () => {
  const C = O + '，同时推动跨团队协作流程标准化，建立可观测体系，覆盖全链路监控与告警治理，形成可复用的方法论';
  const v = checkBullet(O, C, vocab);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('超长')));
});
