/**
 * 高管轮播（M2）—— 复刻 js/company-profile.js 的 execCarousel() + 轮播交互委托。
 * 结构 / 类名与旧版一致；拖拽横滑用原生 addEventListener({passive:false})
 * 保持「横向手势截获、纵向手势交还页面滚动」的语义（触屏专项 R11）。
 */
import { useEffect, useRef, useState } from 'react';
import { Sup } from './FoldableSection';
import type { Exec } from './data';

function ExecPortrait({ f }: { f: Exec }) {
  const url = f.photo || '';
  if (url) {
    return <img className="cp-exec-photo" src={url} alt={f.name || ''} />;
  }
  return (
    <span className="cp-exec-photo is-placeholder" aria-hidden="true">
      {(f.name || '?').charAt(0)}
    </span>
  );
}

function ExecBio({ bio, cls }: { bio: string; cls: string }) {
  const long = bio.length > 40;
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className={cls + (long && !open ? ' is-clamped' : '')} data-cp-exec-bio="">{bio}</p>
      {long && (
        <button
          className="cp-exec-bio-toggle" type="button" data-cp-exec-bio-toggle=""
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起' : '展开'}
        </button>
      )}
    </>
  );
}

export function ExecCard({ f, source }: { f: Exec; source?: string | number }) {
  return (
    <div className="cp-exec">
      <ExecPortrait f={f} />
      <div className="cp-exec-body">
        <p className="cp-exec-name">{f.name || ''}<Sup n={source} /></p>
        <p className="cp-exec-title">{f.title || ''}</p>
        {f.bio ? <ExecBio bio={f.bio} cls="cp-exec-bio" /> : null}
      </div>
    </div>
  );
}

export default function ExecCarousel({ team, source }: { team: Exec[]; source?: string | number }) {
  const people = team.filter((f) => f && (f.name || f.photo));
  const total = people.length;
  const [idx, setIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);

  const goTo = (n: number) => setIdx(Math.max(0, Math.min(total - 1, n)));

  useEffect(() => {
    const vp = vpRef.current;
    const box = boxRef.current;
    const track = trackRef.current;
    if (!vp || !box || !track) return;

    /* 拖拽横滑：decide 轴向 → 横向截获（passive:false），纵向交还页面滚动 */
    const onDown = (ev: PointerEvent) => {
      if ((ev.target as Element).closest?.('button, a')) return;
      const startX = ev.clientX;
      const startY = ev.clientY;
      let width = vp.clientWidth || 1;
      let cur = idx;
      let decided = false;
      let horizontal = false;

      const move = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!decided) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          decided = true;
          horizontal = Math.abs(dx) > Math.abs(dy);
          if (horizontal) track.classList.add('is-dragging');
        }
        if (!horizontal) return;
        if (e.cancelable) e.preventDefault();
        track.style.transform = `translateX(${-cur * 100 + (dx / width) * 100}%)`;
      };
      const up = (e: PointerEvent) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        track.classList.remove('is-dragging');
        if (!decided || !horizontal) { goTo(cur); return; }
        const dx = e.clientX - startX;
        width = vp.clientWidth || 1;
        if (Math.abs(dx) > Math.min(48, width * 0.18)) cur += dx < 0 ? 1 : -1;
        goTo(cur);
      };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const cur = Number(box.getAttribute('data-cp-exec-index')) || 0;
      goTo(cur + (ev.key === 'ArrowRight' ? 1 : -1));
    };

    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('keydown', onKey);
    return () => {
      vp.removeEventListener('pointerdown', onDown);
      vp.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, total]);

  if (!total) return null;
  const nav = total > 1;

  return (
    <div
      ref={boxRef} className="cp-head-exec"
      data-cp-exec-carousel="" data-cp-exec-index={idx} data-cp-exec-count={total}
    >
      <p className="cp-exec-cap">高管介绍</p>
      {nav && (
        <div className="cp-exec-bars" aria-hidden="true">
          {people.map((_, i) => <span key={i} className={'cp-exec-bar' + (i === idx ? ' is-active' : '')}></span>)}
        </div>
      )}
      {/* viewport 同时承载点击拖拽与触摸横滑；tabindex 让键盘可聚焦 */}
      <div
        ref={vpRef} className="cp-exec-viewport" tabIndex={0} role="group"
        aria-label="高管轮播，可左右滑动"
      >
        <div
          ref={trackRef} className="cp-exec-track"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {people.map((f, i) => (
            <article key={i} className="cp-exec-slide">
              <div className="cp-exec-portrait"><ExecPortrait f={f} /></div>
              <div className="cp-exec-slide-body">
                <p className="cp-exec-slide-name">{f.name || ''}<Sup n={source} /></p>
                <p className="cp-exec-slide-title">{f.title || ''}</p>
                {f.bio ? <ExecBio bio={f.bio} cls="cp-exec-slide-bio" /> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="cp-exec-ctrl">
        {nav && (
          <>
            <button
              className="cp-exec-nav is-prev" type="button" aria-label="上一位高管"
              disabled={idx === 0} onClick={() => goTo(idx - 1)}
            >‹</button>
            <button
              className="cp-exec-nav is-next" type="button" aria-label="下一位高管"
              disabled={idx === total - 1} onClick={() => goTo(idx + 1)}
            >›</button>
          </>
        )}
        {nav && (
          <div className="cp-exec-dots">
            {people.map((_, i) => (
              <button
                key={i} type="button"
                className={'cp-exec-dot' + (i === idx ? ' is-active' : '')}
                data-cp-exec-go={i}
                aria-label={'查看第 ' + (i + 1) + ' 位高管'}
                onClick={() => goTo(i)}
              ></button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
