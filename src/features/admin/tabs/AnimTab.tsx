import { useEffect } from 'react';

/**
 * 角色动画台（M1 桥接方案）：
 *   anim-console.js（477 行，model-viewer DOM 操作）暂不组件化——
 *   本组件只渲染与旧版完全一致的 DOM 骨架（同 id/class），切换到该 tab 时
 *   动态加载 /admin/assets/anim-console.js 并调用 window.AnimConsole.init()，
 *   行为与旧 admin 完全一致。M5 收尾阶段再决定是否重写或迁 public/。
 */
declare global {
  interface Window { AnimConsole?: { init: () => void }; }
}

export function AnimTab({ active }: { active: boolean }) {
  const inited = typeof window !== 'undefined' && !!window.AnimConsole;

  useEffect(() => {
    if (!active || inited) return;
    const s = document.createElement('script');
    s.src = '/admin/assets/anim-console.js';
    s.onload = () => window.AnimConsole?.init();
    document.body.appendChild(s);
  }, [active, inited]);

  useEffect(() => {
    if (active && window.AnimConsole) window.AnimConsole.init();
  }, [active]);

  return (
    <section className="panel" id="panelAnim" role="tabpanel" hidden={!active}>
      <div className="toolbar">
        <span className="toolbar-note">角色动画台账：换角色 → 换动作 → 360° 验动作 → 用 280×360 小窗复核公开站取景。状态分「上线 / 候选 / 待评 / 弃用」。快捷键：空格播放暂停 · ←/→ 逐帧 · R 重播。</span>
      </div>
      <div className="anim">
        <div className="anim-main">
          <div className="anim-stage" id="animStage">
            <span className="anim-tag" id="animTag">MALE / MaleRigged.glb</span>
            <span className="anim-read" id="animRead">θ 0° · φ 78° · 80%</span>
            <div className="anim-load" id="animLoad">载入模型…</div>
          </div>
          <div className="anim-transport">
            <button className="btn btn-sm" id="animPlay" type="button">暂停</button>
            <button className="btn btn-sm btn-ghost" id="animReplay" type="button">重播</button>
            <button className="btn btn-sm btn-ghost is-on" id="animLoop" type="button">循环 开</button>
            <input className="anim-seek" id="animSeek" type="range" min={0} max={1} step={0.001} defaultValue={0} aria-label="播放进度" />
            <span className="anim-time" id="animTime">0.00 / 0.00s</span>
            <button className="btn btn-sm btn-ghost" id="animPrevF" type="button">◀ 1 帧</button>
            <button className="btn btn-sm btn-ghost" id="animNextF" type="button">1 帧 ▶</button>
            <select className="anim-speed" id="animSpeed" aria-label="播放速度" defaultValue="1">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1">1.0×</option>
              <option value="1.5">1.5×</option>
            </select>
          </div>
          <div className="anim-views">
            <span className="anim-label">视角</span>
            <button className="btn btn-ghost" type="button" data-anim-orbit="0 80">正面</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="45 78">右前 45</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="90 80">右侧</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="180 80">背面</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="-90 80">左侧</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="0 8">俯视</button>
            <button className="btn btn-ghost" type="button" data-anim-orbit="0 80 0.55">看头部</button>
            <button className="btn btn-ghost" id="animAuto" type="button">自动旋转</button>
            <button className="btn btn-ghost" id="animReset" type="button">复位</button>
            <button className="btn btn-ghost" id="animCopy" type="button">复制取景参数</button>
            <button className="btn btn-ghost" id="animLight" type="button">深底</button>
          </div>
        </div>
        <aside className="anim-side" id="animSide">
          <div className="anim-block">
            <h3>角色</h3>
            <div className="anim-chars" id="animChars"></div>
            <p className="anim-meta" id="animCharMeta">—</p>
          </div>
          <div className="anim-block">
            <h3>动作清单</h3>
            <div className="anim-clips" id="animClips"></div>
            <p className="anim-meta" id="animClipNote">—</p>
          </div>
          <div className="anim-block">
            <h3>公开站取景 280×360</h3>
            <div className="anim-mini" id="animMini"></div>
            <p className="anim-meta">复用首页取景：视口下移 34%，镜头随所选角色而定，可拖动旋转。</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
