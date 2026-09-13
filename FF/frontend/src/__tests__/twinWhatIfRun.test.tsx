/**
 * §17.5 — What-if 시뮬레이션 러너 검증.
 *
 * 요구사항은 "What-if simulation 도 실제 시뮬레이션을 보여야 한다" 이다.
 * 따라서 테스트는 표가 렌더되는지가 아니라, **시뮬레이션 시계를 진행시키면
 * 엔진이 만든 실제 이벤트가 순서대로 공개되는지**를 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider } from '../state/twinStore';
import { TwinSimulation } from '../pages/twin';
import * as E from '../data/twin/engine';
import { TWIN_NOW_MS } from '../state/twinStore';
import { buildPhases, frameOf, phaseSummary } from '../components/whatIfRun';

const inputsFor = (id: string) => E.simInputsFor(E.SIM_PRESETS.find((p) => p.id === id) ?? E.SIM_PRESETS[0]);
const normal = () => E.runSimulation(inputsFor('NORMAL'), TWIN_NOW_MS);
const killSwitch = () => E.runSimulation(inputsFor('KILL_SWITCH'), TWIN_NOW_MS);

/* ── 순수 모델 ─────────────────────────────────────────────────────── */

describe('§17.5 What-if 러너 — 순수 모델', () => {
  it('국면은 엔진 이벤트를 순서대로 빠짐없이 묶는다 (from/to 연속)', () => {
    const r = normal();
    const phases = buildPhases(r);

    expect(phases.length).toBeGreaterThanOrEqual(4);
    expect(phases.reduce((a, p) => a + p.events.length, 0)).toBe(r.eventLog.length);
    phases.forEach((p, i) => {
      expect(p.no).toBe(i + 1);
      expect(p.to).toBe(p.from + p.events.length);
      expect(p.events.length).toBeGreaterThan(0);
      if (i > 0) expect(p.from).toBe(phases[i - 1].to);
    });
    expect(phases[0].group).toBe('AS_BUILT');
    expect(phases[phases.length - 1].group).toBe('RECONCILE');
  });

  it('Kill-Switch 시나리오는 실제로 다른 국면 구성(안전 우선 처리)을 만든다', () => {
    const r = killSwitch();
    const phases = buildPhases(r);
    expect(r.eventLog.some((e) => e.eventType === 'kill-switch.requested')).toBe(true);
    expect(phases.some((p) => p.group === 'SAFETY')).toBe(true);
    expect(phases.find((p) => p.group === 'SAFETY')!.events.some((e) => e.severity === 'FAIL')).toBe(true);
  });

  it('재생 전에는 아무 이벤트도 공개되지 않는다', () => {
    const r = normal();
    const f = frameOf(null, TWIN_NOW_MS, r);
    expect(f.started).toBe(false);
    expect(f.elapsedSeconds).toBe(0);
    expect(f.revealed).toHaveLength(0);
    expect(f.progress).toBe(0);
    expect(f.finished).toBe(false);
    expect(f.phaseStatus.every((s) => s === 'PENDING')).toBe(true);
  });

  it('시뮬레이션 1초마다 정확히 이벤트 1건이 공개된다', () => {
    const r = normal();
    const phases = buildPhases(r);
    for (let s = 0; s <= 3; s += 1) {
      const f = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + s * 1000, r, phases);
      expect(f.elapsedSeconds).toBe(s);
      expect(f.revealed).toHaveLength(s);
      expect(f.revealed.map((e) => e.eventType)).toEqual(r.eventLog.slice(0, s).map((e) => e.eventType));
      expect(f.pendingEvents).toBe(r.eventLog.length - s);
    }
  });

  it('시계가 멈추면(rate 0) 재생도 멈춘다 — 같은 시각은 같은 프레임을 준다', () => {
    const r = normal();
    const a = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + 4000, r);
    const b = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + 4000, r);
    expect(a.revealed.length).toBe(b.revealed.length);
    expect(a.phaseStatus).toEqual(b.phaseStatus);
    expect(a.elapsedSeconds).toBe(4);
  });

  it('이벤트 수를 넘겨도 커서는 clamp 되고 완료 상태가 유지된다', () => {
    const r = normal();
    const total = r.eventLog.length;
    const f = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + 999_000, r);
    expect(f.revealed).toHaveLength(total);
    expect(f.pendingEvents).toBe(0);
    expect(f.finished).toBe(true);
    expect(f.progress).toBe(1);
    expect(f.phaseStatus.every((s) => s === 'PASS' || s === 'FAIL' || s === 'WARN')).toBe(true);
  });

  it('국면 상태는 공개가 진행됨에 따라 PENDING → RUNNING → 판정으로 바뀐다', () => {
    const r = killSwitch();
    const phases = buildPhases(r);
    const safety = phases.findIndex((p) => p.group === 'SAFETY');
    const atStart = frameOf(TWIN_NOW_MS, TWIN_NOW_MS, r, phases);
    const mid = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + (phases[safety].from + 1) * 1000, r, phases);
    const end = frameOf(TWIN_NOW_MS, TWIN_NOW_MS + 999_000, r, phases);

    expect(atStart.phaseStatus[safety]).toBe('PENDING');
    expect(mid.phaseStatus[safety]).not.toBe('PENDING');
    expect(end.phaseStatus[safety]).toBe('FAIL');
    expect(phaseSummary(phases[safety], mid.phaseStatus[safety], 'ko')).toContain('FAIL');
    expect(phaseSummary(phases[0], 'PENDING', 'ko')).toContain('대기');
  });
});

