/**
 * 공용 모션 커널 — 화면 곳곳에 흩어진 반복 애니메이션을 **한 곳**에서 관리한다.
 *
 * 왜 필요한가
 *   화면마다 `setInterval`(실시간 틱·그래프 흔들림)과 `requestAnimationFrame`(숫자 카운트업)을
 *   따로 만들면 화면 하나를 오래 열어두거나 목록에서 카드 수십 개가 동시에 갱신될 때
 *   프레임이 계속 밀린다. 창을 가려도, 사용자가 멈춰도 계속 돈다.
 *
 * 구조
 *   1. 반복 작업은 이 커널의 **단일 루프**에 구독한다(구독자마다 타이머를 만들지 않는다).
 *   2. 구독자가 없으면 루프를 아예 만들지 않는다(빈 루프 0).
 *   3. 창이 가려지거나 · 사용자가 '실시간 모션'을 끄거나 · OS 가 모션 축소를 요청하면 루프를 멈춘다.
 *      → 정지 상태의 CPU 사용은 0 에 가깝다.
 *   4. 정지 중 예약된 카운트업은 즉시 최종값으로 끝난다(애니메이션을 기다리게 하지 않는다).
 *
 * 커널은 React 밖의 모듈 상태다. 그래서 어느 컴포넌트에서든 안전하게 구독할 수 있고,
 * Provider 는 '지금 돌려도 되는가'만 정한다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const PREF_KEY = 'fp.motion.v1';
/** 커널 루프가 도는지 확인하는 테스트용 통계. */
export interface KernelStats { jobs: number; tweens: number; paused: boolean; running: boolean }

interface Job { ms: number; last: number; cb: () => void }
interface Tween { start: number; ms: number; step: (p: number) => void; done?: () => void }

const jobs = new Set<Job>();
const tweens = new Set<Tween>();
let rafId: number | null = null;
/** 시작 상태는 '동작' — Provider 가 실제 상태를 곧바로 밀어 넣는다(Provider 없이도 커널은 정상 동작). */
let paused = false;

const raf = (cb: (t: number) => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(now()), 16) as unknown as number);
const cancelRaf = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function shouldRun() { return !paused && (jobs.size > 0 || tweens.size > 0); }

/**
 * 커널 루프 — 시각은 `performance.now()` 로 읽는다.
 * rAF 콜백 인자는 브라우저마다 절대 시각이지만 가짜 시계(테스트)에서는 '다음 프레임까지의 지연'이라 쓸 수 없다.
 */
function loop() {
  rafId = null;
  const t = now();
  jobs.forEach(j => {
    if (t - j.last < j.ms) return;
    // 주기를 누적해 계산한다 → 프레임 격자에 흔들려도 주기가 정확히 유지된다.
    j.last += j.ms;
    // 밀린 예약은 몰아서 실행하지 않는다(창을 되돌렸을 때 폭주 방지).
    if (t - j.last >= j.ms) j.last = t;
    try { j.cb(); } catch { /* 화면 하나의 오류가 커널 전체를 멈추지 않는다 */ }
  });
  if (tweens.size) {
    const finished: Tween[] = [];
    tweens.forEach(tw => {
      const p = tw.ms <= 0 ? 1 : Math.min(1, (t - tw.start) / tw.ms);
      tw.step(p);
      if (p >= 1) finished.push(tw);
    });
    finished.forEach(tw => { tweens.delete(tw); try { tw.done?.(); } catch { /* 무시 */ } });
  }
  schedule();
}

function schedule() {
  if (rafId === null && shouldRun()) rafId = raf(loop);
}

/** 주기 작업 구독 — 구독자마다 타이머를 만들지 않고 커널 루프를 공유한다. */
export function every(ms: number, cb: () => void): () => void {
  const job: Job = { ms: Math.max(16, ms), last: now(), cb };
  jobs.add(job);
  schedule();
  return () => {
    jobs.delete(job);
    if (!shouldRun() && rafId !== null) { cancelRaf(rafId); rafId = null; }
  };
}

/**
 * 진행 애니메이션(0→1) — 여러 컴포넌트가 하나의 rAF 로 묶인다.
 * 정지 상태에서는 즉시 최종값으로 끝난다.
 */
