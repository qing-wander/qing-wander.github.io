/* 角色动画检验台（后台演示模块）
   ──────────────────────────────────────────────────────────────
   目的：把「角色 → 动作 → 站内取景」这条链路做成可演示的后台功能。
     · 左舞台：360° 环视 / 播放暂停 / 逐帧 / 变速 / 机位预设
     · 右栏：换角色、换动作（带上线状态），底部按公开站 280×360 取景复核
   依赖：assets/vendor/model-viewer.min.js（按需动态加载，不拖慢后台首屏）
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* 状态：online 已上线 / candidate 候选（已认可待合并）/ pending 待评 / deprecated 弃用 */
  var CHARS = [
    {
      id: 'male',
      label: '男性 · 首页角色',
      file: 'assets/models/MaleRigged.glb',
      size: '870 KB',
      bones: 41,
      source: 'Mixamo 自动绑骨 · 本站材质',
      orbit: '0deg 77deg 82%',
      stage: '0deg 78deg 110%',
      pct: 110,
      target: '0m 1.05m 0m',
      clips: [
        { name: 'Idle', label: '待机 Idle', dur: '9.97s', status: 'online', note: '首页常驻，呼吸 + 重心微移' },
        {
          name: 'Wave', label: '挥手 Wave', dur: '3.20s', status: 'online',
          /* 举手会超出静态包围盒：舞台比公开站长，必须单独退远 + 定视点才不会切手/切头 */
          stage: '0deg 78deg 150%', target: '0m 0.95m 0m', pct: 150,
          note: '入场一次性动作，播完回待机'
        },
        { name: 'Sit', label: '坐下 Sit', dur: '10.90s', status: 'online', note: '停留 12s 后自动坐下' }
      ]
    },
    {
      id: 'female',
      label: '女性 · 访客切换',
      file: 'assets/models/FemaleRigged.glb',
      size: '823 KB',
      bones: 33,
      source: 'Mixamo 自动绑骨 · 本站材质',
      orbit: '0deg 80deg 80%',
      stage: '0deg 80deg 110%',
      pct: 110,
      target: '0m 1.0m 0m',
      clips: [
        { name: 'Idle', label: '待机 Idle', dur: '9.97s', status: 'online', note: '访客切换后的常驻待机' },
        { name: 'Greeting', label: '打招呼 Greeting', dur: '5.13s', status: 'online', note: '访客切换时的入场动作' },
        { name: 'Sit', label: '坐下 Sit', dur: '9.60s', status: 'online', note: '停留后落座' }
      ]
    }
  ];

  var state = {
    ready: false,
    charIndex: 0,
    clipIndex: 0,
    dur: 0,
    initRadius: 0,
    basePct: 110,
    playing: true,
    scrubbing: false,
    auto: false
  };

  var mvEl = null;
  var miniEl = null;
  var els = {};
  var mvPromise = null;

  function $(id) { return document.getElementById(id); }

  function ensureMV() {
    if (window.customElements && customElements.get('model-viewer')) {
      return customElements.whenDefined('model-viewer');
    }
    if (mvPromise) return mvPromise;
    var url = new URL('assets/vendor/model-viewer.min.js', document.baseURI).href;
    mvPromise = import(url).then(function () {
      return customElements.whenDefined('model-viewer');
    });
    return mvPromise;
  }

  /* ── 构建舞台 ── */
  function buildStage() {
    els.stage = $('animStage');
    els.side = $('animSide');

    mvEl = document.createElement('model-viewer');
    mvEl.className = 'anim-mv';
    mvEl.setAttribute('alt', '角色动画预览');
    mvEl.setAttribute('camera-controls', '');
    mvEl.setAttribute('touch-action', 'none');
    mvEl.setAttribute('interaction-prompt', 'none');
    mvEl.setAttribute('autoplay', '');
    mvEl.setAttribute('loop', '');
    mvEl.setAttribute('shadow-intensity', '0.55');
    mvEl.setAttribute('shadow-softness', '1');
    mvEl.setAttribute('environment-image', 'neutral');
    mvEl.setAttribute('min-camera-orbit', 'auto 2deg auto');
    mvEl.setAttribute('max-camera-orbit', 'auto 178deg auto');
    mvEl.style.cssText = 'width:100%;height:100%;display:block';
    els.stage.insertBefore(mvEl, els.stage.firstChild);

    mvEl.addEventListener('load', onLoad);
    mvEl.addEventListener('error', function (e) {
      var t = (e && e.detail && e.detail.type) || '';
      setLoad('模型加载失败 ' + t + ' · 检查 assets/models 与网络');
    });
    mvEl.addEventListener('camera-change', readout);
    mvEl.addEventListener('progress', function (e) {
      /* load 之后仍可能收到环境图等异步资源的 progress，别把盖层又推回「载入中」 */
      if (mvEl.loaded) return;
      var p = (e.detail && e.detail.totalProgress) || 0;
      if (p > 0 && p < 1) setLoad('载入中 ' + Math.round(p * 100) + '%');
    });

    miniEl = document.createElement('model-viewer');
    miniEl.setAttribute('alt', '公开站取景预览');
    miniEl.setAttribute('camera-controls', '');
    miniEl.setAttribute('interaction-prompt', 'none');
    miniEl.setAttribute('autoplay', '');
    miniEl.setAttribute('loop', '');
    miniEl.setAttribute('shadow-intensity', '0.55');
    miniEl.setAttribute('shadow-softness', '1');
    miniEl.setAttribute('environment-image', 'neutral');
    /* 切角色后 mini 重新加载，默认会播第 0 段；load 后同步到当前选中的动作 */
    miniEl.addEventListener('load', function () {
      var c = CHARS[state.charIndex];
      var clip = c && c.clips[state.clipIndex];
      if (clip) { try { miniEl.animationName = clip.name; } catch (e) {} }
    });
    $('animMini').appendChild(miniEl);
  }

  function waitDuration(cb, tries) {
    tries = tries || 0;
    var d = (mvEl && mvEl.duration) || 0;
    if (d > 0 || tries > 60) return cb(d);
    setTimeout(function () { waitDuration(cb, tries + 1); }, 50);
  }

  function setLoad(text) {
    var el = $('animLoad');
    if (typeof text === 'string') {
      el.textContent = text;
      el.classList.remove('is-off');
    } else {
      el.classList.add('is-off');
    }
  }

  /* 取当前角色/动作的镜头：动作可以覆盖舞台机位（如 Wave 举手要退远） */
  function framingFor(c, clip) {
    return {
      orbit: (clip && clip.stage) || c.stage || c.orbit,
      target: (clip && clip.target) || c.target,
      pct: (clip && clip.pct) || c.pct || 100
    };
  }

  /* model-viewer 的 duration 在切 clip 后可能滞后，台账里本来就记了准确时长，先用它 */
  function setTimeline(clip) {
    var d = parseFloat(clip && clip.dur) || 0;
    state.dur = d;
    els.seek.max = d || 1;
    els.seek.value = 0;
    $('animTime').textContent = '0.00 / ' + d.toFixed(2) + 's';
  }

  function applyFraming(c, clip, rebase) {
    var f = framingFor(c, clip);
    /* 用 attribute 写入：model-viewer 的属性 setter 对字符串机位不稳定 */
    mvEl.setAttribute('camera-orbit', f.orbit);
    mvEl.setAttribute('camera-target', f.target);
    state.basePct = f.pct;
    if (rebase) {
      try { state.initRadius = mvEl.getCameraOrbit().radius || state.initRadius; } catch (e) {}
    }
    readout();
  }

  function onLoad() {
    /* 先选剪辑再读时长：duration 取决于当前 animationName，未选之前是 0 */
    var c = CHARS[state.charIndex];
    var clip = c.clips[state.clipIndex];
    if (clip) {
      mvEl.animationName = clip.name;
      if (miniEl) miniEl.animationName = clip.name;
    }
    /* paused 在部分 model-viewer 版本是只读访问器，直接赋值会抛 TypeError 并
       截断后面的 setLoad/applyFraming —— 只保留 play()，包在 try 里 */
    try { mvEl.play(); } catch (e) {}
    setLoad(false);
    applyFraming(c, clip, true);
    setTimeline(clip);
  }

  /* ── 角色 / 动作列表 ── */
  function statusTag(status) {
    switch (status) {
      case 'online': return '<span class="tag tag-ok">上线</span>';
      case 'candidate': return '<span class="tag tag-candidate">候选</span>';
      case 'deprecated': return '<span class="tag tag-legacy">弃用</span>';
      default: return '<span class="tag tag-hide">待评</span>';
    }
  }

  function renderChars() {
    var box = $('animChars');
    box.innerHTML = '';
    CHARS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'anim-char' + (i === state.charIndex ? ' is-on' : '');
      b.innerHTML = '<span>' + c.label + '</span><small>' + c.clips.length + ' 动作</small>';
      b.addEventListener('click', function () {
        if (i === state.charIndex) return;
        state.charIndex = i;
        state.clipIndex = 0;
        renderChars();
        renderClips();
        loadChar(i);
      });
      box.appendChild(b);
    });
    var c = CHARS[state.charIndex];
    $('animCharMeta').textContent = c.file.replace('assets/models/', '') +
      ' · ' + c.size + ' · ' + c.bones + ' 骨骼 · ' + c.clips.length + ' 段剪辑' +
      '\n来源：' + (c.source || '—');
  }

  function renderClips() {
    var c = CHARS[state.charIndex];
    var box = $('animClips');
    box.innerHTML = '';
    c.clips.forEach(function (clip, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'anim-clip' + (i === state.clipIndex ? ' is-on' : '');
      b.innerHTML = '<span class="clip-name">' + clip.label + '</span>' +
        '<span class="clip-dur">' + clip.dur + '</span>' + statusTag(clip.status);
      b.title = clip.note || clip.label;
      b.addEventListener('click', function () {
        state.clipIndex = i;
        renderClips();
        applyClip(i, true);
      });
      box.appendChild(b);
    });
    $('animClipNote').textContent = c.clips[state.clipIndex].note || '—';
  }

  /* ── 载入角色 ── */
  function loadChar(i) {
    var c = CHARS[i];
    var clip = c.clips[state.clipIndex];
    setLoad('载入 ' + c.file.replace('assets/models/', '') + '…');
    /* 加载期间就切到新台账，别让时间轴/说明停留在上一个角色 */
    setTimeline(clip);
    $('animClipNote').textContent = (clip && clip.note) || '—';
    mvEl.setAttribute('src', c.file);
    applyFraming(c, clip, false);
    miniEl.setAttribute('src', c.file);
    miniEl.setAttribute('camera-orbit', c.orbit);
    miniEl.setAttribute('camera-target', c.target);
    $('animTag').textContent = c.label.replace(' · ', ' / ') + ' · ' + c.file.replace('assets/models/', '');
  }

  /* ── 动作切换 ── */
  function applyClip(i, force) {
    var c = CHARS[state.charIndex];
    var clip = c.clips[i];
    if (!clip) return;
    mvEl.animationName = clip.name;
    if (miniEl && miniEl.loaded) miniEl.animationName = clip.name;
    applyFraming(c, clip, true);
    /* 切动作瞬间模型内部 mixer 可能还没换好，这两个 setter 偶尔会抛；不能让它截断时间轴更新 */
    try { mvEl.currentTime = 0; } catch (e) {}
    try { mvEl.paused = false; } catch (e) {}
    try { mvEl.play(); } catch (e) {}
    state.playing = true;
    syncPlay();
    setTimeline(clip);
    $('animClipNote').textContent = clip.note || '—';
  }

  function syncPlay() {
    try { state.playing = !mvEl.paused; } catch (e) { state.playing = true; }
    $('animPlay').textContent = state.playing ? '暂停' : '播放';
  }

  /* ── 读数 ── */
  function readout() {
    if (!mvEl) return;
    try {
      var o = mvEl.getCameraOrbit();
      var th = ((Math.round(o.theta * 180 / Math.PI) % 360) + 360) % 360;
      var ph = Math.round(o.phi * 180 / Math.PI);
      var pct = state.initRadius ? Math.round(o.radius / state.initRadius * state.basePct) : state.basePct;
      $('animRead').textContent = 'θ ' + th + '° · φ ' + ph + '° · ' + pct + '%';
    } catch (e) { /* 模型未就绪 */ }
  }

  function setOrbit(theta, phi, scale) {
    var o = mvEl.getCameraOrbit();
    var r = (o.radius || state.initRadius) * (scale || 1);
    mvEl.setAttribute('camera-orbit', theta + 'deg ' + phi + 'deg ' + r + 'm');
    readout();
  }

  /* ── 绑定控件 ── */
  function bindControls() {
    $('animPlay').addEventListener('click', function () {
      mvEl.paused = !mvEl.paused;
      syncPlay();
    });
    $('animReplay').addEventListener('click', function () {
      mvEl.currentTime = 0;
      mvEl.paused = false;
      syncPlay();
    });
    $('animLoop').addEventListener('click', function (e) {
      var on = !mvEl.loop;
      mvEl.loop = on;
      e.currentTarget.textContent = '循环 ' + (on ? '开' : '关');
      e.currentTarget.classList.toggle('is-on', on);
    });
    $('animSpeed').addEventListener('change', function (e) {
      mvEl.timeScale = parseFloat(e.target.value);
    });

    els.seek = $('animSeek');
    els.seek.addEventListener('pointerdown', function () { state.scrubbing = true; });
    window.addEventListener('pointerup', function () { state.scrubbing = false; });
    els.seek.addEventListener('input', function () {
      mvEl.paused = true;
      syncPlay();
      mvEl.currentTime = parseFloat(els.seek.value);
      $('animTime').textContent = parseFloat(els.seek.value).toFixed(2) + ' / ' + state.dur.toFixed(2) + 's';
    });

    $('animPrevF').addEventListener('click', function () { step(-1); });
    $('animNextF').addEventListener('click', function () { step(1); });

    var orbitBtns = document.querySelectorAll('[data-anim-orbit]');
    function clearOrbitHighlight() {
      Array.prototype.forEach.call(orbitBtns, function (x) { x.classList.remove('is-on'); });
    }
    Array.prototype.forEach.call(orbitBtns, function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-anim-orbit').split(' ');
        setOrbit(parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2] || '1'));
        mvEl.autoRotate = false;
        state.auto = false;
        $('animAuto').classList.remove('is-on');
        clearOrbitHighlight();
        b.classList.add('is-on');
      });
    });

    $('animAuto').addEventListener('click', function (e) {
      state.auto = !state.auto;
      mvEl.autoRotate = state.auto;
      mvEl.autoRotateDelay = 0;
      mvEl.setAttribute('rotation-per-second', '26deg');
      e.currentTarget.classList.toggle('is-on', state.auto);
      if (state.auto) clearOrbitHighlight();
    });
    $('animReset').addEventListener('click', function () {
      var c = CHARS[state.charIndex];
      applyFraming(c, c.clips[state.clipIndex], true);
      mvEl.autoRotate = false;
      state.auto = false;
      $('animAuto').classList.remove('is-on');
      clearOrbitHighlight();
    });

    /* 键盘快捷键：空格播放/暂停、←/→ 逐帧、R 重播。
       仅动画面板可见、模型就绪、焦点不在表单控件时响应，避免干扰后台其它操作。
       用捕获阶段：model-viewer 的 shadow DOM 可能拦截按键，捕获阶段先拿到并 preventDefault。 */
    document.addEventListener('keydown', function (e) {
      var panel = $('panelAnim');
      if (!panel || panel.hidden || !mvEl || !mvEl.loaded) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
                t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var k = e.key || '';
      if (e.code === 'Space' || k === ' ' || k === 'Spacebar') {
        e.preventDefault(); $('animPlay').click();
      } else if (e.code === 'ArrowLeft' || k === 'ArrowLeft') {
        e.preventDefault(); step(-1);
      } else if (e.code === 'ArrowRight' || k === 'ArrowRight') {
        e.preventDefault(); step(1);
      } else if (k === 'r' || k === 'R') {
        e.preventDefault(); $('animReplay').click();
      }
    }, true);
    $('animCopy').addEventListener('click', function () {
      var o = mvEl.getCameraOrbit();
      var th = Math.round(o.theta * 180 / Math.PI);
      var ph = Math.round(o.phi * 180 / Math.PI);
      /* initRadius 对应当前动作机位的百分比，换算回 model-viewer 的「相对默认取景」百分比 */
      var pct = Math.round(o.radius / state.initRadius * state.basePct);
      var str = th + 'deg ' + ph + 'deg ' + pct + '%';
      var done = function () { toast('取景参数已复制：' + str); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(done, function () { toast(str); });
      } else { toast(str); }
    });

    $('animLight').addEventListener('click', function (e) {
      var light = els.stage.classList.toggle('is-light');
      e.currentTarget.textContent = light ? '浅底' : '深底';
    });

    /* 舞台播放时同步时间轴 */
    (function tick() {
      /* 自愈：解码慢时 duration 会晚到，别让时间轴一直停在 0 */
      if (mvEl && !state.dur && mvEl.duration) {
        state.dur = mvEl.duration;
        els.seek.max = state.dur;
      }
      if (mvEl && !mvEl.paused && !state.scrubbing && state.dur) {
        var t = Math.min(mvEl.currentTime || 0, state.dur);
        els.seek.value = t;
        $('animTime').textContent = t.toFixed(2) + ' / ' + state.dur.toFixed(2) + 's';
      }
      requestAnimationFrame(tick);
    })();
  }

  function step(dir) {
    mvEl.paused = true;
    syncPlay();
    var t = Math.max(0, Math.min(state.dur, (mvEl.currentTime || 0) + dir / 30));
    mvEl.currentTime = t;
    els.seek.value = t;
    $('animTime').textContent = t.toFixed(2) + ' / ' + state.dur.toFixed(2) + 's';
  }

  function toast(msg) {
    if (window.__adminToast) return window.__adminToast(msg);
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-on'); }, 1800);
  }

  /* ── 初始化（首次进 tab 时才跑） ── */
  function init() {
    if (state.ready) {
      if (state.dur && mvEl) readout();
      return;
    }
    state.ready = true;
    buildStage();
    renderChars();
    renderClips();
    bindControls();
    ensureMV().then(function () {
      loadChar(state.charIndex);
      /* 卡住超过 15s 基本是外部资源问题（Draco 解码器要从 gstatic 取），给一句能排查的话 */
      setTimeout(function () {
        if (mvEl && !mvEl.loaded) setLoad('仍在载入…解码器需要联网（gstatic），可刷新重试');
      }, 15000);
    }).catch(function () {
      setLoad('渲染器加载失败 · 检查 assets/vendor/model-viewer.min.js');
    });
  }

  window.AnimConsole = { init: init };
})();
