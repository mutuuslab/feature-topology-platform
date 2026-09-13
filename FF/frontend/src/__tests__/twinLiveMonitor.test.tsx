/**
 * §17.4 — 실시간 수렴 모니터 검증.
 *
 * 이 화면의 목적은 "live 라고 써 놓고 멈춰 있는 화면"을 없애는 것이다.
 * 따라서 테스트도 렌더 여부가 아니라 **시뮬레이션 tick 을 진행시켰을 때
 * 화면의 값이 실제로 바뀌는지**를 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider, createTwinProvider } from '../state/twinStore';
import { TwinFleet } from '../pages/twin';
import { useTwin } from '../state/twinStore';
import {
  describeTick,
  sampleDelta,
  sampleTick,
  sameSample,
  vinPulses,
} from '../components/liveMonitor';

/* ── 순수 모델 ─────────────────────────────────────────────────────── */

describe('§17.4 수렴 모니터 — 순수 모델', () => {
  it('샘플은 verdict 분포·신호 수신 수·임계값을 스냅샷에서 그대로 읽는다', () => {
    const provider = createTwinProvider({ rate: 0 });
    const snapshot = provider.getSnapshot();
    const s = sampleTick(snapshot);

    expect(s.tick).toBe(snapshot.clock.simTick);
    expect(s.total).toBe(snapshot.twins.length);
    expect(s.threshold).toBe(snapshot.convergence.threshold);
    expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(snapshot.twins.length);
    expect(s.ratePct).toBeCloseTo((s.converged / s.total) * 100, 1);
  });

  it('tick 을 진행하면 신호 수신(heartbeat)과 tick 이 실제로 바뀐다', () => {
    const provider = createTwinProvider({ rate: 1 });
    const before = sampleTick(provider.getSnapshot());

    provider.tick(1000);

    const after = sampleTick(provider.getSnapshot(), before.events);
    expect(after.tick).toBe(before.tick + 1);
    expect(after.at).toBeGreaterThan(before.at);
    // 온라인 차량은 매 tick 신호를 보내므로 "가장 오래된 신호 나이"가 되감긴다.
    expect(after.ageMaxS).toBeLessThanOrEqual(before.ageMaxS);
    expect(after.fresh).toBeGreaterThan(0);
    expect(sameSample(before, after)).toBe(false);
  });

  it('rate 0 이면 tick 을 호출해도 아무 값도 변하지 않는다', () => {
    const provider = createTwinProvider({ rate: 0 });
    const before = sampleTick(provider.getSnapshot());
    provider.tick(1000);
    const after = sampleTick(provider.getSnapshot());
    expect(sameSample(before, after)).toBe(true);
    expect(after.rate).toBe(0);
  });

  it('같은 두 샘플은 delta 가 비어 있고, 변화는 방향과 함께 보고된다', () => {
    const provider = createTwinProvider({ rate: 1 });
    const a = sampleTick(provider.getSnapshot());
    expect(sampleDelta(undefined, a)).toEqual([]);
    expect(sampleDelta(a, a)).toEqual([]);

    provider.tick(1000);
    const b = sampleTick(provider.getSnapshot(), a.events);
    const delta = sampleDelta(a, b, 'ko');
    expect(delta.length).toBeGreaterThan(0);
    expect(delta.every((d) => d.from !== d.to && d.delta === d.to - d.from)).toBe(true);
    expect(delta.some((d) => d.key === 'fresh')).toBe(true);
  });

  it('describeTick 은 변화 없음과 정지 상태를 구분해 알린다', () => {
    const provider = createTwinProvider({ rate: 0 });
    const frozen = sampleTick(provider.getSnapshot());
    expect(describeTick(frozen, frozen, 'ko')).toContain('정지');
    expect(describeTick(frozen, frozen, 'en')).toContain('paused');
  });

  it('VIN 펄스는 차량 수만큼 나오고 오프라인 차량을 구분한다', () => {
    const provider = createTwinProvider({ rate: 1 });
    const snapshot = provider.getSnapshot();
    const pulses = vinPulses(snapshot);

    expect(pulses).toHaveLength(snapshot.twins.length);
    expect(pulses.map((p) => p.vin)).toEqual([...pulses.map((p) => p.vin)].sort());
    const offline = snapshot.twins.filter((t) => !t.link.online).map((t) => t.vin);
    expect(pulses.filter((p) => !p.online).map((p) => p.vin)).toEqual(offline);
    // Desired/Reported/Effective 3층 비교가 화면까지 전달된다.
    const any = pulses[0];
    expect(typeof any.desiredState).toBe('string');
    expect(typeof any.reportedState).toBe('string');
    expect(typeof any.effectiveState).toBe('string');
  });
});

/* ── 화면 (실제 tick 진행) ──────────────────────────────────────────── */

function RoleSetter() {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role: 'Admin' });
  }, [dispatch]);
  return null;
}

