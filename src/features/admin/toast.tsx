/**
 * Toast 提示条（React 版）——视觉与行为对齐旧 admin.js 的 toast：
 * 同一条 tip，2.6s 自动收起，bad 状态红底。
 * 兼容层：仍暴露 window.__adminToast，供 anim-console.js 这类旧模块复用。
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastState { msg: string; bad: boolean; }

const ToastCtx = createContext<(msg: string, bad?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef(0);

  const show = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  ;(window as unknown as { __adminToast: typeof show }).__adminToast = show;

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={'toast is-on' + (toast.bad ? ' is-bad' : '')} role="status" aria-live="polite">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* 时间格式化（旧 fmt 逐字迁移） */
export function fmt(ts?: number | string | null): string {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function esc(s: unknown): string {
  return String(s ?? '');
}
