/**
 * 레이어드 아키텍처 데이터 플로우 — `scene/architectureFlow` 순수 모델 + `ArchitectureFlow` 화면.
 *
 * 진짜 `MockTwinProvider` 시나리오(Canary 활성화 → tick 2회)로 스냅샷을 만들어 검증한다 —
 * 손으로 스냅샷을 지어내면 이 화면이 실제 Twin 판정과 분리될 위험이 있기 때문이다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { MockTwinProvider } from '../data/twin/simulator';
import type { TwinStoreSnapshot } from '../data/twin/port';
// NOTE: explicit `.tsx` extension is required here — on a case-insensitive filesystem
// (Windows/macOS default) an extensionless `../scene/ArchitectureFlow` import resolves the
// `.ts` candidate first and silently hits `architectureFlow.ts` (the pure model, lowercase
// `a`) instead of this component. `tsconfig.json` has `allowImportingTsExtensions: true`
// specifically so this stays unambiguous.
import ArchitectureFlow from '../scene/ArchitectureFlow.tsx';
import {
  LAYER_ORDER,
  LAYER_TITLE,
  buildArchitectureModel,
  buildEdges,
  buildLayers,
  buildReasonChips,
  buildSwimlanes,
  killSwitchActiveCount,
  packetDelayMs,
  packetDurationMs,
} from '../scene/architectureFlow';

afterEach(() => cleanup());

/** Real Twin scenario: Canary rollout activated, then two 5s ticks. Never a hand-written snapshot. */
function canarySnapshot(rate: 0 | 1 | 5 = 0): TwinStoreSnapshot {
  const p = new MockTwinProvider({ nowMs: Date.parse('2026-09-13T10:00:00Z'), rate });
  p.activatePolicy('CANARY');
  p.step(5);
  p.step(5);
  return p.getSnapshot();
}

/** A fresh, mostly-empty scenario: rollout never activated, no incidents yet. */
function freshSnapshot(): TwinStoreSnapshot {
  const p = new MockTwinProvider({ nowMs: Date.parse('2026-09-13T10:00:00Z'), rate: 0 });
  return p.getSnapshot();
}

