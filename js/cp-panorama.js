/* ════════════════════════════════════════════════════════════
   cp-panorama.js · 公司档案 360° 全景查看器（零依赖）
   ────────────────────────────────────────────────────────────
   把一张等距柱状（equirectangular）全景图贴到球面上，用 WebGL
   全屏 quad + fragment shader 做逆投影，不引入 three.js / CDN。

   交互：鼠标拖拽 / 触摸滑动环视、滚轮缩放、惯性、自动旋转、
         方向键微调、+/- 缩放、空格切换自动旋转、全屏、Esc 关闭。
   降级：无 WebGL（或纹理上传失败）时，退化为可拖拽平移的宽幅图。

   用法：CPPanorama.open([{ img, cover, title, address, note, source,
                            yaw, pitch, fov }], 0)
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  var FOV_MIN = 38 * DEG, FOV_MAX = 108 * DEG;
  var PITCH_LIMIT = 1.32;

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uRes;',
    'uniform float uYaw;',
    'uniform float uPitch;',
    'uniform float uFov;',
    'const float PI = 3.141592653589793;',
    'void main() {',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  p.x *= uRes.x / uRes.y;',
    '  float f = 1.0 / tan(uFov * 0.5);',
    '  vec3 d = normalize(vec3(p.x, p.y, -f));',
    '  float cp = cos(uPitch), sp = sin(uPitch);',
    '  d = vec3(d.x, cp * d.y - sp * d.z, sp * d.y + cp * d.z);',
    '  float cy = cos(uYaw), sy = sin(uYaw);',
    '  d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);',
    '  float u = atan(d.x, -d.z) / (2.0 * PI) + 0.5;',
    '  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;',
    '  gl_FragColor = texture2D(uTex, vec2(u, v));',
    '}'
  ].join('\n');

  var root = null, canvas = null, gl = null, prog = null, tex = null;
  var locRes = null, locYaw = null, locPitch = null, locFov = null;
  var scenes = [], index = 0, open = false, raf = 0, fallback = false, posterOverride = '';
  var yaw = 0, pitch = 0, fov = 75 * DEG;
  var velY = 0, velP = 0, autoSpin = false, lastInput = 0;
  var dragging = false, pointerId = null, lastX = 0, lastY = 0;
  var pinch = null;
  var els = {};

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function assetPath(p) {
    /* WebGL 纹理要求同源或带 CORS 头；CDN 映射可能指向未配置 CORS 的
       对象存储，所以这里只接受相对路径，跨域映射一律还原为站内路径。 */
    if (!p) return '';
    var u = p;
    try {
      if (window.AssetURL && typeof window.AssetURL.of === 'function') u = window.AssetURL.of(p);
    } catch (e) { u = p; }
    if (/^(https?:)?\/\//i.test(u)) {
      try {
        var abs = new URL(u, location.href);
        if (abs.origin === location.origin) return u;
        var i = abs.pathname.indexOf('/qing-wander/');
        if (i >= 0) return abs.pathname.slice(i + '/qing-wander/'.length);
      } catch (e) {}
    }
    return /^(https?:)?\/\//i.test(u) ? p : u;
  }

  function build() {
    root = h('div', 'cp-pano');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '360 度全景查看器');
    root.innerHTML =
      '<canvas class="cp-pano-canvas"></canvas>' +
      '<img class="cp-pano-poster" alt="">' +
      '<div class="cp-pano-fallback" hidden><img alt=""></div>' +
      '<div class="cp-pano-head">' +
      '  <div class="cp-pano-meta"><strong class="cp-pano-title"></strong>' +
      '    <span class="cp-pano-sub"></span></div>' +
      '  <button type="button" class="cp-pano-close" data-act="close" aria-label="关闭全景">✕</button>' +
      '</div>' +
      '<div class="cp-pano-hint">拖拽环视 · 滚轮缩放 · 方向键微调</div>' +
      '<div class="cp-pano-loading"><span>全景加载中…</span></div>' +
      '<div class="cp-pano-foot">' +
      '  <div class="cp-pano-scenes"></div>' +
      '  <div class="cp-pano-ctl">' +
      '    <button type="button" data-act="zoom-out" aria-label="缩小">−</button>' +
      '    <button type="button" data-act="zoom-in" aria-label="放大">＋</button>' +
      '    <button type="button" data-act="reset" aria-label="复位视角">复位</button>' +
      '    <button type="button" data-act="auto" aria-pressed="false">自动旋转</button>' +
      '    <button type="button" data-act="fullscreen">全屏</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(root);

    canvas = root.querySelector('.cp-pano-canvas');
    els.poster = root.querySelector('.cp-pano-poster');
    els.fallback = root.querySelector('.cp-pano-fallback');
    els.fallbackImg = els.fallback.querySelector('img');
    els.title = root.querySelector('.cp-pano-title');
    els.sub = root.querySelector('.cp-pano-sub');
    els.loading = root.querySelector('.cp-pano-loading');
    els.scenes = root.querySelector('.cp-pano-scenes');
    els.auto = root.querySelector('[data-act="auto"]');

    root.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'close') close();
      else if (act === 'zoom-in') zoom(-1);
      else if (act === 'zoom-out') zoom(1);
      else if (act === 'reset') reset();
      else if (act === 'auto') setAuto(!autoSpin);
      else if (act === 'fullscreen') toggleFullscreen();
      else if (act === 'scene') switchScene(parseInt(b.getAttribute('data-i'), 10));
    });
    /* 点击画布空白处不关闭：全景是拖拽控件，误触代价高 */
    root.addEventListener('pointerdown', onDown, { passive: false });
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', resize);
    root.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault(); useFallback();
    });
  }

  /* ── WebGL ─────────────────────────────────────────────── */
  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[cp-panorama] shader:', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  }

  function initGL() {
    if (gl) return true;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false })
        || canvas.getContext('experimental-webgl', { alpha: false });
    } catch (e) { gl = null; }
    if (!gl) return false;
    var vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { gl = null; return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[cp-panorama] link:', gl.getProgramInfoLog(prog));
      gl = null; return false;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    locRes = gl.getUniformLocation(prog, 'uRes');
    locYaw = gl.getUniformLocation(prog, 'uYaw');
    locPitch = gl.getUniformLocation(prog, 'uPitch');
    locFov = gl.getUniformLocation(prog, 'uFov');
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    /* 最大纹理尺寸保护：超过就先缩到上限，避免部分移动设备黑屏 */
    return true;
  }

  function fitImage(img) {
    var maxTex = 4096;
    try { maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096; } catch (e) {}
    if (img.width <= maxTex && img.height <= maxTex) return img;
    var k = Math.min(maxTex / img.width, maxTex / img.height);
    var c = document.createElement('canvas');
    c.width = Math.floor(img.width * k); c.height = Math.floor(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function upload(img) {
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fitImage(img));
      return !gl.getError();
    } catch (e) {
      console.warn('[cp-panorama] 纹理上传失败：', e && e.message);
      return false;
    }
  }

  function useFallback() {
    fallback = true;
    gl = null;
    canvas.hidden = true;
    els.poster.hidden = true;
    els.fallback.hidden = false;
    var s = scenes[index] || {};
    els.fallbackImg.src = assetPath(s.img);
    els.loading.hidden = true;
  }

  function resize() {
    if (!open) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(root.clientWidth * dpr));
    var hgt = Math.max(1, Math.round(root.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
    if (!fallback && gl) gl.viewport(0, 0, canvas.width, canvas.height);
    drawFallback();
    render();
  }

  function frame() {
    if (!open) { raf = 0; return; }
    var moving = false;
    if (!dragging) {
      if (Math.abs(velY) > 0.000015 || Math.abs(velP) > 0.000015) {
        yaw += velY; pitch = clamp(pitch + velP, -PITCH_LIMIT, PITCH_LIMIT);
        velY *= 0.93; velP *= 0.93; moving = true;
      } else { velY = 0; velP = 0; }
      if (autoSpin && Date.now() - lastInput > 900) { yaw += 0.00042; moving = true; }
    } else moving = true;
    render();
    if (moving) raf = requestAnimationFrame(frame); else raf = 0;
  }

  function kick() {
    lastInput = Date.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function render() {
    if (fallback || !gl) { drawFallback(); return; }
    gl.uniform2f(locRes, canvas.width, canvas.height);
    gl.uniform1f(locYaw, yaw);
    gl.uniform1f(locPitch, pitch);
    gl.uniform1f(locFov, fov);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* 降级模式：宽幅图 + 拖拽平移 + 缩放 */
  var fb = { x: 0, y: 0, s: 1 };
  function drawFallback() {
    if (!fallback) return;
    els.fallbackImg.style.transform = 'translate(' + fb.x + 'px,' + fb.y + 'px) scale(' + fb.s + ')';
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ── 交互 ─────────────────────────────────────────────── */
  function onDown(ev) {
    if (!open) return;
    if (ev.target.closest && ev.target.closest(
      'button, .cp-pano-head, .cp-pano-foot, .cp-pano-hint, .cp-pano-loading')) return;
    ev.preventDefault();
    dragging = true; pointerId = ev.pointerId;
    lastX = ev.clientX; lastY = ev.clientY;
    velY = 0; velP = 0;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} }
    if (root.setPointerCapture) { try { root.setPointerCapture(ev.pointerId); } catch (e) {} }
    kick();
  }

  function onMove(ev) {
    if (!open || !dragging) return;
    if (ev.pointerId != null && pointerId != null && ev.pointerId !== pointerId) return;
    ev.preventDefault();
    var dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    if (fallback) {
      fb.x += dx; fb.y += dy; drawFallback();
    } else {
      var k = (fov / Math.max(1, root.clientHeight)) * 1.15;
      velY = dx * k; velP = dy * k;
      yaw += velY; pitch = clamp(pitch + velP, -PITCH_LIMIT, PITCH_LIMIT);
    }
    kick();
  }

  function onUp(ev) {
    if (!dragging) return;
    dragging = false; pointerId = null;
    kick();
  }

  function onWheel(ev) {
    if (!open) return;
    ev.preventDefault();
    var step = ev.deltaY > 0 ? 1 : -1;
    if (fallback) { fb.s = clamp(fb.s - step * 0.08, 1, 3.2); drawFallback(); }
    else zoom(step);
    kick();
  }

  function zoom(step) {
    fov = clamp(fov + step * 6 * DEG, FOV_MIN, FOV_MAX);
    kick();
  }

  function reset() {
    var s = scenes[index] || {};
    yaw = (s.yaw || 0) * DEG; pitch = (s.pitch || 0) * DEG; fov = (s.fov || 75) * DEG;
    fb.x = 0; fb.y = 0; fb.s = 1;
    velY = 0; velP = 0;
    setAuto(false);
    drawFallback(); kick();
  }

  function setAuto(on) {
    autoSpin = !!on;
    els.auto.setAttribute('aria-pressed', autoSpin ? 'true' : 'false');
    els.auto.classList.toggle('is-on', autoSpin);
    lastInput = Date.now();
    kick();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen();
    } catch (e) {}
    setTimeout(resize, 120);
  }

  function onKey(ev) {
    if (!open) return;
    var k = ev.key;
    if (k === 'Escape') {
      ev.preventDefault(); ev.stopImmediatePropagation(); close(); return;
    }
    var step = 0.055;
    if (k === 'ArrowLeft') yaw -= step;
    else if (k === 'ArrowRight') yaw += step;
    else if (k === 'ArrowUp') pitch = clamp(pitch - step, -PITCH_LIMIT, PITCH_LIMIT);
    else if (k === 'ArrowDown') pitch = clamp(pitch + step, -PITCH_LIMIT, PITCH_LIMIT);
    else if (k === '+' || k === '=') { if (!fallback) zoom(-1); }
    else if (k === '-' || k === '_') { if (!fallback) zoom(1); }
    else if (k === ' ') { ev.preventDefault(); setAuto(!autoSpin); }
    else return;
    ev.preventDefault(); ev.stopPropagation();
    kick();
  }

  /* ── 场景 ─────────────────────────────────────────────── */
  function renderScenes() {
    if (scenes.length < 2) { els.scenes.innerHTML = ''; return; }
    els.scenes.innerHTML = scenes.map(function (s, i) {
      return '<button type="button" data-act="scene" data-i="' + i + '"' +
        (i === index ? ' class="is-active"' : '') + '>' + esc(s.title || ('场景 ' + (i + 1))) + '</button>';
    }).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadScene(i) {
    index = clamp(i, 0, scenes.length - 1);
    var s = scenes[index] || {};
    els.title.textContent = s.title || '360° 全景';
    var sub = [s.address, s.source].filter(Boolean).join(' · ');
    els.sub.textContent = sub;
    els.loading.hidden = false;
    els.loading.querySelector('span').textContent = '全景加载中…';
    /* 首屏立刻显示封面，避免全景大图加载期间黑屏。
       优先复用图片库卡片已经加载完的那张（浏览器缓存命中，零额外请求）。 */
    els.poster.src = (index === 0 && posterOverride)
      ? posterOverride : assetPath(s.cover || s.img);
    els.poster.hidden = false;
    renderScenes();
    reset();

    var url = assetPath(s.img);
    var img = new Image();
    /* 同源不需要 CORS；若将来换到带 CORS 的 CDN，也不会因跨域污染纹理 */
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (!open || index !== i) return;
      if (!gl && !fallback) {
        if (!initGL()) { useFallback(); return; }
        canvas.hidden = false; els.fallback.hidden = true;
      }
      if (!fallback && !upload(img)) { useFallback(); return; }
      els.poster.hidden = true;
      els.loading.hidden = true;
      resize();
      /* 首屏轻微自动环视，提示这是可拖拽的 360° 画面；
         用户设置了「减少动效」时不自动转。 */
      var reduce = false;
      try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
      if (!reduce) setAuto(true);
    };
    img.onerror = function () {
      if (!open) return;
      els.loading.querySelector('span').textContent = '全景图加载失败，请检查网络后重试';
    };
    img.src = url;
    /* 降级容器同步一张，WebGL 失败时立刻有画面 */
    els.fallbackImg.src = url;
  }

  function switchScene(i) { if (i !== index) loadScene(i); }

  /* ── 对外 ─────────────────────────────────────────────── */
  function openPano(list, i, posterUrl) {
    if (!Array.isArray(list) || !list.length) return;
    if (!root) build();
    scenes = list;
    posterOverride = posterUrl || '';
    open = true; fallback = false;
    canvas.hidden = false; els.fallback.hidden = true;
    els.poster.hidden = false;
    root.hidden = false;
    document.body.classList.add('cp-pano-open');
    loadScene(i || 0);
    resize();
  }

  function close() {
    if (!open) return;
    open = false; dragging = false; setAuto(false);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (root) root.hidden = true;
    document.body.classList.remove('cp-pano-open');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  }

  window.CPPanorama = {
    open: openPano,
    close: close,
    resolve: assetPath,
    isOpen: function () { return open; }
  };
})();
