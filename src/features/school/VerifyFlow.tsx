/**
 * 学历核验访问流（M2）—— 复刻 js/school-profile.js 的申请 / 审批 / 轮询 / 解锁 / 重锁全套。
 * localStorage 键与旧版一致（sp_verify_access / sp_verify_unlock / wall_device_id），
 * 老用户的解锁态在新版无缝继承；API 为 functions/api/verify-access（多线路降级）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBases, url } from '../../lib/api/endpoints';

const POLL_MS = 5000;
const POLL_MAX = 360; // 最多等 30 分钟
const ACCESS_TTL_MS = 24 * 3600 * 1000; // 与服务端一致：批准 24 小时后自动过期
const ACCESS_KEY = 'sp_verify_access';
const UNLOCK_KEY = 'sp_verify_unlock';

export interface VerifyUnlock {
  id: string;
  device: string;
  schoolId: string;
  approvedAt: number;
  expiresAt: number;
}

interface AccessPending {
  id: string;
  base: string;
  schoolId: string;
  startedAt: number;
}

export type PollPhase = 'idle' | 'waiting' | 'approved' | 'timeout' | 'reject' | 'deviceMismatch' | 'expired';

function deviceId(): string {
  try {
    const key = 'wall_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem(key, id);
    }
    return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function deviceInfo(): Record<string, string> {
  try {
    const s = window.screen as Screen;
    return {
      platform: navigator.platform || '',
      screen: (s.width || '') + 'x' + (s.height || ''),
      colorDepth: String(s.colorDepth || ''),
      language: navigator.language || '',
      timezone: String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
      cores: String(navigator.hardwareConcurrency || ''),
      touch: String(('ontouchstart' in window) || navigator.maxTouchPoints > 0),
      dpr: String(window.devicePixelRatio || ''),
    };
  } catch {
    return {};
  }
}

function readAccess(): AccessPending | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null') as AccessPending | null;
    return a && /^[0-9a-f]{32}$/i.test(a.id || '') ? a : null;
  } catch {
    return null;
  }
}

export function readUnlock(): VerifyUnlock | null {
  let u: VerifyUnlock | null;
  try {
    u = JSON.parse(localStorage.getItem(UNLOCK_KEY) || 'null') as VerifyUnlock | null;
  } catch {
    u = null;
  }
  const clear = () => { try { localStorage.removeItem(UNLOCK_KEY); } catch { /* noop */ } };
  if (!u || !/^[0-9a-f]{32}$/i.test(u.id || '')) { clear(); return null; }
  const did = deviceId();
  if (did && u.device && u.device !== did) { clear(); return null; }
  if (!u.expiresAt || Date.now() > Number(u.expiresAt)) { clear(); return null; }
  return u;
}

export function formatExpiry(ts: number): string {
  try {
    return new Date(Number(ts)).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return '';
  }
}

export interface VerifyState {
  unlocked: VerifyUnlock | null;
  phase: PollPhase;
  doneText: string;
  /** 过期授权的到期时刻（重锁提示用） */
  expiredAt?: number;
}