export function animate(ms: number, step: (p: number) => void, done?: () => void): () => void {
  if (paused || ms <= 0) { step(1); done?.(); return () => {}; }
  const tw: Tween = { start: now(), ms, step, done };
  tweens.add(tw);
  schedule();
  return () => { tweens.delete(tw); };
}

/** 커널 정지/재개 — 재개할 때는 밀린 작업을 몰아서 실행하지 않는다(폭주 방지). */
export function setPaused(next: boolean) {
  if (paused === next) return;
  paused = next;
  if (next) {
    if (rafId !== null) { cancelRaf(rafId); rafId = null; }
  } else {
    const t = now();
    jobs.forEach(j => { j.last = t; });
    tweens.forEach(tw => { tw.start = t; });
    schedule();
  }
}

/** 테스트·진단용 — 지금 무엇이 돌고 있는지. */
export function kernelStats(): KernelStats {
  return { jobs: jobs.size, tweens: tweens.size, paused, running: !paused && rafId !== null };
}

/**
 * 모든 구독과 예약을 즉시 버린다 — 테스트 격리용.
 * (구독자는 화면이 사라질 때 스스로 해제하므로 평소에는 쓸 일이 없다.)
 */
export function resetMotion() {
  jobs.clear();
  tweens.clear();
  if (rafId !== null) { cancelRaf(rafId); rafId = null; }
  paused = false;
}

// ── React 계층 ──

export interface MotionApi {
  /** 사용자가 고른 값. false 면 반복 애니메이션을 멈춘다. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** OS 모션 축소 요청(prefers-reduced-motion) 또는 사용자 정지. */
  reduced: boolean;
  /** 탭이 실제로 화면에 보이는가. */
  visible: boolean;
  /** 지금 반복 애니메이션을 돌려도 되는가 — 화면 코드의 단일 판단 기준. */
  running: boolean;
  /** 주기 작업 구독(커널 공유). */
  every: (ms: number, cb: () => void) => () => void;
}

function initialPref(): boolean {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === 'off') return false;
    if (saved === 'on') return true;
  } catch { /* 저장소 접근 불가 → OS 설정을 따른다 */ }
  return !prefersReduced();
}

function prefersReduced(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'));
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

const DEFAULT_API: MotionApi = {
  live: true, setLive: () => {}, reduced: false, visible: true, running: true, every,
};

const MotionCtx = createContext<MotionApi>(DEFAULT_API);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [live, setLiveState] = useState(initialPref);
  const reducedUser = useReducedMotion();
  const visible = useDocumentVisible();
  const reduced = reducedUser || !live;
  const running = visible && !reduced;

  const setLive = useCallback((v: boolean) => {
    setLiveState(v);
    try { localStorage.setItem(PREF_KEY, v ? 'on' : 'off'); } catch { /* 저장 실패는 동작에 영향 없음 */ }
  }, []);

  useEffect(() => { setPaused(!running); return () => setPaused(true); }, [running]);
  // CSS 무한 애니메이션도 같은 신호로 멈춘다(정지 상태에서 합성 레이어가 계속 돌지 않도록).
  useEffect(() => { document.documentElement.dataset.motion = running ? 'live' : 'calm'; }, [running]);

  const api = useMemo<MotionApi>(() => ({ live, setLive, reduced, visible, running, every }), [live, setLive, reduced, visible, running]);
  return <MotionCtx.Provider value={api}>{children}</MotionCtx.Provider>;
}

/** 지금 반복 애니메이션을 돌려도 되는지 + 사용자 제어. */
export const useMotion = () => useContext(MotionCtx);

/** 주기 작업 훅 — 정지 상태에서는 콜백이 호출되지 않는다. */
export function useMotionTick(ms: number, cb: () => void, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => { if (!enabled) return; return every(ms, () => ref.current()); }, [ms, enabled]);
}

/** 진행 애니메이션 훅 — 언마운트 시 자동 해제. */
export function useMotionTween(ms: number, step: (p: number) => void, done?: () => void, deps: unknown[] = []) {
  const stepRef = useRef(step); stepRef.current = step;
  const doneRef = useRef(done); doneRef.current = done;
  useEffect(() => animate(ms, p => stepRef.current(p), () => doneRef.current?.()), deps);
}
