/**
 * §17.2 공장 스케일 Plant Twin — 레이아웃 SoT + 3D/2D 화면.
 *
 * 두 층을 나눠 검증한다.
 *  (1) `scene/plantLayout` 의 순수 함수 — 컨베이어·AMR·야드·셀 상태가 시뮬레이션
 *      시각만으로 결정되고, 판정 집계에서 파생되는지.
 *  (2) `/twin/live` 의 '3D 공장 뷰' 탭 — HUD·프리셋·투어·라벨 LOD·셀 상태표 DOM 계약과
 *      WebGL 미지원 시 자동 강등되는 2D 평면도 경로.
 *
 * jsdom 에는 WebGL 도 2D 캔버스도 없으므로 fiber/drei 를 스텁하고, 라벨 텍스처는
 * `makeTexture` 가 null 을 돌려주어 그려지지 않는다(HUD/도면 쪽을 assert 대상으로 삼는다).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../store';
import { createTwinProvider, TwinProvider } from '../state/twinStore';
import { TwinLive } from '../pages/twinLive';
import {
  AMR_ROUTES,
  CELLS,
  CONVEYOR,
  PLANT,
  PLANT_PRESETS,
  PLANT_STATUS_LABEL,
  PLANT_TOUR,
  TOUR_DWELL_MS,
  amrPose,
  cellReason,
  cellStatus,
  conveyorBodyX,
  featuredVins,
  plantCounts,
  stationAssignments,
  stationPositions,
  yardSlots,
  type PlantCell,
  type PlantCounts,
  type PlantStage,
} from '../scene/plantLayout';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div data-testid="plant-canvas">{children}</div>,
  useFrame: () => {},
  useThree: (
    selector: (s: {
      camera: { position: { lerp: () => void; distanceTo: () => number }; lookAt: () => void };
      controls: { target: { copy: () => void }; update: () => void };
      scene: Record<string, never>;
      size: { width: number; height: number };
    }) => unknown,
  ) =>
    selector({
      camera: {
        position: { lerp: () => {}, distanceTo: () => 0 },
        lookAt: () => {},
      },
      controls: { target: { copy: () => {} }, update: () => {} },
      scene: {},
      size: { width: 1366, height: 768 },
    }),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  OrbitControls: () => null,
}));

/* --------------------------------------------------------------- 공용 헬퍼 */

function counts(over: Partial<PlantCounts> = {}): PlantCounts {
  return {
    total: 0,
    eligible: 0,
    binaryOta: 0,
    hwMismatch: 0,
    variantMismatch: 0,
    noEntitlement: 0,
    stale: 0,
    blocked: 0,
    unknown: 0,
    converged: 0,
    pending: 0,
    guarded: 0,
    rejected: 0,
    drift: 0,
    healthy: 0,
    degraded: 0,
    paused: false,
    killActive: 0,
    ...over,
  };
}

const cellOf = (stage: PlantStage): PlantCell => CELLS.find((c) => c.stage === stage)!;

function RoleSetter({ role }: { role: string }) {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role });
  }, [role, dispatch]);
  return null;
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

function renderLive() {
  return render(
    <MemoryRouter initialEntries={['/twin/live']}>
      <AppProvider>
        <RoleSetter role="Admin" />
        <TwinProvider>
          <Routes>
            <Route path="/twin/live" element={<TwinLive />} />
            <Route path="/twin/vehicle/:vin" element={<LocationProbe />} />
          </Routes>
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

/** true = WebGL 있음(3D 경로), false = 없음(2D 강등 경로). */
function stubWebgl(available: boolean) {
  // webgl.ts 는 jsdom 콘솔 잡음을 막기 위해 생성자 존재 여부를 먼저 본다 —
  // jsdom 에도 그 상황을 만들어 줘야 3D 경로가 실제로 열린다.
  const w = window as unknown as Record<string, unknown>;
  if (available) w.WebGLRenderingContext = function WebGLRenderingContext() {};
  else delete w.WebGLRenderingContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (available ? ({ fake: 'gl' } as unknown as RenderingContext) : null),
  );
}

const presetGroup = () => screen.getByRole('group', { name: '공장 카메라 프리셋' });
const cellGroup = () => screen.getByRole('group', { name: '공정 셀 상태' });
const vinSelect = () => screen.getByRole('combobox', { name: 'VIN' }) as HTMLSelectElement;
const presetButton = (label: string) => within(presetGroup()).getByRole('button', { name: label });

beforeEach(() => {
  localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  stubWebgl(true);
});

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).WebGLRenderingContext;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------- 순수 레이아웃 SoT */

