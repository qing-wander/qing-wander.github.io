/* ──────────────────────────────────────────────────────────────────────
   自动投递 · 发送前真实预览（/api/deliver-preview）
   ──────────────────────────────────────────────────────────────────────
   与 /api/deliver 共用同一套请求解析、附件探测与正文生成逻辑，
   因此预览里看到的就是点击「确认投递」后实际发出的内容。

   POST {同 /api/deliver 的 payload}
     → {ok:true, to, subject, html, text, attachments, replyTo, pending,
        zipName, zipEntries}
   只读预览：不调用 Resend、不消耗发信限额、不需要 RESEND_API_KEY。
   OPTIONS → 204（CORS 预检）
   ────────────────────────────────────────────────────────────────────── */

import {
  allowedOrigins, corsHeaders, isAllowedOrigin, json,
  parseDelivery, probeAttachments,
} from './deliver.js';
import { buildDeliveryEmail, buildSubject } from '../lib/deliver-content.js';

export async function onRequestOptions({ request, env }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('Origin'), allowedOrigins(env)),
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  if (!isAllowedOrigin(origin, allow)) {
    return json({ ok: false, error: 'origin_not_allowed' }, corsHeaders(origin, allow), 403);
  }
  const cors = corsHeaders(origin, allow);

  let body = {};
  try { body = await request.json(); } catch (e) { body = null; }
  const parsed = parseDelivery(body);
  if (parsed.error) return json({ ok: false, error: parsed.error, message: parsed.message }, cors, 400);
  const d = parsed.d;

  /* withData=false：只探测文件是否存在，不把 PDF 转成 base64 传回来 */
  const { names } = await probeAttachments(request, d, false);
  const mail = buildDeliveryEmail(d);

  return json({
    ok: true,
    to: d.to,
    subject: buildSubject(d),
    html: mail.html,
    text: mail.text,
    attachments: names,
    zipName: d.zipName || '',
    zipEntries: d.zipEntries || [],
    pending: d.pendingLabels,
    replyTo: d.email || '',
  }, cors, 200);
}
