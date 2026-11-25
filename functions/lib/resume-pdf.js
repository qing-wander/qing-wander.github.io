/* 云端简历 PDF（KV）
   ──────────────────────────────────────────────────────────────
   真实简历 PDF 带手机号，不能进公开仓库，所以：
     · 生成：node scripts/make-cloud-pdf.mjs --phone "…" --put
     · 存放：KV 键 resume:pdf（SITE_KV 命名空间）
     · 读取：/api/resume-pdf 对外下发；/api/deliver 发信时也读同一份
     · 兜底：KV 没配或没上传时，回落到仓库里的脱敏 PDF，功能不中断
   ────────────────────────────────────────────────────────────── */

export const RESUME_PDF_KV_KEY = 'resume:pdf';
export const RESUME_PDF_TYPE = 'application/pdf';

/* 从 KV 读真实 PDF；没有就返回 null，由调用方决定回落策略 */
export async function readResumePdfFromKv(env) {
  const kv = env && env.SITE_KV;
  if (!kv) return null;
  try {
    const buf = await kv.get(RESUME_PDF_KV_KEY, { type: 'arrayBuffer' });
    if (!buf || !buf.byteLength) return null;
    return new Uint8Array(buf);
  } catch (e) {
    return null;
  }
}

/* Content-Disposition：中文文件名必须走 RFC 5987 的 filename*，否则部分客户端乱码 */
export function pdfHeaders(name) {
  const ascii = String(name || 'resume.pdf').replace(/[^\x20-\x7e]/g, '_');
  return {
    'Content-Type': RESUME_PDF_TYPE,
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name || 'resume.pdf')}`,
    'Cache-Control': 'public, max-age=300',
    'X-Content-Source': 'cloud',
  };
}