describe('§17.2 Plant Twin — 레이아웃 SoT', () => {
  it('공장은 116 m × 60 m 이고 셀 5개가 컨베이어를 따라 배치된다', () => {
    expect(PLANT.width).toBe(116);
    expect(PLANT.depth).toBe(60);
    expect(CELLS).toHaveLength(5);
    expect(CELLS.map((c) => c.stage)).toEqual(['INBOUND', 'FLASH', 'BATTERY', 'CALIB', 'EOL_TEST']);
    // 셀은 서로 겹치지 않고 +X 방향으로 단조 증가한다
    for (let i = 1; i < CELLS.length; i++) expect(CELLS[i].x).toBeGreaterThan(CELLS[i - 1].x);
    // 프리셋 1개당 셀 1개 + 전체/야드/Andon
    expect(PLANT_PRESETS).toHaveLength(8);
    expect(PLANT_TOUR).toHaveLength(PLANT_PRESETS.length);
    expect(TOUR_DWELL_MS).toBe(7000);
  });

  it('스테이션 좌표는 컨베이어(z=0)를 사이에 두고 station 수만큼만 나온다', () => {
    expect(stationPositions(cellOf('INBOUND'))).toHaveLength(2);
    expect(stationPositions(cellOf('BATTERY'))).toHaveLength(4);
    for (const cell of CELLS) {
      const pos = stationPositions(cell);
      expect(pos).toHaveLength(cell.stations);
      for (const [, z] of pos) expect(Math.abs(z)).toBe(4.6); // 컨베이어를 비운다
    }
  });

  it('conveyorBodyX 는 시뮬레이션 시각만으로 결정되고 구간을 벗어나지 않는다', () => {
    expect(conveyorBodyX(0, 0)).toBeCloseTo(CONVEYOR.x1, 6);
    const loopMs = ((CONVEYOR.bodies * CONVEYOR.spacing) / CONVEYOR.speed) * 1000;
    expect(conveyorBodyX(0, loopMs)).toBeCloseTo(conveyorBodyX(0, 0), 6); // 주기성
    for (const t of [0, 700, 3300, 12000, 29999, 61000]) {
      for (let i = 0; i < CONVEYOR.bodies; i++) {
        const x = conveyorBodyX(i, t);
        expect(x).toBeGreaterThanOrEqual(CONVEYOR.x1 - 1e-9);
        expect(x).toBeLessThanOrEqual(CONVEYOR.x2 + 1e-9);
      }
    }
    // 같은 시각이면 같은 값(난수·실시간 클럭 미사용)
    expect(conveyorBodyX(3, 12345)).toBe(conveyorBodyX(3, 12345));
  });

  it('amrPose 는 경로를 왕복하고 복귀 구간에서 returning 이 켜진다', () => {
    const route = AMR_ROUTES[0];
    const start = amrPose(route, 0);
    expect(start.x).toBeCloseTo(-50, 6);
    expect(start.z).toBeCloseTo(22, 6);
    expect(start.returning).toBe(false);

    // 왕복 주기는 (구간 길이 / 속도) 로 결정된다 — 하드코딩 대신 레이아웃에서 유도
    let len = 0;
    for (let i = 1; i < route.points.length; i++) {
      len += Math.hypot(route.points[i][0] - route.points[i - 1][0], route.points[i][1] - route.points[i - 1][1]);
    }
    const halfMs = (len / route.speed) * 1000;

    const atEnd = amrPose(route, halfMs - 50);
    const back = amrPose(route, halfMs + 300);
    expect(atEnd.returning).toBe(false);
    expect(back.returning).toBe(true);
    expect(atEnd.x).toBeCloseTo(route.points[route.points.length - 1][0], 0);
    // 반환 직후라 위치는 종단 근처에서 조금씩 되돌아온다
    expect(back.x).toBeLessThan(atEnd.x);
    expect(back.x).toBeCloseTo(atEnd.x, 0);

    // 한 주기(2×반주기) 뒤 다시 출발점
    const restart = amrPose(route, halfMs * 2 + 50);
    expect(restart.returning).toBe(false);
    expect(restart.x).toBeCloseTo(-50, 0);

    // 어떤 시각에도 공장 바닥을 벗어나지 않는다
    for (const r of AMR_ROUTES) {
      for (let t = 0; t < 120_000; t += 2500) {
        const p = amrPose(r, t);
        expect(p.x).toBeGreaterThanOrEqual(PLANT.minX);
        expect(p.x).toBeLessThanOrEqual(PLANT.maxX);
        expect(p.z).toBeGreaterThanOrEqual(PLANT.minZ);
        expect(p.z).toBeLessThanOrEqual(PLANT.maxZ);
        expect(Number.isFinite(p.yaw)).toBe(true);
      }
    }
  });

  it('yardSlots 는 VIN 정렬로 자리를 고정하고 capacity 를 넘으면 버퍼 행으로 보낸다', () => {
    const verdicts = createTwinProvider().getSnapshot().verdicts;
    expect(verdicts).toHaveLength(30);

    const a = yardSlots(verdicts);
    const b = yardSlots([...verdicts].reverse()); // 입력 순서를 뒤집어도
    expect(a).toHaveLength(30);
    expect(a.map((s, i) => [s.vin, s.x, s.z])).toEqual(b.map((s, i) => [s.vin, s.x, s.z]));
    expect(new Set(a.map((s) => s.vin)).size).toBe(30);
    for (const s of a) {
      expect([40, 46, 52]).toContain(s.x);
      expect(s.row).toBeLessThan(3);
      expect(s.z).toBeCloseTo(-21.6 + s.col * 4.8, 6);
    }

    // 3행(30 슬롯)을 넘으면 4번째 행은 버퍼 X 로 밀린다
    const many = [
      ...verdicts,
      ...verdicts.slice(0, 15).map((v) => ({ ...v, twin: { ...v.twin, vin: `${v.twin.vin}X` } })),
    ];
    const over = yardSlots(many);
    expect(over).toHaveLength(40); // row > 3 은 배정하지 않는다
    expect(over[30].row).toBe(3);
    expect(over[30].x).toBe(32);
  });

  it('cellStatus·cellReason 은 판정 집계에서만 파생된다', () => {
    expect(cellStatus(counts(), cellOf('INBOUND'))).toBe('IDLE');
    expect(cellStatus(counts({ total: 30 }), cellOf('INBOUND'))).toBe('RUNNING');

    // FLASH — Binary OTA 대상 유무, 그리고 Rollout 정지 시 차단
    expect(cellStatus(counts({ binaryOta: 4 }), cellOf('FLASH'))).toBe('RUNNING');
    expect(cellStatus(counts({ binaryOta: 4, paused: true }), cellOf('FLASH'))).toBe('BLOCKED');
    expect(cellStatus(counts({ paused: true }), cellOf('FLASH'))).toBe('IDLE');

    expect(cellStatus(counts({ hwMismatch: 1 }), cellOf('BATTERY'))).toBe('WARNING');
    expect(cellStatus(counts({ variantMismatch: 1 }), cellOf('BATTERY'))).toBe('WARNING');
    expect(cellStatus(counts(), cellOf('BATTERY'))).toBe('RUNNING');

    expect(cellStatus(counts({ stale: 2 }), cellOf('CALIB'))).toBe('WARNING');

    // EOL — Kill-Switch 가 최우선, 그 다음 Drift/Rejected, 그 다음 Guard 차단
    expect(cellStatus(counts({ killActive: 1, drift: 5 }), cellOf('EOL_TEST'))).toBe('SAFETY');
    expect(cellStatus(counts({ drift: 1 }), cellOf('EOL_TEST'))).toBe('ERROR');
    expect(cellStatus(counts({ rejected: 1 }), cellOf('EOL_TEST'))).toBe('ERROR');
    expect(cellStatus(counts({ guarded: 1 }), cellOf('EOL_TEST'))).toBe('WARNING');
    expect(cellStatus(counts(), cellOf('EOL_TEST'))).toBe('RUNNING');

    expect(PLANT_STATUS_LABEL.SAFETY.ko).toContain('Kill-Switch');
    expect(cellReason(counts({ killActive: 2 }), cellOf('EOL_TEST')).ko).toContain('Kill-Switch 2건');
    expect(cellReason(counts({ total: 30 }), cellOf('INBOUND')).ko).toBe('Twin 30대 등록');
  });

  it('plantCounts 는 적격성·수렴·건강도를 모두 집계한다', () => {
    const snap = createTwinProvider().getSnapshot();
    const c = plantCounts(snap);
    expect(c.total).toBe(snap.verdicts.length);
    expect(
      c.eligible + c.binaryOta + c.hwMismatch + c.variantMismatch + c.noEntitlement + c.stale + c.blocked + c.unknown,
    ).toBe(c.total);
    expect(c.converged + c.pending + c.guarded + c.rejected + c.drift).toBeLessThanOrEqual(c.total);
    // HEALTHY/DEGRADED 외 상태(STALE·OFFLINE·DRIFTED·UNKNOWN)는 어느 쪽에도 세지 않는다
    expect(c.healthy + c.degraded).toBeLessThanOrEqual(c.total);
    expect(c.healthy + c.degraded).toBeGreaterThan(0);
    expect(c.paused).toBe(false);
    // Kill-Switch 는 호출자가 넘긴 실제 활성 수를 그대로 쓴다
    expect(plantCounts(snap, 3).killActive).toBe(3);
    expect(plantCounts({ verdicts: [] } as never).total).toBe(0);
  });

  it('셀 배치는 공정 사유가 맞는 VIN 을 VIN 순으로 고르고 남는 자리는 WIP 로 채운다', () => {
    const verdicts = createTwinProvider().getSnapshot().verdicts;
    const flash = featuredVins(verdicts, cellOf('FLASH'));
    expect(flash.length).toBeGreaterThan(0);
    expect(flash.length).toBeLessThanOrEqual(4);
    for (const v of flash) expect(v.eligibility.eligibility).toBe('REQUIRES_BINARY_OTA');
    expect([...flash].map((v) => v.twin.vin)).toEqual([...flash].map((v) => v.twin.vin).sort());

    const eol = featuredVins(verdicts, cellOf('EOL_TEST'));
    for (const v of eol) expect(['CRITICAL_DRIFT', 'REJECTED', 'GUARDED']).toContain(v.reconciliation.result);

    // 스테이션 수는 항상 채워지고, 차량이 모자라면 verdict === null (VIN 없는 WIP 바디)
    const assignments = stationAssignments(verdicts, cellOf('EOL_TEST'));
    expect(assignments).toHaveLength(2);
    expect(assignments[0].id).toBe('EOL TEST-S1');
    expect(assignments.some((a) => a.verdict === null)).toBe(assignments.length > eol.length);
    expect(stationAssignments(verdicts, cellOf('INBOUND')).every((a) => a.verdict === null)).toBe(false);
  });
});

