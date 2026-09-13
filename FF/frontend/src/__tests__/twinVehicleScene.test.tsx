/**
 * §17.3 — 차량 디지털 트윈 3D 뷰(2세대) 스모크.
 *
 * jsdom 에는 WebGL 이 없으므로 @react-three/fiber / drei 를 스텁한다(twinLive.test.tsx 와
 * 동일한 모양). 3D 픽셀이 아니라 (1) 순수 데이터 모델(`vehicleParts.ts`)의 상태/흐름 파생과
 * (2) HUD DOM 계약(레이어 · 카메라 · 부품 선택 · 일시정지 표시 · WebGL 강등)을 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { vi } from 'vitest';
import { MockTwinProvider } from '../data/twin/simulator';
import {
  buildVehicleParts,
  flowEdges,
  flowPhase,
  CAMERA_PRESETS,
  type PartId,
} from '../scene/vehicleParts';
import VehicleTwinScene from '../scene/VehicleTwinScene';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div data-testid="veh-canvas">{children}</div>,
  useFrame: () => {},
  useThree: (
    selector: (s: {
      camera: { position: { lerp: () => void; distanceTo: () => number } };
      controls: { target: { copy: () => void }; update: () => void };
      scene: Record<string, never>;
      size: { width: number; height: number };
    }) => unknown,
  ) =>
    selector({
      camera: { position: { lerp: () => {}, distanceTo: () => 0 } },
      controls: { target: { copy: () => {} }, update: () => {} },
      scene: {},
      size: { width: 1366, height: 768 },
    }),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  OrbitControls: () => null,
  Line: () => null,
  RoundedBox: ({ children }: { children?: ReactNode }) => <mesh>{children}</mesh>,
  Grid: () => null,
}));

const ALL_PART_IDS: PartId[] = ['body', 'battery', 'heater', 'bms', 'vcu', 'cgw', 'hvac', 'guard', 'charge', 'antenna'];

function buildSnapshot(rate: 0 | 1 | 5 = 0) {
  const provider = new MockTwinProvider({ nowMs: Date.parse('2026-09-13T10:00:00Z'), rate });
  return provider.getSnapshot();
}

describe('scene/vehicleParts — 순수 데이터 모델', () => {
  it('buildVehicleParts 는 기존 10종 PartId 를 동일한 파생 규칙으로 반환한다', () => {
    const snap = buildSnapshot();
    const twin = snap.twins[0];
    const verdict = snap.verdicts[0];
    const parts = buildVehicleParts(twin, verdict, false);

    expect(parts.map((p) => p.id).sort()).toEqual([...ALL_PART_IDS].sort());

    const body = parts.find((p) => p.id === 'body')!;
    expect(body.state).toBe('ACTIVE');

    const cgw = parts.find((p) => p.id === 'cgw')!;
    expect(cgw.state).toBe(twin.link.online ? 'ACTIVE' : 'OFFLINE');

    const battery = parts.find((p) => p.id === 'battery')!;
    const inst = twin.featureInstances[Object.keys(twin.featureInstances)[0]];
    if (twin.killSwitch?.active) {
      expect(battery.state).toBe('BLOCKED');
    } else if (!twin.link.online) {
      expect(battery.state).toBe('OFFLINE');
    } else if (inst?.effective.state === 'ON') {
      expect(battery.state).toBe('ACTIVE');
    }
  });

  it('Kill-Switch 활성 시 배터리 상태는 항상 BLOCKED 다(의미 변경 없음)', () => {
    const snap = buildSnapshot();
    const twin = snap.twins[0];
    const verdict = snap.verdicts[0];
    const parts = buildVehicleParts(twin, verdict, true);
    const battery = parts.find((p) => p.id === 'battery')!;
    expect(battery.state).toBe('BLOCKED');
  });

  it('각 부품은 layer/node/flow/anchor 로 추가 보강되고 anchor 는 항상 유한하다', () => {
    const snap = buildSnapshot();
    const parts = buildVehicleParts(snap.twins[0], snap.verdicts[0], false);
    const layers = new Set(parts.map((p) => p.layer));
    for (const layer of ['CLOUD', 'VEHICLE_EDGE', 'ECU', 'ACTUATOR', 'SENSOR']) {
      expect(layers.has(layer as (typeof parts)[number]['layer'])).toBe(true);
    }
    for (const p of parts) {
      expect(p.anchor).toHaveLength(3);
      for (const n of p.anchor) expect(Number.isFinite(n)).toBe(true);
      expect(p.flow).toBeDefined();
      expect(typeof p.flow.blocked).toBe('boolean');
      expect(p.node).toBeDefined();
      expect(['desired', 'reported', 'effective', 'guard']).toContain(p.node.kind);
    }
  });

  it('flowEdges 는 Kill-Switch 활성 시 사유 코드가 있는 차단 에지를 포함한다', () => {
    const snap = buildSnapshot();
    const parts = buildVehicleParts(snap.twins[0], snap.verdicts[0], true);
    const edges = flowEdges(parts);
    const blocked = edges.filter((e) => e.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    const withReason = blocked.find((e) => e.blockReason);
    expect(withReason).toBeTruthy();
    expect(withReason?.blockReason?.ko?.length).toBeGreaterThan(0);
  });

  it('flowEdges 는 Guard 차단 시(Kill-Switch 없이) guard->bms 에지를 차단한다', () => {
    const snap = buildSnapshot();
    const twin = snap.twins[0];
    const verdict = snap.verdicts[0];
    // 강제로 guard 실패 시나리오를 만든다(다른 필드는 twin 사실 그대로 둔다).
    const forcedVerdict = {
      ...verdict,
      guard: { ...verdict.guard, passed: false, reasonCode: 'SOC_BELOW_THRESHOLD' as const },
    };
    const parts = buildVehicleParts(twin, forcedVerdict, false);
    const edges = flowEdges(parts);
    const guardEdge = edges.find((e) => e.id === 'cmd:guard->bms');
    expect(guardEdge?.blocked).toBe(true);
    expect(guardEdge?.blockReason).toBeTruthy();
  });
});

describe('scene/vehicleParts — flowPhase(흐름 패킷 위상)', () => {
  /**
   * 회귀 방지: 위상을 `simTimeMs` 의 함수(`(초 * 0.4) % 1`)로 만들면 배속이 5× 일 때
   * 1틱 = 5 s 이므로 `5 * 0.4 = 2.0 ≡ 0 (mod 1)` — 매 틱 같은 위치로 돌아와 패킷이
   * "정지" 한 것처럼 보였다(관측된 버그). 틱 기반 위상은 이를 구조적으로 막는다.
   */
  it('위상을 simTimeMs 로 만들면 5× 에서 매 틱 같은 위치로 돌아온다(수정 전 동작)', () => {
    const legacy = (simTimeMs: number, index: number) => ((simTimeMs / 1000) * 0.4 + index * 0.33) % 1;
    const positions = [0, 1, 2, 3].map((tick) => legacy(tick * 5000, 0));
    expect(new Set(positions).size).toBe(1);
  });

  it('flowPhase 는 1×·5× 모두에서 틱마다 전진한다(정지 없음)', () => {
    for (const index of [0, 1, 2]) {
      const phases = [0, 1, 2, 3, 4, 5, 6].map((tick) => flowPhase(tick, index));
      expect(new Set(phases).size).toBe(7);
      expect(phases.every((p) => p >= 0 && p < 1)).toBe(true);
    }
  });

  it('flowPhase 는 rate=0(정지)에서 값을 바꾸지 않는다', () => {
    expect(flowPhase(0, 2, false)).toBe(flowPhase(999, 2, false));
    expect(flowPhase(7, 2, false)).toBeCloseTo((2 * 0.33) % 1, 10);
  });

  it('flowPhase 는 에지마다 위상이 어긋나 패킷이 한 줄로 서지 않는다', () => {
    const phases = [0, 1, 2, 3, 4].map((i) => flowPhase(3, i));
    expect(new Set(phases).size).toBe(5);
  });
});

