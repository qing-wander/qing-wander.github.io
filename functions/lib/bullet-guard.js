/* bullet 改写护栏 —— 纯函数，可单测
   ──────────────────────────────────────────────────────────────
   模型改写最容易犯的四类错：编数字、丢术语、塞没做过的技术栈、把原意洗掉。
   这里逐条卡：任一不过就退回原文（不报错、不阻断，宁保守不冒险）。
   ────────────────────────────────────────────────────────────── */

const NUM_RE = /([0-9]+(?:\.[0-9]+)?)(\s*[%％]|\s*万|\s*亿|\s*倍|\s*ms|\s*秒|\s*分钟|\s*天|\s*人|\s*条|\s*个|\s*次|\s*家|\s*套|\s*台)?/g;

export function numbersOf(text) {
  const out = new Set();
  const s = String(text || '');
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s)) !== null) {
    const unit = (m[2] || '').trim();
    out.add(m[1] + (unit ? unit.replace('％', '%') : ''));
  }
  return out;
}

export function termsOf(text) {
  const out = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9.+#_-]{1,}/g)) {
    const t = m[0].toLowerCase();
    /* 太短的英文（如 a / ip）不当作术语，避免误判 */
    if (t.length >= 2) out.add(t);
  }
  return out;
}

/* 语义块：按中文标点切成短语，用来衡量「原意保住了多少」 */
function blocksOf(text) {
  return String(text || '')
    .split(/[，,。.；;、：:（）()!?！？\s]+/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 3);
}

function bigrams(text) {
  const s = String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  const out = [];
  if (s.length === 1) return [s];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/* 召回率：原文的语义块有多少能被候选稿「大致覆盖」（块内 bigram 重合 ≥ 50%） */
export function semanticRecall(original, candidate) {
  const blocks = blocksOf(original);
  if (!blocks.length) return 1;
  const cand = new Set(bigrams(candidate));
  let hit = 0;
  for (const b of blocks) {
    const bg = bigrams(b);
    if (!bg.length) { hit++; continue; }
    const covered = bg.filter((x) => cand.has(x)).length / bg.length;
    if (covered >= 0.5) hit++;
  }
  return hit / blocks.length;
}

/* 候选里出现、但原文与档案词表都没有的英文术语 —— 视为编造技术栈 */
export function inventedTerms(candidate, original, vocab) {
  const cand = termsOf(candidate);
  const base = new Set([...termsOf(original), ...(vocab || [])]);
  return [...cand].filter((t) => !base.has(t));
}

export function checkBullet(original, candidate, vocab) {
  const o = String(original || '');
  const c = String(candidate || '').trim();
  const reasons = [];

  if (!c) return { ok: false, text: o, reasons: ['empty'] };
  if (c === o) return { ok: true, text: c, reasons: ['identical'], changed: false };

  /* 1. 数字守恒：不能丢，也不能造 */
  const on = numbersOf(o);
  const cn = numbersOf(c);
  for (const n of on) if (!cn.has(n)) reasons.push(`丢数字:${n}`);
  for (const n of cn) if (!on.has(n)) reasons.push(`编数字:${n}`);

  /* 2. 英文术语保留 ≥ 70% */
  const ot = termsOf(o);
  const ct = termsOf(c);
  if (ot.size) {
    const kept = [...ot].filter((t) => ct.has(t)).length / ot.size;
    if (kept < 0.7) reasons.push(`术语保留${(kept * 100).toFixed(0)}%`);
  }

  /* 3. 不许凭空冒出档案里没有的技术栈 */
  const invented = inventedTerms(c, o, vocab);
  if (invented.length) reasons.push(`编造术语:${invented.slice(0, 3).join('/')}`);

  /* 4. 原意保住 ≥ 60% */
  const recall = semanticRecall(o, c);
  if (recall < 0.6) reasons.push(`语义召回${(recall * 100).toFixed(0)}%`);

  /* 5. 长度：可以略扩写，但不能膨胀（PDF 两页红线靠它兜） */
  if (c.length > o.length + 12) reasons.push(`超长${c.length}>${o.length + 12}`);
  if (c.length < Math.floor(o.length * 0.5)) reasons.push('过短');

  return { ok: reasons.length === 0, text: reasons.length ? o : c, reasons, changed: reasons.length === 0 };
}
