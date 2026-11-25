/* POST /api/admin/voice/preview —— 后台试听（合成一段，不改线上设置）
   ──────────────────────────────────────────────────────────────
   为什么不从浏览器直连云函数：后台 CSP 是 connect-src 'self'，直连要先放开
   外部域名，等于给后台页面开个口子。走同源代理后 CSP 一个字都不用改，
   顺便在边缘加一道每小时 60 次的限额，避免有人拿后台当免费 TTS 接口刷。

   请求：{ voice?, text? }   返回：{ ok, audio(base64), mime, voice, chars }
   不落库、不写配置 —— 试听和「设为默认」是两件事。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, fail, ipHash, json, requireAdmin } from '../../../lib/admin-auth.js';
import { gate, hourKey } from '../../../lib/guard.js';
import { MAX_TTS_CHARS, isKnownVoice, synthesize, voiceMeta } from '../../../lib/tts.js';

const DEFAULT_PREVIEW = '你好，我是陈培胜的数字分身。他的项目经历、技术栈和协作方式，都可以直接问我。';
const LIMIT_PER_HOUR = 60;

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  const text = String((body && body.text) || '').trim().slice(0, MAX_TTS_CHARS) || DEFAULT_PREVIEW;
  const voice = Number(body && body.voice) || 0;
  if (voice && !isKnownVoice(voice)) return fail('unknown_voice', '这个音色不在白名单里');

  /* 试听自带限额：即便会话泄露，也不能把字符额度一口气烧光 */
  const ip = await ipHash(request);
  const hit = await gate(env.DB, 'admin:voice:preview:' + ip, hourKey(), LIMIT_PER_HOUR, 3700);
  if (hit === 0) return fail('rate_limited', '试听太频繁了，过一会儿再试', 429);

  const r = await synthesize(env, { text, voice, kind: 'answer' });
  if (!r.ok) {
    /* 失败原因原样带回：多半是音色没开通（大模型音色）或云函数连不上，
       后台要能看见腾讯云给的具体 code，否则只能猜 */
    return json({
      ok: false, error: r.error, message: r.message, detail: r.detail || '',
    }, r.status || 502);
  }

  const meta = voiceMeta(r.voice);
  return json({
    ok: true,
    audio: r.audio,
    mime: r.mime,
    voice: r.voice,
    name: meta ? meta.name : '',
    chars: r.chars,
    cached: r.cached,
  });
}