describe('scene/VehicleTwinScene — HUD 계약', () => {
  it('webgl=false 이면 fallback 만 렌더하고 캔버스는 렌더하지 않는다', () => {
    const snap = buildSnapshot();
    render(
      <VehicleTwinScene
        twin={snap.twins[0]}
        verdict={snap.verdicts[0]}
        clock={snap.clock}
        lang="ko"
        webgl={false}
        fallback={<div data-testid="veh-fallback-content">2D 개략도</div>}
      />,
    );
    expect(screen.getByTestId('veh-fallback-content')).toBeInTheDocument();
    expect(screen.queryByTestId('veh-canvas')).not.toBeInTheDocument();
  });

  it('webgl=true 이면 HUD 에 카메라 프리셋 6종과 레이어 칩이 모두 나타난다', () => {
    const snap = buildSnapshot(1);
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />);
    expect(screen.getByTestId('veh-canvas')).toBeInTheDocument();
    const hud = screen.getByTestId('veh-hud');
    const cameraGroup = within(hud).getByRole('group', { name: '카메라 프리셋' });
    for (const id of Object.keys(CAMERA_PRESETS) as Array<keyof typeof CAMERA_PRESETS>) {
      expect(within(cameraGroup).getByRole('button', { name: new RegExp(CAMERA_PRESETS[id].label) })).toBeInTheDocument();
    }
    const layerGroup = within(hud).getByRole('group', { name: '레이어 필터' });
    expect(within(layerGroup).getByRole('button', { name: '전체' })).toBeInTheDocument();
    expect(within(layerGroup).getByRole('button', { name: 'CLOUD' })).toBeInTheDocument();
    expect(within(layerGroup).getByRole('button', { name: 'EDGE' })).toBeInTheDocument();
    expect(within(layerGroup).getByRole('button', { name: 'ECU' })).toBeInTheDocument();
    expect(within(layerGroup).getByRole('button', { name: 'ACTUATOR' })).toBeInTheDocument();
    expect(within(layerGroup).getByRole('button', { name: 'SENSOR' })).toBeInTheDocument();
  });

  it('레이어 칩을 누르면 aria-pressed 가 바뀌어 필터링 상태가 DOM 에 드러난다', () => {
    const snap = buildSnapshot(1);
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />);
    const hud = screen.getByTestId('veh-hud');
    const layerGroup = within(hud).getByRole('group', { name: '레이어 필터' });
    const allChip = within(layerGroup).getByRole('button', { name: '전체' });
    const ecuChip = within(layerGroup).getByRole('button', { name: 'ECU' });
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(ecuChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(ecuChip);
    expect(ecuChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('clock.rate===0 이면 일시정지 표시가 나타나고, rate:1 이면 나타나지 않는다', () => {
    const paused = buildSnapshot(0);
    const { unmount } = render(
      <VehicleTwinScene twin={paused.twins[0]} verdict={paused.verdicts[0]} clock={paused.clock} lang="ko" webgl />,
    );
    expect(screen.getByTestId('veh-scene-root')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByTestId('veh-paused-banner')).toBeInTheDocument();
    unmount();

    const running = buildSnapshot(1);
    render(<VehicleTwinScene twin={running.twins[0]} verdict={running.verdicts[0]} clock={running.clock} lang="ko" webgl />);
    expect(screen.getByTestId('veh-scene-root')).toHaveAttribute('data-paused', 'false');
    expect(screen.queryByTestId('veh-paused-banner')).not.toBeInTheDocument();
  });

  it('부품 목록 버튼을 클릭하면 onSelect 콜백이 해당 PartId 로 호출된다', () => {
    const snap = buildSnapshot(1);
    const onSelect = vi.fn();
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl onSelect={onSelect} />);
    const hud = screen.getByTestId('veh-hud');
    const guardBtn = within(hud).getByRole('button', { name: /Local Guard/ });
    fireEvent.click(guardBtn);
    expect(onSelect).toHaveBeenCalledWith<[PartId]>('guard');
    expect(guardBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('범례가 상태 6종 + 흐름 3종을 텍스트로 표시한다(색만으로 의미를 전달하지 않는다)', () => {
    const snap = buildSnapshot(1);
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />);
    const legend = screen.getByTestId('veh-legend');
    expect(within(legend).getByText('정상·활성')).toBeInTheDocument();
    expect(within(legend).getByText('Guard 차단')).toBeInTheDocument();
    expect(within(legend).getByText(/Desired/)).toBeInTheDocument();
    expect(within(legend).getByText(/Reported/)).toBeInTheDocument();
    expect(within(legend).getByText('차단(사유 코드 표시)')).toBeInTheDocument();
  });
});
