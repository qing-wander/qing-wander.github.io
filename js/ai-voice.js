/* ════════════════════════════════════════════════════════════
   CP.AI 语音播报 · 零侵入语音层（设计依据：docs/ai-voice-survey.md）
   --------------------------------------------------------------
   1) js/main.js 问答逻辑零改动：靠 MutationObserver 观察 aiBody 新增的
      .ai-msg-bot 与首次打招呼气泡 .ai-fab-tip 触发播报。
   2) 主通道 = 浏览器内置 SpeechSynthesis：零 Key / 零后端 / 零费用；
      Edge 的 Online (Natural) 神经语音优先，系统本地中文语音兜底。
   3) 自动播放策略无法绕过：欢迎语先尝试 → onstart 未触发则挂起并显示
      「一点即播」引导 → 首次任意交互在手势内同步 unlock 并补播。
   4) 分句队列 + 看门狗规避 Chrome 网络语音 ~15s 静默截断。
   5) window.AIVoice 暴露契约；setProvider() 预留 Phase 2 云端 TTS。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─────────────── 常量与配置 ─────────────── */

  var STORE = 'cpai_voice_v1';
  var GREET_TEXT = '你好呀，我是 C P A I，陈培胜的档案问答助手。这页内容挺多，翻起来费时间，直接问我就好。答案都会标出依据，声音随时可以关掉。';
  var ON_TEXT = '语音已打开，有什么想问的？';
  var VOICE_TEST = '你好，这是当前的音色，听起来怎么样？';
  var MAX_TOTAL = 600;          // 单次播报最长字符
  var MAX_PART = 110;           // 单句最长字符（规避 Chrome 15s 截断）
  var START_TIMEOUT = 1200;     // 浏览器通道：onstart 超时 → 判定被自动播放策略拦截
  var CLOUD_START_TIMEOUT = 6000; // 云端通道：多一次网络往返，看门狗放宽
  var PART_TIMEOUT = 12000;     // 单句看门狗
  var CTA_DELAY = 420;           // 浏览器通道：没出声多久显示引导
  var CLOUD_CTA_DELAY = 2200;    // 云端通道：合成本身要耗时，别误报「被拦截」

  var STYLE = {
    greet:  { rate: 0.96, pitch: 1.08, gap: 180 },
    answer: { rate: 1.00, pitch: 1.00, gap: 110 },
    error:  { rate: 0.92, pitch: 0.96, gap: 140 }
  };

  var ICON =
    '<svg class="ai-voice-ico" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.5 7.5 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path class="ai-voice-slash" d="M3.5 20.5L20.5 3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '</svg>';

  /* ─────────────── 环境探测 ─────────────── */

  var synth = window.speechSynthesis;
  var Utter = window.SpeechSynthesisUtterance;
  var supported = !!(synth && Utter && typeof synth.speak === 'function');

  var aiPanel = document.getElementById('aiPanel');
  var aiBody = document.getElementById('aiBody');
  var aiHead = aiPanel ? aiPanel.querySelector('.ai-head') : null;
  var aiClose = document.getElementById('aiClose');
  if (!aiPanel || !aiBody) return;

  /* ─────────────── 状态 ─────────────── */

  var enabled = true;             // 默认开启：首次打招呼需要语音
  var voiceURI = '';
  var rateDelta = 0;
  var voices = [];
  var voicesBusy = false;          // loadVoices 重入保护（见下方注释）
  var cloudProvider = null;       // Phase 2：{ synth(text, opts) -> Promise<{src}> }
  var PENDING_NONE = {};
  var pendingProvider = PENDING_NONE;  // 播报中注册 provider：等这句念完再切，不打断
  var queue = [];
  var keep = [];                 // 保活 utterance 引用，防 Chromium GC
  var current = null;
  var currentAudio = null;        // Phase 2：云端 provider 正在播放的 <audio>
  var runId = 0;
  var speaking = false;
  var activationUnlocked = false;
  var welcomeState = 'none';     // none | pending | played
  var lastText = '', lastAt = 0;
  var startTimer = null, partTimer = null, ctaTimer = null, replayTimer = null;
  var ctaEl = null, inlineEl = null, toggleBtn = null;
  var gestureBound = false;

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.enabled === 'boolean') enabled = o.enabled;
      if (o && typeof o.voiceURI === 'string') voiceURI = o.voiceURI;
      if (o && typeof o.rateDelta === 'number') rateDelta = o.rateDelta;
    } catch (e) {}
  }
  function writeStore() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        enabled: enabled, voiceURI: voiceURI, rateDelta: rateDelta
      }));
    } catch (e) {}
  }

  /* ─────────────── 音色选择 ─────────────── */

  function scoreVoice(v) {
    var n = String(v.name || '');
    var lang = String(v.lang || '').replace('_', '-').toLowerCase();
    var s = 0;
    if (/^zh-cn/.test(lang)) s += 30;
    else if (/^zh/.test(lang)) s += 16;
    if (/natural/i.test(n)) s += 100;                 // Edge 神经语音：真人感来源
    if (/online/i.test(n)) s += 40;
    if (/xiaoxiao|晓晓/i.test(n)) s += 26;           // 最稳的中文女声
    if (/yunxi|云希/i.test(n)) s += 20;               // 自然的中文男声
    if (/chinese|中文|普通话|mandarin/i.test(n)) s += 10;
    if (v.localService) s += 8;                     // 本地语音更可靠，作为加分项
    if (/huihui|kangkang|yaoyao|tingting/i.test(n)) s -= 4;
    return s;
  }

  /* 重入保护：syncUI → voiceLabel → pickedVoice 会回调 loadVoices。
     首次 getVoices() 为空 / 过滤后无中文音色时，旧实现在这里无限递归爆栈，
     直接让整个 IIFE 中断、window.AIVoice 都挂不上（生产环境实测踩到过）。 */
  function loadVoices() {
    if (voicesBusy || !supported) return;
    voicesBusy = true;
    try {
      var list = [];
      try { list = synth.getVoices() || []; } catch (e) { list = []; }
      var next = [];
      for (var i = 0; i < list.length; i++) {
        var v = list[i];
        /* Edge 150 曾出现 "Microsoft undefined Online (Natural) - undefined" 残缺条目 */
        if (!v || !v.name || !v.lang || /undefined/i.test(v.name)) continue;
        var lang = String(v.lang).replace('_', '-').toLowerCase();
        if (!/^zh/.test(lang) && !/chinese|中文|普通话|mandarin|cmn/i.test(v.name)) continue;
        next.push({ v: v, score: scoreVoice(v) });
      }
      next.sort(function (a, b) { return b.score - a.score; });
      voices = next;
      /* 必须在 voicesBusy=true 期间调用：syncUI 经 voiceLabel → pickedVoice
         会回调 loadVoices，此时被重入保护挡住，链条到此为止 */
      syncUI();
    } finally {
      voicesBusy = false;
    }
  }

  function pickedVoice() {
    if (!voices.length) loadVoices();
    if (voiceURI) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].v.voiceURI === voiceURI) return voices[i].v;
      }
    }
    return voices.length ? voices[0].v : null;
  }

  function voiceLabel() {
    var v = pickedVoice();
    if (!v) return '系统默认语音';
    return v.name.replace(/^Microsoft\s*/i, '').replace(/Online \(Natural\)/i, '自然') +
      (v.localService ? '（本地）' : '（在线）');
  }

  /* ─────────────── 文本清洗：HTML → 口语文本 ─────────────── */

  var KILL = '.ai-src-row, .ai-src-label, .ai-src, .ai-greet-acts, .ai-msg-name, .ai-dot, script, style';

  function nodeToText(el) {
    var clone = el.cloneNode(true);
    if (clone.querySelectorAll) {
      var kills = clone.querySelectorAll(KILL);
      for (var i = kills.length - 1; i >= 0; i--) {
        if (kills[i].parentNode) kills[i].parentNode.removeChild(kills[i]);
      }
    }
    var html = (clone.innerHTML || '').replace(/<br\s*\/?\s*>/gi, '，');
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function normalize(text) {
    var t = String(text || '').replace(/<[^>]*>/g, '');
    t = t.replace(/0\s*[→➜>\-]\s*1/g, '从零到一');
    t = t.replace(/[👋▍▶↗▲▼⤴⌘✓✦]/g, '');
    t = t.replace(/→/g, '，').replace(/·/g, '，').replace(/\/\//g, '，');
    t = t.replace(/\bTF-?IDF\b/gi, 'T F I D F');
    t = t.replace(/\bRAG\b/g, 'R A G');
    t = t.replace(/CP\.AI/gi, 'C P A I');
    t = t.replace(/CloudBase/gi, '腾讯云开发');
    t = t.replace(/[ \t\r\n]+/g, ' ');
    /* <br> 已转成逗号：清掉「。，」这类叠标点与句首逗号，读起来才像说话 */
    t = t.replace(/([。！？；;!?])\s*，/g, '$1');
    t = t.replace(/，{2,}/g, '，').replace(/^，+/, '').replace(/\s+([，。！？；])/g, '$1');
    t = t.trim();
    if (t.length > MAX_TOTAL) t = t.slice(0, MAX_TOTAL) + '。更多内容，请看文字。';
    return t;
  }

  function tidy(s) { return String(s || '').trim().replace(/^，+/, ''); }

  function chunk(text) {
    var sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || [text];
    var out = [], buf = '';
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      if ((buf + s).length > MAX_PART && buf) {
        var part = tidy(buf);
        if (part) out.push(part);
        buf = '';
      }
      while (s.length > MAX_PART) {
        var cut = s.lastIndexOf('，', MAX_PART);
        if (cut < MAX_PART * 0.4) cut = MAX_PART;
        var head = tidy(s.slice(0, cut + 1));
        if (head) out.push(head);
        s = s.slice(cut + 1);
      }
      buf += s;
    }
    var tail = tidy(buf);
    if (tail) out.push(tail);
    return out;
  }

  /* ─────────────── 播报队列 ─────────────── */

  function emit(state) {
    try {
      var ev, detail = { state: state, enabled: enabled };
      if (window.CustomEvent) ev = new CustomEvent('cpai:voice', { detail: detail });
      else {
        ev = document.createEvent('CustomEvent');
        ev.initCustomEvent('cpai:voice', false, false, detail);
      }
      document.dispatchEvent(ev);
    } catch (e) {}
  }

  function setSpeaking(v) {
    if (speaking === v) return;
    speaking = v;
    if (v) document.body.classList.add('cpai-speaking');
    else document.body.classList.remove('cpai-speaking');
    if (!v && pendingProvider !== PENDING_NONE) {
      cloudProvider = pendingProvider;
      pendingProvider = PENDING_NONE;
    }
    emit(v ? 'start' : 'end');
  }

  function clearTimers() {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    if (partTimer) { clearTimeout(partTimer); partTimer = null; }
    if (ctaTimer) { clearTimeout(ctaTimer); ctaTimer = null; }
  }

  function stop() {
    runId++;
    clearTimers();
    queue = [];
    current = null;
    if (currentAudio) {
      /* 云端音频不吃 speechSynthesis.cancel()：关闭语音 / 切后台 / 新消息打断时
         必须自己 pause，否则会继续念下去 */
      try { currentAudio.pause(); currentAudio.removeAttribute('src'); currentAudio.load(); } catch (e) {}
      currentAudio = null;
    }
    try { synth.cancel(); } catch (e) {}
    setSpeaking(false);
  }

  function markStarted() {
    activationUnlocked = true;
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    if (welcomeState === 'pending') {
      welcomeState = 'played';
      hideCta();
    }
  }

  function blocked() {
    clearTimers();
    stop();
    if (welcomeState === 'pending') showCta(true);
  }

  function nextPart(ctx) {
    if (!enabled || ctx.run !== runId) return;
    if (!queue.length) { current = null; setSpeaking(false); return; }
    var part = queue.shift();
    var finished = false;                 // done 只能推进一次：cancel 会同时触发 onend
    var done = function () {
      if (finished) return;
      finished = true;
      if (ctx.run !== runId || !enabled) return;
      if (partTimer) { clearTimeout(partTimer); partTimer = null; }
      currentAudio = null;
      markStarted();   // 走到 onend 说明真的出过声，别再误判成被拦截
      setTimeout(function () { nextPart(ctx); }, ctx.style.gap);
    };
    partTimer = setTimeout(function () {
      /* 网络语音静默截断：取消当前句，强制推进下一句 */
      if (ctx.run !== runId) return;
      current = null;
      if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
      try { synth.cancel(); } catch (e) {}
      done();
    }, PART_TIMEOUT);

    if (cloudProvider) {
      /* Phase 2：云端 provider 按句合成，队列 / 去重 / UI 全部复用。
         audio.play() 的 Promise 会明确告知是否被自动播放策略拦截，
         不能沿用浏览器通道的「1.2s 没 onstart 就算被拦」判定。 */
      var degraded = false;
      var fallbackToLocal = function () {
        if (degraded || ctx.run !== runId) return;
        degraded = true;
        finished = true;
        cloudProvider = null;        // 连续失败不拖慢后续每一句，本次会话回落浏览器通道
        currentAudio = null;
        if (partTimer) { clearTimeout(partTimer); partTimer = null; }
        speakLocalAgain(ctx, part);
      };
      try {
        cloudProvider.synth(part, { kind: ctx.kind }).then(function (res) {
          if (ctx.run !== runId || !enabled) { done(); return; }
          if (!res || !res.src) { fallbackToLocal(); return; }
          var audio = new Audio(res.src);
          audio.dataset.aiGenerated = '1';   // 生成合成音频的元数据标识
          currentAudio = audio;
          audio.onended = done;
          audio.onerror = fallbackToLocal;
          var p;
          try { p = audio.play(); } catch (e) { p = null; }
          if (p && p.then) {
            p.then(function () {
              if (ctx.run !== runId) return;
              markStarted();
              setSpeaking(true);
            }).catch(function () {
              if (ctx.run !== runId) return;
              currentAudio = null;
              /* 欢迎语被拦：挂起并给「一点即播」入口；其它场景直接退回浏览器语音 */
              if (welcomeState === 'pending' && !activationUnlocked) { blocked(); return; }
              fallbackToLocal();
            });
          } else {
            audio.onplaying = function () { markStarted(); setSpeaking(true); };
            if (audio.paused) fallbackToLocal();
          }
        }).catch(fallbackToLocal);
      } catch (e) { fallbackToLocal(); }
      return;
    }

    var u = new Utter(part);
    var v = ctx.voice;
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-CN'; }
    u.rate = ctx.style.rate + rateDelta;
    u.pitch = ctx.style.pitch;
    u.volume = 0.95;
    u.onstart = function () { markStarted(); setSpeaking(true); };
    u.onend = done;
    u.onerror = function (e) {
      var code = e && e.error ? String(e.error) : '';
      if (/interrupted|canceled/i.test(code)) return;   // cancel 引起的正常中断
      if (u !== current) return;
      current = null;
      if (/not-allowed|not_allowed|denied/i.test(code)) { blocked(); return; }
      done();
    };
    current = u;
    keep.push(u);
    if (keep.length > 40) keep.shift();
    try { synth.speak(u); } catch (e) { done(); }
  }

  /* 云端 provider 失败：把当前句和剩余队列退回浏览器通道，用户无感 */
  function speakLocalAgain(ctx, part) {
    if (ctx.run !== runId || !enabled) return;
    queue.unshift(part);
    nextPart(ctx);
  }

  function say(text, opts) {
    opts = opts || {};
    if (!supported || !enabled || !text || document.hidden) return false;
    var clean = normalize(text);
    if (!clean) return false;
    if (clean === lastText && Date.now() - lastAt < 1500) return false;
    lastText = clean; lastAt = Date.now();

    stop();
    var ctx = {
      run: runId,
      kind: opts.kind || 'answer',
      style: STYLE[opts.kind] || STYLE.answer,
      voice: pickedVoice()
    };
    queue = chunk(clean);

    /* 1.2s 内没有 onstart → 判定被自动播放策略拦截；欢迎语挂起并给出引导 */
    /* 云端通道多一次网络往返：放宽看门狗与 CTA 延迟，别把「还在合成」误判成「被拦截」 */
    var cloud = !!cloudProvider;
    startTimer = setTimeout(function () {
      if (ctx.run === runId && !activationUnlocked) blocked();
    }, cloud ? CLOUD_START_TIMEOUT : START_TIMEOUT);
    /* 欢迎语不依赖「能否提前判断自动播放策略」：没出声就给引导，
       已经出声时 welcomeState 已变 played，showCta 会自动跳过 */
    if (opts.kind === 'greet' && welcomeState === 'pending') {
      ctaTimer = setTimeout(function () { showCta(false); }, cloud ? CLOUD_CTA_DELAY : CTA_DELAY);
    }
    nextPart(ctx);
    return true;
  }

  /* ─────────────── 自动播放解锁 / 首次欢迎语 ─────────────── */

  function unlock() {
    if (!supported || activationUnlocked) return;
    activationUnlocked = true;
    try {
      /* iOS Safari：第一次 speak 必须同步发生在手势回调内，空占位句用来解锁 */
      var blank = new Utter(' ');
      blank.volume = 0;
      synth.speak(blank);
    } catch (e) {}
  }

  function onGreetCue() {
    if (welcomeState !== 'none') return;
    if (!enabled) { welcomeState = 'played'; return; }
    welcomeState = 'pending';
    /* 总是先尝试：部分浏览器因媒体参与度 / 已有激活而允许自动播；
       播不出去时 say() 的 420ms 引导 / 1.2s 看门狗会接住 */
    if (!say(GREET_TEXT, { kind: 'greet' })) showCta(true);
  }

  function onFirstGesture(e) {
    if (e && e.target && e.target.closest && e.target.closest('.ai-voice-cta')) return;
    unlock();
    detachGestures();
    if (welcomeState === 'pending' && enabled) {
      welcomeState = 'played';
      hideCta();
      /* 留一个小窗口：若这次手势正好是「打开面板」，让面板里那条正式
         欢迎语接管，避免补播的 GREET_TEXT 把它打断（见 handleMessage） */
      if (replayTimer) clearTimeout(replayTimer);
      replayTimer = setTimeout(function () {
        replayTimer = null;
        say(GREET_TEXT, { kind: 'greet' });
      }, 140);
    }
  }

  var GESTURES = ['pointerdown', 'touchstart', 'keydown', 'click'];
  function attachGestures() {
    if (gestureBound) return;
    gestureBound = true;
    for (var i = 0; i < GESTURES.length; i++) {
      document.addEventListener(GESTURES[i], onFirstGesture, true);
    }
  }
  function detachGestures() {
    if (!gestureBound) return;
    gestureBound = false;
    for (var i = 0; i < GESTURES.length; i++) {
      document.removeEventListener(GESTURES[i], onFirstGesture, true);
    }
  }

  /* ─────────────── UI：面板头开关 / 首次引导 ─────────────── */

  function makeToggle(cls, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = ICON;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', 'true');
    b.title = label;
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setEnabled(!enabled);
    });
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      cycleVoice();
    });
    return b;
  }

  function buildUI() {
    toggleBtn = makeToggle('ai-voice-toggle', '关闭 AI 语音播报');
    if (aiHead) {
      if (aiClose && aiClose.parentNode === aiHead) aiHead.insertBefore(toggleBtn, aiClose);
      else aiHead.appendChild(toggleBtn);
    }

    /* 右下角常驻开关已移除（2026-11-18）：它贴在 3D 角色旁，视觉噪声大于收益。
       语音开关只留 aiHead 里这一个，要关语音打开面板点一下即可。 */
  }

  function syncUI() {
    if (!toggleBtn) return;
    var label = enabled ? '关闭 AI 语音播报' : '开启 AI 语音播报';
    var title = (enabled ? 'AI 语音：开' : 'AI 语音：关') + ' · ' + voiceLabel() + ' · 右键换音色';
    toggleBtn.classList.toggle('is-off', !enabled || !supported);
    toggleBtn.setAttribute('aria-pressed', enabled && supported ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', supported ? label : '当前浏览器不支持语音播报');
    toggleBtn.title = supported ? title : '当前浏览器不支持语音播报';
    toggleBtn.disabled = !supported;
  }

  function syncCta() {
    var open = !!(aiPanel && !aiPanel.hidden);
    /* 10s 后 main.js 会自动展开面板：浮动引导会被面板盖住，
       此时把引导改挂到对话区里，保证「一点即播」入口始终看得见 */
    if (welcomeState === 'pending' && enabled) {
      hideCta();
      showCta(true);
    }
  }

  var CTA_HTML =
    '<p class="ai-voice-cta-txt">浏览器拦住了自动播放，点一下让 CP.AI 开口打招呼</p>' +
    '<div class="ai-voice-cta-acts">' +
      '<button type="button" class="ai-voice-cta-yes">🔊 听它说</button>' +
      '<button type="button" class="ai-voice-cta-no">先不用</button>' +
    '</div>';

  function onCtaYes(e) {
    e.preventDefault(); e.stopPropagation();
    unlock();
    detachGestures();
    welcomeState = 'played';
    hideCta();
    say(GREET_TEXT, { kind: 'greet' });
  }
  function onCtaNo(e) {
    e.preventDefault(); e.stopPropagation();
    welcomeState = 'played';
    hideCta();
  }
  function bindCta(root) {
    var yes = root.querySelector('.ai-voice-cta-yes');
    var no = root.querySelector('.ai-voice-cta-no');
    if (yes) yes.addEventListener('click', onCtaYes);
    if (no) no.addEventListener('click', onCtaNo);
  }

  function showCta(immediate) {
    if (!supported || !enabled || welcomeState !== 'pending') return;
    if (ctaTimer) { clearTimeout(ctaTimer); ctaTimer = null; }

    if (aiPanel && !aiPanel.hidden) {
      if (inlineEl && inlineEl.parentNode) return;
      if (ctaEl && ctaEl.parentNode) { ctaEl.parentNode.removeChild(ctaEl); ctaEl = null; }
      inlineEl = document.createElement('div');
      inlineEl.className = 'ai-voice-inline-cta';
      inlineEl.innerHTML = CTA_HTML;
      aiBody.appendChild(inlineEl);
      bindCta(inlineEl);
      return;
    }

    if (ctaEl && ctaEl.parentNode) { ctaEl.style.display = ''; return; }
    if (inlineEl && inlineEl.parentNode) {
      inlineEl.parentNode.removeChild(inlineEl);
      inlineEl = null;
    }
    ctaEl = document.createElement('div');
    ctaEl.className = 'ai-voice-cta';
    ctaEl.innerHTML = CTA_HTML;
    document.body.appendChild(ctaEl);
    bindCta(ctaEl);
    if (!immediate) ctaEl.classList.add('is-late');
  }

  function hideCta() {
    if (ctaTimer) { clearTimeout(ctaTimer); ctaTimer = null; }
    if (ctaEl && ctaEl.parentNode) ctaEl.parentNode.removeChild(ctaEl);
    if (inlineEl && inlineEl.parentNode) inlineEl.parentNode.removeChild(inlineEl);
    ctaEl = null;
    inlineEl = null;
  }

  function cancelReplay() {
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
  }

  function cycleVoice() {
    if (!supported || !enabled) return;
    if (!voices.length) loadVoices();
    if (!voices.length) return;
    var idx = -1;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].v.voiceURI === voiceURI) { idx = i; break; }
    }
    var next = voices[(idx + 1) % voices.length];
    voiceURI = next.v.voiceURI || '';
    writeStore();
    syncUI();
    stop();
    say(VOICE_TEST, { kind: 'answer' });
  }

  function setEnabled(v) {
    enabled = !!v;
    writeStore();
    if (!enabled) {
      if (supported) stop();
      hideCta();
      cancelReplay();
      if (welcomeState === 'pending') welcomeState = 'played';
      detachGestures();
    } else {
      attachGestures();
      unlock();
      say(ON_TEXT, { kind: 'answer' });
    }
    syncUI();
  }

  /* ─────────────── DOM 观察：不碰 main.js ─────────────── */

  function handleMessage(node) {
    if (!node || node.nodeType !== 1 || !node.classList) return;
    if (node.classList.contains('ai-msg-user') || node.classList.contains('ai-typing')) return;
    if (!node.classList.contains('ai-msg-bot')) return;
    var bubble = node.querySelector ? node.querySelector('.ai-bubble') : null;
    if (!bubble) return;
    var isGreet = node.classList.contains('ai-greet') ||
                  (bubble.querySelector && bubble.querySelector('.ai-greet-acts'));
    if (isGreet && welcomeState !== 'none') return;  // 10s 自动展开不与首次欢迎语重复
    cancelReplay();                                  // 正式消息接管，别再补播 GREET_TEXT
    if (welcomeState === 'pending') {                 // 用户手动打开过面板：交给这条正式欢迎语
      welcomeState = 'played';
      hideCta();
    }
    var raw = nodeToText(bubble);
    if (!raw.trim()) return;
    say(raw, { kind: /^▍/.test(raw.trim()) ? 'error' : (isGreet ? 'greet' : 'answer') });
  }

  function observe() {
    if (window.MutationObserver) {
      var bodyMo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          for (var j = 0; j < added.length; j++) handleMessage(added[j]);
        }
      });
      bodyMo.observe(aiBody, { childList: true });

      /* 首次打招呼气泡由 main.js 插到 #aiFab 的父节点（body） */
      var tipMo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n && n.classList && n.classList.contains('ai-fab-tip')) onGreetCue();
          }
        }
      });
      tipMo.observe(document.body, { childList: true });

      var panelMo = new MutationObserver(syncCta);
      panelMo.observe(aiPanel, { attributes: true, attributeFilter: ['hidden'] });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && supported) stop();
      syncCta();
    });
    window.addEventListener('pagehide', function () { if (supported) stop(); }, false);
  }

  /* ─────────────── 启动 ─────────────── */

  readStore();
  buildUI();
  syncCta();
  syncUI();

  if (supported) {
    loadVoices();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 3000);   // 某些引擎永不触发 voiceschanged
    attachGestures();
  } else {
    detachGestures();
  }
  observe();

  /* ─────────────── 对外契约 ─────────────── */

  window.AIVoice = {
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    speak: function (text, opts) { return say(text, opts || {}); },
    cancel: function () { if (supported) stop(); },
    setProvider: function (p) {
      var next = (p && typeof p.synth === 'function') ? p : null;
      /* 探测云端可用性是异步的：若此刻正在朗读，等这句播完再切，
         否则 setProvider 会把欢迎语拦腰截断（Phase 2 实测踩到过） */
      if (speaking) { pendingProvider = next; return; }
      cloudProvider = next;
      pendingProvider = PENDING_NONE;
    },
    getStatus: function () {
      var v = pickedVoice();
      return {
        supported: supported,
        enabled: enabled,
        speaking: speaking,
        provider: cloudProvider ? 'cloud' : 'browser',
        voice: v ? v.name : null,
        voiceLocal: v ? !!v.localService : null,
        voiceCount: voices.length,
        welcomeState: welcomeState,
        unlocked: activationUnlocked
      };
    }
  };
})();
