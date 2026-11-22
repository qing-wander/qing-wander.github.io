/* ════════════════════════════════════════════════════════════
   数字分身角色舞台 · 皮肤切换系统
   --------------------------------------------------------------
   设计原则：
   1) 不碰 js/main.js 的问答逻辑 —— 单击角色等价于点原有 #aiFab，
      状态联动靠 MutationObserver 观察面板与打字气泡。
   2) 皮肤统一契约 create(host) -> { setState(s), destroy() }，
      状态 s ∈ idle | thinking | answer | greet | click。
   3) 3D 皮肤用本地 GLB + 按需加载的 model-viewer；2D 皮肤全部内联 SVG，
      无外部依赖、随站点主题变量换色，离线可跑。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var BASE = 'assets/skins/';
  var STORE = 'cpai_skin_v2';
  /* 性别切换模式：男女两套形象由隐藏按钮统一切换，不开放Public皮肤菜单 */
  var GENDER_SWITCH_ONLY = true;
  /* 旧版 key 作废：清掉 2D 默认的残留，让所有访问者统一落到 3D 默认 */
  try { localStorage.removeItem('cpai_skin_v1'); } catch (e) {}
  var aiFab = document.getElementById('aiFab');
  var aiPanel = document.getElementById('aiPanel');
  var aiBody = document.getElementById('aiBody');
  if (!aiFab || !aiPanel) return;

  /* ─────────────── SVG 角色素材（内联，零请求） ─────────────── */

  var SVG_CPBOT =
    '<svg class="ai-sk-svg" viewBox="0 0 120 150" aria-hidden="true">' +
    '<ellipse cx="60" cy="141" rx="34" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
    '<g class="sk-breathe">' +
      '<g class="sk-cpbot-antenna"><path class="sk-line" d="M60 34V19"/><circle cx="60" cy="15" r="5" class="sk-orange sk-line"/></g>' +
      '<rect x="18" y="48" width="7" height="18" class="sk-ink"/><rect x="95" y="48" width="7" height="18" class="sk-ink"/>' +
      '<rect x="24" y="32" width="72" height="56" rx="6" class="sk-card sk-line"/>' +
      '<rect x="31" y="39" width="58" height="40" rx="3" class="sk-blue"/>' +
      '<g class="sk-cpbot-eyes">' +
        '<rect x="42" y="50" width="10" height="14" rx="2" class="sk-white sk-blink"/>' +
        '<rect x="68" y="50" width="10" height="14" rx="2" class="sk-white sk-blink"/>' +
      '</g>' +
      '<path d="M50 69Q60 75 70 69" style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round"/>' +
      '<rect x="34" y="88" width="52" height="42" rx="4" class="sk-card sk-line"/>' +
      '<rect x="42" y="96" width="36" height="17" class="sk-paper sk-line-thin"/>' +
      '<text x="60" y="108" text-anchor="middle" class="sk-ink" style="font:700 9px monospace;letter-spacing:.06em">CP.ME</text>' +
      '<circle cx="76" cy="121" r="4" class="sk-green sk-cpbot-lamp"/>' +
      '<path class="sk-line" d="M45 130v10M75 130v10"/>' +
    '</g></svg>';

  var SVG_CAT =
    '<svg class="ai-sk-svg" viewBox="0 0 120 150" aria-hidden="true">' +
    '<ellipse cx="60" cy="141" rx="36" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
    '<g class="sk-breathe">' +
      '<g class="sk-cat-tail">' +
        '<path d="M88 118Q113 116 109 94Q107 82 98 88" style="fill:none;stroke:var(--ink);stroke-width:13;stroke-linecap:round"/>' +
        '<path d="M88 118Q113 116 109 94Q107 82 98 88" style="fill:none;stroke:var(--orange);stroke-width:7;stroke-linecap:round"/>' +
      '</g>' +
      '<rect x="34" y="90" width="52" height="45" rx="20" class="sk-card sk-line"/>' +
      '<g class="sk-cat-paw"><rect x="44" y="118" width="14" height="15" rx="7" class="sk-card sk-line"/>' +
      '<rect x="64" y="118" width="14" height="15" rx="7" class="sk-card sk-line"/></g>' +
      '<rect x="34" y="94" width="52" height="9" rx="4" class="sk-orange sk-line-thin"/>' +
      '<circle cx="60" cy="100" r="4" class="sk-blue sk-line-thin"/>' +
      '<g class="sk-cat-head">' +
        '<path class="sk-card sk-line sk-cat-ear" d="M34 58L32 34L52 48Z"/>' +
        '<path class="sk-card sk-line sk-cat-ear" d="M86 58L88 34L68 48Z"/>' +
        '<path d="M38 40L36 51L46 47Z" class="sk-orange"/><path d="M82 40L84 51L74 47Z" class="sk-orange"/>' +
        '<rect x="30" y="48" width="60" height="48" rx="20" class="sk-card sk-line"/>' +
        '<g class="sk-blink"><ellipse cx="47" cy="69" rx="6" ry="8" class="sk-ink"/>' +
        '<ellipse cx="73" cy="69" rx="6" ry="8" class="sk-ink"/></g>' +
        '<circle cx="49" cy="66" r="2" class="sk-white"/><circle cx="75" cy="66" r="2" class="sk-white"/>' +
        '<path d="M57 79L60 82L63 79Z" class="sk-orange"/>' +
        '<path d="M60 82v3M60 85q-5 5-9 1M60 85q5 5 9 1" class="sk-line-thin"/>' +
        '<path d="M32 76l-12-3M32 82l-12 3M88 76l12-3M88 82l12 3" class="sk-line-thin"/>' +
      '</g>' +
    '</g></svg>';

  var SVG_L2D =
    '<svg class="ai-sk-svg sk-l2d" viewBox="0 0 120 150" aria-hidden="true">' +
    '<ellipse cx="60" cy="141" rx="34" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
    '<g class="sk-l2d-layer" data-depth="0.35">' +
      '<path d="M26 60Q20 18 60 16Q100 18 94 60L92 108Q88 124 60 124Q32 124 28 108Z" class="sk-ink"/>' +
    '</g>' +
    '<g class="sk-l2d-layer" data-depth="0.55">' +
      '<g class="sk-l2d-body">' +
        '<path d="M32 108Q60 98 88 108L94 140H26Z" class="sk-blue sk-line"/>' +
        '<path d="M52 104L60 116L68 104" class="sk-card sk-line-thin"/>' +
        '<path d="M60 116v22" class="sk-line-thin" style="stroke:var(--orange)"/>' +
        '<rect x="46" y="126" width="28" height="10" class="sk-card sk-line-thin"/>' +
        '<text x="60" y="134" text-anchor="middle" class="sk-ink" style="font:700 7px monospace">ARCHIVE</text>' +
      '</g>' +
    '</g>' +
    '<g class="sk-l2d-layer" data-depth="0.8">' +
      '<rect x="36" y="40" width="48" height="56" rx="18" class="sk-card sk-line"/>' +
      '<path d="M32 52Q60 34 88 52Q86 40 60 36Q34 40 32 52Z" class="sk-ink sk-l2d-hair"/>' +
      '<path d="M30 50Q36 26 60 26Q84 26 90 50L84 46Q60 34 36 46Z" class="sk-ink"/>' +
      '<g class="sk-blink"><ellipse cx="48" cy="66" rx="4.5" ry="6" class="sk-ink"/>' +
      '<ellipse cx="72" cy="66" rx="4.5" ry="6" class="sk-ink"/></g>' +
      '<circle cx="49.5" cy="64" r="1.6" class="sk-white"/><circle cx="73.5" cy="64" r="1.6" class="sk-white"/>' +
      '<circle cx="48" cy="66" r="10" class="sk-line-thin"/><circle cx="72" cy="66" r="10" class="sk-line-thin"/>' +
      '<path d="M58 66h4" class="sk-line-thin"/>' +
      '<path d="M55 82q5 5 10 0" class="sk-line-thin sk-l2d-mouth"/>' +
      '<circle cx="38" cy="76" r="4" class="sk-orange" style="opacity:.55"/>' +
      '<circle cx="82" cy="76" r="4" class="sk-orange" style="opacity:.55"/>' +
    '</g></svg>';

  var SVG_PET =
    '<svg class="ai-sk-svg" viewBox="0 0 60 60" aria-hidden="true">' +
    '<g class="sk-pet-body">' +
      '<rect x="8" y="12" width="44" height="38" rx="12" class="sk-card sk-line"/>' +
      '<rect x="13" y="17" width="34" height="20" rx="8" class="sk-blue"/>' +
      '<g class="sk-blink"><circle cx="22" cy="27" r="3.6" class="sk-white"/>' +
      '<circle cx="38" cy="27" r="3.6" class="sk-white"/></g>' +
      '<circle cx="22" cy="27" r="1.7" class="sk-ink"/><circle cx="38" cy="27" r="1.7" class="sk-ink"/>' +
      '<path d="M26 40q4 4 8 0" class="sk-line-thin"/>' +
      '<path class="sk-pet-arm sk-line" d="M50 30q9-2 8-10"/>' +
      '<path class="sk-line" d="M18 50v6M42 50v6"/>' +
      '<rect x="15" y="9" width="30" height="5" rx="2" class="sk-orange"/>' +
    '</g></svg>';

  var SVG_MASCOT =
    '<svg class="ai-sk-svg" viewBox="0 0 120 150" aria-hidden="true">' +
    '<ellipse cx="60" cy="141" rx="34" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
    '<g class="sk-breathe">' +
      '<circle cx="60" cy="76" r="48" class="sk-line-thin sk-mascot-ring" style="stroke-dasharray:7 9;stroke:var(--blue)"/>' +
      '<g class="sk-mascot-core">' +
        '<path d="M60 30L96 76L60 122L24 76Z" class="sk-blue sk-line"/>' +
        '<path d="M60 42L86 76L60 110L34 76Z" class="sk-card sk-line-thin"/>' +
        '<g class="sk-blink"><rect x="46" y="66" width="9" height="13" rx="3" class="sk-ink"/>' +
        '<rect x="65" y="66" width="9" height="13" rx="3" class="sk-ink"/></g>' +
        '<path d="M52 90q8 7 16 0" class="sk-line-thin"/>' +
        '<path d="M60 30V18" class="sk-line"/><circle cx="60" cy="15" r="5" class="sk-orange sk-line"/>' +
        '<text x="60" y="80" text-anchor="middle" style="font:700 8px monospace;fill:var(--ink);opacity:.35">CP</text>' +
      '</g>' +
    '</g></svg>';

  var SVG_TALK =
    '<svg class="ai-sk-svg" viewBox="0 0 120 150" aria-hidden="true">' +
    '<ellipse cx="60" cy="141" rx="34" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
    '<g class="sk-breathe">' +
      '<path d="M22 140q4-30 38-30t38 30Z" class="sk-blue sk-line"/>' +
      '<path d="M52 110l8 12 8-12" class="sk-card sk-line-thin"/>' +
      '<rect x="36" y="32" width="48" height="62" rx="22" class="sk-card sk-line"/>' +
      '<path d="M34 50Q36 22 60 22Q84 22 86 50L80 42Q60 30 40 42Z" class="sk-ink"/>' +
      '<g class="sk-blink"><ellipse cx="48" cy="62" rx="4" ry="5.5" class="sk-ink"/>' +
      '<ellipse cx="72" cy="62" rx="4" ry="5.5" class="sk-ink"/></g>' +
      '<ellipse cx="60" cy="80" rx="7" ry="4" class="sk-ink sk-talk-mouth"/>' +
      '<circle cx="38" cy="72" r="4" class="sk-orange" style="opacity:.5"/>' +
      '<circle cx="82" cy="72" r="4" class="sk-orange" style="opacity:.5"/>' +
      '<g transform="translate(90 66)">' +
        '<rect class="sk-wave-bar sk-orange" x="0" y="4" width="4" height="16" rx="2"/>' +
        '<rect class="sk-wave-bar sk-blue" x="7" y="0" width="4" height="20" rx="2"/>' +
        '<rect class="sk-wave-bar sk-orange" x="14" y="6" width="4" height="14" rx="2"/>' +
        '<rect class="sk-wave-bar sk-blue" x="21" y="2" width="4" height="18" rx="2"/>' +
      '</g>' +
    '</g></svg>';

  /* ─────────────── 3D 皮肤工厂 ─────────────── */

  var mvPromise = null;
  /* 动态 import 必须用绝对 URL：classic script 里的裸相对 specifier 在部分浏览器会解析失败 */
  var MV_URL = new URL(BASE + 'vendor/model-viewer.min.js', document.baseURI).href;
  function ensureModelViewer() {
    if (window.customElements && customElements.get('model-viewer')) return Promise.resolve();
    if (mvPromise) return mvPromise;
    var loaded = import(MV_URL).then(function () {
      return customElements.whenDefined('model-viewer');
    });
    var guard = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('model-viewer timeout')); }, 12000);
    });
    mvPromise = Promise.race([loaded, guard]).catch(function (e) {
      mvPromise = null;
      throw e;
    });
    return mvPromise;
  }

  function fallback3D(hostEl, msg) {
    hostEl.innerHTML = SVG_CPBOT + '<div class="ai-mv-hud">3D 降级 // ' + msg + '</div>';
  }

  function create3D(cfg) {
    return function (host) {
      var disposed = false, mv = null, state = 'idle', restoreTimer = null;
      host.innerHTML =
        '<div class="ai-mv-loading">' +
          '<svg class="ai-sk-svg" viewBox="0 0 120 150" style="max-width:110px;max-height:130px">' +
            '<ellipse cx="60" cy="141" rx="30" ry="5" style="fill:rgba(var(--ink-rgb),.18)"/>' +
            '<rect x="34" y="46" width="52" height="46" rx="8" class="sk-card sk-line"/>' +
            '<rect x="42" y="56" width="36" height="24" rx="3" class="sk-blue"/>' +
            '<text x="60" y="112" text-anchor="middle" style="font:700 9px monospace;fill:var(--ink-soft)">LOADING 3D…</text>' +
          '</svg></div>' +
        (cfg.hud ? '<div class="ai-mv-frame"></div><div class="ai-mv-scan"></div><div class="ai-mv-hud">LIVE 3D // HYBRID</div>' : '');

      /* 首屏优先：model-viewer(≈979KB) + GLB(≈872KB) 合计近 1.8MB，
         等页面 load 后浏览器空闲再拉，期间先显示 SVG 占位；点角色会立即触发加载。 */
      var booted = false;
      var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      function boot() {
        if (booted || disposed) return;
        booted = true;
        ensureModelViewer().then(function () {
        if (disposed) return;
        mv = document.createElement('model-viewer');
        mv.className = 'ai-mv' + (cfg.bob ? ' ai-mv-bob' : '');
        /* 3D 模型走 CDN 重写器（可一键回退本地）：仅在 AssetURL 就绪时替换 GLB */
        var modelSrc = (window.AssetURL && window.AssetURL.model)
          ? window.AssetURL.model(cfg.file)
          : (BASE + 'models/' + cfg.file);
        mv.setAttribute('src', modelSrc);
        mv.setAttribute('alt', cfg.name + ' 3D 模型');
        if (!reduceMotion) mv.setAttribute('autoplay', '');
        mv.setAttribute('animation-name', cfg.clips.idle);
        mv.setAttribute('animation-crossfade-duration', cfg.seq ? '620' : '280');
        /* 四足动物固定侧面视角更好看，靠骨骼 idle 动画提供活动；人形/机器人可缓慢自转 */
        if (cfg.rotate) {
          mv.setAttribute('auto-rotate', '');
          mv.setAttribute('auto-rotate-delay', '0');
          mv.setAttribute('rotation-per-second', cfg.rotate);
        }
        /* 窄屏舞台只有 116×156，同一取景距离下人物会更小；单独给一档镜头 */
        var narrow = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
        mv.setAttribute('camera-orbit', (narrow && cfg.orbitNarrow) || cfg.orbit || '0deg 80deg 80%');
        /* 显式视线中心：model-viewer 默认按根节点(脚底)取景，人形会顶掉头；对准人体中心 */
        mv.setAttribute('camera-target', (narrow && cfg.targetNarrow) || cfg.target || '0m 0.6m 0m');
        if (cfg.fov) mv.setAttribute('field-of-view', cfg.fov);
        /* 接触阴影：原本 shadow-intensity=0，人物完全悬空、和浅色页面对不上焦 */
        mv.setAttribute('shadow-intensity', '0.55');
        mv.setAttribute('shadow-softness', '1');
        mv.setAttribute('interaction-prompt', 'none');
        mv.setAttribute('touch-action', 'pan-y');
        mv.setAttribute('loading', 'eager');
        var loading = host.querySelector('.ai-mv-loading');
        if (loading) loading.remove();
        host.appendChild(mv);
        mv.addEventListener('load', function () {
          stage.classList.add('is-mv-ready');
          /* 减少动态偏好：停在待机首帧，不做入场挥手与坐姿序列 */
          if (reduceMotion) { apply(state, true); try { mv.pause(); } catch (e) {} return; }
          if (cfg.seq) intro(); else apply(state, true);
        });
        /* 一次性动作播完自动回到待机/坐姿（model-viewer 默认不循环） */
        mv.addEventListener('finished', function () {
          if (!cfg.seq) return;
          if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
          if (phase === 'intro' || phase === 'oneshot') settle();
        });
        mv.addEventListener('error', function () { fallback3D(host, '模型加载失败'); });
        }).catch(function () {
          if (disposed) return;
          fallback3D(host, '需用 http 预览');
        });
      }

      var bootScheduled = false;
      function scheduleBoot() {
        if (bootScheduled) return;
        bootScheduled = true;
        var go = function () { setTimeout(boot, 400); };
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 });
        else setTimeout(go, 900);
      }
      if (document.readyState === 'complete') scheduleBoot();
      else {
        window.addEventListener('load', scheduleBoot, { once: true });
        /* 兜底：Turnstile / 字体等第三方资源可能把 load 拖到十几秒，不能让角色一直停在占位 */
        setTimeout(scheduleBoot, 2600);
      }

      /* ── 骨骼动画序列（cfg.seq）：入场挥手 → 待机呼吸 → 停留后坐下 ── */
      var seq = cfg.seq || null;
      var phase = 'boot';        /* boot | intro | idle | sit | oneshot */
      var sitTimer = null, layTimer = null;
      var restMode = 'idle';     /* 一次性动作结束后回到 idle 还是 sit */

      /* 与建模型时同一档镜头：窄屏用 orbitNarrow，否则 toIdle/toSit 切回时会把镜头拉远 */
      var narrowView = !!(window.matchMedia && window.matchMedia('(max-width: 560px)').matches);
      var baseOrbit = (narrowView && cfg.orbitNarrow) || cfg.orbit || '0deg 80deg 80%';
      function setView(mode) {
        if (!mv) return;
        if (mode === 'lay') {
          mv.setAttribute('orientation', '0deg 0deg 90deg');
          mv.setAttribute('camera-orbit', '0deg 78deg 200%');
        } else {
          mv.setAttribute('orientation', '0deg 0deg 0deg');
          mv.setAttribute('camera-orbit', baseOrbit);
        }
      }
      function playClip(name) {
        if (!name || !mv) return;
        if (mv.animationName !== name) mv.animationName = name;
        if (reduceMotion) { try { mv.pause(); } catch (e) {} return; }
        try { mv.play(); } catch (e) {}
      }
      /* GLB 里可能还没有 Think 剪辑（Mixamo 后续补），按实际可用剪辑回退 */
      function hasAnim(name) {
        var list = (mv && mv.availableAnimations) || [];
        return !!name && list.indexOf(name) >= 0;
      }
      function pickClip(name, fallback) {
        if (!name) return fallback;
        var list = (mv && mv.availableAnimations) || [];
        if (!list.length || hasAnim(name)) return name;
        return fallback;
      }
      function clearSit() {
        if (sitTimer) { clearTimeout(sitTimer); sitTimer = null; }
        if (layTimer) { clearTimeout(layTimer); layTimer = null; }
      }
      /* 久坐计时单独抽出：起身答完一轮后要能把"10 秒后盘腿坐"重新接上 */
      function armSit() {
        if (!seq || !seq.sit || sitTimer) return;
        sitTimer = setTimeout(function () { sitTimer = null; toSit(); }, seq.sitAfter || 10000);
      }
      function toIdle(restartTimer) {
        clearSit();
        phase = 'idle'; restMode = 'idle';
        if (mv) { mv.classList.remove('ai-mv-sit', 'ai-mv-lay'); if (cfg.bob) mv.classList.add('ai-mv-bob'); }
        setView('stand');
        playClip(cfg.clips.idle);
        if (restartTimer !== false) armSit();
      }
      function toSit() {
        clearSit();
        phase = 'sit'; restMode = 'sit';
        if (mv) { mv.classList.add('ai-mv-sit'); mv.classList.remove('ai-mv-bob', 'ai-mv-lay'); }
        setView('stand');
        playClip(seq.sit);
        if (seq.lay) layTimer = setTimeout(function () { toLay(); }, seq.layAfter || 12000);
      }
      function toLay() {
        clearSit();
        phase = 'lay'; restMode = 'lay';
        if (mv) { mv.classList.add('ai-mv-lay'); mv.classList.remove('ai-mv-sit', 'ai-mv-bob'); }
        setView('lay');
        playClip(seq.lay);
      }
      /* 一次性动作/入场结束后落位：期间用户已经提问，就把 thinking/answer 补上 */
      function settle() {
        if (state === 'thinking' || state === 'answer') {
          toIdle(false);
          apply(state, true);
          return;
        }
        if (restMode === 'lay') toLay();
        else if (restMode === 'sit') toSit();
        else toIdle();
      }
      function oneShot(name) {
        if (!name || !mv) return;
        clearSit();
        var back = (phase === 'sit' || phase === 'lay') ? phase : 'idle';
        phase = 'oneshot'; restMode = back;
        if (mv) { mv.classList.remove('ai-mv-sit', 'ai-mv-lay'); mv.classList.add('ai-mv-bob'); }
        setView('stand');
        playClip(name);
        /* 兜底：万一 finished 事件没来，按时长回位 */
        restoreTimer = setTimeout(function () {
          if (phase !== 'oneshot') return;
          settle();
        }, cfg.hold || 2600);
      }
      function applySeq(s, force) {
        if (s === 'greet' || s === 'click') {
          if (phase === 'boot') return;
          oneShot(cfg.clips[s] || cfg.seq.intro);
          return;
        }
        if (s === 'thinking' || s === 'answer') {
          if (phase === 'boot' || phase === 'intro' || phase === 'oneshot') return;
          /* 坐着/躺着被提问时先起身：盘腿坐着一动不动，完全没有"在处理"的肢体信号 */
          if (phase === 'sit' || phase === 'lay') toIdle(false);
          else {
            phase = 'idle';
            if (mv) mv.classList.remove('ai-mv-sit', 'ai-mv-lay');
            setView('stand');
          }
          /* 思考期间不许坐下（久坐计时会正好在这时候触发）；回答完再把计时接上 */
          if (s === 'thinking') {
            clearSit();
            playClip(pickClip(cfg.clips.thinking, cfg.clips.idle));
          } else {
            playClip(cfg.clips.answer);
            armSit();
          }
          return;
        }
        /* idle */
        if (phase === 'boot' || phase === 'intro') return;
        if (force || phase === 'oneshot') {
          if (restMode === 'lay') toLay();
          else if (restMode === 'sit') toSit();
          else toIdle();
          return;
        }
        if (phase === 'idle') return;
        toIdle();
      }

      function intro() {
        if (!seq) { apply(state, true); return; }
        phase = 'intro';
        playClip(seq.intro || cfg.clips.greet);
        restoreTimer = setTimeout(function () {
          if (phase !== 'intro') return;
          /* 入场挥手期间用户就提问了：先把状态补上，否则 thinking/answer 会一直丢到面板关闭 */
          settle();
        }, cfg.hold || 2600);
      }
      if (false) { /* noop */ }

      function apply(s, force) {
        state = s;
        /* 思考态放到舞台上：没有 Think 骨骼时用头顶"正在输入"小点补足反馈；
           有真实 Think 动画时关掉人工前倾/提速，避免和骨骼动画叠成双重动作 */
        if (stage) {
          var thinking = s === 'thinking';
          if (stage.classList.contains('is-thinking') !== thinking) stage.classList.toggle('is-thinking', thinking);
          stage.classList.toggle('is-think-anim', thinking && hasAnim(cfg.clips.thinking));
        }
        if (!mv) return;
        if (seq) { applySeq(s, force); return; }
        var clip = cfg.clips[s] || cfg.clips.idle;
        var transient = (s === 'answer' || s === 'greet' || s === 'click');
        if (mv.animationName !== clip || force) mv.animationName = clip;
        if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
        if (transient) {
          restoreTimer = setTimeout(function () { apply('idle'); }, cfg.hold || 2200);
        }
      }
      return {
        setState: function (s) { apply(s); },
        boot: boot,
        destroy: function () {
          disposed = true;
          if (restoreTimer) clearTimeout(restoreTimer);
          clearSit();
          if (stage) stage.classList.remove('is-thinking');
          if (mv) mv.remove();
        }
      };
    };
  }

  /* ─────────────── 2D 皮肤工厂 ─────────────── */

  function createStatic(svg, stateClass) {
    return function (host) {
      host.innerHTML = svg;
      var t = null;
      return {
        setState: function (s) {
          host.classList.remove('is-thinking', 'is-answer', 'is-greet');
          if (s === 'thinking') host.classList.add('is-thinking');
          if (s === 'answer' || s === 'greet') host.classList.add('is-answer');
          if (t) clearTimeout(t);
          if (s === 'answer' || s === 'greet') {
            t = setTimeout(function () { host.classList.remove('is-answer'); }, 2600);
          }
          if (stateClass) stateClass(host, s);
        },
        destroy: function () { if (t) clearTimeout(t); }
      };
    };
  }

  /* 看板娘：鼠标视差跟随 */
  function createLive2D(host) {
    host.innerHTML = SVG_L2D;
    var layers = host.querySelectorAll('.sk-l2d-layer');
    var t = null;
    function onMove(e) {
      var r = host.getBoundingClientRect();
      var dx = ((e.clientX - r.left) / r.width - .5) * 2;
      var dy = ((e.clientY - r.top) / r.height - .5) * 2;
      for (var i = 0; i < layers.length; i++) {
        var d = parseFloat(layers[i].getAttribute('data-depth')) || .5;
        layers[i].style.transform = 'translate(' + (dx * 7 * d).toFixed(1) + 'px,' + (dy * 5 * d).toFixed(1) + 'px)';
      }
    }
    function onLeave() {
      for (var i = 0; i < layers.length; i++) layers[i].style.transform = '';
    }
    document.addEventListener('mousemove', onMove);
    host.addEventListener('mouseleave', onLeave);
    return {
      setState: function (s) {
        host.classList.toggle('is-answer', s === 'answer' || s === 'greet');
        if (t) clearTimeout(t);
        if (s === 'answer' || s === 'greet') t = setTimeout(function () { host.classList.remove('is-answer'); }, 2600);
      },
      destroy: function () {
        document.removeEventListener('mousemove', onMove);
        host.removeEventListener('mouseleave', onLeave);
        if (t) clearTimeout(t);
      }
    };
  }

  /* 桌宠：随机状态机 + 拖拽 */
  function createDeskPet(host) {
    host.classList.add('sk-pet-host');
    host.innerHTML = '<div class="sk-pet-shadow"></div>' +
      '<div class="sk-pet" data-state="idle">' + SVG_PET + '</div>';
    var pet = host.querySelector('.sk-pet');
    var shadow = host.querySelector('.sk-pet-shadow');
    var x = 18, dir = 1, state = 'idle', timer = null, dragging = false, dragX = 0, startX = 0;
    var states = ['idle', 'idle', 'walk', 'sit', 'walk', 'jump', 'wave'];

    function tick() {
      if (dragging) return schedule(700);
      var next = states[Math.floor(Math.random() * states.length)];
      state = next;
      pet.setAttribute('data-state', next);
      if (next === 'walk') {
        dir = Math.random() < .5 ? -1 : 1;
        var steps = 8 + Math.floor(Math.random() * 8);
        var step = 0;
        var walkTimer = setInterval(function () {
          x += dir * 7;
          var max = host.clientWidth - 60;
          if (x < 0) { x = 0; dir = 1; }
          if (x > max) { x = max; dir = -1; }
          pet.style.left = x + 'px';
          shadow.style.left = x + 'px';
          if (++step >= steps) { clearInterval(walkTimer); pet.setAttribute('data-state', 'idle'); }
        }, 110);
      }
      schedule(1400 + Math.random() * 2200);
    }
    function schedule(ms) { if (timer) clearTimeout(timer); timer = setTimeout(tick, ms); }

    function down(e) {
      dragging = true;
      startX = e.clientX; dragX = x;
      pet.classList.add('is-dragging');
      pet.setAttribute('data-state', 'idle');
      if (pet.setPointerCapture && e.pointerId !== undefined) pet.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      x = Math.max(0, Math.min(host.clientWidth - 60, dragX + e.clientX - startX));
      pet.style.left = x + 'px';
      shadow.style.left = x + 'px';
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      pet.classList.remove('is-dragging');
      schedule(500);
    }
    pet.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    x = 18; pet.style.left = x + 'px'; shadow.style.left = x + 'px';
    schedule(900);

    return {
      setState: function (s) {
        if (dragging) return;
        if (s === 'answer' || s === 'greet') { pet.setAttribute('data-state', 'wave'); }
        else if (s === 'thinking') { pet.setAttribute('data-state', 'jump'); }
      },
      destroy: function () {
        if (timer) clearTimeout(timer);
        pet.removeEventListener('pointerdown', down);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      }
    };
  }

  /* 专属形象：优先 AI 生成立绘，失败回退本地吉祥物 */
  function createGenerated(host) {
    host.innerHTML = SVG_MASCOT;
    var img = document.createElement('img');
    img.className = 'sk-gen-img';
    img.alt = '陈培胜的数字分身形象';
    img.src = BASE + 'generated.png';
    img.onload = function () { host.innerHTML = ''; host.appendChild(img); };
    var t = null;
    return {
      setState: function (s) {
        host.classList.toggle('is-thinking', s === 'thinking');
        if (s === 'answer' || s === 'greet') {
          host.classList.add('is-answer');
          if (t) clearTimeout(t);
          t = setTimeout(function () { host.classList.remove('is-answer'); }, 2400);
        }
      },
      destroy: function () { if (t) clearTimeout(t); }
    };
  }

  /* 本人形象：粗描边立绘（透明底 PNG），呼吸 / 侧头 / 跳动三态 */
  function createSelfPet(host) {
    var t = null;
    host.innerHTML =
      '<div class="sk-pet-shadow"></div>' +
      '<img class="sk-pet-img" alt="个人形象 立绘" src="' + BASE + 'pet-self.png">';
    return {
      setState: function (s) {
        host.classList.toggle('is-thinking', s === 'thinking');
        if (s === 'answer' || s === 'greet' || s === 'click') {
          host.classList.add('is-answer');
          if (t) clearTimeout(t);
          t = setTimeout(function () { host.classList.remove('is-answer'); }, s === 'click' ? 900 : 2400);
        }
      },
      destroy: function () { if (t) clearTimeout(t); }
    };
  }

  /* ─────────────── 皮肤清单 ─────────────── */

  var SKINS = [
    {
      id: 'self3d', key: '1', group: '3D 真模型 · 本地 GLB', name: '个人形象 3D',
      meta: '混元 3D + Mixamo 骨骼 · 5 万面 / 0.85MB · 待机 / 挥手 / 盘腿坐',
      note: '混元 3D 直接导出 5 万面模型（自带完整 UV 与贴图），OBJ 上传 Mixamo 自动绑骨（41 根骨骼）一次成功，无需体素水密化与权重回灌：呼吸待机 Idle、双臂举高挥手 Wave、盘腿坐 Sit 三段真实骨骼动画，Draco + WebP 压缩后仅 0.85MB。首访落地先挥手，待机 10 秒盘腿坐；点击会再挥一次手。',
      create: create3D({
        file: 'MaleRigged.glb?v=20261120H', name: '个人形象 3D',
        orbit: '0deg 77deg 82%', target: '0m 0.75m 0m', orbitNarrow: '0deg 78deg 88%', targetNarrow: '0m 0.75m 0m',
        rotate: null, bob: true,
        clips: { idle: 'Idle', thinking: 'Think', answer: 'Idle', greet: 'Wave', click: 'Wave' },
        seq: { intro: 'Wave', sit: 'Sit', sitAfter: 10000 },
        hold: 2600
      })
    },
    {
      id: 'female3d', key: '2', group: '3D 真模型 · 本地 GLB', name: '温柔形象 3D',
      meta: '混元 3D + Mixamo 骨骼 · 5 万面 / 0.82MB · 斯文问候 / 优雅翘腿坐',
      note: '温柔斯文版：混元 3D 女性模型上传 Mixamo 自动绑骨，三段真实骨骼动画——Standing Greeting 斯文问候、Idle 呼吸待机、Sitting 优雅翘腿坐姿（双手交叠放膝）。Draco + WebP 压缩后 0.82MB。首访落地先问候，待机 10 秒翘腿端坐；点击会再问候一次。',
      create: create3D({
        file: 'FemaleRigged.glb?v=20261121U', name: '温柔形象 3D',
        orbit: '0deg 78deg 88%', target: '0m 0.92m 0m', orbitNarrow: '0deg 79deg 108%', targetNarrow: '0m 0.92m 0m',
        rotate: null, bob: true,
        clips: { idle: 'Idle', thinking: 'Think', answer: 'Idle', greet: 'Greeting', click: 'Greeting' },
        seq: { intro: 'Greeting', sit: 'Sit', sitAfter: 10000 },
        hold: 2600
      })
    }
  ];

  function byId(id) { for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i]; return null; }

  /* ─────────────── 舞台 / 菜单 DOM ─────────────── */

  var stage = document.createElement('div');
  stage.className = 'ai-stage';
  stage.id = 'aiStage';
  stage.setAttribute('role', 'button');
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('aria-label', '陈培胜的数字分身，点击开始对话');
  stage.innerHTML =
    '<div class="ai-stage-actor" id="aiActor"></div>' +
    '<div class="ai-stage-ground" aria-hidden="true"></div>' +
    '<div class="ai-stage-name" id="aiSkinName"></div>' +
    '<div class="ai-stage-hint" id="aiStageHint"><i class="ai-stage-hint-dot" aria-hidden="true"></i>点我问 <b>数字分身</b></div>' +
    '<div class="ai-stage-think" id="aiStageThink" aria-hidden="true"><i></i><i></i><i></i></div>' +
    '<button class="ai-stage-menu-btn" id="aiSkinBtn" type="button" aria-label="打开皮肤菜单">&#9672;</button>';
  aiFab.parentNode.insertBefore(stage, aiFab);

  var menu = document.createElement('div');
  menu.className = 'ai-skin-menu';
  menu.id = 'aiSkinMenu';
  menu.hidden = true;
  menu.innerHTML =
    '<div class="ai-skin-menu-head">' +
      '<span class="ai-skin-menu-title">SKINS // 角色皮肤</span>' +
      '<span class="ai-skin-menu-sub" id="aiSkinCount"></span>' +
      '<button class="ai-skin-menu-x" id="aiSkinClose" type="button" aria-label="关闭皮肤菜单">×</button>' +
    '</div>' +
    '<div class="ai-skin-menu-body" id="aiSkinBody"></div>' +
    '<div class="ai-skin-menu-foot">' +
      '<b>右键</b> 角色 · <b>双击</b> 角色 · <b>长按</b>（手机） · 点 <b>◈</b> · 按 <b>S</b> 都能打开菜单；数字 <b>1–9</b> 直接切换。' +
      '<div class="ai-skin-note" id="aiSkinNote"></div>' +
    '</div>';
  document.body.appendChild(menu);

  var actor = stage.querySelector('#aiActor');
  var nameEl = stage.querySelector('#aiSkinName');
  var bodyEl = menu.querySelector('#aiSkinBody');
  var noteEl = menu.querySelector('#aiSkinNote');
  menu.querySelector('#aiSkinCount').textContent = SKINS.length + ' 款 · 全部离线可用';

  var cardsHtml = '', lastGroup = '';
  SKINS.forEach(function (s) {
    if (s.group !== lastGroup) {
      if (lastGroup) cardsHtml += '</div>';
      cardsHtml += '<div class="ai-skin-group">' + s.group + '</div><div class="ai-skin-grid">';
      lastGroup = s.group;
    }
    cardsHtml +=
      '<button class="ai-skin-card" type="button" data-skin="' + s.id + '">' +
        '<span class="ai-skin-card-key">' + s.key + '</span>' +
        '<span class="ai-skin-card-txt">' +
          '<span class="ai-skin-card-name">' + s.name + '</span>' +
          '<span class="ai-skin-card-meta">' + s.meta + '</span>' +
        '</span>' +
      '</button>';
  });
  cardsHtml += '</div>';
  bodyEl.innerHTML = cardsHtml;

  /* ─────────────── 切换逻辑 ─────────────── */

  var current = null, instance = null, host = null;

  function setState(s) { if (instance && instance.setState) instance.setState(s); }

  function activate(id, silent) {
    var skin = byId(id);
    if (!skin) return;
    if (instance && instance.destroy) { try { instance.destroy(); } catch (e) {} }
    actor.innerHTML = '';
    host = document.createElement('div');
    host.className = 'ai-skin-host';
    actor.appendChild(host);
    try { instance = skin.create(host) || {}; } catch (e) { instance = {}; host.innerHTML = SVG_CPBOT; }
    current = skin;
    stage.setAttribute('data-skin', id);
    nameEl.textContent = skin.name;
    noteEl.innerHTML = '<b>' + skin.name + '</b> · ' + skin.note;
    var cards = bodyEl.querySelectorAll('.ai-skin-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('is-active', cards[i].getAttribute('data-skin') === id);
    }
    try { localStorage.setItem(STORE, id); } catch (e) {}
    stage.classList.remove('is-switching');
    stage.classList.remove('is-mv-ready');
    stage.classList.remove('is-thinking');
    stage.classList.remove('is-think-anim');
    void stage.offsetWidth;
    stage.classList.add('is-switching');
    if (!silent) setState('greet');
    else setState('idle');
  }

  function savedSkin() {
    try {
      var v = localStorage.getItem(STORE);
      if (v && byId(v)) return v;   /* 只剩个人形象 3D，老访客的旧皮肤 id 统一回落 */
    } catch (e) {}
    return 'self3d';
  }

  /* ─────────────── 菜单开关 ─────────────── */

  function openMenu() {
    if (GENDER_SWITCH_ONLY || SKINS.length < 2) return;   /* 性别切换由隐藏按钮统一控制 */
    /* 换皮肤时先收起问答面板，避免两个浮层叠在一起 */
    if (!aiPanel.hidden) aiFab.click();
    menu.hidden = false;
  }
  function closeMenu() { menu.hidden = true; }
  function toggleMenu() { menu.hidden ? openMenu() : closeMenu(); }

  /* ── 常驻入口提示 ─────────────────────────────────────────────
     角色是把 ai-fab 视觉隐藏后的唯一入口，之前没有任何标识；
     首屏 2.6s 浮出一次、11s 自动收起，hover / 键盘聚焦再出现，点击即收。 */
  var hintEl = stage.querySelector('#aiStageHint');
  var hintSettled = false;
  function showHint() { if (hintEl) hintEl.classList.add('is-on'); }
  function hideHint() { if (hintEl) hintEl.classList.remove('is-on'); }
  setTimeout(function () {
    /* 首访 2s 左右会先冒招呼气泡，气泡本身已经指向角色，标签就不要再叠上去 */
    if (aiPanel.hidden && !document.body.classList.contains('ai-panel-open') && !document.querySelector('.ai-fab-tip')) showHint();
  }, 2600);
  setTimeout(function () {
    hintSettled = true;
    if (!stage.matches || !stage.matches(':hover')) hideHint();
  }, 11000);
  stage.addEventListener('mouseenter', showHint);
  stage.addEventListener('mouseleave', function () { if (hintSettled) hideHint(); });
  stage.addEventListener('focus', showHint);
  stage.addEventListener('blur', function () { if (hintSettled) hideHint(); });

  /* 单击 = 打开问答（走原 aiFab，完全复用原逻辑）。
     皮肤菜单由性别切换统一接管（GENDER_SWITCH_ONLY），不再需要双击判定，
     因此去掉原来的 230ms 等待：点击即时响应，移动端也不用再区分长按。 */
  stage.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.ai-stage-menu-btn')) return;
    if (instance && instance.boot) instance.boot();   /* 点击即插队加载 3D，不等 idle */
    hideHint();
    aiFab.click();
    setState('click');
  });
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      hideHint();
      aiFab.click();
    }
  });
  if (GENDER_SWITCH_ONLY || SKINS.length < 2) { stage.querySelector('#aiSkinBtn').style.display = 'none'; }
  stage.querySelector('#aiSkinBtn').addEventListener('click', function (e) {
    e.stopPropagation(); toggleMenu();
  });
  menu.querySelector('#aiSkinClose').addEventListener('click', closeMenu);
  bodyEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-skin]') : null;
    if (!btn) return;
    activate(btn.getAttribute('data-skin'));
  });

  /* ─────────────── 与问答面板的状态联动（不修改 main.js） ─────── */

  var wasTyping = false;
  var wasTip = false;
  var wasOpen = aiPanel.hidden === false;
  document.body.classList.toggle('ai-panel-open', wasOpen);

  if (window.MutationObserver) {
    var mo = new MutationObserver(function () {
      var open = !aiPanel.hidden;
      if (open !== wasOpen) {
        wasOpen = open;
        document.body.classList.toggle('ai-panel-open', open);
        if (open) setState('greet'); else setState('idle');
      }
      var typing = !!(aiBody && aiBody.querySelector('.ai-typing'));
      if (typing && !wasTyping) setState('thinking');
      if (!typing && wasTyping) setState('answer');
      wasTyping = typing;
    });
    mo.observe(aiPanel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    if (aiBody) mo.observe(aiBody, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    /* 招呼气泡出现时让角色挥手（数字分身打招呼；自动弹出已停用，此观察保留兼容） */
    var tipMo = new MutationObserver(function () {
      var tip = document.querySelector('.ai-fab-tip');
      var now = !!tip;
      if (now !== wasTip) {
        wasTip = now;
        if (now && aiPanel.hidden) setState('greet');
        else if (!now && aiPanel.hidden) setState('idle');
        /* 气泡和常驻标签都指向人物头顶，两层文案会叠在一起：气泡在时让标签先退场 */
        if (now) hideHint();
        else if (!hintSettled) showHint();
      }
    });
    tipMo.observe(aiFab.parentNode, { childList: true });
  }

  /* ─────────────── 启动 + 空闲预加载 3D 组件 ─────── */

  activate(savedSkin(), true);
  document.body.classList.add('has-ai-skin');

  /* 3D 组件不再和首屏抢带宽：等页面 load 且空闲后再预取，实际建模由 create3D 的 scheduleBoot 触发 */
  function preload3D() {
    var go = function () { ensureModelViewer().catch(function () {}); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1200);
  }
  if (document.readyState === 'complete') preload3D();
  else window.addEventListener('load', preload3D, { once: true });

  /* 控制台快捷入口，方便调试：window.CPAI_SKINS.list() / .use('fox3d') */
  window.CPAI_SKINS = {
    list: function () { return SKINS.map(function (s) { return s.key + ' ' + s.id + ' — ' + s.name; }); },
    use: activate,
    menu: toggleMenu,
    current: function () { return current && current.id; }
  };
})();
