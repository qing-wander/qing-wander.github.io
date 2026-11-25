/* 后台前端：无框架，一个文件。所有写操作都带 X-Admin-Request（配合 SameSite cookie 挡 CSRF） */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    dev: { offset: 0, limit: 50, q: '', total: 0, legacy: 0 },
    msg: { offset: 0, limit: 50, q: '', status: '', device: '', total: 0,
           /* focus 来自邮件直达链接；open 是当前展开回复面板的留言 id；
              replies 缓存列表接口返回的对话，展开面板时不必再请求一次。 */
           focus: '', open: null, replies: {} },
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
  /* 给其它面板模块（如 anim-console.js）复用同一条提示条 */
  window.__adminToast = toast;

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    if ((opts.method || 'GET') !== 'GET') headers['X-Admin-Request'] = '1';
    return fetch(path, Object.assign({}, opts, { headers: headers, credentials: 'include' }))
      .then(function (r) {
        if (r.status === 401) {
          toLogin();
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

  /* ── 登录 ──
     登录页独立在 /login，本页由服务端中间件守卫：没会话直接 302 过去。
     这里只保留兜底——接口返回 401（会话过期 / 被清 cookie）时再跳一次。 */
  function toLogin() {
    var next = location.pathname + location.search;
    location.replace('/login?next=' + encodeURIComponent(next));
  }

  $('logoutBtn').addEventListener('click', function () {
    api('/api/admin/auth/logout', { method: 'POST' }).then(function () {
      location.replace('/login?logout=1');
    }).catch(function () { location.replace('/login'); });
  });

  $('refreshBtn').addEventListener('click', function () {
    loadAll();
    toast('已刷新');
  });

  /* ── 概览 ── */
  function loadStats() {
    return api('/api/admin/stats').then(function (d) {
      var s = d.stats || {};
      $('stPv').textContent = s.pv == null ? '—' : s.pv;
      $('stUv').textContent = s.uv == null ? '—' : s.uv;
      $('stUv24').textContent = s.uv24 == null ? '—' : s.uv24;
      $('stDevices').textContent = s.devices == null ? '—' : s.devices;
      $('stMessages').textContent = s.messages == null ? '—' : s.messages;
      $('stToday').textContent = s.today == null ? '—' : s.today;
      $('stHidden').textContent = s.hidden == null ? '—' : s.hidden;
      $('stPending').textContent = s.pending_replies == null ? '—' : s.pending_replies;
      $('stBlocked').textContent = s.blocked_devices == null ? '—' : s.blocked_devices;
    });
  }

  /* ── 设备台账 ── */
  function loadDevices() {
    var q = state.dev.q ? '&q=' + encodeURIComponent(state.dev.q) : '';
    return api('/api/admin/devices?limit=' + state.dev.limit + '&offset=' + state.dev.offset + q).then(function (d) {
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

  /* ── 留言审核 + 回复 / 评论对话 ── */
  /* 回复面板：插在该留言行的下一行，内容来自列表接口已返回的 replies，
     不额外发请求。站长回复写 author='owner'，访客追问是 author='visitor'。 */
  function replyPanelHtml(messageId) {
    var reps = state.msg.replies[messageId] || [];
    var items = reps.length ? reps.map(function (r) {
      var owner = r.author === 'owner';
      var hidden = r.status === 'hidden';
      return '<div class="rp-item' + (owner ? ' is-owner' : '') + (hidden ? ' is-hidden' : '') + '">' +
        '<div class="rp-head">' +
          '<span class="rp-who">' + (owner ? '我 · 回复' : '访客 · 追问') + '</span>' +
          '<span class="rp-time">' + fmt(r.created_at) + '</span>' +
          (hidden ? '<span class="tag tag-hide">已隐藏</span>' : '') +
          '<button class="btn btn-sm btn-danger rp-del" type="button" data-act="reply-del" data-id="' + esc(r.id) + '" data-msg="' + esc(messageId) + '">删除</button>' +
        '</div>' +
        '<div class="rp-text">' + esc(r.text) + '</div>' +
      '</div>';
    }).join('') : '<p class="rp-empty">还没有对话。写下第一条回复，它会直接贴到访客那台设备的这条留言下面。</p>';

    return '<div class="reply-panel">' +
      '<div class="rp-title">对话 · ' + reps.length + ' 条</div>' +
      '<div class="rp-list">' + items + '</div>' +
      '<div class="rp-compose">' +
        '<textarea class="rp-input" data-role="owner-reply-input" data-msg="' + esc(messageId) +
          '" rows="3" maxlength="300" placeholder="写回复…（访客回到同一设备刷新即可看到）"></textarea>' +
        '<div class="rp-foot">' +
          '<span class="toolbar-note">⌘ / Ctrl + Enter 快速发送 · 回复只对该设备可见</span>' +
          '<button class="btn btn-sm rp-send" type="button" data-act="reply-send" data-msg="' + esc(messageId) + '">发送回复 ▶</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function openReplyPanel(messageId) {
    var body = $('msgBody');
    var old = body.querySelector('tr.reply-row');
    if (old) old.parentNode.removeChild(old);
    if (!messageId) return;
    var row = null;
    body.querySelectorAll('tr[data-msg-id]').forEach(function (tr) {
      if (tr.getAttribute('data-msg-id') === messageId) row = tr;
    });
    if (!row) return;
    var tr = document.createElement('tr');
    tr.className = 'reply-row';
    tr.setAttribute('data-reply-for', messageId);
    var td = document.createElement('td');
    td.colSpan = 7;
    td.innerHTML = replyPanelHtml(messageId);
    tr.appendChild(td);
    row.parentNode.insertBefore(tr, row.nextSibling);
    var input = td.querySelector('[data-role="owner-reply-input"]');
    if (input) input.focus();
  }

  function loadMessages() {
    var p = [];
    if (state.msg.q) p.push('q=' + encodeURIComponent(state.msg.q));
    if (state.msg.status) p.push('status=' + encodeURIComponent(state.msg.status));
    if (state.msg.device) p.push('device_hash=' + encodeURIComponent(state.msg.device));
    if (state.msg.focus) p.push('focus=' + encodeURIComponent(state.msg.focus));
    p.push('limit=' + state.msg.limit);
    p.push('offset=' + state.msg.offset);
    return api('/api/admin/messages?' + p.join('&')).then(function (d) {
      state.msg.total = d.total || 0;
      var rows = d.messages || [];
      state.msg.replies = {};
      rows.forEach(function (m) { state.msg.replies[m.id] = m.replies || []; });
      if (!rows.length) {
        $('msgBody').innerHTML = '<tr><td colspan="7" class="empty">没有符合条件的留言</td></tr>';
      } else {
        $('msgBody').innerHTML = rows.map(function (m) {
          var legacy = m.device_hash === 'legacy';
          var hidden = m.status === 'hidden';
          var n = Number(m.reply_count || 0);
          var talk = n
            ? '<span class="tag ' + (m.owner_replied ? 'tag-ok' : 'tag-hide') + '">' + n + ' 条 · ' + (m.owner_replied ? '已回' : '待回') + '</span>'
            : '<span class="tag tag-legacy">无</span>';
          return '<tr data-msg-id="' + esc(m.id) + '">' +
            '<td class="mono">' + fmt(m.created_at) + '</td>' +
            '<td class="mono" title="' + esc(m.device_hash) + '">' + (legacy ? '<span class="tag tag-legacy">legacy</span>' : esc(String(m.device_hash).slice(0, 8)) + '…') + '</td>' +
            '<td>' + esc(m.name) + '</td>' +
            '<td class="text">' + esc(m.text) + '</td>' +
            '<td>' + (hidden ? '<span class="tag tag-hide">已隐藏</span>' : '<span class="tag tag-ok">正常</span>') + '</td>' +
            '<td>' + talk + '</td>' +
            '<td class="act">' +
              '<button class="btn btn-sm" type="button" data-act="reply" data-id="' + esc(m.id) + '">回复</button> ' +
              '<button class="btn btn-sm ' + (hidden ? '' : 'btn-danger') + '" type="button" data-act="status" data-id="' + esc(m.id) + '" data-status="' + (hidden ? 'visible' : 'hidden') + '">' + (hidden ? '恢复' : '隐藏') + '</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      }
      $('msgNote').textContent = '共 ' + state.msg.total + ' 条' +
        (state.msg.device ? ' · 设备 ' + state.msg.device.slice(0, 8) + '…' : '') +
        (state.msg.focus ? ' · 已定位单条留言（点「筛选」回到列表）' : '');
      $('msgClearDevice').hidden = !state.msg.device;
      $('msgPage').textContent = pageInfo(state.msg);
      $('msgPrev').disabled = state.msg.offset <= 0;
      $('msgNext').disabled = state.msg.offset + state.msg.limit >= state.msg.total;
      if (state.msg.open) openReplyPanel(state.msg.open);
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
      state.msg.focus = '';
      state.msg.open = null;
      switchTab('messages');
      return;
    }
    var blocked = b.getAttribute('data-blocked') === '1';
    b.disabled = true;
    api('/api/admin/devices/block', { method: 'POST', body: JSON.stringify({ device_hash: hash, blocked: blocked }) })
      .then(function () {
        toast(blocked ? '已拉黑这台设备' : '已解封');
        loadDevices(); loadStats();
      })
      .catch(function (err) { toast(err.message || '操作失败', true); b.disabled = false; });
  });

  $('msgBody').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');

    if (act === 'status') {
      var id = b.getAttribute('data-id');
      var status = b.getAttribute('data-status');
      b.disabled = true;
      api('/api/admin/messages/status', { method: 'POST', body: JSON.stringify({ id: id, status: status }) })
        .then(function () {
          toast(status === 'hidden' ? '已隐藏，公开端看不到' : '已恢复公开');
          loadMessages(); loadStats();
        })
        .catch(function (err) { toast(err.message || '操作失败', true); b.disabled = false; });
      return;
    }

    if (act === 'reply') {
      var mid = b.getAttribute('data-id');
      state.msg.open = (state.msg.open === mid) ? null : mid;
      openReplyPanel(state.msg.open);
      return;
    }

    if (act === 'reply-send') {
      var msgId = b.getAttribute('data-msg');
      var input = null;
      $('msgBody').querySelectorAll('[data-role="owner-reply-input"]').forEach(function (el) {
        if (el.getAttribute('data-msg') === msgId) input = el;
      });
      if (!input) return;
      var text = String(input.value || '').trim();
      if (Array.from(text).length < 2) { toast('再多写两个字吧（至少 2 个字）', true); input.focus(); return; }
      b.disabled = true;
      b.textContent = '发送中…';
      api('/api/admin/messages/reply', { method: 'POST', body: JSON.stringify({ messageId: msgId, text: text }) })
        .then(function (d) {
          state.msg.replies[msgId] = d.replies || [];
          state.msg.open = msgId;
          toast('已回复，访客回到本设备刷新即可看到');
          return loadMessages().then(function () { openReplyPanel(msgId); loadStats(); });
        })
        .catch(function (err) {
          toast(err.message || '回复失败', true);
          b.disabled = false; b.textContent = '发送回复 ▶';
        });
      return;
    }

    if (act === 'reply-del') {
      var rid = b.getAttribute('data-id');
      var forMsg = b.getAttribute('data-msg');
      b.disabled = true;
      api('/api/admin/messages/reply', { method: 'DELETE', body: JSON.stringify({ id: rid }) })
        .then(function () {
          toast('已删除这条回复');
          state.msg.open = forMsg;
          return loadMessages().then(function () { openReplyPanel(forMsg); loadStats(); });
        })
        .catch(function (err) { toast(err.message || '删除失败', true); b.disabled = false; });
    }
  });

  /* 回复框 ⌘ / Ctrl + Enter 快速发送 */
  $('msgBody').addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    if (!e.target || e.target.getAttribute('data-role') !== 'owner-reply-input') return;
    e.preventDefault();
    var msgId = e.target.getAttribute('data-msg');
    var btn = $('msgBody').querySelector('[data-act="reply-send"][data-msg="' + msgId + '"]');
    if (btn) btn.click();
  });

  /* ── 标签页 / 筛选 / 分页 ── */
  /* ── 问答埋点看板 ── */
  function loadQa() {
    return api('/api/admin/qa').then(function (d) {
      var t = d.totals || {};
      $('qaTotal').textContent = t.total == null ? '—' : t.total;
      $('qaLast7').textContent = t.last7 == null ? '—' : t.last7;
      $('qaEmpty').textContent = t.empty == null ? '—' : t.empty;
      $('qaEmptyRate').textContent = (t.empty_rate == null ? '—' : t.empty_rate + '%');
      $('qaMs').textContent = t.ms_avg == null ? '—' : t.ms_avg;

      var qs = d.top_questions || [];
      $('qaTopQuestions').innerHTML = qs.length ? qs.map(function (r) {
        return '<li><span class="qa-q">' + esc(r.q) + '</span><span class="qa-n">' + r.n + ' 次</span></li>';
      }).join('') : '<li class="empty">还没有问答记录</li>';

      var hits = d.top_hits || [];
      $('qaTopHits').innerHTML = hits.length ? hits.map(function (r) {
        return '<li><span class="qa-q mono">' + esc(r.id) + '</span><span class="qa-n">' + r.n + ' 次</span></li>';
      }).join('') : '<li class="empty">还没有命中记录</li>';

      api('/api/admin/qa/trend?days=14').then(function (d2) {
        var series = (d2 && d2.series) || [];
        var max = Math.max.apply(null, series.map(function (x) { return x.total; }).concat([1]));
        $('qaTrend').innerHTML = series.length ? series.map(function (x) {
          var hTotal = Math.round((x.total / max) * 100);
          var hEmpty = x.total ? Math.round((x.empty / max) * 100) : 0;
          return '<div class="qa-trend-col" title="' + esc(x.date) + '：' + x.total + ' 次，空召回 ' + x.empty + '">' +
            '<div class="qa-trend-stack">' +
              '<div class="qa-trend-bar" style="height:' + Math.max(hTotal - hEmpty, 0) + '"></div>' +
              '<div class="qa-trend-empty" style="height:' + hEmpty + '"></div>' +
            '</div>' +
            '<span class="qa-trend-x">' + esc(x.label) + '</span>' +
            '<span class="qa-trend-n">' + (x.total || '') + '</span>' +
            '</div>';
        }).join('') : '<span class="empty">还没有数据</span>';
      }).catch(function () { $('qaTrend').innerHTML = '<span class="empty">趋势接口不可用</span>'; });

      api('/api/admin/qa/topics?limit=200').then(function (t) {
        var topics = (t && t.topics) || [];
        $('qaTopics').innerHTML = topics.length ? topics.map(function (x) {
          var badge = x.empty_rate >= 50 && x.count >= 2
            ? '<span class="pill bad">空召回 ' + x.empty_rate + '%</span>'
            : '<span class="pill">' + x.count + ' 次</span>';
          return '<li><span class="qa-q" title="' + esc((x.examples || []).join(' / ')) + '">' + esc(x.topic) + '</span>' + badge + '</li>';
        }).join('') : '<li class="empty">还没有足够的问题可聚类</li>';

        var sug = (t && t.suggest) || [];
        var box = $('qaSuggest');
        if (sug.length) {
          box.hidden = false;
          box.innerHTML = '<strong>建议补切片：</strong>' + sug.map(function (x) {
            return esc(x.topic) + '（' + x.count + ' 次，空召回 ' + x.empty_rate + '%）';
          }).join(' · ');
        } else {
          box.hidden = true;
        }
      }).catch(function () { $('qaTopics').innerHTML = '<li class="empty">聚类接口不可用</li>'; });

      var rows = d.recent || [];
      $('qaRecent').innerHTML = rows.length ? rows.map(function (r) {
        return '<tr>' +
          '<td class="mono">' + fmt(r.ts) + '</td>' +
          '<td>' + esc(r.query) + '</td>' +
          '<td class="mono">' + (r.hit_count || 0) + '</td>' +
          '<td class="mono">' + (r.ms == null ? '—' : r.ms) + '</td>' +
          '<td>' + (r.empty ? '<span class="pill bad">空召回</span>' : '<span class="pill">已作答</span>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="5" class="empty">还没有问答记录</td></tr>';
    });
  }

  /* ── 模型与提示词配置 ── */
  function loadConfig() {
    return api('/api/admin/config').then(function (d) {
      var mods = d.modules || [];
      $('cfgList').innerHTML = mods.map(function (m) {
        return '<article class="cfg-card" data-key="' + esc(m.key) + '">' +
          '<div class="cfg-head"><h2>' + esc(m.title) + '</h2>' +
          (m.is_default ? '<span class="pill">默认配置</span>' : '<span class="pill ok">已自定义</span>') + '</div>' +
          '<p class="cfg-note">' + esc(m.note) + '<span class="mono"> · key=' + esc(m.key) + '</span></p>' +
          '<label class="cfg-label">模型 ID<input class="cfg-input mono" data-field="model" value="' + esc(m.model) + '"></label>' +
          '<label class="cfg-label">提示词<textarea class="cfg-textarea" data-field="prompt" rows="4">' + esc(m.prompt) + '</textarea></label>' +
          '<div class="cfg-actions"><span class="toolbar-note" data-role="meta">' + (m.updated_at ? '更新于 ' + fmt(m.updated_at) : '尚未保存过') + '</span>' +
          '<button class="btn" type="button" data-act="save-config">保存</button></div>' +
          '</article>';
      }).join('') || '<p class="empty">没有可配置模块</p>';
    });
  }

  $('cfgList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act="save-config"]');
    if (!b) return;
    var card = b.closest('.cfg-card');
    var key = card.getAttribute('data-key');
    var model = card.querySelector('[data-field="model"]').value.trim();
    var prompt = card.querySelector('[data-field="prompt"]').value.trim();
    b.disabled = true;
    api('/api/admin/config', { method: 'POST', body: JSON.stringify({ key: key, model: model, prompt: prompt }) })
      .then(function () {
        toast('已保存：' + key);
        card.querySelector('[data-role="meta"]').textContent = '刚保存';
      })
      .catch(function (err) { toast(err.message || '保存失败', true); })
      .then(function () { b.disabled = false; });
  });

  /* ── 站点默认主题（每日自动轮换已暂停，留空 = 默认橙色 ARCHIVE）── */
  function loadTheme() {
    return api('/api/admin/theme').then(function (d) {
      var cur = d.theme || '';
      $('themeCur').textContent = cur ? cur : '默认橙色（ARCHIVE）';
      var list = d.themes || [];
      $('themeChips').innerHTML = list.map(function (t) {
        var on = t.id === cur ? ' is-on' : '';
        return '<button class="theme-chip' + on + '" type="button" data-theme-id="' + esc(t.id) + '">' +
          '<strong>' + esc(t.name) + '</strong><small>' + esc(t.note) + '</small></button>';
      }).join('') + '<button class="theme-chip' + (cur ? '' : ' is-on') + '" type="button" data-theme-id="">' +
        '<strong>默认橙色</strong><small>固定 ARCHIVE，不自动轮换</small></button>';
    });
  }

  $('themeChips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-theme-id]');
    if (!b) return;
    var theme = b.getAttribute('data-theme-id');
    api('/api/admin/theme', { method: 'POST', body: JSON.stringify({ theme: theme }) })
      .then(function () {
        toast(theme ? '已切到：' + theme : '已恢复默认橙色（ARCHIVE）');
        loadTheme();
      })
      .catch(function (err) { toast(err.message || '设置失败', true); });
  });

  $('configReload').addEventListener('click', function () { loadConfig(); loadTheme(); toast('已重新读取'); });

  /* ── 站点数据：云端真相源（仓库 JSON 只是脱敏占位副本）─────────
     GET /api/admin/site-content 列表 / ?key= 正文；POST 保存；DELETE 恢复默认。
     大文件（company-profiles 100KB+）只在选中时才拉，列表接口不传正文。 */
  var CONTENT = { items: [], cur: '', dirty: false };
  var CONTENT_LABEL = {
    'site-data': '首页 / 全站文案',
    'company-profiles': '公司档案',
    'school-profiles': '学校档案',
    people: '页脚推荐的人',
    contributions: 'GitHub 贡献',
    'work-details': '作品案例',
    'asset-manifest': '资源 CDN 映射'
  };

  function contentStat(text, kind) {
    var el = $('contentStat');
    el.textContent = text;
    el.className = 'pill' + (kind ? ' ' + kind : '');
  }

  function renderContentChips() {
    var box = $('contentChips');
    if (!CONTENT.items.length) { box.innerHTML = '<span class="empty">没有数据项</span>'; return; }
    box.innerHTML = CONTENT.items.map(function (it) {
      var on = it.key === CONTENT.cur;
      var name = CONTENT_LABEL[it.key] || it.key;
      var size = it.configured ? (it.size > 1024 ? Math.round(it.size / 1024) + 'KB' : it.size + 'B') : '默认';
      return '<button type="button" class="voice-chip' + (on ? ' is-on' : '') + '" data-key="' + esc(it.key) + '">' +
        esc(name) + ' <small>' + esc(size) + '</small></button>';
    }).join('');
  }

  function loadContentList(keepCur) {
    return api('/api/admin/site-content').then(function (d) {
      CONTENT.items = d.keys || [];
      var cur = keepCur || CONTENT.cur;
      if (!cur && CONTENT.items.length) cur = CONTENT.items[0].key;
      CONTENT.cur = cur;
      renderContentChips();
      var n = CONTENT.items.filter(function (x) { return x.configured; }).length;
      contentStat(n + '/' + CONTENT.items.length + ' 已配置');
      return loadContentOne(cur);
    }).catch(function (err) {
      $('contentChips').innerHTML = '<span class="empty">' + esc(err.message || '读取失败') + '</span>';
    });
  }

  function loadContentOne(key) {
    if (!key) return Promise.resolve();
    CONTENT.cur = key;
    CONTENT.dirty = false;
    renderContentChips();
    $('contentLabel').firstChild.nodeValue = (CONTENT_LABEL[key] || key) + ' ';
    $('contentText').disabled = true;
    $('contentText').value = '加载中…';
    $('contentMeta').textContent = '读取中';
    $('contentReset').disabled = true;
    $('contentSave').disabled = true;
    return api('/api/admin/site-content?key=' + encodeURIComponent(key)).then(function (d) {
      $('contentText').value = d.text || '';
      $('contentText').disabled = false;
      $('contentSave').disabled = false;
      $('contentReset').disabled = !d.configured;
      $('contentMeta').textContent = d.configured
        ? '已配置 · ' + fmt(d.updated_at) + ' · ' + (d.text || '').length + ' 字符'
        : '未配置 · 使用仓库脱敏副本';
      CONTENT.dirty = false;
    }).catch(function (err) {
      $('contentText').value = '';
      $('contentMeta').textContent = err.message || '读取失败';
    });
  }

  function saveContent() {
    var key = CONTENT.cur;
    if (!key) return;
    var text = $('contentText').value;
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { toast('不是合法 JSON：' + e.message, true); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast('顶层必须是 JSON 对象', true); return;
    }
    $('contentSave').disabled = true;
    api('/api/admin/site-content', {
      method: 'POST',
      body: JSON.stringify({ key: key, text: text })
    }).then(function () {
      toast(key === 'site-data'
        ? '已保存，知识库在后台自动重建'
        : '已保存：' + (CONTENT_LABEL[key] || key));
      return loadContentList(key);
    }).catch(function (err) { toast(err.message || '保存失败', true); })
      .then(function () { $('contentSave').disabled = false; });
  }

  function resetContent() {
    var key = CONTENT.cur;
    if (!key) return;
    if (!window.confirm('恢复默认会删除云端这份数据，访客端回退到仓库脱敏副本。确定？')) return;
    $('contentReset').disabled = true;
    api('/api/admin/site-content?key=' + encodeURIComponent(key), { method: 'DELETE' })
      .then(function () {
        toast('已恢复默认');
        return loadContentList(key);
      })
      .catch(function (err) { toast(err.message || '恢复失败', true); })
      .then(function () { $('contentReset').disabled = false; });
  }

  $('contentChips').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-key]') : null;
    if (!btn) return;
    if (CONTENT.dirty && !window.confirm('当前内容未保存，确定切换？')) return;
    loadContentOne(btn.getAttribute('data-key'));
  });
  $('contentText').addEventListener('input', function () { CONTENT.dirty = true; });
  $('contentSave').addEventListener('click', saveContent);
  $('contentReset').addEventListener('click', resetContent);
  $('contentReload').addEventListener('click', function () {
    loadContentList().then(function () { toast('已重新读取'); });
  });

  /* ── 知识库：状态 + 手动重建 ──────────────────────────────────
     切片与向量由 worker/kb 的 /rebuild 在云端生成（AI/Vectorize 绑定在那里）。
     保存 site-data 后服务端会自动触发一次；这里给一个可见的手动入口。 */
  function loadKb() {
    var stat = $('kbStat');
    if (!stat) return;
    stat.textContent = '读取中…';
    return api('/api/admin/kb').then(function (d) {
      stat.textContent = d.count ? (d.kb_version || '已建立') : '未建';
      stat.className = 'pill' + (d.stale ? ' warn' : '');
      var bits = [d.count + ' 片', d.terms + ' 词', '更新于 ' + fmt(d.updated_at)];
      if (d.stale) bits.push('已落后于站点数据，建议重建');
      if (!d.worker_ready) bits.push('未配置 KB_WORKER_URL');
      $('kbMeta').textContent = d.count ? bits.join(' · ') : '知识库还没建，点右侧「重建知识库」';
    }).catch(function (err) {
      stat.textContent = '不可用';
      $('kbMeta').textContent = err.message || '读取失败';
    });
  }

  function rebuildKb() {
    var btn = $('kbRebuild');
    btn.disabled = true;
    $('kbMeta').textContent = '正在重建（约 5–20 秒）…';
    api('/api/admin/kb', { method: 'POST' })
      .then(function (d) {
        toast('已重建：' + d.count + ' 片 · ' + d.kb_version);
        return loadKb();
      })
      .catch(function (err) {
        $('kbMeta').textContent = err.message || '重建失败';
        toast(err.message || '重建失败', true);
      })
      .then(function () { btn.disabled = false; });
  }

  $('kbReload').addEventListener('click', function () { loadKb(); });
  $('kbRebuild').addEventListener('click', rebuildKb);
  $('tabContent').addEventListener('click', function () { setTimeout(loadKb, 0); });

  /* ── AI 语音：音色切换 + 招呼文案 + 试听 ────────────────────────
     音色写 /api/admin/voice（D1 admin_config.ai_voice），公开站 /api/voice 读；
     招呼文案写 /api/admin/greeting（D1 admin_config.ai_greeting），公开站
     /api/greeting 读，首页面板欢迎语 + 语音招呼语都吃这一份；
     试听走 /api/admin/voice/preview —— 同源代理到云函数，不落库、不改设置。 */
  var VOICE = {
    list: [], gender: 'female', maxChars: 150, name: '',
    defaults: { female: 101001, male: 101013 },
    cur: { female: 101001, male: 101013 },
    isDefault: { female: true, male: true }
  };
  var voiceAudio = null;
  var voiceBusy = false;
  /* 试听框是否已被站长手动改过：改过就不再被招呼文案覆盖，便于临时试别的句子 */
  var voiceTextDirty = false;
  $('voiceText').addEventListener('input', function () { voiceTextDirty = true; });

  function voiceStat(text, kind) {
    var el = $('voiceStat');
    el.textContent = text;
    el.className = 'pill' + (kind ? ' ' + kind : '');
  }

  function stopVoice() {
    if (voiceAudio) {
      try { voiceAudio.pause(); } catch (e) {}
      try { voiceAudio.src = ''; } catch (e) {}
      voiceAudio = null;
    }
    $('voiceStop').disabled = true;
  }

  function voiceName(id) {
    var hit = VOICE.list.filter(function (v) { return v.id === id; })[0];
    return hit ? hit.name : String(id);
  }

  function renderVoice() {
    var g = VOICE.gender;
    var cur = VOICE.cur[g];
    var isDefault = !!VOICE.isDefault[g];
    $('voiceCur').textContent = (g === 'female' ? '女版 · ' : '男版 · ') +
      (isDefault ? '默认 · ' : '') + voiceName(cur);
    var chips = $('voiceGender').querySelectorAll('button[data-gender]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', chips[i].getAttribute('data-gender') === g);
    }
    var list = VOICE.list.filter(function (v) { return v.gender === g; });
    var html = list.map(function (v) {
      var on = (!isDefault && v.id === cur) ? ' is-on' : '';
      return '<div class="voice-chip' + on + '">' +
        '<button class="voice-pick" type="button" data-act="pick" data-voice="' + v.id + '">' +
          '<strong>' + esc(v.name) + '</strong>' +
          '<small>' + esc(v.note) + '</small>' +
          '<em>' + esc(v.type) + ' · ' + v.id + '</em>' +
        '</button>' +
        '<button class="voice-try" type="button" data-act="try" data-voice="' + v.id + '">试听</button>' +
      '</div>';
    }).join('');
    html += '<div class="voice-chip' + (isDefault ? ' is-on' : '') + '">' +
      '<button class="voice-pick" type="button" data-act="pick" data-voice="0">' +
        '<strong>恢复默认</strong><small>用服务端默认音色</small><em>DEFAULT</em>' +
      '</button></div>';
    $('voiceChips').innerHTML = html;
  }

  function loadVoice() {
    return api('/api/admin/voice').then(function (d) {
      VOICE.list = d.voices || [];
      VOICE.defaults.female = d.default_female_voice || 101001;
      VOICE.defaults.male = d.default_male_voice || 101013;
      VOICE.cur.female = d.female_voice || VOICE.defaults.female;
      VOICE.cur.male = d.male_voice || VOICE.defaults.male;
      VOICE.isDefault.female = !!d.female_is_default;
      VOICE.isDefault.male = !!d.male_is_default;
      VOICE.name = d.name || '';
      VOICE.maxChars = d.max_chars || 150;
      $('voiceUpstream').textContent = d.upstream || '—';
      $('voiceMeta').textContent = '女版：' + voiceName(VOICE.cur.female) +
        ' · 男版：' + voiceName(VOICE.cur.male);
      renderVoice();
    }).catch(function (err) {
      $('voiceChips').innerHTML = '<span class="empty">' + esc(err.message || '读取失败') + '</span>';
    });
  }

  /* ── 招呼文案：一处改，首页面板欢迎语 / 语音招呼语 / 试听框同步 ── */
  function syncVoiceText(text) {
    if (voiceTextDirty) return;   /* 站长手动改过试听框就别覆盖 */
    $('voiceText').value = text || '';
  }

  function loadGreeting() {
    return api('/api/admin/greeting').then(function (d) {
      $('greetingText').value = d.text || '';
      $('greetingText').maxLength = d.max_chars || 150;
      $('greetingMeta').textContent = d.is_default ? '默认文案' : '已自定义';
      $('greetingMeta').className = 'pill' + (d.is_default ? '' : ' ok');
      syncVoiceText(d.text);
    }).catch(function (err) {
      $('greetingMeta').textContent = '读取失败';
      $('greetingMeta').className = 'pill bad';
      toast(err.message || '招呼文案读取失败', true);
    });
  }

  function saveGreeting(reset) {
    var btn = reset ? $('greetingReset') : $('greetingSave');
    var body = reset ? { reset: true } : { text: $('greetingText').value.trim() };
    if (!reset && !body.text) { toast('先写点文案', true); return; }
    btn.disabled = true;
    return api('/api/admin/greeting', { method: 'POST', body: JSON.stringify(body) })
      .then(function (d) {
        $('greetingText').value = d.text || '';
        $('greetingMeta').textContent = d.is_default ? '默认文案' : '已自定义';
        $('greetingMeta').className = 'pill' + (d.is_default ? '' : ' ok');
        voiceTextDirty = false;
        syncVoiceText(d.text);
        toast(reset ? '已恢复默认文案' : '已保存，访客刷新即生效');
      })
      .catch(function (err) { toast(err.message || '保存失败', true); })
      .then(function () { btn.disabled = false; });
  }

  $('greetingSave').addEventListener('click', function () { saveGreeting(false); });
  $('greetingReset').addEventListener('click', function () { saveGreeting(true); });

  function previewVoice(id) {
    if (voiceBusy) return;
    var text = String($('voiceText').value || '').trim().slice(0, VOICE.maxChars);
    if (!text) { toast('先写点试听文本', true); return; }
    voiceBusy = true;
    stopVoice();
    voiceStat('合成中…');
    $('voicePlay').disabled = true;
    var label = voiceName(id);
    api('/api/admin/voice/preview', { method: 'POST', body: JSON.stringify({ voice: id, text: text }) })
      .then(function (d) {
        voiceAudio = new Audio('data:' + (d.mime || 'audio/mpeg') + ';base64,' + d.audio);
        voiceAudio.onended = function () { voiceStat('播放结束', 'ok'); $('voiceStop').disabled = true; };
        voiceAudio.onerror = function () { voiceStat('播放失败', 'bad'); $('voiceStop').disabled = true; };
        $('voiceStop').disabled = false;
        voiceStat('播放中 · ' + (d.name || label), 'ok');
        $('voiceMeta').textContent = label + ' · ' + text.length + ' 字 · 仅试听，未改线上设置';
        return voiceAudio.play();
      })
      .catch(function (err) {
        voiceStat('试听失败', 'bad');
        $('voiceMeta').textContent = err.message || '合成失败';
        toast(err.message || '试听失败', true);
      })
      .then(function () { voiceBusy = false; $('voicePlay').disabled = false; });
  }

  $('voiceChips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = Number(b.getAttribute('data-voice'));
    if (b.getAttribute('data-act') === 'try') { previewVoice(id); return; }
    var g = VOICE.gender;
    api('/api/admin/voice', { method: 'POST', body: JSON.stringify({ voice: id, gender: g }) })
      .then(function (d) {
        VOICE.cur[g] = d.voice;
        VOICE.name = d.name || '';
        VOICE.isDefault[g] = !!d.is_default;
        renderVoice();
        toast((g === 'female' ? '女版' : '男版') + (id ? '已切换：' + (d.name || id) : '已恢复默认音色'));
        $('voiceMeta').textContent = '刚切换，公开站 1 分钟内生效（访客切换性别即时生效）';
      })
      .catch(function (err) { toast(err.message || '切换失败', true); });
  });

  $('voiceGender').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-gender]');
    if (!b) return;
    var g = b.getAttribute('data-gender');
    if (g !== 'female' && g !== 'male') return;
    VOICE.gender = g;
    renderVoice();
  });

  $('voicePlay').addEventListener('click', function () { previewVoice(VOICE.cur[VOICE.gender]); });
  $('voiceStop').addEventListener('click', function () { stopVoice(); voiceStat('已停止'); });
  $('voiceReload').addEventListener('click', function () { loadVoice(); loadGreeting(); toast('已重新读取'); });

  function switchTab(name) {
    state.tab = name;
    var map = {
      devices: ['tabDevices', 'panelDevices'],
      messages: ['tabMessages', 'panelMessages'],
      qa: ['tabQa', 'panelQa'],
      config: ['tabConfig', 'panelConfig'],
      voice: ['tabVoice', 'panelVoice'],
      content: ['tabContent', 'panelContent'],
      variant: ['tabVariant', 'panelVariant'],
      anim: ['tabAnim', 'panelAnim']
    };
    Object.keys(map).forEach(function (k) {
      var on = k === name;
      $(map[k][0]).classList.toggle('is-on', on);
      $(map[k][0]).setAttribute('aria-selected', on ? 'true' : 'false');
      $(map[k][1]).hidden = !on;
    });
    if (name === 'devices') loadDevices();
    else if (name === 'messages') loadMessages();
    else if (name === 'qa') loadQa();
    else if (name === 'config') { loadTheme(); loadConfig(); }
    else if (name === 'voice') { loadVoice(); loadGreeting(); }
    else if (name === 'content') loadContentList();
    else if (name === 'anim' && window.AnimConsole) window.AnimConsole.init();
  }
  $('tabDevices').addEventListener('click', function () { switchTab('devices'); });
  $('tabMessages').addEventListener('click', function () { switchTab('messages'); });
  $('tabQa').addEventListener('click', function () { switchTab('qa'); });
  $('tabConfig').addEventListener('click', function () { switchTab('config'); });
  $('tabVariant').addEventListener('click', function () { switchTab('variant'); });
  $('tabVoice').addEventListener('click', function () { switchTab('voice'); });
  $('tabContent').addEventListener('click', function () { switchTab('content'); });
  $('tabAnim').addEventListener('click', function () { switchTab('anim'); });

  /* ── 按 JD 生成变体 ─────────────────────────────────────── */
  var variantHtml = '';
  var variantBusy = false;

  function fmtNum(n) { return String(n == null ? '—' : n); }

  $('variantBtn').addEventListener('click', function () {
    if (variantBusy) return;
    var jd = $('variantJd').value.trim();
    if (jd.length < 20) { toast('JD 至少 20 字', true); return; }
    variantBusy = true;
    $('variantBtn').disabled = true;
    $('variantMeta').textContent = '生成中…（检索 + 选材 + 渲染）';
    var t0 = Date.now();
    api('/api/admin/variant', { method: 'POST', body: JSON.stringify({ jd: jd, rewrite: $('variantRewrite').checked }) })
      .then(function (d) {
        variantHtml = d.html || '';
        var s = d.stats || {};
        var cards = [
          ['bullet 数量', fmtNum(s.bullets_before) + ' → ' + fmtNum(s.bullets_after)],
          ['删掉条目', fmtNum(s.bullets_dropped)],
          ['项目', fmtNum(s.projects) + ' / ' + fmtNum(s.projects_total)],
          ['HTML 体积', fmtNum(s.bytes) + ' B'],
          ['检索最高分', fmtNum(s.top_score)],
          ['耗时', ((Date.now() - t0) / 1000).toFixed(1) + ' s']
        ];
        $('variantStats').innerHTML = cards.map(function (c) {
          return '<div class="stat"><span class="stat-num">' + esc(c[1]) + '</span><span class="stat-label">' + esc(c[0]) + '</span></div>';
        }).join('');
        $('variantStatsCard').hidden = false;
        $('variantOrder').textContent = '技能顺序：' + (s.skills_order || []).join(' → ');
        var rw = s.rewrite || {};
        if (rw.requested) {
          var rwText = rw.model
            ? '改写：' + rw.rewritten + ' 条通过护栏，' + rw.rejected + ' 条退回原文'
              + (rw.chars_delta ? '（净增 ' + rw.chars_delta + ' 字）' : '')
              + (rw.reasons && rw.reasons.length ? ' ｜ 拦截原因：' + rw.reasons.slice(0, 5).join('、') + (rw.reasons.length > 5 ? '…' : '') : '')
            : '改写未生效：' + (rw.reason || '模型无响应') + '（已按原文输出）';
          $('variantOrder').textContent = rwText;
        }
        var name = 'resume-' + new Date().toISOString().slice(0, 10) + '.html';
        $('variantStat').textContent = name;
        $('variantSave').disabled = false;
        $('variantMeta').textContent = '已生成，记得核对 2 页红线';
        toast('变体已生成');
      })
      .catch(function (err) {
        $('variantMeta').textContent = '生成失败：' + (err.message || '未知错误');
        toast(err.message || '生成失败', true);
      })
      .then(function () {
        variantBusy = false;
        $('variantBtn').disabled = false;
      });
  });

  $('variantSave').addEventListener('click', function () {
    if (!variantHtml) return;
    var blob = new Blob([variantHtml], { type: 'text/html; charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resume-' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  });

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
    state.msg.focus = '';   /* 重新筛选即退出邮件直达定位 */
    state.msg.open = null;
    loadMessages();
  });
  $('msgSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('msgSearchBtn').click(); });
  $('msgStatus').addEventListener('change', function () { $('msgSearchBtn').click(); });
  $('msgClearDevice').addEventListener('click', function () {
    state.msg.device = '';
    state.msg.offset = 0;
    state.msg.focus = '';
    state.msg.open = null;
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
    location.href = '/api/admin/export';
  });

  function loadAll() {
    loadStats();
    if (state.tab === 'devices') loadDevices();
    else if (state.tab === 'messages') loadMessages();
    else if (state.tab === 'qa') loadQa();
    else if (state.tab === 'config') { loadTheme(); loadConfig(); }
    else if (state.tab === 'voice') { loadVoice(); loadGreeting(); }
    else if (state.tab === 'content') loadContentList();
  }

  /* ── 启动 ──
     服务端已确认登录态，直接渲染；me 只作二次保险（例如 cookie 刚好过期）。 */
  /* 邮件里的「打开后台直接回复」带 ?focus=<留言 id>：
     跳过设备台账，直接切到留言审核、只加载这一条并自动展开回复面板。 */
  var focusId = new URLSearchParams(location.search).get('focus') || '';
  if (focusId) {
    state.msg.focus = focusId;
    state.msg.open = focusId;
    $('msgStatus').value = '';
  }

  $('dash').hidden = false;
  if (focusId) {
    state.tab = 'messages';
    switchTab('messages');   /* 内部 loadMessages 会带 focus 并展开面板 */
    loadStats();
  } else {
    loadAll();
  }
})();
