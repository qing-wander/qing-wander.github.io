/* ════════════════════════════════════════════════════════════
   CP.AI 语音播报 · Phase 2 云端 Provider（设计依据：docs/ai-voice-survey.md 第 7 节）
   --------------------------------------------------------------
   1) 只做一件事：实现 AIVoice.setProvider() 需要的 { synth(text, opts) }，
      队列、去重、开关、口型联动、首次打招呼、降级全部复用 js/ai-voice.js。
   2) 复用已上线的 /chat HTTP 触发路径，用 body.mode='tts' 路由，
      不在控制台新增 /tts 路径映射（线上网关配置零改动）。
   3) 启动先探测一次全链路（合成「你好」两字），成功才注册 provider；
      没开通 / 没密钥 / 超时 → 保持浏览器 SpeechSynthesis，用户无感。
   4) 前端永远拿不到 SecretId/Key；返回的是 base64 mp3，按 text+kind 缓存。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE = 'cpai_voice_cloud_v1';
  var PROBE_TEXT = '你好';           // 探测只消耗 2 个字符
  var REQUEST_TIMEOUT = 5500;      // 云端比浏览器语音多一跳，超时就降级
  var CACHE_MAX = 80;

  var voice = window.AIVoice;
  if (!voice || typeof voice.setProvider !== 'function') return;   // 语音模块没加载：静默退出

  var enabled = true;
  var state = 'checking';          // checking | cloud | browser | unavailable | off
  var reason = '';
  var cache = Object.create(null);
  var cacheOrder = [];
  var probeDone = false;

  try {
    var raw = localStorage.getItem(STORE);
    var o = raw ? JSON.parse(raw) : null;
    if (o && typeof o.enabled === 'boolean') enabled = o.enabled;
  } catch (e) {}

  /* 排障开关：?tts=browser 强制走浏览器语音，不改任何代码 */
  try {
    if (/[?&]tts=browser(?:&|$)/.test(location.search)) enabled = false;
  } catch (e) {}

  function writeStore() {
    try { localStorage.setItem(STORE, JSON.stringify({ enabled: enabled })); } catch (e) {}
  }

  function endpoint() {
    return window.CP_AI_TTS_ENDPOINT ||
      window.CP_AI_ENDPOINT ||
      'https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat';
  }

  function cachePut(key, src) {
    if (cache[key] === undefined) cacheOrder.push(key);
    cache[key] = src;
    while (cacheOrder.length > CACHE_MAX) {
      var old = cacheOrder.shift();
      if (old !== undefined) delete cache[old];
    }
  }

  /** 请求云端合成；任何异常都抛出去，交给 ai-voice.js 的 fallbackToLocal 回落 */
  function request(text, kind) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'tts', text: text, kind: kind || 'answer' }),
      cache: 'no-store'
    };
    if (ctrl) opts.signal = ctrl.signal;

    var timer = setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }, REQUEST_TIMEOUT);

    return fetch(endpoint(), opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error('tts_http_' + r.status + (j && j.error ? ':' + j.error : ''));
      });
      return r.json();
    }).then(function (j) {
      if (!j || !j.ok || !j.audio) throw new Error('tts_bad_payload');
      return 'data:' + (j.mime || 'audio/mpeg') + ';base64,' + j.audio;
    }).catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  var provider = {
    synth: function (text, opts) {
      var kind = (opts && opts.kind) || 'answer';
      var key = kind + '|' + text;
      if (cache[key] !== undefined) {
        return Promise.resolve({ src: cache[key], mime: 'audio/mpeg' });
      }
      return request(text, kind).then(function (src) {
        cachePut(key, src);
        return { src: src, mime: 'audio/mpeg' };
      });
    }
  };

  function setState(s, msg) {
    state = s;
    reason = msg || '';
  }

  /** 探测全链路：合成两字，成功才把 provider 交给语音模块 */
  function probe(force) {
    if (!enabled) { setState('off', '云端通道已关闭'); voice.setProvider(null); return Promise.resolve(false); }
    if (probeDone && !force && state !== 'checking') return Promise.resolve(state === 'cloud');
    setState('checking');
    return provider.synth(PROBE_TEXT, { kind: 'answer' }).then(function () {
      probeDone = true;
      setState('cloud');
      voice.setProvider(provider);
      return true;
    }).catch(function (e) {
      probeDone = true;
      var msg = e && e.message ? String(e.message).slice(0, 120) : 'unknown';
      setState('unavailable', msg);
      voice.setProvider(null);
      return false;
    });
  }

  window.AIVoiceCloud = {
    enable: function () {
      enabled = true;
      writeStore();
      return probe(true);
    },
    disable: function () {
      enabled = false;
      setState('off', '已手动切回浏览器语音');
      voice.setProvider(null);
      writeStore();
      return Promise.resolve(false);
    },
    isEnabled: function () { return enabled; },
    /** 手动验证：合成并播放一句，用来在真机上听云端音色 */
    test: function (text) {
      return provider.synth(text || '你好，这是云端音色，听起来怎么样？', { kind: 'answer' })
        .then(function (res) {
          var a = new Audio(res.src);
          a.dataset.aiGenerated = '1';
          return a.play();
        });
    },
    probe: function () { return probe(true); },
    getStatus: function () {
      return {
        state: state,
        reason: reason,
        enabled: enabled,
        endpoint: endpoint(),
        cached: cacheOrder.length,
        active: !!(voice.getStatus && voice.getStatus().provider === 'cloud')
      };
    }
  };

  probe(false);
})();