describe('scene/architectureFlow — pure model', () => {
  it('빌드된 모델은 6개 레이어를 정해진 순서로 갖고, 각 레이어는 노드를 갖는다', () => {
    const snapshot = canarySnapshot();
    const layers = buildLayers(snapshot);
    expect(layers).toHaveLength(6);
    expect(layers.map((l) => l.id)).toEqual(LAYER_ORDER);
    for (const l of layers) expect(l.nodes.length).toBeGreaterThan(0);
    // 한국어 타이틀이 요구된 6개 레이어와 일치한다
    expect(LAYER_TITLE.catalog.ko).toContain('피처 카탈로그');
    expect(LAYER_TITLE.policy.ko).toContain('정책 엔진');
    expect(LAYER_TITLE.rollout.ko).toContain('수렴 게이트');
    expect(LAYER_TITLE.vehicle.ko).toContain('차량 에지');
    expect(LAYER_TITLE.observability.ko).toContain('관측');
  });

  it('엣지는 인접 레이어만 연결하고, 패킷 수는 실제 라이브 수치에서 파생된다', () => {
    const snapshot = canarySnapshot();
    const edges = buildEdges(snapshot);
    expect(edges.length).toBeGreaterThan(0);
    const idx = Object.fromEntries(LAYER_ORDER.map((id, i) => [id, i]));
    for (const e of edges) {
      expect(Math.abs(idx[e.to] - idx[e.from])).toBe(1); // 인접 레이어만
      expect(e.packetCount).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(e.x1)).toBe(true);
      expect(Number.isFinite(e.y1)).toBe(true);
    }
    // 활성 VIN 수가 policy->rollout 커맨드 엣지 패킷 수와 같다
    const broadcast = edges.find((e) => e.id === 'e-policy-rollout')!;
    expect(broadcast.packetCount).toBe(snapshot.rollout.activatedVins.length);
  });

  it('rollout.paused / guardBlocked / drift 가 실제로 참일 때만 엣지가 차단된다', () => {
    const snapshot = canarySnapshot();
    const edges = buildEdges(snapshot);
    const guardEdge = edges.find((e) => e.id === 'e-connectivity-vehicle')!;
    expect(guardEdge.blocked).toBe(snapshot.stats.guardBlocked > 0);
    const telemetryEdge = edges.find((e) => e.id === 'e-vehicle-observability')!;
    expect(telemetryEdge.blocked).toBe(snapshot.stats.drift > 0);
    if (telemetryEdge.blocked) expect(telemetryEdge.blockReason?.ko).toBeTruthy();

    // Rollout 이 일시정지 상태이면 하향 command 엣지들이 전부 차단된다
    const paused = { ...snapshot, rollout: { ...snapshot.rollout, paused: true, pausedReason: { ko: '테스트 정지', en: 'test pause' } } };
    const pausedEdges = buildEdges(paused);
    for (const e of pausedEdges.filter((e) => e.kind === 'command' && e.from === 'policy')) {
      expect(e.blocked).toBe(true);
      expect(e.blockReason?.ko).toBe('테스트 정지');
    }
  });

  it('killSwitchActiveCount 는 실제 kill-switch 활성 차량 수를 센다', () => {
    const snapshot = canarySnapshot();
    const manual = snapshot.twins.filter((t) => t.killSwitch?.active).length;
    expect(killSwitchActiveCount(snapshot)).toBe(manual);
  });

  it('packetDurationMs 는 rate 에 따라 달라지고, packetDelayMs 는 index 만의 순수 함수다', () => {
    expect(packetDurationMs(1)).toBeGreaterThan(packetDurationMs(5));
    expect(packetDelayMs(3, 3200)).toBe(packetDelayMs(3, 3200));
    expect(packetDelayMs(0, 3200)).toBe(0);
    expect(packetDelayMs(3, 3200)).not.toBe(packetDelayMs(4, 3200));
  });

  it('swimlane 은 convergence.waves 의 cohort 로 VIN 을 최대 8개까지 샘플링한다', () => {
    const snapshot = canarySnapshot();
    const lanes = buildSwimlanes(snapshot);
    expect(lanes.length).toBe(snapshot.convergence.waves.length);
    for (const lane of lanes) {
      expect(lane.chips.length).toBeLessThanOrEqual(8);
      for (const chip of lane.chips) {
        const v = snapshot.verdicts.find((vv) => vv.twin.vin === chip.vin)!;
        expect(v.twin.link.cohort).toBe(lane.wave);
      }
    }
  });

  it('reason chip 은 stats.reasonCodeCounts 를 한국어 라벨로 옮긴다', () => {
    const snapshot = canarySnapshot();
    const chips = buildReasonChips(snapshot);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(10);
    for (const c of chips) expect(c.label.ko.length).toBeGreaterThan(0);
  });

  it('빈 스냅샷(rollout 비활성·incident 0)에서도 모델이 죽지 않는다', () => {
    const snapshot = freshSnapshot();
    expect(snapshot.incidents).toHaveLength(0);
    expect(snapshot.rollout.active).toBe(false);
    expect(() => buildArchitectureModel(snapshot)).not.toThrow();
    const model = buildArchitectureModel(snapshot);
    expect(model.layers).toHaveLength(6);
    expect(model.edges.length).toBeGreaterThan(0);
  });
});

