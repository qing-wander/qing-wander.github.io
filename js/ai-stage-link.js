/* ════════════════════════════════════════════════════════════
   数字分身角色 ↔ 问答面板「语义联动」
   --------------------------------------------------------------
   目标：让右下角 3D 角色从"状态灯"变成"发言人"——
   ① 语音真的出声时，头顶换音波条（不再挂"正在算"的点）；
   ② 回答指向站内某个区块时，角色递出一张「去看看」小票，
      点击才滚动 + 描边落点，绝不自动抢滚动权。
   约束：只读 DOM、不改 js/main.js 的问答/语音/皮肤逻辑；
        面板打开时角色已由 css/ai-skins.css 缩小贴边。
   调试：window.CPAI_STAGE_LINK.routes() / .demo('projects')
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var stage = document.getElementById('aiStage');
  var aiBody = document.getElementById('aiBody');
  var aiPanel = document.getElementById('aiPanel');
  if (!stage || !aiBody || !aiPanel) return;

  /* ─────────────── 1) 说话音波 ─────────────── */
  var talk = document.createElement('div');
  talk.className = 'ai-stage-talk';
  talk.setAttribute('aria-hidden', 'true');
  talk.innerHTML = '<i></i><i></i><i></i><i></i>';
  stage.appendChild(talk);

  var wasSpeaking = false;
  function syncVoice() {
    var on = document.body.classList.contains('cpai-speaking');
    if (on === wasSpeaking) return;
    wasSpeaking = on;
    stage.classList.toggle('is-speaking', on);
  }
  if (window.MutationObserver) {
    new MutationObserver(syncVoice).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  syncVoice();

  /* ─────────────── 2) 问答 → 区块路由表 ───────────────
     先看问题（意图最明确），问题没命中再看回答里关键词出现 ≥2 次，
     避免答案正文随便提一句"项目"就把票弹出来。 */
  var ROUTES = [
    { id: 'projects',   name: '去项目区看证据',   hint: 'P-01 ~ P-05 · 业务与结果', re: /项目|作品|案例|系统|落地|做过|业务|成果/i },
    { id: 'experience', name: '去工作经历',       hint: '公司 / 年限 / 离职原因',   re: /经历|公司|任职|在职|离职|跳槽|几年|工作过|履历/i },
    { id: 'skills',     name: '去看能力清单',     hint: '技术栈 / 熟练度 / 工具',   re: /技能|技术栈|框架|语言|会什么|擅长|掌握|栈/i },
    { id: 'education',  name: '去看教育背景',     hint: '学校 / 学历 / 专业',       re: /教育|学历|学校|毕业|本科|大学|专业/i },
    { id: 'awards',     name: '去看证书奖项',     hint: '认证 / 荣誉 / 竞赛',       re: /证书|奖项|荣誉|认证|奖/i },
    { id: 'jd',         name: '去做 JD 匹配',     hint: '贴岗位描述逐条对照',       re: /JD|岗位|匹配|招聘|要求|任职资格/i },
    { id: 'contact',    name: '去看联系方式',     hint: '邮箱 / 电话 / 约面试',     re: /联系|邮箱|电话|微信|约面试|怎么找|沟通/i }
  ];

  function countIn(text, re) {
    var m = text.match(new RegExp(re.source, 'gi'));
    return m ? m.length : 0;
  }

  function classify(q, a) {
    q = q || ''; a = a || '';
    if (a.length < 24) return null;
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].re.test(q)) return ROUTES[i];
    var best = null, bestN = 0;
    for (var j = 0; j < ROUTES.length; j++) {
      var n = countIn(a, ROUTES[j].re);
      if (n > bestN) { bestN = n; best = ROUTES[j]; }
    }
    return bestN >= 2 ? best : null;
  }

  /* ─────────────── 3) 指路小票 ─────────────── */
  var ticket = document.createElement('button');
  ticket.type = 'button';
  ticket.className = 'ai-locate-ticket';
  ticket.hidden = true;
  ticket.setAttribute('aria-label', '角色指路：跳到对应区块');
  ticket.innerHTML =
    '<span class="ai-locate-k">▶ 去看看</span>' +
    '<span class="ai-locate-txt"></span>' +
    '<span class="ai-locate-x" aria-hidden="true">×</span>';
  var ticketTxt = ticket.querySelector('.ai-locate-txt');
  document.body.appendChild(ticket);

  var activeRoute = null;
  var hideTimer = null;
  var HOLD = 9000;

  function place() {
    if (ticket.hidden) return;
    var r = stage.getBoundingClientRect();
    var w = ticket.offsetWidth || 236;
    var h = ticket.offsetHeight || 46;
    /* 右边界让给面板：票是角色的"台词"，不能压到字幕窗口上 */
    var pr = aiPanel.hidden ? null : aiPanel.getBoundingClientRect();
    var maxRight = pr ? pr.left - 8 : window.innerWidth - 12;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), maxRight - w);
    if (left < 12) left = 12;
    var below = (r.top - h - 14) < 76;          /* 顶到固定顶栏就改挂脚下 */
    var top = below ? Math.min(r.bottom + 10, window.innerHeight - h - 12) : (r.top - h - 14);
    ticket.style.left = left + 'px';
    ticket.style.top = Math.max(12, top) + 'px';
    ticket.classList.toggle('is-below', below);
  }

  function hideTicket() {
    activeRoute = null;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    ticket.classList.remove('is-on');
    ticket.hidden = true;
    stage.classList.remove('has-locate');
  }

  function showTicket(route) {
    /* 小屏 / 面板未开 / 遮罩大窗时角色不在场，票也没有立足点 */
    if (!route) return;
    if (aiPanel.hidden || window.innerWidth < 900 || document.querySelector('.ai-panel.is-max')) return;
    if (!document.getElementById(route.id)) return;
    activeRoute = route;
    stage.classList.add('has-locate');   /* 票在时，入口标签让位 */
    ticketTxt.innerHTML = '<span>' + route.name + ' ↗</span><small>' + route.hint + '</small>';
    ticket.hidden = false;
    ticket.classList.remove('is-on');
    /* 同步定位一次：哪怕 rAF 被节流/后台标签页不跑，票也落在角色头顶而不是文档流末尾 */
    place();
    requestAnimationFrame(function () {
      place();
      requestAnimationFrame(function () { ticket.classList.add('is-on'); });
    });
    setTimeout(function () { ticket.classList.add('is-on'); }, 120);   /* rAF 兜底 */
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTicket, HOLD);
  }

  /* 落点描边：独立浮层跟着目标矩形走，滚动停 260ms 后定住 1.4s 再淡出。
     只框目标上部约 360px（长 section 全框会把整屏罩住），并裁到固定顶栏以下。 */
  function spot(target) {
    var frame = document.createElement('div');
    frame.className = 'cp-spot-frame';
    document.body.appendChild(frame);

    var idleTimer = null, outTimer = null, closed = false;

    function draw() {
      var r = target.getBoundingClientRect();
      var vh = window.innerHeight;
      /* 目标完全不在视口：先藏起来，等滚动事件再显示 */
      if (r.bottom < 78 || r.top > vh - 40) { frame.style.opacity = '0'; return; }
      var top = Math.max(r.top, 78);
      var h = Math.min(r.height, 360, Math.max(0, vh - top - 12));
      if (h < 56) h = Math.min(120, vh - top - 12);
      frame.style.left = r.left + 'px';
      frame.style.top = top + 'px';
      frame.style.width = r.width + 'px';
      frame.style.height = h + 'px';
      frame.style.opacity = '';
    }

    function stop() {
      if (closed) return;
      closed = true;
      window.removeEventListener('scroll', onScroll);
      if (idleTimer) clearTimeout(idleTimer);
      outTimer = setTimeout(function () {
        frame.classList.add('is-out');
        setTimeout(function () { if (frame.parentNode) frame.remove(); }, 400);
      }, 1400);
    }

    function onScroll() {
      if (closed) return;
      draw();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, 260);
    }

    draw();
    window.addEventListener('scroll', onScroll, { passive: true });
    idleTimer = setTimeout(stop, 420);   /* 已经在落点时不需要一直等滚动 */
  }

  function travel(route) {
    if (!route) return;
    var target = document.getElementById(route.id);
    if (!target) { hideTicket(); return; }
    hideTicket();
    /* 落点偏移交给 html 的 scroll-padding-top: 84px，这里不再额外加 margin */
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { target.scrollIntoView(); }
    spot(target);
  }

  ticket.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('.ai-locate-x')) { hideTicket(); return; }
    travel(activeRoute);
  });

  /* ─────────────── 4) 监听回答：只认「提问 → 回答」这一对 ─────────────── */
  function handleAnswer() {
    var msgs = aiBody.querySelectorAll('.ai-msg');
    if (msgs.length < 2) return;
    var last = msgs[msgs.length - 1];
    var prev = msgs[msgs.length - 2];
    if (!last.classList.contains('ai-msg-bot') || last.classList.contains('ai-typing')) return;
    if (last.getAttribute('data-cp-routed')) return;       /* 同一轮只处理一次 */
    if (!prev.classList.contains('ai-msg-user')) return;   /* 开场白/系统提示不指路 */
    last.setAttribute('data-cp-routed', '1');

    /* JD 模式答案是卡片（.ai-jd-card），卡片自己带「打开完整对照」，不再叠票 */
    if (aiBody.lastElementChild && aiBody.lastElementChild.classList.contains('ai-jd-card')) return;

    var qEl = prev.querySelector('.ai-bubble');
    var aEl = last.querySelector('.ai-bubble');
    var a = aEl ? (aEl.textContent || '') : '';
    if (a.indexOf('▍') === 0) return;                      /* 错误/超时/限流不指路 */

    var route = classify(qEl ? (qEl.textContent || '') : '', a);
    if (route) showTicket(route);
  }

  if (window.MutationObserver) {
    new MutationObserver(handleAnswer).observe(aiBody, { childList: true, subtree: true });
    /* 面板关闭 / 放大成遮罩大窗：票必须一起退场（票 z-index 高于遮罩，留着会浮在最上层） */
    new MutationObserver(function () {
      if (aiPanel.hidden || aiPanel.classList.contains('is-max')) hideTicket();
    }).observe(aiPanel, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }

  /* 舞台与票都是 fixed：页面滚动不改变两者相对位置，只监听视口尺寸变化，
     避免滚动时反复强制 relayout */
  window.addEventListener('resize', function () { if (!ticket.hidden) place(); });

  /* 调试入口 */
  window.CPAI_STAGE_LINK = {
    routes: function () { return ROUTES.map(function (r) { return r.id + ' — ' + r.name; }); },
    demo: function (id) {
      var r = null;
      for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) r = ROUTES[i];
      if (r) showTicket(r);
    },
    hide: hideTicket,
    travel: function (id) { travel(ROUTES.filter(function (r) { return r.id === id; })[0]); }
  };
})();
