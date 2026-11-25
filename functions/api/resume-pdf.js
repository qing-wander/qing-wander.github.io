/* /api/resume-pdf —— 下发云端简历 PDF
   ──────────────────────────────────────────────────────────────
   KV 里有真实 PDF（带手机号）就直接下发；没有则回落到仓库里的脱敏副本，
   保证「后台没上传」也不会 404。
   ────────────────────────────────────────────────────────────── */
import { RESUME_PDF_NAME, RESUME_PDF_PATH } from '../lib/deliver-content.js';
import { pdfHeaders, readResumePdfFromKv } from '../lib/resume-pdf.js';

export async function onRequestGet({ request, env }) {
  const kvBytes = await readResumePdfFromKv(env);
  if (kvBytes) {
    return new Response(kvBytes, { status: 200, headers: pdfHeaders(RESUME_PDF_NAME) });
  }

  const resp = await fetch(new URL(RESUME_PDF_PATH, request.url)).catch(() => null);
  if (!resp || !resp.ok) return new Response('Not found', { status: 404 });
  const headers = pdfHeaders(RESUME_PDF_NAME);
  headers['Cache-Control'] = 'public, max-age=60';
  headers['X-Content-Source'] = 'fallback';
  return new Response(await resp.arrayBuffer(), { status: 200, headers });
}