describe('scene/ArchitectureFlow — 화면', () => {
  it('6개 레이어가 모두 한국어 타이틀과 함께 렌더링된다', () => {
    const snapshot = canarySnapshot();
    render(<ArchitectureFlow snapshot={snapshot} lang="ko" />);
    expect(screen.getByTestId('architecture-flow')).toBeInTheDocument();
    expect(screen.getByText(/피처 카탈로그/)).toBeInTheDocument();
    expect(screen.getByText(/정책 엔진/)).toBeInTheDocument();
    expect(screen.getByText(/수렴 게이트/)).toBeInTheDocument();
    expect(screen.getByText(/커넥티비티/)).toBeInTheDocument();
    expect(screen.getByText(/차량 에지/)).toBeInTheDocument();
    expect(screen.getByText(/관측/)).toBeInTheDocument();
    for (const id of LAYER_ORDER) expect(screen.getByTestId(`arch-layer-${id}`)).toBeInTheDocument();
  });

  it('라이브 수치(수렴률, guard 차단 수)가 실제 스냅샷 값과 함께 표시된다', () => {
    const snapshot = canarySnapshot();
    render(<ArchitectureFlow snapshot={snapshot} lang="ko" />);
    const ratePct = `${Math.round(snapshot.convergence.convergenceRate * 100)}%`;
    expect(screen.getAllByText(ratePct).length).toBeGreaterThan(0);
    expect(screen.getAllByText(String(snapshot.stats.guardBlocked)).length).toBeGreaterThan(0);
    expect(screen.getByText(`revision ${snapshot.revision}`)).toBeInTheDocument();
  });

  it('패킷 수는 엣지 수와 같고, rate===0 이면 멈추고 rate>0 이면 움직인다', () => {
    const pausedSnapshot = canarySnapshot(0);
    const { container: pausedContainer, unmount } = render(<ArchitectureFlow snapshot={pausedSnapshot} lang="ko" />);
    const edgeCount = buildEdges(pausedSnapshot).length;
    const pausedPackets = pausedContainer.querySelectorAll('.arch-packet');
    expect(pausedPackets.length).toBe(edgeCount);
    expect(screen.getByTestId('architecture-flow')).toHaveAttribute('data-paused', 'true');
    for (const p of Array.from(pausedPackets)) {
      expect((p as HTMLElement).style.animationPlayState).toBe('paused');
    }
    unmount();

    const runningSnapshot = canarySnapshot(5);
    const { container: runningContainer } = render(<ArchitectureFlow snapshot={runningSnapshot} lang="ko" />);
    expect(screen.getByTestId('architecture-flow')).toHaveAttribute('data-paused', 'false');
    const runningPackets = runningContainer.querySelectorAll('.arch-packet');
    expect(runningPackets.length).toBe(buildEdges(runningSnapshot).length);
    // 차단되지 않은 엣지의 패킷은 실행 중이어야 한다
    const anyRunning = Array.from(runningPackets).some(
      (p) => (p as HTMLElement).style.animationPlayState === 'running',
    );
    expect(anyRunning).toBe(true);
    // 차단된 엣지가 있다면 그 패킷은 rate 와 무관하게 항상 정지해야 한다
    const blockedEdgeIds = buildEdges(runningSnapshot)
      .filter((e) => e.blocked)
      .map((e) => e.id);
    for (const id of blockedEdgeIds) {
      const g = runningContainer.querySelector(`[data-testid="arch-edge-${id}"]`)!;
      const packet = g.querySelector('.arch-packet') as HTMLElement;
      expect(packet.style.animationPlayState).toBe('paused');
    }
  });

  it('VIN 칩을 클릭하면 onSelectVin 이 호출되고, 더블클릭하면 onOpenVehicle 이 호출된다', () => {
    const snapshot = canarySnapshot();
    const selected: string[] = [];
    const opened: string[] = [];
    render(
      <ArchitectureFlow
        snapshot={snapshot}
        lang="ko"
        onSelectVin={(vin) => selected.push(vin)}
        onOpenVehicle={(vin) => opened.push(vin)}
      />,
    );
    const lanes = screen.getByTestId('arch-swimlanes');
    const chipButtons = within(lanes).getAllByRole('button');
    expect(chipButtons.length).toBeGreaterThan(0);
    fireEvent.click(chipButtons[0]);
    expect(selected.length).toBe(1);
    fireEvent.doubleClick(chipButtons[0]);
    expect(opened.length).toBe(1);
  });

  it('Reason Code 분포 섹션이 렌더링된다', () => {
    const snapshot = canarySnapshot();
    render(<ArchitectureFlow snapshot={snapshot} lang="ko" />);
    const section = screen.getByTestId('arch-reason-chips');
    expect(within(section).getByText('Reason Code 분포')).toBeInTheDocument();
    expect(section.querySelectorAll('.arch-reason-chip').length).toBeGreaterThan(0);
  });

  it('빈 스냅샷(incident 0 · rollout 비활성)에서도 렌더링이 깨지지 않는다', () => {
    const snapshot = freshSnapshot();
    expect(() => render(<ArchitectureFlow snapshot={snapshot} lang="ko" />)).not.toThrow();
    expect(screen.getByTestId('architecture-flow')).toBeInTheDocument();
    // rollout 비활성 상태도 화면에 그대로 드러난다(색만으로 전달하지 않음)
    expect(screen.getByText(/단계 \(Canary\/Wave\/Fleet\)/)).toBeInTheDocument();
    expect(screen.getAllByText('NONE').length).toBeGreaterThan(0);
  });

  it('범례에 4가지 엣지 종류와 차단 표시가 모두 나온다', () => {
    const snapshot = canarySnapshot();
    render(<ArchitectureFlow snapshot={snapshot} lang="ko" />);
    const legend = screen.getByLabelText('범례');
    expect(within(legend).getByText(/Command/)).toBeInTheDocument();
    expect(within(legend).getByText(/Report/)).toBeInTheDocument();
    expect(within(legend).getByText(/Telemetry/)).toBeInTheDocument();
    expect(within(legend).getByText(/Audit/)).toBeInTheDocument();
    expect(within(legend).getByText(/차단/)).toBeInTheDocument();
  });
});
