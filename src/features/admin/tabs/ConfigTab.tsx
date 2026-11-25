import { useState } from 'react';
import { useConfig, useGender, useSaveConfig, useSetGender, useSetTheme, useTheme } from '../queries';
import { fmt, useToast } from '../toast';
import type { ConfigModule } from '../../../lib/api/admin';

/** 模型与提示词：主题 / 展示套装 / 各 AI 模块的 model+prompt 卡片 */
export function ConfigTab() {
  const toast = useToast();
  const theme = useTheme();
  const gender = useGender();
  const config = useConfig();
  const setTheme = useSetTheme();
  const setGender = useSetGender();

  const curTheme = theme.data?.theme || '';
  const curGender = gender.data?.theme || gender.data?.gender || '';

  return (
    <section className="panel" id="panelConfig" role="tabpanel">
      <div className="toolbar">
        <span className="toolbar-note">每个 AI 模块单独配模型 + 提示词。存 D1，保存即生效；简历内容仍以 Git 为唯一真相源。</span>
        <button className="btn btn-ghost" type="button" onClick={() => {
          theme.refetch(); gender.refetch(); config.refetch(); toast('已重新读取');
        }}>重新读取</button>
      </div>

      <article className="cfg-card cfg-theme">
        <div className="cfg-head"><h2>站点默认主题</h2>
          <span className="pill">{theme.data ? (curTheme || '默认橙色（ARCHIVE）') : '—'}</span></div>
        <p className="cfg-note">对所有访客生效；访客自己切过主题（localStorage 锁定）则仍以访客选择为准。<span className="mono"> · key=theme</span></p>
        <div className="theme-chips">
          {theme.data?.themes?.map((t) => (
            <button key={t.id} className={'theme-chip' + (t.id === curTheme ? ' is-on' : '')} type="button"
              onClick={() => setTheme.mutate({ theme: t.id }, {
                onSuccess: () => toast('已切到：' + t.id),
                onError: (e) => toast(e.message || '设置失败', true),
              })}>
              <strong>{t.name}</strong><small>{t.note}</small>
            </button>
          ))}
          <button className={'theme-chip' + (curTheme ? '' : ' is-on')} type="button"
            onClick={() => setTheme.mutate({ theme: '' }, {
              onSuccess: () => toast('已恢复默认橙色（ARCHIVE）'),
              onError: (e) => toast(e.message || '设置失败', true),
            })}>
            <strong>默认橙色</strong><small>固定 ARCHIVE，不自动轮换</small>
          </button>
        </div>
      </article>

      <article className="cfg-card cfg-theme">
        <div className="cfg-head"><h2>展示套装</h2>
          <span className="pill">{gender.data ? (curGender === 'female' ? '女版套装' : curGender === 'male' ? '男版套装' : '跟随站点默认（男版）') : '—'}</span></div>
        <p className="cfg-note">决定公开站访客看到的整套形象（头像 + 3D 模型 + 语音音色）；访客端不可自行切换。留空 = 跟随站点数据默认男版。<span className="mono"> · key=gender</span></p>
        <div className="theme-chips">
          {(gender.data?.themes ?? []).map((g) => (
            <button key={g.id} className={'theme-chip' + (g.id === curGender ? ' is-on' : '')} type="button"
              onClick={() => setGender.mutate({ gender: g.id }, {
                onSuccess: () => toast('已切到：' + (g.id === 'female' ? '女版套装' : '男版套装')),
                onError: (e) => toast(e.message || '设置失败', true),
              })}>
              <strong>{g.name}</strong><small>{g.note}</small>
            </button>
          ))}
          <button className={'theme-chip' + (curGender ? '' : ' is-on')} type="button"
            onClick={() => setGender.mutate({ gender: '' }, {
              onSuccess: () => toast('已恢复跟随站点默认'),
              onError: (e) => toast(e.message || '设置失败', true),
            })}>
            <strong>跟随默认</strong><small>按站点数据 hero.gender 展示</small>
          </button>
        </div>
      </article>

      <div className="cfg-list">
        {config.data?.modules?.length
          ? config.data.modules.map((m) => <ConfigCard key={m.key} m={m} />)
          : <p className="empty">{config.isLoading ? '加载中…' : '没有可配置模块'}</p>}
      </div>
    </section>
  );
}

function ConfigCard({ m }: { m: ConfigModule }) {
  const toast = useToast();
  const [model, setModel] = useState(m.model);
  const [prompt, setPrompt] = useState(m.prompt);
  const save = useSaveConfig();

  return (
    <article className="cfg-card" data-key={m.key}>
      <div className="cfg-head"><h2>{m.title}</h2>
        {m.is_default ? <span className="pill">默认配置</span> : <span className="pill ok">已自定义</span>}</div>
      <p className="cfg-note">{m.note}<span className="mono"> · key={m.key}</span></p>
      <label className="cfg-label">模型 ID
        <input className="cfg-input mono" value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="cfg-label">提示词
        <textarea className="cfg-textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="cfg-actions">
        <span className="toolbar-note">{m.updated_at ? '更新于 ' + fmt(m.updated_at) : '尚未保存过'}</span>
        <button className="btn" type="button" disabled={save.isPending}
          onClick={() => save.mutate({ key: m.key, model: model.trim(), prompt: prompt.trim() }, {
            onSuccess: () => toast('已保存：' + m.key),
            onError: (e) => toast(e.message || '保存失败', true),
          })}>保存</button>
      </div>
    </article>
  );
}
