/**
 * 모션 계약 — 화면이 느려지던 구조적 원인(구독자마다 타이머·rAF 를 따로 만들고,
 * 실시간 슬라이스가 바뀔 때마다 **모든** 화면이 리렌더되던 문제)에 대한 회귀 테스트.
 *
 * 지켜야 할 계약
 *   1. 구독자가 없으면 커널은 루프를 만들지 않는다(빈 루프 0).
 *   2. 구독을 해제하면 루프도 함께 사라진다.
 *   3. 정지 상태에서는 콜백이 아예 호출되지 않고, 정지 중 예약된 카운트업은 즉시 최종값으로 끝난다.
 *   4. 실시간 틱은 실시간 화면만 다시 그린다(비실시간 화면은 리렌더되지 않는다).
 *   5. 실시간 구독자가 없으면 LIVE_TICK 자체가 돌지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { every, animate, setPaused, resetMotion, kernelStats, MotionProvider, useMotion } from '../state/motion';
import { AppProvider, useApp, useLive, useLiveSlices } from '../store';

/**
 * 시뮬레이션 시계는 rAF 로 돌기 때문에 테스트에서도 rAF·performance 를 함께 가짜로 바꿔야
 * "30초 진행" 같은 시간 계산이 벽시계가 아니라 가짜 시계를 따른다.
 */
function fakeTimers() {
  return {
    toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] as Array<
      'setInterval' | 'clearInterval' | 'requestAnimationFrame' | 'cancelAnimationFrame' | 'performance'
    >,
  };
}

/** 커널은 모듈 전역 상태를 쓴다 — 파일 안의 테스트끼리 섞이지 않도록 매번 정리한다. */
beforeEach(() => {
  localStorage.clear();
  resetMotion();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetMotion();
});

describe('모션 커널 — 반복 애니메이션은 한 곳에서만 돈다', () => {
  it('구독자가 없으면 루프를 만들지 않는다', () => {
    expect(kernelStats()).toMatchObject({ jobs: 0, tweens: 0, running: false });
  });

  it('여러 화면이 구독해도 커널 작업은 구독자 수만큼이지만 루프는 하나다', () => {
    vi.useFakeTimers(fakeTimers());
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const off = [every(1000, a), every(1000, b), every(50, c)];
    expect(kernelStats().jobs).toBe(3);
    expect(kernelStats().running).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    // 주기가 누적 계산되므로 프레임 격자(16ms)에 흔들리지 않는다.
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(c).toHaveBeenCalledTimes(40);
    off.forEach(f => f());
    expect(kernelStats().jobs).toBe(0);
    expect(kernelStats().running).toBe(false);
  });

  it('정지하면 콜백이 멈추고, 재개하면 밀린 분을 몰아서 실행하지 않는다', () => {
    vi.useFakeTimers(fakeTimers());
    const cb = vi.fn();
    const off = every(1000, cb);
    // 프레임 격자(16ms)가 1000ms 배수와 항상 맞물리지는 않으므로 8배수 구간에서 확인한다.
    act(() => { vi.advanceTimersByTime(8000); });
    expect(cb).toHaveBeenCalledTimes(8);
    setPaused(true);
    expect(kernelStats().running).toBe(false);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(cb).toHaveBeenCalledTimes(8); // 정지 중에는 한 번도 돌지 않는다
    const before = cb.mock.calls.length;
    setPaused(false);
    act(() => { vi.advanceTimersByTime(10_000); });
    const delta = cb.mock.calls.length - before;
    // 재개하면 다시 흐르지만(10초에 9~10회), 60초치를 몰아서 실행하지는 않는다(60회가 되면 실패).
    expect(delta).toBeGreaterThanOrEqual(9);
    expect(delta).toBeLessThanOrEqual(10);
    off();
  });

  it('정지 중 예약된 카운트업은 기다리게 하지 않고 즉시 최종값으로 끝난다', () => {
    setPaused(true);
    const step = vi.fn();
    const done = vi.fn();
    animate(900, step, done);
    expect(step).toHaveBeenCalledWith(1);
    expect(done).toHaveBeenCalled();
    expect(kernelStats().tweens).toBe(0);
  });
});