/* ------------------------------------------------------------ 화면(탭/HUD) */

describe('§17.2 Plant Twin — 3D 공장 뷰 탭', () => {
  it('기본 탭이 공장 뷰이고, 탭 전환으로 차량 뷰·Fleet 평면도로 갈 수 있다', () => {
    renderLive();
    expect(screen.getByTestId('plant-view')).toBeInTheDocument();
    expect(screen.queryByTestId('twinlive-3d')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '3D 차량 뷰' }));
    expect(screen.getByTestId('twinlive-3d')).toBeInTheDocument();
    expect(screen.queryByTestId('plant-view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fleet 평면도' }));
    expect(screen.getByTestId('twinlive-floor')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3D 공장 뷰' }));
    expect(screen.getByTestId('plant-view')).toBeInTheDocument();
  });

  it('HUD 에 규모·Twin 수·프리셋·투어·라벨 모드·FPS 가 있고 캔버스가 마운트된다', () => {
    renderLive();
    expect(screen.getByText(/116 m × 60 m · Twin 30대/)).toBeInTheDocument();
    expect(screen.getByTestId('plant-canvas')).toBeInTheDocument();

    const presets = within(presetGroup()).getAllByRole('button');
    expect(presets).toHaveLength(8);
    expect(presets[0]).toHaveTextContent('전체 조망');
    expect(presets[0].className).toContain('primary'); // 기본 프리셋

    const tour = screen.getByRole('button', { name: /투어/ });
    expect(tour).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('plant-fps')).toHaveTextContent('– fps');

    // 색만으로 의미를 전달하지 않도록 범례가 항상 붙는다
    expect(screen.getByText('수렴 (Converged)')).toBeInTheDocument();
    expect(screen.getByText('Guard 차단 (Guarded)')).toBeInTheDocument();
    expect(screen.getByText(/클릭 = VIN 선택/)).toBeInTheDocument();
  });

  it('프리셋 버튼과 셀 카드 클릭이 카메라 프리셋을 바꾼다', () => {
    renderLive();
    fireEvent.click(presetButton('출하 야드'));
    expect(presetButton('출하 야드').className).toContain('primary');
    expect(presetButton('전체 조망').className).not.toContain('primary');

    const cards = within(cellGroup()).getAllByRole('button');
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('VIN REG'), expect.stringContaining('EOL TEST')]),
    );

    fireEvent.click(within(cellGroup()).getByRole('button', { name: /EOL TEST/ }));
    expect(presetButton('EOL 시험').className).toContain('primary');
  });

  it('투어는 7 초 체류 후 다음 프리셋으로 넘어가고, 라벨 LOD·선택 VIN 추적이 토글된다', () => {
    renderLive();
    const tour = screen.getByRole('button', { name: /투어/ });
    fireEvent.click(tour);
    expect(screen.getByRole('button', { name: '⏸ 투어 정지' })).toHaveAttribute('aria-pressed', 'true');

    // +5s 두 번 = 10 s → 첫 스톱(전체 조망)에서 두 번째 스톱(VIN 등록)으로
    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    expect(presetButton('전체 조망').className).toContain('primary');
    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    expect(presetButton('VIN 등록').className).toContain('primary');

    fireEvent.click(screen.getByRole('button', { name: '⏸ 투어 정지' }));
    expect(screen.getByRole('button', { name: /투어/ })).toHaveAttribute('aria-pressed', 'false');

    const labelGroup = screen.getByRole('group', { name: '라벨 표시 모드' });
    expect(within(labelGroup).getAllByRole('button')).toHaveLength(4);
    expect(within(labelGroup).getByRole('button', { name: '자동' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(labelGroup).getByRole('button', { name: '이상만' }));
    expect(within(labelGroup).getByRole('button', { name: '이상만' })).toHaveAttribute('aria-pressed', 'true');

    const follow = screen.getByRole('button', { name: /선택 VIN 추적/ });
    fireEvent.click(follow);
    expect(follow).toHaveAttribute('aria-pressed', 'true');
    // 추적 중에는 정적 프리셋 강조가 풀린다(추적 프리셋이 카메라를 소유)
    expect(presetButton('전체 조망').className).not.toContain('primary');
  });
});

