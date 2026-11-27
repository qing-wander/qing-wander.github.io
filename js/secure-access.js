/* ════════════════════════════════════════════════════════════════════
   js/secure-access.js · 加密材料通用访问组件（与业务页面解耦）
   ────────────────────────────────────────────────────────────────────
   一处挂载，得到完整流程：
     锁定态 → 填写申请 → 邮件通知本人 → 本人点签名链接批准
     → 页面轮询到 approved 后无需刷新自动解锁
     → 下发带签名、5 分钟失效的材料链接
     → 定时 / 页面恢复可见 / 图片加载失败时自动续签新链接
     → 授权到期或换设备自动重新加锁

   用法（任何页面都行）：
     <div data-secure-access="company-material:comein"
          data-secure-title="任职佐证材料"
          data-secure-lead="离职证明为隐私文件…"
          data-secure-items='[{"label":"离职证明","status":"available"}]'
          data-secure-pending="0"></div>
     <script>SecureAccess.mountAll()</script>

   服务端配套：functions/lib/secure-access.js（资源 / 签名 / 审批状态）、
   functions/lib/secure-assets.js（材料注册表 + 私有对象存储）、
   functions/api/verify-access.js（申请与状态）、
   functions/api/verify-access-approve.js（邮件审批）、
   functions/api/secure-asset.js（签名链接取流）。
   新增资源只需在注册表加一项 + 页面上加一个容器，本文件不用改。

   安全约定：签名 URL 只在内存里，绝不会写进 localStorage / DOM 属性以外
   的地方缓存；页面刷新一律重新向服务端申请新链接。
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var POLL_MS = 5000;
  var POLL_MAX = 360;                 // 最多等 30 分钟
  var APPROVAL_TTL_MS = 24 * 3600 * 1000;
  var DEFAULT_REFRESH_SEC = 120;

  var instances = new Map();
  var modal = null;
  var active = null;
  var lastFocused = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function apiBases() {
    var host = location.hostname || '';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return [''];
    if (/\.github\.io$/i.test(host)) return ['https://qing-wander.pages.dev'];
    return ['', 'https://qing-wander.pages.dev'];
  }

  /* 与留言墙 / 学历核验共用同一设备 ID，方便本人识别重复申请 */
  function deviceId() {
    try {
      var key = 'wall_device_id';
      var id = localStorage.getItem(key);
      if (!id) {
        id = (window.crypto && typeof window.crypto.randomUUID === 'function')
          ? window.crypto.randomUUID()
          : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        localStorage.setItem(key, id);
      }
      return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
    } catch (e) { return ''; }
  }

  function deviceInfo() {
    try {
      var s = window.screen || {};
      return {
        platform: navigator.platform || '',
        screen: (s.width || '') + 'x' + (s.height || ''),
        colorDepth: String(s.colorDepth || ''),
        language: navigator.language || '',
        timezone: String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
        cores: String(navigator.hardwareConcurrency || ''),
        touch: String(('ontouchstart' in window) || navigator.maxTouchPoints > 0),
        dpr: String(window.devicePixelRatio || '')
      };
    } catch (e) { return {}; }
  }

  function keyPrefix(kind, resource) { return 'secure_access:' + kind + ':' + resource; }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function formatTime(ts) {
    try {
      return new Date(Number(ts)).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (e) { return ''; }
  }

  /* ── 单个容器 = 一个实例 ─────────────────────────────────── */
  function Instance(el) {
    this.el = el;
    this.resource = String(el.getAttribute('data-secure-access') || '').trim();
    this.title = el.getAttribute('data-secure-title') || '加密材料';
    this.lead = el.getAttribute('data-secure-lead') ||
      '为保护隐私，这份材料默认加锁。若因招聘核验、背调等正当用途需要查看，请填写申请；本人核实身份并批准后才会在本页面解锁。';
    this.materialsPending = el.getAttribute('data-secure-pending') === '1';
    this.items = [];
    try {
      var raw = JSON.parse(el.getAttribute('data-secure-items') || '[]');
      if (Object.prototype.toString.call(raw) === '[object Array]') this.items = raw;
    } catch (e) {}
    this.pollTimer = null;
    this.refreshTimer = null;
    this.pollTick = 0;
    this.retryAt = 0;
    this.base = apiBases()[0];
    this.lastAssets = [];
  }

  Instance.prototype.pendingKey = function () { return keyPrefix('pending', this.resource); };
  Instance.prototype.unlockKey = function () { return keyPrefix('unlock', this.resource); };

  Instance.prototype.destroy = function () {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.pollTimer = this.refreshTimer = null;
    this.lastAssets = [];
  };

  Instance.prototype.clearTimers = function () {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.pollTimer = this.refreshTimer = null;
  };

  Instance.prototype.itemsHtml = function () {
    if (!this.items.length) {
      return '<p class="sa-items-note">材料清单由服务端在批准后下发。</p>';
    }
    return '<ul class="sa-items">' + this.items.map(function (it) {
      var pending = it.status === 'pending';
      return '<li class="sa-item' + (pending ? ' is-pending' : '') + '">' +
        '<span class="sa-item-icon">' + (pending ? '◌' : '▣') + '</span>' +
        '<span>' + esc(it.label || '材料') + '</span>' +
        (it.issuer ? '<small>' + esc(it.issuer) + '</small>' : '') +
        (pending ? '<em>整理中，待补充</em>' : '<em>已归档</em>') +
      '</li>';
    }).join('') + '</ul>';
  };

  Instance.prototype.renderLocked = function (message, kind) {
    this.clearTimers();
    this.lastAssets = [];
    var disabled = this.materialsPending;
    var note = disabled
      ? '这家公司的离职证明尚未归档，材料整理完成后开放申请。'
      : this.lead;
    var extra = message
      ? '<p class="sa-notice is-' + esc(kind || 'info') + '">' + esc(message) + '</p>' : '';
    this.el.innerHTML =
      '<div class="sa-box" data-sa-state="locked">' +
        '<div class="sa-head"><span class="sa-kicker">SECURE / LOCKED</span>' +
          '<span class="sa-lock-chip">LOCK</span></div>' +
        '<h4 class="sa-title">' + esc(this.title) + '</h4>' +
        this.itemsHtml() +
        extra +
        '<p class="sa-lead">' + esc(note) + '</p>' +
        '<button class="sa-apply" type="button" data-secure-apply' + (disabled ? ' disabled' : '') + '>' +
          (disabled ? '材料整理中 · 暂不可申请' : '申请查看权限 →') + '</button>' +
        '<p class="sa-foot-note">申请需填写身份与用途，由本人邮件核实后批准；' +
          '授权仅对当前设备有效，批准后 24 小时自动过期。材料链接带签名、5 分钟失效并自动续签。</p>' +
      '</div>';
  };

  Instance.prototype.renderWaiting = function (text) {
    this.el.innerHTML =
      '<div class="sa-box" data-sa-state="waiting">' +
        '<div class="sa-head"><span class="sa-kicker">SECURE / PENDING</span>' +
          '<span class="sa-lock-chip is-wait">WAIT</span></div>' +
        '<h4 class="sa-title">' + esc(this.title) + '</h4>' +
        this.itemsHtml() +
        '<p class="sa-lead">' + esc(text || '申请已提交，等待本人核实身份并批准。请留在此页，批准后会自动解锁，无需刷新。') + '</p>' +
        '<p class="sa-foot-note">离开本页后再回来会自动续上等待结果。</p>' +
      '</div>';
  };

  /* 批准后：只把服务端刚签发的 URL 放进 img.src，不缓存、不落盘 */
  Instance.prototype.renderApproved = function (assets, info) {
    var self = this;
    this.lastAssets = assets || [];
    var until = info && info.expiresAt ? formatTime(info.expiresAt) : '24 小时后';
    var cards = this.lastAssets.length
      ? this.lastAssets.map(function (a) {
          return '<figure class="sa-card">' +
            '<img class="sa-img" src="' + esc(a.url) + '" alt="' + esc(a.label || '材料') +
              '" loading="lazy" data-sa-zoom>' +
            '<figcaption><b>' + esc(a.label || '材料') + '</b>' +
              (a.issuer ? '<span>' + esc(a.issuer) + '</span>' : '') +
              (a.date ? '<span>出具日期 ' + esc(a.date) + '</span>' : '') +
            '</figcaption></figure>';
        }).join('')
      : '<p class="sa-empty">该资源暂无已归档材料，本人补充后重新打开本页即可查看。</p>';
    var linkUntil = this.lastAssets.length && this.lastAssets[0].expiresAt
      ? formatTime(this.lastAssets[0].expiresAt) : '5 分钟后';
    this.el.innerHTML =
      '<div class="sa-box" data-sa-state="approved">' +
        '<div class="sa-head"><span class="sa-kicker">SECURE / APPROVED</span>' +
          '<span class="sa-lock-chip is-open">OPEN</span></div>' +
        '<h4 class="sa-title">' + esc(this.title) + ' · 已解锁</h4>' +
        '<div class="sa-grid">' + cards + '</div>' +
        '<p class="sa-flag">✓ 已获本人批准查看 · 仅限申请用途 · 授权有效期至 ' + esc(until) + '</p>' +
        '<div class="sa-actions">' +
          '<button class="sa-refresh" type="button" data-sa-refresh>刷新签名链接 ↻</button>' +
          '<span class="sa-link-note">链接 ' + esc(linkUntil) + ' 失效，页面会自动续签；' +
            '旧链接无法继续访问对象存储。</span>' +
        '</div>' +
      '</div>';
    /* 图片加载失败（签名刚好过期 / 网络抖动）时立即续签一次 */
    Array.prototype.forEach.call(this.el.querySelectorAll('.sa-img'), function (img) {
      img.addEventListener('error', function () {
        var now = Date.now();
        if (now < self.retryAt) return;
        self.retryAt = now + 5000;
        self.refresh();
      });
    });
  };

  Instance.prototype.saveUnlock = function (id, info) {
    writeJSON(this.unlockKey(), {
      id: id, device: deviceId(), approvedAt: info.approvedAt || Date.now(),
      expiresAt: info.expiresAt || (Date.now() + APPROVAL_TTL_MS)
    });
  };
  Instance.prototype.readUnlock = function () {
    var u = readJSON(this.unlockKey());
    if (!u || !/^[0-9a-f]{32}$/i.test(u.id || '')) { removeKey(this.unlockKey()); return null; }
    var did = deviceId();
    if (did && u.device && u.device !== did) { removeKey(this.unlockKey()); return null; }
    if (!u.expiresAt || Date.now() > Number(u.expiresAt)) { removeKey(this.unlockKey()); return null; }
    return u;
  };
  Instance.prototype.lock = function (message, kind) {
    removeKey(this.unlockKey());
    removeKey(this.pendingKey());
    this.renderLocked(message, kind);
  };

  /* 向服务端取一次状态：approved 时服务端会重新签发一批短时效链接 */
  Instance.prototype.refresh = function (opts) {
    var self = this;
    var o = opts || {};
    var u = this.readUnlock();
    if (!u && !o.pendingId) { this.lock('', 'info'); return; }
    var id = u ? u.id : o.pendingId;
    var base = o.base || this.base || apiBases()[0];
    var url = new URL(base + '/api/verify-access?id=' + encodeURIComponent(id), location.href).href;
    var headers = { 'Accept': 'application/json' };
    var did = deviceId();
    if (did) headers['X-Device-Id'] = did;
    return fetch(url, { method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) throw new Error('not_json');
        return r.json();
      })
      .then(function (d) { self.handleStatus(d, id, base); })
      .catch(function () {
        /* 网络抖动：保留当前画面，稍微等一下再续签 */
        if (u) self.scheduleRefresh(15);
      });
  };

  Instance.prototype.handleStatus = function (d, id, base) {
    if (d && d.error === 'device_mismatch') {
      this.lock('该次批准仅对申请时的设备有效，请在当前设备重新提交申请。', 'warn');
      return;
    }
    if (d && d.ok && d.status === 'approved') {
      this.base = base;
      this.pendingId = '';
      if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
      var info = { approvedAt: d.approvedAt, expiresAt: d.expiresAt };
      this.saveUnlock(id, info);
      removeKey(this.pendingKey());
      this.renderApproved(d.assets || [], info);
      this.scheduleRefresh(d.assetRefreshIn || DEFAULT_REFRESH_SEC);
      return;
    }
    if (d && d.ok && d.status === 'expired') {
      this.lock('授权已到期（有效期 24 小时），请重新提交申请。', 'warn');
      return;
    }
    if (d && d.ok && d.status === 'rejected') {
      this.lock('本人未批准这次申请。如需继续，请补充身份信息后重新提交。', 'warn');
      return;
    }
    /* pending：继续轮询（申请阶段） */
    if (this.pendingId) this.schedulePoll();
  };

  Instance.prototype.scheduleRefresh = function (sec) {
    var self = this;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(function () { self.refresh(); }, Math.max(10, Number(sec) || DEFAULT_REFRESH_SEC) * 1000);
  };

  Instance.prototype.schedulePoll = function () {
    var self = this;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(function () { self.pollOnce(); }, POLL_MS);
  };

  Instance.prototype.pollOnce = function () {
    var self = this;
    if (this.pollTick++ >= POLL_MAX) {
      removeKey(this.pendingKey());
      this.pendingId = '';
      this.lock('等待超时（30 分钟）。本人尚未操作，请稍后重新提交申请。', 'warn');
      return;
    }
    var id = this.pendingId;
    var url = new URL(this.base + '/api/verify-access?id=' + encodeURIComponent(id), location.href).href;
    var headers = { 'Accept': 'application/json' };
    var did = deviceId();
    if (did) headers['X-Device-Id'] = did;
    fetch(url, { method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) throw new Error('not_json');
        return r.json();
      })
      .then(function (d) { self.handleStatus(d, id, self.base); })
      .catch(function () { self.schedulePoll(); });
  };

  Instance.prototype.startPolling = function (id, base) {
    var self = this;
    this.pendingId = id;
    this.base = base;
    this.pollTick = 0;
    writeJSON(this.pendingKey(), { id: id, base: base, startedAt: Date.now() });
    this.renderWaiting();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(function () { self.pollOnce(); }, 1200);
  };

  Instance.prototype.boot = function () {
    var u = this.readUnlock();
    if (u) {
      /* 刷新页面 / 重开页面：解锁态仍在，但必须重新领一张新签名链接 */
      this.pendingId = '';
      this.renderWaiting('正在恢复已授权材料的签名链接…');
      this.refresh({ pendingId: u.id });
      return;
    }
    var p = readJSON(this.pendingKey());
    if (p && /^[0-9a-f]{32}$/i.test(p.id || '') &&
        Date.now() - (p.startedAt || 0) < POLL_MAX * POLL_MS) {
      this.startPolling(p.id, p.base || apiBases()[0]);
      return;
    }
    removeKey(this.pendingKey());
    this.renderLocked('', 'info');
  };

  /* ── 申请弹窗（整页单例，多个容器共用） ─────────────────── */
  function modalHtml() {
    return '<div class="sa-modal" role="dialog" aria-modal="true" aria-labelledby="saModalTitle">' +
      '<button class="sa-modal-close" type="button" data-sa-modal-close aria-label="关闭弹窗">×</button>' +
      '<p class="sa-modal-kicker">SECURE / ACCESS REQUEST</p>' +
      '<h3 class="sa-modal-title" id="saModalTitle">申请查看加密材料</h3>' +
      '<p class="sa-modal-lead">请说明你的身份与查看用途。信息会连同申请时间、设备与浏览器信息邮件发送给本人；' +
        '核实身份并批准后，本页会自动解锁，无需刷新。授权仅对当前设备有效，24 小时后自动过期，' +
        '材料链接带签名且 5 分钟失效，到期需重新申请。</p>' +
      '<form class="sa-form" data-sa-form novalidate>' +
        '<label class="sa-field"><span>你的姓名 / 称呼 <em>必填</em></span>' +
          '<input type="text" name="name" maxlength="40" autocomplete="name" placeholder="例如：张三"></label>' +
        '<label class="sa-field"><span>当前身份 <em>必填</em></span><select name="identity">' +
          '<option value="">请选择…</option><option value="hr">HR / 招聘负责人</option>' +
          '<option value="manager">用人经理 / 业务负责人</option><option value="interviewer">面试官</option>' +
          '<option value="headhunter">猎头 / 招聘顾问</option><option value="partner">合作方 / 客户</option>' +
          '<option value="researcher">研究者 / 学生</option><option value="other">其他身份</option>' +
        '</select></label>' +
        '<label class="sa-field"><span>所在公司 / 机构 <em>建议填写</em></span>' +
          '<input type="text" name="org" maxlength="80" placeholder="例如：某某科技 · 招聘部"></label>' +
        '<label class="sa-field"><span>联系方式（邮箱或电话） <em>建议填写</em></span>' +
          '<input type="text" name="contact" maxlength="120" placeholder="邮箱优先"></label>' +
        '<label class="sa-field"><span>查看用途 <em>必填</em></span><select name="purpose">' +
          '<option value="">请选择…</option><option value="recruit">招聘流程评估</option>' +
          '<option value="background">入职背景调查</option><option value="interview">面试 / 技术评估</option>' +
          '<option value="cooperation">商务合作尽职调查</option><option value="research">学术研究 / 资料整理</option>' +
          '<option value="other">其他用途</option></select></label>' +
        '<label class="sa-field"><span>查看理由 <em>必填 · 至少 15 字</em></span>' +
          '<textarea name="reason" rows="4" maxlength="600" placeholder="请具体说明为什么需要查看这份材料…"></textarea>' +
          '<small>建议写清：① 你是谁、代表哪家公司；② 为什么需要核验；③ 信息只用于什么场景、不会外传。</small></label>' +
        '<label class="sa-check"><input type="checkbox" name="consent" value="1">' +
          '<span>我确认以上信息真实，且仅用于所填用途，不会转交第三方。</span></label>' +
        '<div class="sa-honeypot" aria-hidden="true"><label>网站地址<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="sa-form-error" data-sa-error hidden></p>' +
        '<button class="sa-submit" type="submit" data-sa-submit>提交申请 →</button>' +
      '</form>' +
      '<div class="sa-form-done" data-sa-done hidden>' +
        '<b>申请已提交</b><p data-sa-done-text>请留在此页等待自动解锁。</p>' +
        '<button class="sa-submit is-alt" type="button" data-sa-modal-close>关闭</button></div>' +
    '</div>';
  }

  function getModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'sa-modal-mask';
    modal.hidden = true;
    modal.innerHTML = modalHtml();
    document.body.appendChild(modal);
    return modal;
  }

  function openModal(inst) {
    var el = getModal();
    active = inst;
    var form = el.querySelector('[data-sa-form]');
    var done = el.querySelector('[data-sa-done]');
    var err = el.querySelector('[data-sa-error]');
    var btn = el.querySelector('[data-sa-submit]');
    if (form) { form.hidden = false; form.reset(); }
    if (done) done.hidden = true;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (btn) { btn.disabled = false; btn.textContent = '提交申请 →'; }
    var title = el.querySelector('#saModalTitle');
    if (title) title.textContent = '申请查看' + (inst.title || '加密材料');
    lastFocused = document.activeElement;
    el.hidden = false;
    document.body.classList.add('sa-modal-open');
    var first = el.querySelector('input[name="name"]');
    if (first) first.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    active = null;
    document.body.classList.remove('sa-modal-open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function doneText(text) {
    if (!modal) return;
    var t = modal.querySelector('[data-sa-done-text]');
    if (t) t.textContent = text;
    var done = modal.querySelector('[data-sa-done]');
    if (done) done.hidden = false;
    var form = modal.querySelector('[data-sa-form]');
    if (form) form.hidden = true;
  }

  function submitForm(form) {
    if (!active) return;
    var inst = active;
    var errEl = form.querySelector('[data-sa-error]');
    var btn = form.querySelector('[data-sa-submit]');
    function fail(msg) {
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
      if (btn) { btn.disabled = false; btn.textContent = '提交申请 →'; }
    }
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    var name = String(form.elements.name.value || '').trim();
    var reason = String(form.elements.reason.value || '').trim();
    if (Array.from(name).length < 2) { fail('请填写姓名 / 称呼（至少 2 个字）'); return; }
    if (!form.elements.identity.value) { fail('请选择你的当前身份'); return; }
    if (!form.elements.purpose.value) { fail('请选择查看用途'); return; }
    if (Array.from(reason).length < 15) { fail('查看理由请至少写 15 个字，方便本人核实身份'); return; }
    if (!form.elements.consent.checked) { fail('请先确认信息真实、仅用于所填用途'); return; }

    var payload = {
      resource: inst.resource,
      name: name, identity: form.elements.identity.value,
      org: String(form.elements.org.value || '').trim(),
      contact: String(form.elements.contact.value || '').trim(),
      purpose: form.elements.purpose.value,
      reason: reason, consent: true,
      device: deviceInfo(), origin: location.href
    };
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    var did = deviceId();
    if (did) headers['X-Device-Id'] = did;

    var bases = apiBases();
    function next(i) {
      if (i >= bases.length) { fail('网络异常，申请未提交，请稍后重试'); return; }
      var base = bases[i];
      fetch(new URL(base + '/api/verify-access', location.href).href, {
        method: 'POST', headers: headers, credentials: 'omit', body: JSON.stringify(payload)
      }).then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) {
          if ((r.status === 404 || r.status >= 500) && i + 1 < bases.length) return next(i + 1);
          throw new Error('not_json');
        }
        return r.json().then(function (d) {
          if (r.ok && d && d.ok) {
            form.hidden = true;
            var done = form.parentNode.querySelector('[data-sa-done]');
            if (done) done.hidden = false;
            if (d.requestId) {
              inst.startPolling(d.requestId, base);
              doneText('申请已提交。请留在此页等待：本人批准后本页会自动解锁，无需刷新。' +
                '授权仅对当前设备有效、24 小时后过期；材料链接带签名且会定时自动续签。');
            } else {
              doneText('申请已提交。当前站点未启用在线审批，本人会通过你留下的联系方式回复。');
            }
            return;
          }
          if (!r.ok && (r.status === 404 || r.status === 502) && i + 1 < bases.length) return next(i + 1);
          fail((d && d.message) || '提交失败，请稍后重试');
        });
      }, function () { next(i + 1); });
    }
    next(0);
  }

  /* ── 大图预览（组件自带，不依赖页面里的灯箱） ───────────── */
  var lightbox = null;
  function openZoom(img) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'sa-lightbox';
      lightbox.hidden = true;
      lightbox.innerHTML = '<button type="button" class="sa-lightbox-close" aria-label="关闭">✕</button><img alt="">';
      lightbox.addEventListener('click', function (ev) {
        if (ev.target === lightbox || ev.target.classList.contains('sa-lightbox-close')) closeZoom();
      });
      document.body.appendChild(lightbox);
    }
    var target = lightbox.querySelector('img');
    if (target) { target.src = img.currentSrc || img.src; target.alt = img.alt || ''; }
    lightbox.hidden = false;
  }
  function closeZoom() { if (lightbox) { lightbox.hidden = true; } }

  /* ── 全局事件（捕获阶段，抽屉重渲染后依然生效） ─────────── */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var zi = closest(t, '[data-sa-zoom]');
    if (zi && zi.tagName === 'IMG') { openZoom(zi); return; }
    var apply = closest(t, '[data-secure-apply]');
    if (apply) {
      var host = closest(apply, '[data-secure-access]');
      var inst = host && instances.get(host);
      if (inst && !apply.disabled) openModal(inst);
      return;
    }
    var refresh = closest(t, '[data-sa-refresh]');
    if (refresh) {
      var host2 = closest(refresh, '[data-secure-access]');
      var inst2 = host2 && instances.get(host2);
      if (inst2) inst2.refresh();
      return;
    }
    if (modal && !modal.hidden) {
      if (t === modal || closest(t, '[data-sa-modal-close]')) { closeModal(); return; }
    }
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (modal && !modal.hidden) { closeModal(); ev.stopPropagation(); return; }
    if (lightbox && !lightbox.hidden) { closeZoom(); ev.stopPropagation(); }
  }, true);

  document.addEventListener('submit', function (ev) {
    var form = closest(ev.target, '[data-sa-form]');
    if (form) { ev.preventDefault(); submitForm(form); }
  }, true);

  /* 页面重新可见时立即续签，避免签名在后台标签页里过期 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    instances.forEach(function (inst) {
      if (inst.el.getAttribute('data-sa-state') !== 'approved' &&
          !inst.el.querySelector('[data-sa-state="approved"]')) return;
      inst.refresh();
    });
  });

  /* ── 对外 API ────────────────────────────────────────────── */
  function mountAll(root) {
    var scope = root || document;
    /* 抽屉重建后旧容器已脱离文档，清掉它们的定时器 */
    instances.forEach(function (inst, el) {
      if (!document.contains(el)) { inst.destroy(); instances.delete(el); }
    });
    var nodes = scope.querySelectorAll('[data-secure-access]');
    Array.prototype.forEach.call(nodes, function (el) {
      if (instances.has(el)) return;
      var inst = new Instance(el);
      if (!inst.resource) return;
      instances.set(el, inst);
      inst.boot();
    });
  }

  window.SecureAccess = {
    mountAll: mountAll,
    mount: function (el) { mountAll(el && el.parentElement ? el.parentElement : document); },
    refresh: function (el) {
      var inst = instances.get(el);
      if (inst) inst.refresh();
    }
  };

  /* DOM 就绪后自动挂载一次；动态插入的容器可随时再调 mountAll */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }
})();
