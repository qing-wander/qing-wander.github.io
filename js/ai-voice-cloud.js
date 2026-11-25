/* ════════════════════════════════════════════════════════════
   数字分身语音播报 · Phase 2 云端 Provider（设计依据：docs/ai-voice-survey.md 第 7 节）
   --------------------------------------------------------------
   1) 只做一件事：实现 AIVoice.setProvider() 需要的 { synth(text, opts), prefetch(texts, opts) }，
      队列、去重、开关、口型联动、首次打招呼、降级全部复用 js/ai-voice.js。
   2) 复用已上线的 /chat HTTP 触发路径，用 body.mode='tts' 路由，
      不在控制台新增 /tts 路径映射（线上网关配置零改动）。
   3) 启动先探测一次全链路（合成「你好」两字），成功才注册 provider；
      没开通 / 没密钥 / 超时 → 保持浏览器 SpeechSynthesis，用户无感。
   4) 前端永远拿不到 SecretId/Key；返回的是 base64 mp3，按 text+kind 缓存。
   5) 2026-11-19 优化：同句请求去重（pending）+ 播放预取（prefetch 2 句），
      把「合成→播放→再合成」的串行空档压到接近 0；超时由 5.5s 放宽到 12s。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE = 'cpai_voice_cloud_v1';
  var PROBE_TEXT = '你好';           // 探测只消耗 2 个字符
  var REQUEST_TIMEOUT = 12000;     // 云端比浏览器语音多一跳；网络抖动时别急着降级
  var PREFETCH_AHEAD = 2;          // 播放当前句时，并行预合成后面 2 句
  var CACHE_MAX = 80;

  var voice = window.AIVoice;
  if (!voice || typeof voice.setProvider !== 'function') return;   // 语音模块没加载：静默退出

  var enabled = true;
  var state = 'checking';          // checking | cloud | browser | unavailable | off
  var reason = '';
  var cache = Object.create(null);
  var cacheOrder = [];
  var pending = Object.create(null);   // key -> Promise，避免预取与正式播报重复发请求
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

  /* ── 音色（后台 /admin「AI 语音」里切换）─────────────────────────
     读 /api/voice 拿当前音色；缓存 10 分钟，够快也不至于让站长改完等太久。
     拿不到就发 0 —— 服务端按自己的默认音色合成，功能不受影响。 */
  var VOICE_STORE = 'cpai_voice_id_v1';
  var VOICE_TTL = 10 * 60 * 1000;
  var voiceId = 0;
  var voicePromise = null;

  function currentGender() {
    return (window.CP_GENDER === 'male' || window.CP_GENDER === 'female') ? window.CP_GENDER : '';
  }

  function fallbackVoice(g) {
    return g === 'male' ? 101013 : 101001;   // 与 lib/tts.js 的 DEFAULT_VOICE_BY_GENDER 一致
  }

  function voiceApi() {
    var m = String(endpoint()).match(/^(.*)\/api\/chat$/);
    return m ? m[1] + '/api/voice' : '';
  }

  function voiceCache(fresh) {
    try {
      var o = JSON.parse(localStorage.getItem(VOICE_STORE) || 'null');
      if (!o || typeof o.id !== 'number' || typeof o.at !== 'number') return 0;
      var g = currentGender();
      /* 旧记录没写 gender 时按女声处理（历史默认就是女声）；换性别后旧缓存必须失效。 */
      var cachedGender = o.gender || 'female';
      if (g && cachedGender !== g) return 0;
      if (!fresh) return o.id;
      return Date.now() - o.at < VOICE_TTL ? o.id : 0;
    } catch (e) { return 0; }
  }

  function loadVoice() {
    if (voicePromise) return voicePromise;
    var gender = currentGender();
    var done = function (id) {
      voiceId = id > 0 ? id : (gender ? fallbackVoice(gender) : 0);
      return voiceId;
    };
    var cached = voiceCache(true);
    if (cached > 0) { voicePromise = Promise.resolve(done(cached)); return voicePromise; }
    var url = voiceApi();
    if (!url) { voicePromise = Promise.resolve(done(0)); return voicePromise; }
    voicePromise = fetch(url + (gender ? '?gender=' + encodeURIComponent(gender) : ''), { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      var id = j && j.ok ? Number(j.voice) || 0 : 0;
      if (id > 0) {
        try {
          localStorage.setItem(VOICE_STORE, JSON.stringify({ id: id, gender: gender || 'any', at: Date.now() }));
        } catch (e) {}
      }
      return done(id || voiceCache(false));
    }).catch(function () {
      return done(voiceCache(false));   // 网络抖了就用手上旧的，别退回默认音色
    });
    return voicePromise;
  }

  /* 站长在后台换了音色，这里最多 10 分钟才跟上；?voice=flush 可强制重取 */
  try {
    if (/[?&]voice=flush(?:&|$)/.test(location.search)) {
      try { localStorage.removeItem(VOICE_STORE); } catch (e) {}
    }
  } catch (e) {}

  function cachePut(key, src) {
    if (cache[key] === undefined) cacheOrder.push(key);
    cache[key] = src;
    while (cacheOrder.length > CACHE_MAX) {
      var old = cacheOrder.shift();
      if (old !== undefined) delete cache[old];
    }
  }

  function keyOf(text, kind) {
    return (kind || 'answer') + '|' + text;
  }

  /** 请求云端合成；任何异常都抛出去，交给 ai-voice.js 的 fallbackToLocal 回落 */
  function request(text, kind) {
    var key = keyOf(text, kind);
    if (pending[key]) return pending[key];

    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'tts', text: text, kind: kind || 'answer', voice: voiceId || 0 }),
      cache: 'no-store'
    };
    if (ctrl) opts.signal = ctrl.signal;

    var timer = setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }, REQUEST_TIMEOUT);

    var p = fetch(endpoint(), opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error('tts_http_' + r.status + (j && j.error ? ':' + j.error : ''));
      });
      return r.json();
    }).then(function (j) {
      if (!j || !j.ok || !j.audio) throw new Error('tts_bad_payload');
      return 'data:' + (j.mime || 'audio/mpeg') + ';base64,' + j.audio;
    }).then(function (src) {
      delete pending[key];
      return src;
    }, function (e) {
      clearTimeout(timer);
      delete pending[key];
      throw e;
    });

    pending[key] = p;
    return p;
  }

  var provider = {
    synth: function (text, opts) {
      var kind = (opts && opts.kind) || 'answer';
      var key = keyOf(text, kind);
      if (cache[key] !== undefined) {
        return Promise.resolve({ src: cache[key], mime: 'audio/mpeg' });
      }
      return request(text, kind).then(function (src) {
        cachePut(key, src);
        return { src: src, mime: 'audio/mpeg' };
      });
    },

    /** 预取：ai-voice.js 播当前句时把后面几句提前合成好，命中缓存后 synth 直接返回 */
    prefetch: function (texts, opts) {
      var kind = (opts && opts.kind) || 'answer';
      var list = (texts || []).slice(0, PREFETCH_AHEAD);
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (!t) continue;
        var key = keyOf(t, kind);
        if (cache[key] !== undefined || pending[key]) continue;
        (function (k, txt) {
          request(txt, kind).then(function (src) {
            cachePut(k, src);          // 预取结果写进缓存，正式播报时直接命中
          }).catch(function () {});     // 预取失败静默，交给正式播报时的正常降级
        })(key, t);
      }
    }
  };

  function setState(s, msg) {
    state = s;
    reason = msg || '';
  }

  /** 探测全链路：先取音色，再合成两字，成功才把 provider 交给语音模块 */
  function probe(force) {
    if (!enabled) { setState('off', '云端通道已关闭'); voice.setProvider(null); return Promise.resolve(false); }
    if (probeDone && !force && state !== 'checking') return Promise.resolve(state === 'cloud');
    setState('checking');
    return loadVoice().then(function () {
      return provider.synth(PROBE_TEXT, { kind: 'answer' });
    }).then(function () {
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
    /** 性别套装切换后调用：丢掉旧性别的音色与音频缓存，重新取对应音色 */
    reloadVoice: function () {
      voicePromise = null;
      voiceId = 0;
      cache = Object.create(null);
      cacheOrder = [];
      pending = Object.create(null);
      try { localStorage.removeItem(VOICE_STORE); } catch (e) {}
      return probe(true);
    },
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
        voice: voiceId,
        endpoint: endpoint(),
        cached: cacheOrder.length,
        active: !!(voice.getStatus && voice.getStatus().provider === 'cloud')
      };
    }
  };

  probe(false);
})();