describe('실시간 슬라이스 분리 — 틱은 실시간 화면만 다시 그린다', () => {
  it('실시간 구독자가 없으면 LIVE_TICK 이 아예 돌지 않는다', () => {
    vi.useFakeTimers(fakeTimers());
    render(<AppProvider><NonLive /></AppProvider>);
    expect(kernelStats().jobs).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(kernelStats().jobs).toBe(0);
  });

  it('실시간 화면이 붙으면 틱이 돌고, 비실시간 화면은 리렌더되지 않는다', () => {
    vi.useFakeTimers(fakeTimers());
    const nonLiveRenders = vi.fn();
    render(
      <AppProvider>
        <NonLive onRender={nonLiveRenders} />
        <LiveConsumer />
      </AppProvider>,
    );
    expect(screen.getByTestId('live-tick').textContent).toBe('0');
    expect(nonLiveRenders).toHaveBeenCalledTimes(1);
    // 2초 주기 틱 — 4초 진행하면 tick 은 2, AppCtx 를 구독하는 화면은 그대로다.
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByTestId('live-tick').textContent).toBe('2');
    expect(nonLiveRenders).toHaveBeenCalledTimes(1);
  });

  it('실시간 화면을 닫으면 틱도 사라진다', () => {
    vi.useFakeTimers(fakeTimers());
    const view = render(<AppProvider><LiveConsumer /></AppProvider>);
    expect(kernelStats().jobs).toBe(1);
    view.unmount();
    expect(kernelStats().jobs).toBe(0);
  });

  it('틱이 갱신하는 다른 슬라이스도 구독한 화면에서는 최신값으로 흐른다', () => {
    vi.useFakeTimers(fakeTimers());
    render(<AppProvider><NonLive /><SliceConsumer /></AppProvider>);
    const before = screen.getByTestId('slice-revenue').textContent;
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByTestId('slice-revenue').textContent).not.toBe(before);
  });
});

describe('MotionProvider — 정지 신호를 CSS 와 커널에 함께 내린다', () => {
  it('실행 중이면 html[data-motion="live"] 이고 커널도 돈다', () => {
    vi.useFakeTimers(fakeTimers());
    render(<MotionProvider><Probe /></MotionProvider>);
    expect(document.documentElement.dataset.motion).toBe('live');
    expect(screen.getByTestId('probe-running').textContent).toBe('live');
    expect(kernelStats().paused).toBe(false);
  });

  it('정지하면 html[data-motion="calm"] 이 되어 CSS 반복 애니메이션도 멈춘다', () => {
    vi.useFakeTimers(fakeTimers());
    render(<MotionProvider><Probe /></MotionProvider>);
    act(() => { screen.getByTestId('probe-toggle').click(); });
    expect(document.documentElement.dataset.motion).toBe('calm');
    expect(screen.getByTestId('probe-running').textContent).toBe('calm');
    expect(kernelStats().paused).toBe(true);
    // 저장되어 새로 열어도 유지된다.
    expect(localStorage.getItem('fp.motion.v1')).toBe('off');
  });
});

function NonLive({ onRender }: { onRender?: () => void }) {
  useApp();
  onRender?.();
  return <span data-testid="non-live">non-live</span>;
}

function LiveConsumer() {
  const live = useLive();
  return <span data-testid="live-tick">{live.tick}</span>;
}

/** LIVE_TICK 이 함께 갱신하는 슬라이스(구독/과금)를 읽는 화면. */
function SliceConsumer() {
  const { subscriptions } = useLiveSlices();
  return <span data-testid="slice-revenue">{subscriptions.reduce((a, s) => a + s.revenueWon, 0)}</span>;
}

function Probe() {
  const motion = useMotion();
  return (
    <>
      <span data-testid="probe-running">{motion.running ? 'live' : 'calm'}</span>
      <button data-testid="probe-toggle" onClick={() => motion.setLive(!motion.live)}>toggle</button>
    </>
  );
}
