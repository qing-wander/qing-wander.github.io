/* 扫码进入后：scene = 后台网页生成的一次性 ticket（32 位 hex）。
   wx.login 拿 code，连同 ticket POST 给后台 /api/admin/auth/mini/confirm。
   确认结果不在这里展示细节——网页端轮询才会拿到 openid 或登录态，
   这样 openid 不会留在手机截图里。 */

var API = 'https://qingfin.cn/api/admin/auth/mini/confirm';

Page({
  data: {
    title: '正在确认登录',
    desc: '请稍候，确认完成后回到网页即可',
    ok: false,
    failed: false,
  },

  ticket: '',

  onLoad: function (options) {
    var scene = String((options && options.scene) || '');
    try { scene = decodeURIComponent(scene); } catch (e) { /* 保留原值 */ }
    if (!/^[0-9a-f]{32}$/.test(scene)) {
      this.fail('二维码无效', '请回到后台登录页重新扫码');
      return;
    }
    this.ticket = scene;
    this.confirm();
  },

  confirm: function () {
    var self = this;
    this.setData({ title: '正在确认登录', desc: '请稍候，确认完成后回到网页即可', failed: false });
    wx.login({
      success: function (res) {
        if (!res.code) {
          self.fail('登录失败', '拿不到微信凭证，请重试');
          return;
        }
        wx.request({
          url: API,
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: { ticket: self.ticket, code: res.code },
          success: function (r) {
            if (r.statusCode === 200 && r.data && r.data.ok) {
              self.setData({
                title: '确认成功',
                desc: '回到网页即可完成登录，本页可以关闭',
                ok: true,
                failed: false,
              });
            } else {
              self.fail('确认失败', (r.data && r.data.message) || '请稍后重试');
            }
          },
          fail: function () {
            self.fail('网络异常', '检查网络后重试；如仍失败，检查小程序 request 合法域名');
          },
        });
      },
      fail: function () {
        self.fail('登录失败', '拿不到微信凭证，请重试');
      },
    });
  },

  fail: function (title, desc) {
    this.setData({ title: title, desc: desc, ok: false, failed: true });
  },

  retry: function () {
    this.confirm();
  },
});
