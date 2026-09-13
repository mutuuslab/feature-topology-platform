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
import * as THREE from 'three';
import { MockTwinProvider } from '../data/twin/simulator';
import {
  buildVehicleParts,
  flowEdges,
  flowPhase,
  CAMERA_PRESETS,
  type PartId,
} from '../scene/vehicleParts';
import VehicleTwinScene from '../scene/VehicleTwinScene';
import { prepareScene } from '../scene/CarModel';
import { ARTICULATIONS, CAR_CONCEPT, CAR_CONCEPT_SPEC_LINE, STUDIO_HDRI, WHEEL_NODES } from '../scene/vehicleAsset';

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

// 팩토리가 import 바인딩을 직접 참조하면 호이스팅과 TDZ 가 충돌한다 → 동적 import 로 분리한다.
vi.mock('@react-three/drei', async () => {
  const { useGltfStub } = await import('../test/gltfStub');
  return {
    Html: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    OrbitControls: () => null,
    Line: () => null,
    RoundedBox: ({ children }: { children?: ReactNode }) => <mesh>{children}</mesh>,
    Grid: () => null,
    Environment: ({ children }: { children?: ReactNode }) => <group>{children}</group>,
    Lightformer: () => null,
    ContactShadows: () => null,
    // §17.4 — 실 glTF 자산 대역(jsdom 은 WebGL/텍스처를 로드할 수 없다).
    useGLTF: useGltfStub(),
  };
});

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

  /* §17.4 — 실 자산(Car Concept) + 실 HDRI 배선 계약. */

  it('기본값은 실 모델·실 HDRI 이고, 강등하면 절차적 차체로 바뀐다', () => {
    const snap = buildSnapshot(1);
    const { container } = render(
      <VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />,
    );
    const hud = screen.getByTestId('veh-hud');
    const bodyGroup = within(hud).getByRole('group', { name: '차체 모델' });
    const assetChip = within(bodyGroup).getByRole('button', { name: /실 모델/ });
    const shellChip = within(bodyGroup).getByRole('button', { name: /절차적 X-ray/ });
    expect(assetChip).toHaveAttribute('aria-pressed', 'true');
    expect(shellChip).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('primitive')).toBeInTheDocument();

    fireEvent.click(shellChip);
    expect(shellChip).toHaveAttribute('aria-pressed', 'true');
    expect(assetChip).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('primitive')).not.toBeInTheDocument();

    const envGroup = within(hud).getByRole('group', { name: '환경' });
    expect(within(envGroup).getByRole('button', { name: /실 HDRI/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(envGroup).getByRole('button', { name: /절차적 라이트포머/ }));
    expect(within(envGroup).getByRole('button', { name: /실 HDRI/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('관절 4종(도어·후드·리어 클램셸)을 열고 전부 닫을 수 있다', () => {
    const snap = buildSnapshot(1);
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />);
    const hud = screen.getByTestId('veh-hud');
    const joints = within(hud).getByRole('group', { name: '차체 관절' });
    expect(within(joints).getAllByRole('button', { name: /닫힘/ })).toHaveLength(ARTICULATIONS.length);

    const door = within(joints).getByRole('button', { name: /운전석 도어/ });
    expect(door).toHaveAttribute('title', ARTICULATIONS.find((a) => a.key === 'doorL')!.note);
    fireEvent.click(door);
    expect(door).toHaveAttribute('aria-pressed', 'true');
    expect(door).toHaveTextContent('열림');

    fireEvent.click(within(joints).getByRole('button', { name: '전부 닫기' }));
    expect(within(joints).getAllByRole('button', { name: /닫힘/ })).toHaveLength(ARTICULATIONS.length);
    expect(door).toHaveAttribute('aria-pressed', 'false');
  });

  it('출처 표기가 자산·라이선스·실측 스펙을 함께 노출한다(CC BY 4.0 의무 이행)', () => {
    const snap = buildSnapshot(1);
    render(<VehicleTwinScene twin={snap.twins[0]} verdict={snap.verdicts[0]} clock={snap.clock} lang="ko" webgl />);
    const credit = screen.getByTestId('veh-credit');
    expect(credit).toHaveTextContent(CAR_CONCEPT.author);
    expect(credit).toHaveTextContent('CC BY 4.0');
    expect(credit).toHaveTextContent(STUDIO_HDRI.author);
    expect(credit).toHaveTextContent('CC0 1.0');
    expect(credit).toHaveTextContent('162,766');
    expect(within(credit).getByRole('link', { name: /Car Concept/ })).toHaveAttribute('href', CAR_CONCEPT.sourceUrl);
    expect(within(credit).getByRole('link', { name: /Studio Small 09/ })).toHaveAttribute('href', STUDIO_HDRI.sourceUrl);
    expect(CAR_CONCEPT_SPEC_LINE).toContain('정점 162,766');
  });
});

describe('scene/CarModel — prepareScene(실 glTF 후처리)', () => {
  /** 실제 자산의 노드 이름 규칙(§17.4): 차체 패널 = `Body*`, 실내 = `Interior*`, 휠 = `Wheel*`. */
  const buildAssetLikeScene = () => {
    const root = new THREE.Object3D();
    root.name = 'BodyUnderside';
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'Paint' }));
    panel.name = 'BodyPanelsColor2';
    const interior = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'Trim' }));
    interior.name = 'InteriorSeatsColor1';
    root.add(panel, interior);
    const pivots: THREE.Object3D[] = [];
    for (const spec of ARTICULATIONS) {
      const pivot = new THREE.Object3D();
      pivot.name = spec.node;
      pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
      root.add(pivot);
      pivots.push(pivot);
    }
    for (const name of WHEEL_NODES) {
      const wheel = new THREE.Object3D();
      wheel.name = name;
      root.add(wheel);
    }
    return { root, panel, interior, pivots };
  };

  it('원본 씬을 변형하지 않고 복제본만 손본다(useGLTF 캐시 오염 방지)', () => {
    const { root, panel, pivots } = buildAssetLikeScene();
    const prepared = prepareScene(root);

    expect(prepared.scene).not.toBe(root);
    expect(panel.castShadow).toBe(false);
    expect(panel.material.name).toBe('Paint');
    const clonedPanel = prepared.scene.getObjectByName('BodyPanelsColor2') as THREE.Mesh;
    expect(clonedPanel.castShadow).toBe(true);
    expect(clonedPanel.receiveShadow).toBe(true);
    expect(clonedPanel.material).not.toBe(panel.material);
    expect(prepared.scene.getObjectByName('BodyDoorLColor1')).not.toBe(pivots[0]);
  });

  it('재질을 (원본 재질 × 패널 여부)당 1회만 복제한다 — 공유 재질은 공유로 남는다', () => {
    const { root, panel, interior } = buildAssetLikeScene();
    const shared = new THREE.MeshStandardMaterial({ name: 'Shared' });
    const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    second.name = 'BodyGaskets';
    panel.material = shared;
    root.add(second);

    const prepared = prepareScene(root);
    expect(prepared.materials).toHaveLength(2);
    const panelEntry = prepared.materials.filter((m) => m.panel);
    expect(panelEntry).toHaveLength(1);
    expect(panelEntry[0].material.name).toBe('Shared');
    expect(prepared.materials.filter((m) => !m.panel).map((m) => m.material.name)).toEqual(['Trim']);
    expect(prepared.materials.every((m) => m.material.opacity === 1 && m.material.transparent === false)).toBe(true);
    expect(panelEntry[0].base).toEqual({ opacity: 1, transparent: false, depthWrite: true });

    // 공유 재질을 쓰는 두 패널은 복제 후에도 같은 인스턴스를 쓴다(드로우콜 증가 없음).
    const first = prepared.scene.getObjectByName('BodyPanelsColor2') as THREE.Mesh;
    const other = prepared.scene.getObjectByName('BodyGaskets') as THREE.Mesh;
    expect(first.material).toBe(other.material);
    expect(first.material).not.toBe(shared);
    expect(interior.material.name).toBe('Trim');
  });

  it('관절/휠 피벗을 이름으로 찾아 자산 실측 축·각도·기준 회전을 보관한다', () => {
    const { root, pivots } = buildAssetLikeScene();
    const prepared = prepareScene(root);

    expect(prepared.joints.map((j) => j.key)).toEqual(ARTICULATIONS.map((a) => a.key));
    for (const [index, joint] of prepared.joints.entries()) {
      const spec = ARTICULATIONS[index];
      expect(joint.openDeg).toBe(spec.openDeg);
      expect(joint.axis.toArray()).toEqual([spec.axis === 'x' ? 1 : 0, spec.axis === 'y' ? 1 : 0, spec.axis === 'z' ? 1 : 0]);
      expect(joint.base.equals(pivots[index].quaternion)).toBe(true);
    }
    expect(prepared.wheels.map((w) => w.node.name)).toEqual([...WHEEL_NODES]);
  });

  it('관절을 열어도 원본 피벗 회전은 그대로다', () => {
    const { root, pivots } = buildAssetLikeScene();
    const prepared = prepareScene(root);
    const door = prepared.joints[0];
    door.node.quaternion.copy(door.base).multiply(new THREE.Quaternion().setFromAxisAngle(door.axis, 0.7));
    expect(pivots[0].quaternion.equals(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25))).toBe(true);
  });
});
