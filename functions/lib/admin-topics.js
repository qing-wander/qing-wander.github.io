/* 问题语义聚类（无模型，纯算法）
   ──────────────────────────────────────────────────────────────
   为什么不用 embedding：qa_logs 里一次问答才几十条，条条都要调模型算向量太贵；
   中文问句的核心信息集中在字符二元组（「沙箱」「多租」「Kubernetes」），
   用 bigram Jaccard + 同义词归一，就能把「他会 Kubernetes 吗」「懂 k8s 不」搓成一类。

   归一化只做「确定同义」的替换：k8s→kubernetes、rag→检索增强这类，
   宁可少合并也不要错合并——错合并会让"补哪些切片"的判断跑偏。
   ────────────────────────────────────────────────────────────── */

const SYNONYMS = [
  [/k8s/g, 'kubernetes'],
  [/k8[sS]/g, 'kubernetes'],
  [/llm/g, '大模型'],
  [/大语言模型/g, '大模型'],
  [/向量库/g, '向量数据库'],
  [/向量检索|向量搜索/g, '向量数据库'],
  [/多租户隔离|租户隔离/g, '多租户'],
  [/云沙箱|沙盒/g, '沙箱'],
  [/检索增强生成/g, 'rag'],
  [/智能体/g, 'agent'],
  [/工作经验|工作年限/g, '经验'],
];

export function normalize(text) {
  let s = String(text || '').toLowerCase().trim();
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  /* 去掉问句噪声：这些人人都有的词，合并时会把不相干的问题拉到一起 */
  return s.replace(/[？?！!。，,、；;：:"'“”‘’（）()【】\[\]]/g, ' ')
    .replace(/(他|她|你|您)/g, ' ')
    .replace(/(会|懂|了解|熟悉|掌握|做过|用过)/g, ' ')
    .replace(/吗|呢|么|不/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bigrams(text) {
  const s = normalize(text).replace(/\s/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  /* 英文单词整体也算一个特征，否则 kubernetes 会被切碎成 ku/ub/be… */
  for (const w of normalize(text).split(' ')) if (/^[a-z0-9][a-z0-9.+#/-]{2,}$/.test(w)) set.add('w:' + w);
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* 单链聚类：与簇内任一成员相似度 ≥ threshold 就并进来。
   单链在长尾数据上容易串成大簇，所以阈值给到 0.5（比常见 0.3 高一档）。 */
export function cluster(rows, threshold = 0.5) {
  const items = rows.map((r) => ({ row: r, grams: bigrams(r.query) }));
  const groups = [];
  for (const it of items) {
    let placed = false;
    for (const g of groups) {
      if (g.members.some((m) => jaccard(it.grams, m.grams) >= threshold)) {
        g.members.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ members: [it] });
  }
  return groups
    .map((g) => {
      /* 代表句取最短的那条——短问句通常最接近"主题名" */
      const rep = g.members.slice().sort((a, b) => String(a.row.query).length - String(b.row.query).length)[0].row.query;
      const queries = g.members.map((m) => String(m.row.query));
      const emptyCount = g.members.filter((m) => m.row.empty).length;
      return {
        topic: String(rep).trim(),
        count: g.members.length,
        empty: emptyCount,
        examples: [...new Set(queries)].slice(0, 5),
        last_ts: Math.max(...g.members.map((m) => Number(m.row.ts) || 0)),
      };
    })
    .sort((a, b) => b.count - a.count || b.last_ts - a.last_ts);
}