/* ------------------------------------------------------ 2D 강등 경로 + 라우팅 */

describe('§17.2 Plant Twin — WebGL 없는 환경', () => {
  beforeEach(() => stubWebgl(false));

  it('같은 레이아웃 SoT 로 그린 2D 평면도로 강등되고 캔버스는 렌더하지 않는다', () => {
    renderLive();
    expect(screen.queryByTestId('plant-canvas')).toBeNull();
    const schematic = screen.getByTestId('plant-schematic');
    expect(within(schematic).getByRole('img', { name: /공장 평면도/ })).toBeInTheDocument();
    expect(within(schematic).getByText('OUTBOUND YARD (30)')).toBeInTheDocument();
    expect(schematic.querySelector('.plant-schematic-note')).not.toBeNull();
    // 셀 5개 + AMR 6대
    for (const cell of CELLS) expect(within(schematic).getByText(cell.short)).toBeInTheDocument();
    for (const r of AMR_ROUTES) expect(within(schematic).getByText(r.id)).toBeInTheDocument();
  });

  it('야드 차량을 클릭하면 VIN 이 선택되고, 더블클릭하면 차량 상세로 이동한다', () => {
    renderLive();
    const schematic = screen.getByTestId('plant-schematic');
    fireEvent.click(within(schematic).getByRole('button', { name: '야드 VIN-DEMO-005' }));
    expect(vinSelect().value).toBe('VIN-DEMO-005');

    fireEvent.doubleClick(within(schematic).getByRole('button', { name: '야드 VIN-DEMO-007' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/twin/vehicle/VIN-DEMO-007');
  });
});
