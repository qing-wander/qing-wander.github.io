import { useEffect, useRef, useState } from 'react';
import { useGreeting, usePickVoice, useSaveGreeting, useVoice, previewVoiceReq } from '../queries';
import { useToast } from '../toast';

/** AI 语音：套装切换 / 音色卡片（切换+试听） / 招呼文案 / 链路说明。试听不动线上设置。 */
export function VoiceTab() {
  const toast = useToast();
  const voice = useVoice();
  const greeting = useGreeting();
  const pick = usePickVoice();
  const saveGreeting = useSaveGreeting();

  const [genderView, setGenderView] = useState<'female' | 'male'>('female');
  const [greetText, setGreetText] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [stat, setStat] = useState<{ text: string; kind?: string }>({ text: '待试听' });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const d = voice.data;
  const cur = genderView === 'female' ? (d?.female_voice ?? 101001) : (d?.male_voice ?? 101013);
  const isDefault = genderView === 'female' ? !!d?.female_is_default : !!d?.male_is_default;

  /* 招呼文案加载进试听框（站长手动改过则不覆盖，与旧版语义一致） */
  useEffect(() => {
    if (greeting.data) {
      setGreetText(greeting.data.text);
      if (!previewDirty) setPreviewText(greeting.data.text);
    }
  }, [greeting.data, previewDirty]);

  function stopVoice() {
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* noop */ } audioRef.current = null; }
  }

  function doPreview(id: number) {
    const text = previewText.trim().slice(0, d?.max_chars ?? 150);
    if (!text) { toast('先写点试听文本', true); return; }
    stopVoice();
    setStat({ text: '合成中…' });
    previewVoiceReq(id, text).then((p) => {
      const a = new Audio('data:' + p.mime + ';base64,' + p.audio);
      audioRef.current = a;
      a.onended = () => setStat({ text: '播放结束', kind: 'ok' });
      a.onerror = () => setStat({ text: '播放失败', kind: 'bad' });
      setStat({ text: '播放中 · ' + (p.name || String(id)), kind: 'ok' });
      a.play().catch(() => setStat({ text: '播放失败', kind: 'bad' }));
    }).catch((e: Error) => {
      setStat({ text: '试听失败', kind: 'bad' });
      toast(e.message || '试听失败', true);
    });
  }

  const voiceName = (id: number) => d?.voices?.find((v) => v.id === id)?.name ?? String(id);

  return (
    <section className="panel" id="panelVoice" role="tabpanel">
      <div className="toolbar">
        <span className="toolbar-note">数字分身播报用的云端音色。选定即写进 D1，公开站 1 分钟内生效；访客浏览器不支持或云端不可用时自动回落浏览器语音。</span>
        <button className="btn btn-ghost" type="button" onClick={() => { voice.refetch(); greeting.refetch(); toast('已重新读取'); }}>重新读取</button>
      </div>

      <article className="cfg-card">
        <div className="cfg-head"><h2>音色</h2>
          <span className="pill">{d ? (genderView === 'female' ? '女版 · ' : '男版 · ') + (isDefault ? '默认 · ' : '') + voiceName(cur) : '—'}</span></div>
        <p className="cfg-note">先选套装，再点卡片切换该性别的音色。女版配女声 + 女头像 + 女模型，男版配男声 + 男头像 + 男模型；访客端不可自行切换，整套形象由「展示套装」开关决定。</p>
        <div className="voice-gender" id="voiceGender">
          {(['female', 'male'] as const).map((g) => (
            <button key={g} className={'btn btn-ghost' + (genderView === g ? ' is-on' : '')} type="button"
              onClick={() => setGenderView(g)}>{g === 'female' ? '女版套装' : '男版套装'}</button>
          ))}
        </div>
        <p className="cfg-note">点卡片 = 切成这个音色（立刻生效）；点「试听」只合成一段给你听，不改线上设置。</p>
        <div className="voice-chips">
          {(d?.voices ?? []).filter((v) => v.gender === genderView).map((v) => (
            <div key={v.id} className={'voice-chip' + (!isDefault && v.id === cur ? ' is-on' : '')}>
              <button className="voice-pick" type="button" disabled={pick.isPending}
                onClick={() => pick.mutate({ voice: v.id, gender: genderView }, {
                  onSuccess: () => toast((genderView === 'female' ? '女版' : '男版') + '已切换：' + v.name),
                  onError: (e) => toast(e.message || '切换失败', true),
                })}>
                <strong>{v.name}</strong><small>{v.note}</small><em>{v.type} · {v.id}</em>
              </button>
              <button className="voice-try" type="button" onClick={() => doPreview(v.id)}>试听</button>
            </div>
          ))}
          <div className={'voice-chip' + (isDefault ? ' is-on' : '')}>
            <button className="voice-pick" type="button" disabled={pick.isPending}
              onClick={() => pick.mutate({ voice: 0, gender: genderView }, {
                onSuccess: () => toast((genderView === 'female' ? '女版' : '男版') + '已恢复默认音色'),
                onError: (e) => toast(e.message || '切换失败', true),
              })}>
              <strong>恢复默认</strong><small>用服务端默认音色</small><em>DEFAULT</em>
            </button>
          </div>
        </div>
      </article>

      <article className="cfg-card">
        <div className="cfg-head"><h2>招呼文案</h2>
          <span className={'pill' + (greeting.data && !greeting.data.is_default ? ' ok' : '')}>{greeting.data ? (greeting.data.is_default ? '默认文案' : '已自定义') : '—'}</span></div>
        <p className="cfg-note">数字分身首次打招呼的文案。保存后访客面板欢迎语、语音招呼语、下方试听框同步生效，不用重新构建。<span className="mono"> · key=ai_greeting</span></p>
        <label className="cfg-label">文案（纯文本，最多 {greeting.data?.max_chars ?? 150} 字）
          <textarea className="cfg-textarea" rows={2} maxLength={greeting.data?.max_chars ?? 150} value={greetText}
            onChange={(e) => setGreetText(e.target.value)} />
        </label>
        <div className="cfg-actions">
          <span className="toolbar-note">不接受 HTML 标签；支持换行，访客端显示为分行。</span>
          <button className="btn btn-ghost" type="button" disabled={saveGreeting.isPending}
            onClick={() => saveGreeting.mutate({ reset: true }, {
              onSuccess: () => { setPreviewDirty(false); toast('已恢复默认文案'); },
              onError: (e) => toast(e.message || '保存失败', true),
            })}>恢复默认</button>
          <button className="btn" type="button" disabled={saveGreeting.isPending}
            onClick={() => {
              if (!greetText.trim()) { toast('先写点文案', true); return; }
              saveGreeting.mutate({ text: greetText.trim() }, {
                onSuccess: () => { setPreviewDirty(false); toast('已保存，访客刷新即生效'); },
                onError: (e) => toast(e.message || '保存失败', true),
              });
            }}>保存文案</button>
        </div>
      </article>

      <article className="cfg-card">
        <div className="cfg-head"><h2>试听</h2><span className={'pill' + (stat.kind ? ' ' + stat.kind : '')}>{stat.text}</span></div>
        <p className="cfg-note">试听文本按 {d?.max_chars ?? 150} 字截断，默认就是上面的招呼文案；云函数只合成不缓存试听内容，同一句重复试听会重新合成一次。</p>
        <label className="cfg-label">试听文本
          <textarea className="cfg-textarea" rows={2} value={previewText}
            onChange={(e) => { setPreviewText(e.target.value); setPreviewDirty(true); }} />
        </label>
        <div className="cfg-actions">
          <span className="toolbar-note">选中音色后点「试听」</span>
          <button className="btn btn-ghost" type="button" onClick={() => { stopVoice(); setStat({ text: '已停止' }); }}>停止</button>
          <button className="btn" type="button" onClick={() => doPreview(cur)}>试听当前音色</button>
        </div>
      </article>

      <article className="cfg-card">
        <div className="cfg-head"><h2>链路</h2></div>
        <p className="cfg-note">合成链路：公开站 <span className="mono">/api/chat (mode=tts)</span> → 腾讯云函数 <span className="mono">{d?.upstream || '—'}</span>。音色白名单在 <span className="mono">functions/lib/tts.js</span>，前端拿不到密钥，也不允许传白名单外的 ID。</p>
        <p className="cfg-note">清单里只有 10 个精品音色（腾讯云免费额度覆盖）。大模型音色（月华 / 飞镜 / 爱小芊）实测未开通时会让云函数直接 502，所以没放进来；等控制台开通后把 ID 加回 <span className="mono">functions/lib/tts.js</span> 的 VOICES 即可。</p>
      </article>
    </section>
  );
}