/** 시뮬레이션을 수동으로 진행시키는 버튼 — 자동 interval 없이 결정적으로 검증한다. */
function Stepper() {
  const { step, activate, setRate } = useTwin();
  return (
    <div>
      <button onClick={() => step(5)}>TEST_STEP</button>
      <button onClick={() => activate('CANARY')}>TEST_ACTIVATE</button>
      <button onClick={() => setRate(1)}>TEST_RATE1</button>
    </div>
  );
}

function renderFleet(ui?: ReactNode) {
  return render(
    <MemoryRouter>
      <AppProvider>
        <RoleSetter />
        <TwinProvider>
          {ui ?? (
            <>
              <TwinFleet />
              <Stepper />
            </>
          )}
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

const tickText = () => screen.getByTestId('livemon-tick').textContent ?? '';
const rows = () => screen.getAllByTestId('livemon-tick-row');

describe('§17.4 수렴 모니터 — 화면', () => {
  beforeEach(() => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('모니터가 상태 분포·차량 격자·tick 로그와 함께 렌더된다', () => {
    renderFleet();
    const card = screen.getByTestId('live-convergence');

    expect(card).toBeInTheDocument();
    expect(screen.getByText('실시간 수렴 모니터')).toBeInTheDocument();
    expect(screen.getByText('수렴률 추세')).toBeInTheDocument();
    expect(screen.getByText('차량별 신호 수신 (하트비트)')).toBeInTheDocument();
    expect(card.querySelectorAll('[data-vin]')).toHaveLength(30);
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('livemon-summary')).toBeInTheDocument();
  });

  it('rate 0 이면 PAUSED 를 표시하고, Step 으로 진행하면 tick·로그·추세가 실제로 갱신된다', () => {
    renderFleet();
    expect(screen.getAllByText(/PAUSED/).length).toBeGreaterThan(0);
    expect(tickText()).toBe('tick 0');

    fireEvent.click(screen.getByText('TEST_STEP'));
    expect(tickText()).toBe('tick 1');

    fireEvent.click(screen.getByText('TEST_STEP'));
    fireEvent.click(screen.getByText('TEST_STEP'));
    expect(tickText()).toBe('tick 3');

    // tick 이력이 누적되어 로그 표가 늘어나고, 최신 행이 강조된다.
    const log = rows();
    expect(log.length).toBe(4);
    expect(log[0].getAttribute('data-current')).toBe('true');
    expect(log[0].textContent).toContain('3');
    // 하트비트도 갱신된다 (신호 수신 대수 표기).
    expect(screen.getAllByText(/신선|fresh/).length).toBeGreaterThan(0);
    // 배너는 rate 를 그대로 반영한다 — 하드코딩된 "LIVE" 가 아니다.
    fireEvent.click(screen.getByText('TEST_RATE1'));
    expect(screen.getByText(/LIVE 1×/)).toBeInTheDocument();
  });

  it('Rollout 을 활성화하면 수렴 파동(전달 대기 → 도달)이 화면에서 실제로 진행된다', () => {
    renderFleet();
    const recCount = (rec: string) =>
      screen.getByTestId('livemon-cells').querySelectorAll(`[data-rec="${rec}"]`).length;

    // t0 — 전 차량이 이미 수렴 상태이고 신호는 아직 없다.
    expect(recCount('CONVERGED')).toBe(22);
    expect(recCount('PENDING')).toBe(0);
    expect(screen.getByTestId('livemon-cells').querySelectorAll('[data-heartbeat="0"]')).toHaveLength(0);

    // desired=ON 전개 → 정책이 아직 도달하지 않은 차량이 생긴다.
    fireEvent.click(screen.getByText('TEST_ACTIVATE'));
    expect(recCount('PENDING')).toBe(3);
    expect(recCount('CONVERGED')).toBe(19);

    // 1 tick — 텔레메트리가 흐르고 전달이 하나 도착한다.
    fireEvent.click(screen.getByText('TEST_STEP'));
    expect(recCount('PENDING')).toBe(2);
    expect(recCount('CONVERGED')).toBe(20);
    expect(screen.getByTestId('livemon-cells').querySelectorAll('[data-heartbeat="0"]').length).toBeGreaterThan(0);

    // 2 tick — 나머지가 도착해 수렴으로 복귀한다.
    fireEvent.click(screen.getByText('TEST_STEP'));
    expect(recCount('PENDING')).toBe(0);
    expect(recCount('CONVERGED')).toBe(22);

    // 화면은 그 변화를 Δ 칩과 요약 문장으로 보고한다.
    const chips = screen.getByTestId('livemon-deltas').textContent ?? '';
    expect(chips).not.toContain('변화 없음');
    expect(chips).toContain('수렴 차량');
    // rate 0 이므로 요약은 "데이터 정지"를 정직하게 알린다(수동 Step 이라는 사실도 함께).
    expect(screen.getByTestId('livemon-summary').textContent ?? '').toContain('정지');
  });
});
