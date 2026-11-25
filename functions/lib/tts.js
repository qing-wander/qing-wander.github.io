/* 语音合成（TTS）· Pages 侧统一入口
   ──────────────────────────────────────────────────────────────
   1) 音色白名单只在这里维护一份：后端 /api/chat 与 /api/admin/voice 都读它，
      前端拿到的也是这份列表，三处不会漂。
   2) 真正的合成在腾讯云函数（functions/tencent/tts.js，TC3 签名与密钥都在那边）。
      这里只做「转发 + 白名单 + 体积/文本校验」，不持有任何密钥。
   3) 为什么前端不直连云函数：后台 CSP 是 connect-src 'self'，且直连会把音色
      ID 之外的东西（异常细节、限流状态）暴露给页面；走同源 /api/chat 还能
      复用中间的边缘限流。

   环境变量：
     TTS_ENDPOINT   可选，云函数 /chat 地址；不配用下面 DEFAULT_TTS_ENDPOINT
   ────────────────────────────────────────────────────────────── */

/* 音色清单来源：腾讯云语音合成文档 cloud.tencent.com/document/product/1073/92668
   只收「适合数字分身播报」的中文成年音色；童声、粤语、英文音色故意不放进来。

   为什么没有大模型音色（501004 月华 / 501005 飞镜 / 601009 爱小芊）：
   2026-11-25 线上实测这三个在未开通的账号上会让云函数直接 502（返回纯文本
   "error code: 502"），前端只能拿到一个看不懂的错误。等控制台开通了再把
   ID 加回这张表即可，其余代码不用动。 */
export const VOICES = [
  { id: 101001, name: '智瑜', note: '情感女声 · 默认，语气最像真人', type: '精品', gender: 'female' },
  { id: 101026, name: '智希', note: '通用女声 · 平稳，适合长段解释', type: '精品', gender: 'female' },
  { id: 101027, name: '智梅', note: '通用女声 · 偏温和', type: '精品', gender: 'female' },
  { id: 101055, name: '智付', note: '通用女声 · 客服腔，清楚利落', type: '精品', gender: 'female' },
  { id: 101011, name: '智燕', note: '新闻女声 · 播报感强', type: '精品', gender: 'female' },
  { id: 101004, name: '智云', note: '通用男声 · 中性稳重', type: '精品', gender: 'male' },
  { id: 101030, name: '智柯', note: '通用男声 · 偏年轻', type: '精品', gender: 'male' },
  { id: 101054, name: '智友', note: '通用男声 · 对话感强', type: '精品', gender: 'male' },
  { id: 101013, name: '智辉', note: '新闻男声 · 低沉，读简历很有分量', type: '精品', gender: 'male' },
  { id: 101021, name: '智瑞', note: '新闻男声 · 清亮', type: '精品', gender: 'male' },
];

/* 套装默认音色：女版沿用历史默认，男版配低沉新闻男声。 */
export const DEFAULT_VOICE = 101001;
export const DEFAULT_VOICE_BY_GENDER = { female: 101001, male: 101013 };

export function isGender(g) { return g === 'male' || g === 'female'; }
export const MAX_TTS_CHARS = 150;          // 与云函数 MAX_TEXT_CHARS 一致
const DEFAULT_TTS_ENDPOINT = 'https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat';
const TTS_TIMEOUT_MS = 12000;             // 云函数自己 8s 超时，这里留网络余量
const ORIGIN_FOR_UPSTREAM = 'https://chenpeisheng.cn';   // 云函数的 Origin 白名单认这个

export function isKnownVoice(v) {
  const n = Number(v);
  return VOICES.some((x) => x.id === n);
}

export function voiceMeta(v) {
  const n = Number(v);
  return VOICES.find((x) => x.id === n) || null;
}

export function ttsEndpoint(env) {
  const raw = String((env && env.TTS_ENDPOINT) || '').trim();
  return raw || DEFAULT_TTS_ENDPOINT;
}

/* 返回统一形状，调用方不需要分辨「网络挂了 / 云函数拒绝 / 没开通」：
   { ok:true, audio, mime, voice, chars, cached } 或 { ok:false, error, status, message } */
export async function synthesize(env, opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  if (!text) return { ok: false, error: 'empty_text', status: 400, message: '缺少文本' };
  if (text.length > MAX_TTS_CHARS) {
    return { ok: false, error: 'text_too_long', status: 400, message: `单段最多 ${MAX_TTS_CHARS} 字（当前 ${text.length} 字）` };
  }

  const voice = Number(o.voice) || DEFAULT_VOICE;
  if (!isKnownVoice(voice)) {
    return { ok: false, error: 'unknown_voice', status: 400, message: '这个音色不在白名单里' };
  }

  const url = ttsEndpoint(env);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN_FOR_UPSTREAM },
      body: JSON.stringify({ mode: 'tts', text, kind: String(o.kind || 'answer'), voice }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(TTS_TIMEOUT_MS)
        : undefined,
    });
  } catch (e) {
    return {
      ok: false, error: 'tts_unreachable', status: 502,
      message: '语音服务连不上', detail: String((e && e.message) || e).slice(0, 120),
    };
  }

  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!body || !body.ok || !body.audio) {
    return {
      ok: false,
      /* 优先用腾讯云的错误码（UnsupportedVoiceType 这类信息量最大），没有才退回通用 error */
      error: String((body && (body.code || body.error)) || ('tts_http_' + res.status)).slice(0, 80),
      status: res.status === 429 ? 429 : 502,
      message: String((body && body.message) || '语音合成失败').slice(0, 160),
    };
  }

  return {
    ok: true,
    audio: body.audio,
    mime: body.mime || 'audio/mpeg',
    voice: Number(body.voice) || voice,
    chars: Number(body.chars) || text.length,
    cached: !!body.cached,
  };
}
