/* ════════════════════════════════════════════════════════════
   性别形象切换（测试入口）
   - 头像（档案卡 / 关于我）与 3D 舞台角色一起切换
   - 隐形按钮：页面左下角 26×26 透明热区；键盘 G；控制台 window.setGender()
   - 不改动 main.js 的渲染逻辑，只在渲染完成后覆盖图片 src
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE = 'cp_gender_v2';
  var MAP = {
    male: {
      img: 'images/portrait.jpg',
      alt: '陈培胜——橙色连帽卫衣与黑框眼镜的半身插画肖像',
      no: 'PHOTO NO.001',
      skin: 'self3d'
    },
    female: {
      img: 'images/avatar-female.png',
      alt: '温柔斯文版女性插画肖像——黑发马尾、方框眼镜、橙色衬衫',
      no: 'PHOTO NO.002',
      skin: 'female3d'
    }
  };

  function saved() {
    var qs = new URLSearchParams(location.search).get('gender');
    if (qs === 'male' || qs === 'female') return qs;
    try {
      var v = localStorage.getItem(STORE);
      if (v === 'male' || v === 'female') return v;
    } catch (e) {}
    if (window.CPAI_SKINS && window.CPAI_SKINS.current() === 'female3d') return 'female';
    return 'male';
  }

  function setAvatar(g) {
    var m = MAP[g];
    var idcard = document.getElementById('idcardPhoto');
    var about = document.getElementById('aboutPhoto');
    var no = document.getElementById('aboutPhotoNo');
    if (idcard) { idcard.src = m.img; idcard.alt = m.alt; }
    if (about) { about.src = m.img; about.alt = m.alt; }
    if (no) no.textContent = m.no;
  }

  function apply(g, opts) {
    if (!MAP[g]) return;
    var silent = !!(opts && opts.silent);
    try { localStorage.setItem(STORE, g); } catch (e) {}
    document.documentElement.setAttribute('data-gender', g);
    window.CP_GENDER = g;
    setAvatar(g);
    if (window.CPAI_SKINS) window.CPAI_SKINS.use(MAP[g].skin, silent);
  }

  /* 图片由 main.js 异步渲染，等它写完再覆盖 */
  function applyAfterRender(g) {
    var tries = 0;
    (function wait() {
      var idcard = document.getElementById('idcardPhoto');
      if ((idcard && idcard.getAttribute('src')) || tries++ > 120) apply(g, { silent: true });
      else setTimeout(wait, 30);
    })();
  }

  /* 隐形测试按钮：左下角透明热区 */
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'genderHiddenToggle';
  btn.title = '性别形象切换（测试）';
  btn.setAttribute('aria-label', '切换性别形象（测试）');
  btn.style.cssText = 'position:fixed;left:0;bottom:0;width:26px;height:26px;' +
    'padding:0;margin:0;border:0;background:transparent;opacity:0;' +
    'cursor:pointer;z-index:99999;';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  });
  document.body.appendChild(btn);

  /* 键盘 G：同样的切换（输入框内不响应） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'g' && e.key !== 'G') return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  });

  /* 控制台/外部调用入口 */
  window.setGender = function (g, opts) { apply(g, opts); };
  window.toggleGender = function () {
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  };

  applyAfterRender(saved());
})();
