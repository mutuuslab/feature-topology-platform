/**
 * §17.5 — "live 라벨이 실제로 움직이는가" 회귀 방지.
 *
 * 이 파일이 고정하는 단일 주장: 차량·폐루프 화면의 **모든 움직임은
 * `snapshot.clock` 에서 파생**된다. 따라서
 *   · rate 0 → 아무것도 변하지 않는다 (거짓 애니메이션 금지)
 *   · tick 이 흐르면 TTL 잔여가 줄고 수신 스트림이 늘어난다
 *   · 결함이 주입되면 수신이 멈추고 TTL 이 소진되어 판정이 거부된다
 * 를 값으로 검증한다. 새 타이머·난수·고정 문구는 쓰지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider, createTwinProvider } from '../state/twinStore';
import { VehicleTelemetryLive } from '../components/VehicleTelemetryLive';
import { TwinVehicle, TwinIncident } from '../pages/twinOps';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { freshnessSummary, signalFreshness, vehicleFlowState, vinTelemetryFrame } from '../components/telemetryLive';

/* ------------------------------------------------------------------ */
/* 공통 헬퍼                                                            */
/* ------------------------------------------------------------------ */

/** 새 Provider + WAVE 활성화 → "이미 배포된 차량"을 만든다(결함은 배포된 차량에서만 관측된다). */
function activated(scope: 'CANARY' | 'WAVE' = 'WAVE') {
  const provider = createTwinProvider({ rate: 0 });
  provider.activatePolicy(scope);
  const snapshot = provider.getSnapshot();
  return { provider, snapshot, vin: snapshot.rollout.activatedVins[0] };
}

function RoleSetter({ role }: { role: string }) {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role });
  }, [role, dispatch]);
  return null;
}

