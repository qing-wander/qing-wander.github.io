/* 检索用的确定性分词：中文按字 bigram，英文/数字按整词。
   为什么不用分词器：D1 FTS5 的中文分词器在不同环境行为不一致，
   而 bigram 在写入与查询两端都能复现，且不依赖任何第三方库。 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const WORD = /[a-zA-Z0-9]/;

export function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** @returns {string[]} 归一化 token 序列 */
export function tokenize(text) {
  const src = stripTags(text).toLowerCase();
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (CJK.test(ch)) {
      let run = '';
      while (i < src.length && CJK.test(src[i])) run += src[i++];
      if (run.length === 1) out.push(run);
      else for (let k = 0; k + 1 < run.length; k++) out.push(run.slice(k, k + 2));
      continue;
    }
    if (WORD.test(ch)) {
      let run = '';
      while (i < src.length && WORD.test(src[i])) run += src[i++];
      if (run.length > 1 || /[0-9]/.test(run)) out.push(run);
      continue;
    }
    i++;
  }
  return out;
}

/** 写入 D1 FTS5 的 text_tokens：空格分隔的 token 串（unicode61 不再分词） */
export function tokenText(text) {
  return tokenize(text).join(' ');
}
