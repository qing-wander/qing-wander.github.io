/* POST /api/auth/logout —— 清 cookie */
import { json, assertCsrf, clearCookie } from '../../../lib/admin.js';

export async function onRequestPost({ request }) {
  const csrf = assertCsrf(request);
  if (csrf) return csrf;
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