function renderTwin(ui: ReactNode, opts: { route: string; initial: string; role?: string } = { route: '/', initial: '/' }) {
  return render(
    <MemoryRouter initialEntries={[opts.initial]}>
      <AppProvider>
        <RoleSetter role={opts.role ?? 'integrator'} />
        <TwinProvider>
          <Routes>
            <Route path={opts.route} element={<>{ui}</>} />
          </Routes>
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

/* ------------------------------------------------------------------ */
/* A. TTL 신선도 — 순수 함수                                            */
/* ------------------------------------------------------------------ */

describe('§17.5-A 신호 TTL 신선도 모델', () => {
  const { snapshot } = activated();
  const twin = snapshot.twins[0];
  const t0 = snapshot.clock.simTimeMs;

  it('모든 신호 스펙에 대해 잔여 시간과 게이지 비율을 계산한다', () => {
    const rows = signalFreshness(twin, t0);
    expect(rows.map((r) => r.key)).toEqual(T.SIGNAL_SPECS.map((s) => s.key));
    rows.forEach((r) => {
      expect(r.ttlS).toBe(T.SIGNAL_BY_KEY[r.key].ttlSeconds);
      expect(r.ratio).toBeGreaterThanOrEqual(0);
      expect(r.ratio).toBeLessThanOrEqual(1);
      expect(r.vss).toContain('Vehicle.');
      if (r.ageS != null) expect(r.remainS).toBe(Math.round(r.ttlS - r.ageS));
      else expect(r.remainS).toBeNull();
    });
  });

  it('시각이 30초 흐르면 잔여가 정확히 30초 줄고 게이지가 줄지 않는다', () => {
    const a = signalFreshness(twin, t0);
    const b = signalFreshness(twin, t0 + 30_000);
    a.forEach((r, i) => {
      if (r.remainS == null) {
        expect(b[i].remainS).toBeNull();
        expect(b[i].ratio).toBe(1);
        return;
      }
      expect(b[i].remainS).toBe(r.remainS - 30);
      expect(b[i].ratio).toBeGreaterThanOrEqual(r.ratio);
    });
  });

  it('만료 판정은 엔진의 staleSignals 와 정확히 일치한다 (카드 ↔ 판정 불일치 금지)', () => {
    const far = t0 + 6 * 3600 * 1000;
    const fromEngine = E.staleSignals(twin, far).map(String).sort();
    const fromCard = signalFreshness(twin, far)
      .filter((r) => r.unusable)
      .map((r) => String(r.key))
      .sort();
    expect(fromEngine.length).toBe(T.SIGNAL_SPECS.length);
    expect(fromCard).toEqual(fromEngine);

    const summary = freshnessSummary(signalFreshness(twin, far), 'ko');
    expect(summary.total).toBe(T.SIGNAL_SPECS.length);
    expect(summary.stale).toBe(summary.total);
    expect(summary.usable).toBe(0);
    expect(summary.next).toBeNull();
    expect(summary.text).toContain('전부 만료');
  });

  it('시각이 흐를수록 신선 개수가 단조 감소하고 결국 전부 만료된다', () => {
    let prev = freshnessSummary(signalFreshness(twin, t0), 'ko');
    for (let h = 1; h <= 6; h++) {
      const cur = freshnessSummary(signalFreshness(twin, t0 + h * 3600_000), 'ko');
      expect(cur.usable).toBeLessThanOrEqual(prev.usable);
      prev = cur;
    }
    expect(prev.usable).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* B. 흐름 상태 + 수신 프레임                                           */
/* ------------------------------------------------------------------ */

describe('§17.5-B 흐름 상태와 수신 프레임', () => {
  const { snapshot } = activated();
  const now = snapshot.clock.simTimeMs;
  const recent = new Date(now - 2000).toISOString();
  const base = snapshot.twins[0];

  /** 모든 신호를 "2초 전 수신"으로 맞춘 정상 차량. */
  const live: T.Twin = {
    ...base,
    link: { ...base.link, online: true, lastSeenAt: recent },
    context: Object.fromEntries(
      Object.entries(base.context).map(([k, s]) => [k, s && { ...s, observedAt: recent }]),
    ) as T.Twin['context'],
  };

  it('온라인 + 최근 수신이면 판정 가능으로 판정한다', () => {
    const st = vehicleFlowState(live, now, 'ko');
    expect(st.online).toBe(true);
    expect(st.streaming).toBe(true);
    expect(st.sinceLastRxS).toBeCloseTo(2, 0);
    expect(st.nextExpiryS).toBeGreaterThan(0);
    expect(T.pick(st.gate, 'ko')).toContain('판정 가능');
  });

  it('오프라인이면 수신 여부와 무관하게 판정을 보류한다', () => {
    const offline = { ...live, link: { ...live.link, online: false } };
    const st = vehicleFlowState(offline, now, 'ko');
    expect(st.online).toBe(false);
    expect(st.streaming).toBe(false);
    expect(T.pick(st.gate, 'ko')).toContain('오프라인');
  });

  it('수신이 끊기고 TTL 이 소진되면 안전 판단을 거부한다', () => {
    const st = vehicleFlowState(live, now + 20 * 60 * 1000, 'ko');
    expect(st.streaming).toBe(false);
    expect(T.pick(st.gate, 'ko')).toContain('TTL 만료');
  });

  it('수신 프레임은 시뮬레이터 tick·수신 시각·만료 목록에서 파생된다', () => {
    const { provider, vin } = activated();
    const before = vinTelemetryFrame(provider.getSnapshot(), vin)!;
    provider.step(1);
    const after = vinTelemetryFrame(provider.getSnapshot(), vin)!;

    expect(after.tick).toBe(before.tick + 1);
    expect(after.atMs).toBeGreaterThan(before.atMs);
    expect(after.received).toBeGreaterThan(0);
    expect(after.received).toBeLessThanOrEqual(after.total);
    expect(after.total).toBe(T.SIGNAL_SPECS.length);
    expect(after.online).toBe(true);
    expect(after.staleKeys).toEqual(E.staleSignals(provider.getSnapshot().twins.find((t) => t.vin === vin)!, provider.getSnapshot().clock.simTimeMs).map(String));
  });

  it('없는 VIN 은 프레임을 만들지 않는다', () => {
    expect(vinTelemetryFrame(snapshot, 'VIN-NOPE')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* C. 컴포넌트 — 실제로 움직이는가                                      */
/* ------------------------------------------------------------------ */

describe('§17.5-C 차량 텔레메트리 카드', () => {
  it('수신이 살아 있으면 프레임이 tick 마다 하나씩 쌓인다', () => {
    const { provider, vin } = activated();
    const view = render(<VehicleTelemetryLive snapshot={provider.getSnapshot()} vin={vin} lang="ko" />);
    const step = (s: number) => {
      act(() => {
        provider.step(s);
      });
      view.rerender(<VehicleTelemetryLive snapshot={provider.getSnapshot()} vin={vin} lang="ko" />);
    };
    const remainOf = (key: string) =>
      Number(
        (view.container.querySelector(`[data-testid="vtel-remain"][data-signal="${key}"]`)?.textContent ?? '')
          .replace('s', ''),
      );

    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-paused', 'true');
    // 최초 렌더는 "마지막 수신 1건"만 보여주고, 시계가 멈춰 있어 아직 흐르지 않는다
    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-streaming', 'false');
    expect(screen.getAllByTestId('vtel-frame').length).toBe(1);

    step(1);
    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-streaming', 'true');
    expect(screen.getAllByTestId('vtel-frame').length).toBe(2);
    step(1);
    step(1);
    expect(screen.getAllByTestId('vtel-frame').length).toBe(4);

    // 수신될 때마다 TTL 타이머는 되감긴다 → 잔여가 최대치 근처로 복귀
    expect(remainOf('BatterySoc')).toBeGreaterThan(T.SIGNAL_BY_KEY.BatterySoc.ttlSeconds - 5);
    expect(Number((screen.getByTestId('vtel-since-rx').textContent ?? '').replace('s', ''))).toBeLessThanOrEqual(1);
  });

  it('텔레메트리가 끊기면 스트림이 멈추고 TTL 이 소진되어 판정이 거부된다', () => {
    const { provider, vin } = activated();
    const view = render(<VehicleTelemetryLive snapshot={provider.getSnapshot()} vin={vin} lang="ko" />);
    const step = (s: number) => {
      act(() => {
        provider.step(s);
      });
      view.rerender(<VehicleTelemetryLive snapshot={provider.getSnapshot()} vin={vin} lang="ko" />);
    };
    const remainOf = (key: string) =>
      Number(
        (view.container.querySelector(`[data-testid="vtel-remain"][data-signal="${key}"]`)?.textContent ?? '')
          .replace('s', ''),
      );
    const staleOf = (key: string) =>
      view.container.querySelector(`[data-testid="vtel-signal"][data-signal="${key}"]`)?.getAttribute('data-stale');

    step(1);
    step(1);
    const framesAtFault = screen.getAllByTestId('vtel-frame').length;
    const socBefore = remainOf('BatterySoc');
    expect(staleOf('BatteryTemperature')).toBe('false');

    // 장애 주입 → 이 차량은 수신 대상에서 빠진다 (BatteryTemperature 는 UNCERTAIN + 900초 과거)
    act(() => {
      provider.injectFault('BATTERY_TEMP_STALE', [vin]);
      provider.step(60);
    });
    view.rerender(<VehicleTelemetryLive snapshot={provider.getSnapshot()} vin={vin} lang="ko" />);
    step(60);

    expect(screen.getAllByTestId('vtel-frame').length).toBe(framesAtFault); // 수신 정지 = 스트림 정지
    expect(staleOf('BatteryTemperature')).toBe('true');
    expect(remainOf('BatterySoc')).toBe(socBefore - 120); // 무수신 120초 → 잔여 정확히 120초 감소
    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-streaming', 'false');
    expect(screen.getByTestId('vtel-gate').textContent).toContain('TTL 만료');
    expect(Number((screen.getByTestId('vtel-since-rx').textContent ?? '').replace('s', ''))).toBeGreaterThanOrEqual(120);
  });

  it('시뮬레이터가 정지해 있으면 화면도 멈춘다 (거짓 애니메이션 금지)', () => {
    const { provider, vin, snapshot } = activated();
    const view = render(<VehicleTelemetryLive snapshot={snapshot} vin={vin} lang="ko" />);
    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-paused', 'true');

    const before = view.container.innerHTML;
    // 같은 시각의 새 스냅샷으로 다시 렌더해도 DOM 이 변하지 않아야 한다(중복 프레임도 없어야 한다)
    view.rerender(<VehicleTelemetryLive snapshot={{ ...snapshot }} vin={vin} lang="ko" />);
    expect(screen.getAllByTestId('vtel-frame').length).toBe(1);
    expect(view.container.innerHTML).toBe(before);
    expect(provider.getSnapshot().clock.rate).toBe(0);
  });

  it('없는 VIN 은 안내 문구를 보여준다', () => {
    const { snapshot } = activated();
    render(<VehicleTelemetryLive snapshot={snapshot} vin="VIN-NOPE" lang="ko" />);
    expect(screen.getByTestId('vtel-missing')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* D. 화면 통합 — 차량 상세                                              */
/* ------------------------------------------------------------------ */

describe('§12.4 차량 상세의 live 구성', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('실시간 텔레메트리 카드와 차량 3D 슬롯을 함께 렌더한다', () => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
    renderTwin(<TwinVehicle />, { route: '/twin/vehicle/:vin', initial: '/twin/vehicle/VIN-DEMO-017' });

    expect(screen.getByRole('heading', { name: /Vehicle Twin/ })).toBeInTheDocument();
    const card = screen.getByTestId('vehicle-telemetry-live');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-paused', 'true');
    expect(screen.getByTestId('vtel-summary').textContent).toMatch(/신선 \d+\/6/);
    expect(screen.getAllByTestId('vtel-signal').length).toBe(T.SIGNAL_SPECS.length);

    // jsdom 에는 WebGL 이 없다 → three.js 를 받지 않고 폴백을 그린다
    expect(screen.getByTestId('vehicle-3dbox')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-3d-fallback')).toBeInTheDocument();
  });

  it('3D 시각화는 탭 아래에 있으므로 헤더에서 바로 내려갈 수 있어야 한다', () => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
    renderTwin(<TwinVehicle />, { route: '/twin/vehicle/:vin', initial: '/twin/vehicle/VIN-DEMO-017' });

    const box = screen.getByTestId('vehicle-3dbox');
    const jump = vi.fn();
    (box as unknown as { scrollIntoView: unknown }).scrollIntoView = jump;
    const btn = screen.getByRole('button', { name: /차량 3D 보기/ });

    fireEvent.click(btn);
    expect(jump).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    // prefers-reduced-motion 이면 긴 스크롤 애니메이션을 쓰지 않는다
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    fireEvent.click(btn);
    expect(jump).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'center' });
  });
});

/* ------------------------------------------------------------------ */
/* E. 화면 통합 — 폐루프는 시뮬레이터 시각에서 파생된다                  */
/* ------------------------------------------------------------------ */

describe('§12.5 Closed-Loop 진행의 live 파생', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('rate 0 이면 진행률·카운트다운이 전혀 변하지 않는다', () => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const view = renderTwin(<TwinIncident />, { route: '/', initial: '/' });
    fireEvent.click(screen.getByTestId('seed-incident'));

    const pct = () => screen.getByTestId('incident-loop-pct').textContent;
    const line = () => screen.getByTestId('incident-loop-line').textContent;
    const p0 = pct();
    const l0 = line();
    expect(view.container.querySelector('.twin-progress-track > i')).toHaveAttribute('data-paused', 'true');
    expect(l0).toContain('경과 0s');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(pct()).toBe(p0);
    expect(line()).toBe(l0);
  });

  it('시계가 흐르면 12단계 진행률과 카운트다운이 실제로 전진한다', () => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 1 }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const view = renderTwin(<TwinIncident />, { route: '/', initial: '/' });
    fireEvent.click(screen.getByTestId('seed-incident'));
    expect(screen.getByText(/INC-0001 생성/)).toBeInTheDocument();

    const pct = () => Number((screen.getByTestId('incident-loop-pct').textContent ?? '').replace('%', ''));
    const line = () => screen.getByTestId('incident-loop-line').textContent ?? '';
    /** 폐루프 단계 표의 ACTIVE 행 번호 — Incident 목록 행과 구분해야 한다. */
    const activeStep = () => {
      const rows = Array.from(view.container.querySelectorAll('tr.twin-open'));
      const stepRow = rows.find((r) => /^\d+$/.test((r.querySelector('td')?.textContent ?? '').trim()));
      return (stepRow?.querySelector('td')?.textContent ?? '').trim();
    };

    // 주입 직후: 자동 일시정지로 6단계까지 저장되어 있다
    expect(pct()).toBe(50);
    expect(line()).toContain('경과 0s');
    expect(line()).toContain('단계 7/12');
    const firstActive = activeStep();
    expect(firstActive).toBe('7');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(pct()).toBe(58); // 30초 = 7단계
    expect(line()).toContain('경과 30s');
    expect(line()).toContain('단계 8/12');
    expect(line()).toContain('자동 진행 ON');
    expect(activeStep()).toBe('8');
    expect(activeStep()).not.toBe(firstActive);
    expect(Number((screen.getByTestId('incident-loop-countdown').textContent ?? '').replace('s', ''))).toBe(2);
  });
});
