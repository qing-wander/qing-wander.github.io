/* ──────────────────────────────────────────────────────────────────────
   公司档案互动组件：浏览量（小眼睛）/ 点赞 / 评论与回复
   ──────────────────────────────────────────────────────────────────────
   给公司档案详情末尾补一个互动区块，独立页 company.html 与简历抽屉共用。
   数据全部走 Cloudflare Pages Function /api/company-social（D1 持久化），
   github.io 静态站直连 pages.dev，本地预览打本机；后端不可用时只显示提示，
   不用 localStorage 假装有持久化。

   设备唯一口径：localStorage 随机 device id（复用留言墙的 key）
   + 设备指纹（平台 / 屏幕 / 语言 / 时区）+ 浏览器 UA，
   服务端把三者拼成 HMAC 哈希，同一标识对同一档案只计一次浏览 / 一次赞。
   ────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var API_BASES = (function () {
    var host = location.hostname || '';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return [''];
    if (/\.github\.io$/i.test(host)) return ['https://qing-wander.pages.dev'];
    return ['', 'https://qing-wander.pages.dev'];
  })();

  /* 与留言墙共用同一设备 ID：清缓存 / 换浏览器算新设备 */
  function deviceId() {
    var key = 'wall_device_id';
    try {
      var id = localStorage.getItem(key);
      if (!id) {
        id = (window.crypto && typeof window.crypto.randomUUID === 'function')
          ? window.crypto.randomUUID()
          : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        localStorage.setItem(key, id);
      }
      return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
    } catch (e) {
      return '';
    }
  }

  /* 设备指纹：只取公开、稳定的环境信息，不采集任何个人身份数据 */
  function deviceFp() {
    try {
      var s = window.screen || {};
      return [
        navigator.platform || '',
        (s.width || '') + 'x' + (s.height || ''),
        (s.colorDepth || ''),
        (navigator.language || ''),
        String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
        String(navigator.hardwareConcurrency || '')
      ].join('|');
    } catch (e) {
      return '';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function apiCall(body, cb) {
    var did = deviceId();
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (did) { headers['X-Device-Id'] = did; headers['X-Device-Fp'] = deviceFp(); }
    var payload = JSON.stringify(body);
    function next(i) {
      if (i >= API_BASES.length) { cb(new Error('no_api'), null); return; }
      var url = new URL(API_BASES[i] + '/api/company-social', location.href).href;
      fetch(url, { method: 'POST', headers: headers, body: payload, credentials: 'omit' })
        .then(function (r) {
          var ct = r.headers.get('content-type') || '';
          if (ct.indexOf('application/json') < 0) throw new Error('not_json');
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (res) {
          if (res.data && res.data.ok) cb(null, res.data);
          else if (!res.ok && i + 1 < API_BASES.length) next(i + 1);
          else cb(new Error((res.data && res.data.error) || 'api_error'), res.data);
        }, function () { next(i + 1); });
    }
    next(0);
  }

  function loadState(cid, cb) {
    var did = deviceId();
    var headers = { 'Accept': 'application/json' };
    if (did) { headers['X-Device-Id'] = did; headers['X-Device-Fp'] = deviceFp(); }
    function next(i) {
      if (i >= API_BASES.length) { cb(new Error('no_api'), null); return; }
      var url = new URL(API_BASES[i] + '/api/company-social?c=' + encodeURIComponent(cid), location.href).href;
      fetch(url, { headers: headers, credentials: 'omit' })
        .then(function (r) {
          var ct = r.headers.get('content-type') || '';
          if (ct.indexOf('application/json') < 0) throw new Error('not_json');
          return r.json();
        })
        .then(function (d) {
          if (d && d.ok) cb(null, d);
          else if (i + 1 < API_BASES.length) next(i + 1);
          else cb(new Error((d && d.error) || 'api_error'), d);
        }, function () { next(i + 1); });
    }
    next(0);
  }

  function timeAgo(ts) {
    var d = Date.now() - Number(ts);
    if (!isFinite(d) || d < 0) return '';
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 2592000000) return Math.floor(d / 86400000) + ' 天前';
    var dt = new Date(Number(ts));
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') +
      '-' + String(dt.getDate()).padStart(2, '0');
  }

  /* 一条评论（可带回复）的 HTML。所有用户内容都经 esc()，不拼接原始 HTML */
  function commentHtml(item) {
    var replies = (item.replies || []).map(function (r) {
      return '<div class="cs-reply">' +
        '<div class="cs-msg-head"><b>' + esc(r.name) + '</b><span>' + esc(timeAgo(r.ts)) + '</span></div>' +
        '<p class="cs-msg-text">' + esc(r.text) + '</p>' +
        '<div class="cs-msg-actions"><button type="button" class="cs-like-btn' + (r.liked ? ' is-on' : '') +
        '" data-cs-like="' + esc(r.id) + '" aria-label="赞同这条回复">♡ ' + (r.likes || 0) + '</button></div>' +
        '</div>';
    }).join('');
    return '<div class="cs-comment">' +
      '<div class="cs-msg-head"><b>' + esc(item.name) + '</b><span>' + esc(timeAgo(item.ts)) + '</span></div>' +
      '<p class="cs-msg-text">' + esc(item.text) + '</p>' +
      '<div class="cs-msg-actions">' +
        '<button type="button" class="cs-like-btn' + (item.liked ? ' is-on' : '') +
        '" data-cs-like="' + esc(item.id) + '" aria-label="赞同这条评论">♡ ' + (item.likes || 0) + '</button>' +
        '<button type="button" class="cs-reply-btn" data-cs-reply="' + esc(item.id) + '">回复</button>' +
      '</div>' +
      (replies ? '<div class="cs-replies">' + replies + '</div>' : '') +
      '</div>';
  }

  function skeleton(cid) {
    return '<section class="cp-sec cp-social" data-cs-root="' + esc(cid) + '">' +
      '<h4 class="cp-sec-title">读者互动</h4>' +
      '<div class="cs-bar">' +
        '<span class="cs-views" title="按设备 + 浏览器去重统计">👁 <b data-cs-views>—</b> 次浏览</span>' +
        '<button type="button" class="cs-like-main" data-cs-like-main>♡ <b data-cs-likes>0</b> 赞同</button>' +
      '</div>' +
      '<form class="cs-form" data-cs-form>' +
        '<div class="cs-form-row"><input type="text" name="name" maxlength="24" placeholder="昵称（可不填）" aria-label="昵称">' +
        '<button type="submit" class="cs-submit">发表评论</button></div>' +
        '<textarea name="text" maxlength="500" rows="2" placeholder="说说你的看法…（至少 2 个字）" aria-label="评论内容"></textarea>' +
      '</form>' +
      '<div class="cs-list" data-cs-list><p class="cs-empty">评论加载中…</p></div>' +
      '<p class="cs-tip" data-cs-tip>评论公开可见，请友善发言；设备标识仅用于浏览与点赞去重。</p>' +
      '</section>';
  }

  function mount(container, cid) {
    if (!container || !cid) return;
    var root = container.querySelector('[data-cs-root="' + cid + '"]');
    if (!root) return;
    if (root.getAttribute('data-cs-ready') === '1') return;

    var listEl = root.querySelector('[data-cs-list]');
    var formEl = root.querySelector('[data-cs-form]');
    var tipEl = root.querySelector('[data-cs-tip]');
    var viewEl = root.querySelector('[data-cs-views]');
    var likeEl = root.querySelector('[data-cs-likes]');
    var likeBtn = root.querySelector('[data-cs-like-main]');
    var state = null;

    function paint(data) {
      state = data;
      viewEl.textContent = String(data.views || 0);
      likeEl.textContent = String(data.likes || 0);
      likeBtn.classList.toggle('is-on', !!data.liked);
      likeBtn.innerHTML = (data.liked ? '♥' : '♡') + ' <b data-cs-likes>' + (data.likes || 0) + '</b> 赞同';
      likeEl = root.querySelector('[data-cs-likes]');
      var comments = data.comments || [];
      listEl.innerHTML = comments.length
        ? comments.map(commentHtml).join('')
        : '<p class="cs-empty">还没有评论，来抢第一条吧。</p>';
    }

    function fail(err, msg) {
      if (viewEl) viewEl.textContent = '—';
      if (listEl) listEl.innerHTML = '<p class="cs-empty">' + esc(msg || '互动数据暂不可用') + '</p>';
      if (tipEl) tipEl.textContent = '后端未连接时不会写入任何数据；稍后刷新重试。';
    }

    function act(body, successMsg) {
      var submit = formEl.querySelector('.cs-submit');
      if (submit) { submit.disabled = true; }
      apiCall(Object.assign({ c: cid }, body), function (err, data) {
        if (submit) { submit.disabled = false; }
        if (err) {
          if (tipEl) tipEl.textContent = (data && data.message) || '提交失败，请稍后再试。';
          return;
        }
        paint(data);
        if (tipEl) tipEl.textContent = successMsg || '已更新。';
      });
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-cs-like], [data-cs-like-main], [data-cs-reply]') : null;
      if (!t) return;
      ev.preventDefault();
      if (t.hasAttribute('data-cs-like-main')) {
        act({ action: state && state.liked ? 'unlike' : 'like' });
        return;
      }
      var likeId = t.getAttribute('data-cs-like');
      if (likeId) {
        /* 从当前状态判断这条评论本机是否已赞 */
        var liked = false;
        (function walk(items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].id === likeId) { liked = !!items[i].liked; return; }
            walk(items[i].replies || []);
          }
        })(state ? state.comments : []);
        act({ action: liked ? 'commentUnlike' : 'commentLike', id: likeId });
        return;
      }
      var replyId = t.getAttribute('data-cs-reply');
      if (replyId) {
        var textarea = formEl.querySelector('textarea[name="text"]');
        var existing = formEl.querySelector('[data-cs-reply-to]');
        if (existing) existing.remove();
        var input = document.createElement('input');
        input.type = 'hidden'; input.name = 'parentId'; input.value = replyId;
        input.setAttribute('data-cs-reply-to', '1');
        formEl.appendChild(input);
        if (textarea) { textarea.placeholder = '写下你的回复…'; textarea.focus(); }
        if (tipEl) tipEl.textContent = '正在回复一条评论；点「发表评论」提交回复。';
      }
    });

    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var fd = new FormData(formEl);
      var text = String(fd.get('text') || '').trim();
      if (Array.from(text).length < 2) {
        if (tipEl) tipEl.textContent = '再多写两个字吧（至少 2 个字）。';
        return;
      }
      var hidden = formEl.querySelector('[data-cs-reply-to]');
      var isReply = !!hidden;
      var body = { action: isReply ? 'reply' : 'comment', name: String(fd.get('name') || ''), text: text };
      if (isReply) body.parentId = hidden.value;
      act(body, isReply ? '回复已发表。' : '评论已发表。');
      formEl.querySelector('textarea[name="text"]').value = '';
      if (hidden) hidden.remove();
      formEl.querySelector('textarea[name="text"]').placeholder = '说说你的看法…（至少 2 个字）';
    });

    /* 首次加载：先取状态，再异步报一次浏览（两者独立，浏览失败不影响评论展示） */
    loadState(cid, function (err, data) {
      if (err) { fail(err); return; }
      paint(data);
      root.setAttribute('data-cs-ready', '1');
      apiCall({ c: cid, action: 'view' }, function (e, d) {
        if (!e && d) paint(d);
      });
    });
  }

  /* 独立页：脚本在档案渲染之后引入，直接扫全文档；抽屉：open() 后调用 */
  function mountAll() {
    var nodes = document.querySelectorAll('[data-cs-root]');
    for (var i = 0; i < nodes.length; i++) {
      mount(nodes[i].parentNode || document, nodes[i].getAttribute('data-cs-root'));
    }
  }

  window.CompanySocial = { mount: mount, mountAll: mountAll, skeleton: skeleton };

  /* 独立档案页：档案由内联脚本同步渲染，DOMContentLoaded 时统一挂载。
     抽屉场景没有静态节点，由 company-profile.js 的 open() 显式调用 mount。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