/* ── 화면 ──────────────────────────────────────────────────────────── */

function RoleSetter() {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role: 'integrator' });
  }, [dispatch]);
  return null;
}

function renderSim() {
  return render(
    <MemoryRouter>
      <AppProvider>
        <RoleSetter />
        <TwinProvider>
          <TwinSimulation />
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

const card = () => screen.getByTestId('whatif-runner');
const elapsed = () => Number(card().getAttribute('data-elapsed'));
const revealed = () => screen.getByTestId('wif-log').querySelectorAll('li[data-severity]').length;

describe('§17.5 What-if 러너 — 화면', () => {
  beforeEach(() => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0, simInputs: inputsFor('NORMAL') }));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('러너가 파이프라인·로그·판정 영역과 함께 렌더된다', () => {
    renderSim();
    expect(card()).toBeInTheDocument();
    expect(screen.getByTestId('wif-pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('wif-current')).toBeInTheDocument();
    expect(screen.getByTestId('wif-log')).toBeInTheDocument();
    // 아직 실행 전 — 재생 로그는 비어 있고 최종 판정은 잠겨 있다.
    expect(revealed()).toBe(0);
    expect(screen.getByTestId('wif-verdict').className).not.toContain('on');
    expect(screen.getByTestId('wif-state').textContent).toContain('정지');
  });

  it('실행을 누르면 시계가 돌고, 1초 스텝마다 실제 이벤트가 한 건씩 드러난다', () => {
    renderSim();
    fireEvent.click(screen.getByTestId('wif-run'));

    // rate 0 → 실행이 시계를 1× 로 켠다.
    expect(card().getAttribute('data-rate')).toBe('1');
    expect(screen.getByTestId('wif-state').textContent).toContain('재생 중');
    expect(elapsed()).toBe(0);

    fireEvent.click(screen.getByTestId('wif-step'));
    expect(elapsed()).toBe(1);
    expect(revealed()).toBe(1);

    fireEvent.click(screen.getByTestId('wif-step'));
    fireEvent.click(screen.getByTestId('wif-step'));
    expect(elapsed()).toBe(3);
    expect(revealed()).toBe(3);

    // 로그는 엔진이 만든 이벤트 타입/설명을 그대로 보여준다 (합성 문자열이 아니다).
    const first = screen.getByTestId('wif-log').querySelector('li[data-severity]')!.textContent ?? '';
    expect(first).toContain('vehicle.as-built.updated');
    // 국면 노드도 하나 이상 판정 상태로 넘어간다.
    expect(screen.getByTestId('wif-pipeline').querySelectorAll('[data-status="PENDING"]').length)
      .toBeLessThan(screen.getByTestId('wif-pipeline').querySelectorAll('[data-phase]').length);
  });

  it('정지는 시계를 멈추고 진행을 되돌리지 않는다 — 재개/초기화가 실제로 동작한다', () => {
    renderSim();
    fireEvent.click(screen.getByTestId('wif-run'));
    fireEvent.click(screen.getByTestId('wif-step'));
    fireEvent.click(screen.getByTestId('wif-step'));
    expect(elapsed()).toBe(2);

    fireEvent.click(screen.getByTestId('wif-pause'));
    expect(card().getAttribute('data-rate')).toBe('0');
    expect(elapsed()).toBe(2); // 정지해도 이미 재생된 구간은 유지
    expect(revealed()).toBe(2);

    fireEvent.click(screen.getByTestId('wif-resume'));
    expect(card().getAttribute('data-rate')).toBe('1');

    fireEvent.click(screen.getByTestId('wif-reset'));
    expect(card().getAttribute('data-rate')).toBe('0');
    expect(elapsed()).toBe(0);
    expect(revealed()).toBe(0);
    expect(screen.getByTestId('wif-verdict').className).not.toContain('on');
  });

  it('마지막 이벤트까지 재생되면 최종 판정이 공개되고 시계가 더 나아가지 않는다', () => {
    renderSim();
    const total = normal().eventLog.length;
    fireEvent.click(screen.getByTestId('wif-run'));

    for (let i = 0; i < total; i += 1) fireEvent.click(screen.getByTestId('wif-step'));

    expect(elapsed()).toBe(total);
    expect(revealed()).toBe(total);
    expect(screen.getByTestId('wif-verdict').className).toContain('on');
    expect(screen.getByTestId('wif-state').textContent).toContain('재생 완료');

    const verdict = screen.getByTestId('wif-verdict').textContent ?? '';
    expect(verdict).toContain('Reconciliation');
    expect(verdict).toContain('Local Guard');

    fireEvent.click(screen.getByTestId('wif-step'));
    expect(elapsed()).toBe(total); // clamp — 무한히 늘어나지 않는다
  });
});