export function useVerifyAccess(schoolId: string, qId: string): {
  state: VerifyState;
  submit: (payload: Record<string, unknown>, onFail: (msg: string) => void, onOk: (polling: boolean) => void) => void;
} {
  const [state, setState] = useState<VerifyState>({ unlocked: null, phase: 'idle', doneText: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef(0);
  const clean = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const finishPhase = (phase: PollPhase, doneText: string) =>
    setState((prev) => ({ ...prev, phase, doneText }));

  /* 审批结果轮询（请求形状与状态分支与旧版 pollOnce 一致） */
  const pollOnce = useCallback((a: AccessPending) => {
    if (tickRef.current++ >= POLL_MAX) {
      try { localStorage.removeItem(ACCESS_KEY); } catch { /* noop */ }
      clean();
      finishPhase('timeout', '等待超时（30 分钟）。本人尚未操作，请稍后重新打开本页或再次提交申请。');
      return;
    }
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    const did = deviceId();
    if (did) headers['X-Device-Id'] = did;
    fetch(url(a.base, '/api/verify-access?id=' + encodeURIComponent(a.id)), {
      method: 'GET', headers, credentials: 'omit', cache: 'no-store',
    })
      .then((r) => {
        const ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) throw new Error('not_json');
        return r.json();
      })
      .then((d: Record<string, unknown>) => {
        if (d && d.error === 'device_mismatch') {
          try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(UNLOCK_KEY); } catch { /* noop */ }
          clean();
          setState({ unlocked: null, phase: 'deviceMismatch', doneText: '该次批准仅对申请时的设备有效。请在当前设备重新提交申请。' });
          return;
        }
        if (d && d.ok && d.status === 'approved') {
          const did2 = deviceId();
          try {
            localStorage.setItem(UNLOCK_KEY, JSON.stringify({
              id: a.id, device: did2, schoolId: a.schoolId,
              approvedAt: Number(d.approvedAt) || Date.now(),
              expiresAt: Number(d.expiresAt) || (Date.now() + ACCESS_TTL_MS),
            }));
          } catch { /* noop */ }
          try { localStorage.removeItem(ACCESS_KEY); } catch { /* noop */ }
          clean();
          setState({
            unlocked: readUnlock(), phase: 'approved',
            doneText: '本人已批准，学历核验板块已解锁。授权仅限当前设备、24 小时内有效，到期后需重新申请。',
          });
          return;
        }
        if (d && d.ok && d.status === 'expired') {
          try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(UNLOCK_KEY); } catch { /* noop */ }
          clean();
          setState({
            unlocked: null, phase: 'expired',
            doneText: '授权已到期（有效期 24 小时），请重新提交申请。',
            expiredAt: Date.now() - ACCESS_TTL_MS,
          });
          return;
        }
        if (d && d.ok && d.status === 'rejected') {
          try { localStorage.removeItem(ACCESS_KEY); } catch { /* noop */ }
          clean();
          finishPhase('reject', '本人未批准这次申请。如需继续，请补充身份信息后重新提交。');
          return;
        }
        timerRef.current = setTimeout(() => pollOnce(a), POLL_MS);
      })
      .catch(() => {
        /* 网络抖动不打断等待；404 多半是 github.io 直连无 Functions，下轮也不换 base，
           因为提交时已经记下了真正可用的 base */
        timerRef.current = setTimeout(() => pollOnce(a), POLL_MS);
      });
  }, []);

  /* 提交申请：POST /api/verify-access 多线路降级（与旧版一致） */
  const submit = useCallback((
    payload: Record<string, unknown>,
    onFail: (msg: string) => void,
    onOk: (polling: boolean) => void,
  ) => {
    const body = { ...payload, device: deviceInfo(), origin: location.href };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const did = deviceId();
    if (did) headers['X-Device-Id'] = did;
    const bases = apiBases();
    const schoolKey = schoolId || qId || '';
    const next = (i: number): void => {
      if (i >= bases.length) { onFail('网络异常，申请未提交，请稍后重试'); return; }
      const base = bases[i] ?? '';
      fetch(url(base, '/api/verify-access'), { method: 'POST', headers, credentials: 'omit', body: JSON.stringify(body) })
        .then((r) => {
          const ct = r.headers.get('content-type') || '';
          if (ct.indexOf('application/json') < 0) {
            if ((r.status === 404 || r.status >= 500) && i + 1 < bases.length) return next(i + 1);
            throw new Error('not_json');
          }
          return r.json().then((d: Record<string, unknown>) => {
            if (r.ok && d && d.ok) {
              if (d.requestId) {
                try {
                  localStorage.setItem(ACCESS_KEY, JSON.stringify({
                    id: String(d.requestId), base, schoolId: schoolKey, startedAt: Date.now(),
                  }));
                } catch { /* noop */ }
                tickRef.current = 0;
                clean();
                setState({ unlocked: null, phase: 'waiting', doneText: '' });
                timerRef.current = setTimeout(() => {
                  const a = readAccess();
                  if (a) pollOnce(a);
                }, 1200);
                onOk(true);
              } else {
                setState({ unlocked: null, phase: 'idle', doneText: '' });
                onOk(false);
              }
              return;
            }
            if (!r.ok && (r.status === 404 || r.status === 502) && i + 1 < bases.length) return next(i + 1);
            onFail(String(d.message || '提交失败，请稍后重试'));
          });
        }, () => next(i + 1));
    };
    next(0);
  }, [pollOnce, schoolId, qId]);

  /* 页面打开时：先认领仍在有效期内的解锁态，否则续上未完成的等待（bootAccess） */
  useEffect(() => {
    let rawUnlock: { expiresAt?: number } | null = null;
    try { rawUnlock = JSON.parse(localStorage.getItem(UNLOCK_KEY) || 'null'); } catch { rawUnlock = null; }
    const u = readUnlock();
    setState((s) => ({ ...s, unlocked: u || null }));
    if (u) return;
    if (rawUnlock && rawUnlock.expiresAt && Number(rawUnlock.expiresAt) <= Date.now()) {
      /* 过期授权：展示重锁提示 */
      setState((s) => ({ ...s, phase: 'expired', doneText: '', expiredAt: Number(rawUnlock.expiresAt) }));
    }
    const a = readAccess();
    if (a && Date.now() - (a.startedAt || 0) > POLL_MAX * POLL_MS) {
      try { localStorage.removeItem(ACCESS_KEY); } catch { /* noop */ }
      return;
    }
    if (a) {
      tickRef.current = 0;
      setState({ unlocked: null, phase: 'waiting', doneText: '' });
      timerRef.current = setTimeout(() => {
        const cur = readAccess();
        if (cur) pollOnce(cur);
      }, 1200);
    }
    return clean;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, submit };
}
