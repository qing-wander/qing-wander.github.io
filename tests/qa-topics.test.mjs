/* 问题聚类：同义问法要合、不同话题不能串 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, bigrams, jaccard, cluster } from '../functions/lib/admin-topics.js';

test('同义词归一：k8s / kubernetes 视为同一个词', () => {
  assert.match(normalize('他会 Kubernetes 吗'), /kubernetes/);
  assert.match(normalize('懂 k8s 不'), /kubernetes/);
});

test('问句噪声被剥离：他/会/吗/标点不参与聚类', () => {
  const a = normalize('他会沙箱吗？');
  assert.equal(a.includes('？') || a.includes('他'), false);
  assert.match(a, /沙箱/);
});

test('jaccard：同一问句不同问法相似度高，无关话题接近 0', () => {
  const g1 = bigrams('他会 Kubernetes 吗');
  const g2 = bigrams('懂 k8s 不');
  const g3 = bigrams('他现在的联系方式');
  assert.ok(jaccard(g1, g2) >= 0.5, 'k8s 与 kubernetes 应算同一类');
  assert.ok(jaccard(g1, g3) < 0.2, 'kubernetes 与联系方式不应混在一起');
});

test('cluster：把同义问法归成一个话题，且统计空召回', () => {
  const rows = [
    { ts: 5, query: '他会 Kubernetes 吗', empty: 1 },
    { ts: 4, query: '懂 k8s 不', empty: 1 },
    { ts: 3, query: '他在进门财经做什么', empty: 0 },
    { ts: 2, query: '他现在的联系方式', empty: 0 },
    { ts: 1, query: '他做过哪些 0→1 系统', empty: 0 },
  ];
  const topics = cluster(rows);
  const k8s = topics.find((t) => /kubernetes|k8s/i.test(t.topic) || t.examples.some((e) => /k8s|kubernetes/i.test(e)));
  assert.ok(k8s, '应存在 k8s 相关簇');
  assert.equal(k8s.count, 2, '两种问法应合成一类');
  assert.equal(k8s.empty, 2, '两条都是空召回');
  assert.ok(topics.length <= 4, '不应把每条问题都单独成一簇');
});

test('cluster：完全不相干的问题不会被硬合并', () => {
  const topics = cluster([
    { ts: 2, query: '他懂多租户隔离吗', empty: 0 },
    { ts: 1, query: '他的工作时间是什么', empty: 0 },
  ]);
  assert.equal(topics.length, 2);
});
