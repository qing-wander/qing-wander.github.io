/**
 * /login SPA（M1）：三通道登录 —— 邮箱验证码 / 微信（扫码或公众号）/ 小程序扫码。
 * 逻辑自旧 login.html 逐行迁移：错误文案表、safeNext 防开放重定向、
 * 验证码冷却倒计时、小程序码轮询（1.5s×40）、openid 引导提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authMethodsSchema, loginCodeSchema, miniQrSchema } from '../../lib/api/admin';

const ERRORS: Record<string, string> = {
  bad_state: '登录状态校验失败，请重试',
  wechat_not_configured: '微信登录还没配置 AppID / Secret',
  wechat_allowlist_empty: '微信登录白名单为空，先把 openid 填进 WECHAT_ALLOW_OPENIDS',
  wechat_no_code: '微信没有回传授权码',
  wechat_token_failed: '微信换 token 失败，检查 AppID / Secret',
  wechat_network: '连不上微信接口，稍后重试',
  mini_not_configured: '小程序登录还没配置',
  wechat_qr_failed: '小程序码生成失败，稍后重试',
  wechat_code_failed: '微信凭证校验失败，请重试',
  ticket_expired: '二维码已过期，请关闭后重试',
  access_denied: '你取消了微信授权',
  email_not_allowed: '这个邮箱不在登录白名单里',
  mail_not_configured: '还没配置发信（缺 RESEND_API_KEY）',
  mail_rejected: '发信被拒，检查发件域名是否已在 Resend 验证',
  mail_network: '发信服务连不上，稍后重试',
  rate_limited: '尝试太频繁，稍后再试',
  cooldown: '刚发过，等倒计时结束再发',
  code_expired: '验证码过期了，重新发一封',
  code_not_found: '没有待验证的验证码，先发一封',
  too_many_attempts: '错误次数太多，重新发一封',
  bad_code: '验证码不对',
  bad_input: '邮箱或验证码格式不对',
  bad_email: '邮箱格式不对',
};

const params = new URLSearchParams(location.search);

function safeNext(): string {
  const n = params.get('next') || '';
  if (!n || n.charAt(0) !== '/') return '/admin/';
  if (n === '/login' || n.indexOf('/login?') === 0) return '/admin/';
  if (n !== '/admin' && n.indexOf('/admin/') !== 0 && n.indexOf('/admin?') !== 0) return '/admin/';
  return n;
}

async function post(path: string, body: unknown): Promise<{ r: Response; d: Record<string, unknown> }> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  });
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { r, d };
}

export function LoginApp() {
  /* ── 可用登录方式探测 ── */
  const [methods, setMethods] = useState<null | {
    wechatMode: '' | 'qr' | 'mp'; mini: boolean; emailEnabled: boolean; emailHint?: string; emailCount: number;
  }>(null);

  /* ── 邮箱流 ── */
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean; identity?: { openid?: string; unionid?: string } }>({ text: '' });
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /* ── 小程序扫码 ── */
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImg, setQrImg] = useState('');
  const [qrMsg, setQrMsg] = useState<{ text: string; ok?: boolean; identity?: { openid?: string; unionid?: string } }>({ text: '正在生成二维码…' });

  useEffect(() => {
    fetch('/api/admin/auth/methods', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok) return;
        const m = authMethodsSchema.parse(d);
        const inWx = m.inWechat;
        const mode = inWx && m.wechat.mp ? 'mp' : (m.wechat.qr ? 'qr' : m.wechat.mp ? 'mp' : '');
        setMethods({
          wechatMode: mode, mini: m.mini,
          emailEnabled: m.email.enabled, emailHint: m.email.hint, emailCount: m.email.count,
        });
      })
      .catch(() => { /* 探测失败不影响手填邮箱 */ });
  }, []);

  /* URL 错误信息（OAuth 回跳 / logout 提示） */
  useEffect(() => {
    const err = params.get('error');
    if (!err) {
      if (params.get('logout')) setMsg({ text: '已退出登录', ok: true });
      return;
    }
    if (err === 'wechat_not_allowed' || err === 'not_allowed') {
      const identity = { openid: params.get('openid') || '', unionid: params.get('unionid') || '' };
      setMsg({
        text: '这个微信账号还没放行。把下面的 openid 填进环境变量 WECHAT_ALLOW_OPENIDS 再试：',
        identity: Object.values(identity).some(Boolean) ? identity : undefined,
      });
      return;
    }
    if (err.indexOf('wechat_') === 0 && !ERRORS[err]) { setMsg({ text: '微信授权失败：' + err }); return; }
    setMsg({ text: ERRORS[err] || ('登录失败：' + err) });
  }, []);

  /* 冷却倒计时 */
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  /* 扫码轮询 */
  const qrTimer = useRef<ReturnType<typeof setInterval> | 0>(0);
  const qrTicket = useRef('');
  const qrTries = useRef(0);
  const stopQrPoll = useCallback(() => { clearInterval(qrTimer.current); qrTicket.current = ''; }, []);

  const qrPoll = useCallback(() => {
    if (!qrTicket.current) return;
    qrTries.current += 1;
    if (qrTries.current > 40) { stopQrPoll(); setQrMsg({ text: '二维码已过期，请关闭后重新打开' }); return; }
    fetch('/api/admin/auth/mini/poll?ticket=' + encodeURIComponent(qrTicket.current), { credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (d?.ok) { stopQrPoll(); location.replace(safeNext()); return; }
        if (d?.status === 'pending') return;
        stopQrPoll();
        if (d?.status === 'not_allowed') {
          setQrMsg({ text: '这个微信还没放行。把下面的 openid 配到 WECHAT_ALLOW_OPENIDS 再试：', identity: { openid: d.openid, unionid: d.unionid } });
          return;
        }
        setQrMsg({ text: '二维码已失效，请关闭后重新打开' });
      })
      .catch(() => { /* 网络抖动，下一轮继续 */ });
  }, [stopQrPoll]);

  function qrStart() {
    setQrOpen(true);
    setQrImg('');
    qrTicket.current = '';
    qrTries.current = 0;
    setQrMsg({ text: '正在生成二维码…' });
    fetch('/api/admin/auth/mini/qr', { credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (!d?.ok) { setQrMsg({ text: (d && (ERRORS[String(d.error)] || String(d.message ?? ''))) || '生成失败，请稍后重试' }); return; }
        const m = miniQrSchema.parse(d);
        qrTicket.current = m.ticket;
        setQrImg(m.image);
        setQrMsg({ text: '请用微信扫码，在小程序里确认', ok: true });
        clearInterval(qrTimer.current);
        qrTimer.current = setInterval(qrPoll, 1500);
      })
      .catch(() => setQrMsg({ text: '网络异常，请重试' }));
  }

  useEffect(() => () => clearInterval(qrTimer.current), []);

  async function sendCode() {
    const e = email.trim();
    if (!e) { setMsg({ text: '先填邮箱' }); return; }
    setSending(true);
    setMsg({ text: '发送中…', ok: true });
    try {
      const { r, d } = await post('/api/admin/auth/email/send', { email: e });
      if (r.ok && d.ok !== false) {
        const m = loginCodeSchema.parse(d);
        setSentEmail(e); /* 用原始输入；接口返回的 email 是掩码（de***@…），不能回填 */
        setStep('code');
        setMsg({ text: '验证码已发出，10 分钟内有效', ok: true });
        setCooldown(m.cooldown || 60);
        return;
      }
      setMsg({ text: (d && (ERRORS[String(d.error)] || String(d.message ?? ''))) || '发送失败' });
    } catch {
      setMsg({ text: '网络异常，重试一次' });
    } finally { setSending(false); }
  }

  async function verify() {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) { setMsg({ text: '验证码是 6 位数字' }); return; }
    setVerifying(true);
    setMsg({ text: '验证中…', ok: true });
    try {
      const { r, d } = await post('/api/admin/auth/email/verify', { email: sentEmail, code: c });
      if (r.ok && d.ok !== false) { location.replace(safeNext()); return; }
      if (d.error === 'bad_code' && typeof d.left === 'number') {
        setMsg({ text: '验证码不对，还能再试 ' + d.left + ' 次' });
      } else {
        setMsg({ text: ERRORS[String(d.error)] || String(d.message ?? '') || '登录失败' });
      }
    } catch {
      setMsg({ text: '网络异常，重试一次' });
    } finally { setVerifying(false); }
  }

  const wxMode = methods?.wechatMode ?? 'qr';
  const wxEnabled = !!methods && !!methods.wechatMode;
  const showMini = methods?.mini;
  const emailDisabled = methods ? !methods.emailEnabled : false;

  return (
    <>
      <main className="card">
        <p className="tag">PRIVATE CONSOLE</p>
        <h1>后台登录</h1>
        <p className="hint">不用密码：微信扫一下，或收一封邮箱验证码。</p>
        <p className="note">登录状态保留 30 天，期间再进后台无需重复验证。</p>

        {!showMini && (
          <a className="btn btn-wx" id="wxBtn" href={wxEnabled ? '/api/admin/auth/wechat?mode=' + wxMode : undefined}
            aria-disabled={!wxEnabled}>
            {wxEnabled ? (wxMode === 'mp' ? '微信一键登录' : '微信扫码登录') : '微信登录（未配置）'}
          </a>
        )}
        {!wxEnabled && !showMini && methods && (
          <p className="note">需要小程序 AppID / Secret，或公众号 / 开放平台配置</p>
        )}

        {showMini && (
          <button className="btn btn-mini" type="button" id="miniBtn" onClick={qrStart}>微信小程序扫码登录</button>
        )}

        <div className="divider">OR</div>

        <form autoComplete="on" onSubmit={(e) => { e.preventDefault(); if (step === 'email') { void sendCode(); } else { void verify(); } }}>
          {step === 'email' ? (
            <div id="stepEmail">
              <label className="field">
                <span className="field-label">邮箱</span>
                <input id="email" type="email" required autoComplete="email" value={email} disabled={emailDisabled}
                  placeholder={methods?.emailHint ? methods.emailHint.replace(/\*\*\*/, '…') : 'you@gmail.com / you@qq.com'}
                  onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button className="btn" type="submit" id="sendBtn" disabled={sending || emailDisabled}>发验证码</button>
            </div>
          ) : (
            <div id="stepCode">
              <label className="field">
                <span className="field-label" id="codeLabel">验证码 · 已发到 {sentEmail}</span>
                <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <div className="row">
                <button className="btn btn-solid" type="submit" id="verifyBtn" disabled={verifying}>登录</button>
                <button className="btn btn-sm" type="button" id="resendBtn" disabled={cooldown > 0 || sending}
                  onClick={sendCode}>{cooldown > 0 ? cooldown + 's' : '重发'}</button>
              </div>
              <p className="note"><a href="#" onClick={(e) => { e.preventDefault(); setStep('email'); setCode(''); setMsg({ text: '' }); }}>换一个邮箱</a></p>
            </div>
          )}

          <p className={'msg' + (msg.ok ? ' is-ok' : '')} id="msg" role="alert">
            {msg.text}
            {msg.identity ? (
              <>
                {msg.identity.openid ? <span className="id-row">openid：<code>{msg.identity.openid}</code></span> : null}
                {msg.identity.unionid ? <span className="id-row">unionid：<code>{msg.identity.unionid}</code></span> : null}
              </>
            ) : null}
          </p>
        </form>

        <p className="foot">
          <a href="https://chenpeisheng.cn">← 返回公开站</a>
          <span id="footNote">{methods?.emailEnabled && methods.emailHint ? '白名单 ' + methods.emailCount + ' 个 · ' + methods.emailHint : ''}</span>
        </p>
      </main>

      {qrOpen && (
        <div className="modal" id="qrModal">
          <div className="qr-card">
            <p className="tag">WECHAT LOGIN</p>
            <h2>微信扫码登录</h2>
            <p className="hint">用微信扫一扫，在小程序里确认一下</p>
            <div className="qr-wrap"><img id="qrImg" alt="小程序登录二维码" src={qrImg || undefined} /></div>
            <p className={'msg' + (qrMsg.ok ? ' is-ok' : '')} id="qrMsg" role="alert">
              {qrMsg.text}
              {qrMsg.identity ? (
                <>
                  {qrMsg.identity.openid ? <span className="id-row">openid：<code>{qrMsg.identity.openid}</code></span> : null}
                  {qrMsg.identity.unionid ? <span className="id-row">unionid：<code>{qrMsg.identity.unionid}</code></span> : null}
                </>
              ) : null}
            </p>
            <button className="btn btn-sm" type="button" id="qrClose"
              onClick={() => { stopQrPoll(); setQrOpen(false); setQrImg(''); }}>关闭</button>
          </div>
        </div>
      )}
    </>
  );
}
