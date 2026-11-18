/* GET /api/auth/me —— 前端判断要不要显示登录页 */
import { json, isAdmin } from '../../../lib/admin.js';

export async function onRequestGet({ request, env }) {
  return json({ ok: true, authed: await isAdmin(request, env) });
}
