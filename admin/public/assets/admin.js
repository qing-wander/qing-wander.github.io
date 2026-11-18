/* 后台前端：无框架，一个文件。所有写操作都带 X-Admin-Request（配合 SameSite cookie 挡 CSRF） */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    dev: { offset: 0, limit: 50, q: '', total: 0, legacy: 0 },
    msg: { offset: 0, limit: 50, q: '', status: '', device: '', total: 0 },
    tab: 'devices'
  };

  /* ── 工具 ── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    var now = Date.now();
    var diff = now - Number(ts);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var toastTimer = 0;
  function toast(msg, bad) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    if ((opts.method || 'GET') !== 'GET') headers['X-Admin-Request'] = '1';
    return fetch(path, Object.assign({}, opts, { headers: headers, credentials: 'include' }))
      .then(function (r) {
        if (r.status === 401) {
          showLogin();
          throw new Error('unauthorized');
        }
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || d.ok === false) {
            var e = new Error((d && d.message) || (d && d.error) || ('HTTP ' + r.status));
            e.status = r.status;
            throw e;
          }
          return d;
        });
      });
  }

  /* ── 登录 ── */
  function showLogin() {
    $('login').hidden = false;
    $('dash').hidden = true;
    var pw = $('password');
    if (pw) setTimeout(function () { pw.focus(); }, 30);
  }

  function showDash() {
    $('login').hidden = true;
    $('dash').hidden = false;
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('loginBtn');
    var err = $('loginError');
    err.textContent = '';
    btn.disabled = true;
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) })
      .then(function () {
        $('password').value = '';
        showDash();
        loadAll();
        toast('已登录');
      })
      .catch(function (e) {
        err.textContent = e.message === 'bad_password' ? '口令不对' :
          (e.status === 429 ? '尝试太频繁，15 分钟后再试' : (e.message || '登录失败'));
      })
      .then(function () { btn.disabled = false; });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('/api/auth/logout', { method: 'POST' }).then(function () {
      showLogin();
      toast('已退出');
    }).catch(function () { showLogin(); });
  });

  $('refreshBtn').addEventListener('click', function () {
    loadAll();
    toast('已刷新');
  });

  /* ── 概览 ── */
  function loadStats() {
    return api('/api/stats').then(function (d) {
      var s = d.stats || {};
      $('stPv').textContent = s.pv == null ? '—' : s.pv;
      $('stUv').textContent = s.uv == null ? '—' : s.uv;
      $('stUv24').textContent = s.uv24 == null ? '—' : s.uv24;
      $('stDevices').textContent = s.devices == null ? '—' : s.devices;
      $('stMessages').textContent = s.messages == null ? '—' : s.messages;
      $('stToday').textContent = s.today == null ? '—' : s.today;
      $('stHidden').textContent = s.hidden == null ? '—' : s.hidden;
      $('stBlocked').textContent = s.blocked_devices == null ? '—' : s.blocked_devices;
    });
  }

  /* ── 设备台账 ── */
  function loadDevices() {
    var q = state.dev.q ? '&q=' + encodeURIComponent(state.dev.q) : '';
    return api('/api/devices?limit=' + state.dev.limit + '&offset=' + state.dev.offset + q).then(function (d) {
      state.dev.total = d.total || 0;
      state.dev.legacy = d.legacyMessages || 0;
      var rows = d.devices || [];
      if (!rows.length) {
        $('devBody').innerHTML = '<tr><td colspan="7" class="empty">还没有设备留言</td></tr>';
      } else {
        $('devBody').innerHTML = rows.map(function (x) {
          var blocked = x.status === 'blocked';
          return '<tr>' +
            '<td class="mono" title="' + esc(x.device_hash) + '">' + esc(String(x.device_hash).slice(0, 12)) + '…</td>' +
            '<td class="mono">' + fmt(x.first_seen) + '</td>' +
            '<td class="mono">' + fmt(x.last_seen) + '</td>' +
            '<td class="mono">' + (x.messages || 0) + (x.hidden ? ' <span class="tag tag-hide">隐藏 ' + x.hidden + '</span>' : '') + '</td>' +
            '<td class="text">' + (x.last_text ? esc(String(x.last_text).slice(0, 60)) : '—') + '</td>' +
            '<td>' + (blocked ? '<span class="tag tag-block">已拉黑</span>' : '<span class="tag tag-ok">正常</span>') + '</td>' +
            '<td class="act">' +
              '<button class="btn btn-sm" data-act="view" data-hash="' + esc(x.device_hash) + '">看留言</button> ' +
              '<button class="btn btn-sm ' + (blocked ? '' : 'btn-danger') + '" data-act="block" data-hash="' + esc(x.device_hash) + '" data-blocked="' + (blocked ? '0' : '1') + '">' + (blocked ? '解封' : '拉黑') + '</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      }
      if (state.dev.legacy) {
        $('devNote').textContent = '另有 ' + state.dev.legacy + ' 条迁移前旧留言（legacy）';
      } else {
        $('devNote').textContent = '共 ' + state.dev.total + ' 台设备';
      }
      $('devPage').textContent = pageInfo(state.dev);
      $('devPrev').disabled = state.dev.offset <= 0;
      $('devNext').disabled = state.dev.offset + state.dev.limit >= state.dev.total;
    });
  }

  /* ── 留言审核 ── */
  function loadMessages() {
    var p = [];
    if (state.msg.q) p.push('q=' + encodeURIComponent(state.msg.q));
    if (state.msg.status) p.push('status=' + state.msg.status);
    if (state.msg.device) p.push('device_hash=' + encodeURIComponent(state.msg.device));
    p.push('limit=' + state.msg.limit);
    p.push('offset=' + state.msg.offset);
    return api('/api/messages?' + p.join('&')).then(function (d) {
      state.msg.total = d.total || 0;
      var rows = d.messages || [];
      if (!rows.length) {
        $('msgBody').innerHTML = '<tr><td colspan="6" class="empty">没有符合条件的留言</td></tr>';
      } else {
        $('msgBody').innerHTML = rows.map(function (m) {
          var legacy = m.device_hash === 'legacy';
          var hidden = m.status === 'hidden';
          return '<tr>' +
            '<td class="mono">' + fmt(m.created_at) + '</td>' +
            '<td class="mono" title="' + esc(m.device_hash) + '">' + (legacy ? '<span class="tag tag-legacy">legacy</span>' : esc(String(m.device_hash).slice(0, 8)) + '…') + '</td>' +
            '<td>' + esc(m.name) + '</td>' +
            '<td class="text">' + esc(m.text) + '</td>' +
            '<td>' + (hidden ? '<span class="tag tag-hide">已隐藏</span>' : '<span class="tag tag-ok">正常</span>') + '</td>' +
            '<td class="act">' +
              '<button class="btn btn-sm ' + (hidden ? '' : 'btn-danger') + '" data-act="status" data-id="' + esc(m.id) + '" data-status="' + (hidden ? 'visible' : 'hidden') + '">' + (hidden ? '恢复' : '隐藏') + '</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      }
      $('msgNote').textContent = '共 ' + state.msg.total + ' 条' + (state.msg.device ? ' · 设备 ' + state.msg.device.slice(0, 8) + '…' : '');
      $('msgClearDevice').hidden = !state.msg.device;
      $('msgPage').textContent = pageInfo(state.msg);
      $('msgPrev').disabled = state.msg.offset <= 0;
      $('msgNext').disabled = state.msg.offset + state.msg.limit >= state.msg.total;
    });
  }

  function pageInfo(s) {
    if (!s.total) return '0 / 0';
    var from = s.offset + 1;
    var to = Math.min(s.offset + s.limit, s.total);
    return from + '–' + to + ' / ' + s.total;
  }

  /* ── 操作（事件委托） ── */
  $('devBody').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var hash = b.getAttribute('data-hash');
    if (b.getAttribute('data-act') === 'view') {
      state.msg.device = hash;
      state.msg.offset = 0;
      switchTab('messages');
      return;
    }
    var blocked = b.getAttribute('data-blocked') === '1';
    b.disabled = true;
    api('/api/devices/block', { method: 'POST', body: JSON.stringify({ device_hash: hash, blocked: blocked }) })
      .then(function () {
        toast(blocked ? '已拉黑这台设备' : '已解封');
        loadDevices(); loadStats();
      })
      .catch(function (err) { toast(err.message || '操作失败', true); b.disabled = false; });
  });

  $('msgBody').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act="status"]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var status = b.getAttribute('data-status');
    b.disabled = true;
    api('/api/messages/status', { method: 'POST', body: JSON.stringify({ id: id, status: status }) })
      .then(function () {
        toast(status === 'hidden' ? '已隐藏，公开端看不到' : '已恢复公开');
        loadMessages(); loadStats();
      })
      .catch(function (err) { toast(err.message || '操作失败', true); b.disabled = false; });
  });

  /* ── 标签页 / 筛选 / 分页 ── */
  function switchTab(name) {
    state.tab = name;
    var dev = name === 'devices';
    $('tabDevices').classList.toggle('is-on', dev);
    $('tabMessages').classList.toggle('is-on', !dev);
    $('tabDevices').setAttribute('aria-selected', dev ? 'true' : 'false');
    $('tabMessages').setAttribute('aria-selected', dev ? 'false' : 'true');
    $('panelDevices').hidden = !dev;
    $('panelMessages').hidden = dev;
    if (dev) loadDevices(); else loadMessages();
  }
  $('tabDevices').addEventListener('click', function () { switchTab('devices'); });
  $('tabMessages').addEventListener('click', function () { switchTab('messages'); });

  $('devSearchBtn').addEventListener('click', function () {
    state.dev.q = $('devSearch').value.trim();
    state.dev.offset = 0;
    loadDevices();
  });
  $('devSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('devSearchBtn').click(); });

  $('msgSearchBtn').addEventListener('click', function () {
    state.msg.q = $('msgSearch').value.trim();
    state.msg.status = $('msgStatus').value;
    state.msg.offset = 0;
    loadMessages();
  });
  $('msgSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('msgSearchBtn').click(); });
  $('msgStatus').addEventListener('change', function () { $('msgSearchBtn').click(); });
  $('msgClearDevice').addEventListener('click', function () {
    state.msg.device = '';
    state.msg.offset = 0;
    loadMessages();
  });

  $('devPrev').addEventListener('click', function () {
    state.dev.offset = Math.max(0, state.dev.offset - state.dev.limit); loadDevices();
  });
  $('devNext').addEventListener('click', function () {
    state.dev.offset += state.dev.limit; loadDevices();
  });
  $('msgPrev').addEventListener('click', function () {
    state.msg.offset = Math.max(0, state.msg.offset - state.msg.limit); loadMessages();
  });
  $('msgNext').addEventListener('click', function () {
    state.msg.offset += state.msg.limit; loadMessages();
  });

  $('exportBtn').addEventListener('click', function () {
    location.href = '/api/export';
  });

  function loadAll() {
    loadStats();
    if (state.tab === 'devices') loadDevices(); else loadMessages();
  }

  /* ── 启动 ── */
  api('/api/auth/me').then(function (d) {
    if (d.authed) { showDash(); loadAll(); } else { showLogin(); }
  }).catch(function () { showLogin(); });
})();
