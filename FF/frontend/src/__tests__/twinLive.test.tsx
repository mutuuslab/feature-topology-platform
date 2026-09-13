/**
 * §12.6 Live Visual Twin 스모크 — RFTwin 스타일 실시간 화면.
 *
 * jsdom 에는 WebGL 이 없으므로 @react-three/fiber / drei 를 스텁한다.
 * 3D 좌표계 대신 (1) 부품 목록·상세·Explanation 패널 같은 DOM 계약과
 * (2) WebGL 미지원 시 자동 강등되는 2D 개략도 경로를 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider } from '../state/twinStore';
import { TwinLive } from '../pages/twinLive';
import App from '../App';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div data-testid="twinlive-canvas">{children}</div>,
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
      camera: { position: { lerp: () => {}, distanceTo: () => 0 }, lookAt: () => {} },
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
  Environment: ({ children }: { children?: ReactNode }) => <group>{children}</group>,
  Lightformer: () => null,
  ContactShadows: () => null,
}));

function RoleSetter({ role }: { role: string }) {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role });
  }, [role, dispatch]);
  return null;
}

function renderLive(opts: { role?: string; withRoutes?: boolean; initial?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.initial ?? '/twin/live']}>
      <AppProvider>
        <RoleSetter role={opts.role ?? 'integrator'} />
        <TwinProvider>
          {opts.withRoutes === false ? (
            <TwinLive />
          ) : (
            <Routes>
              <Route path="/twin/live" element={<TwinLive />} />
              <Route path="/twin/vehicle/:vin" element={<LocationProbe />} />
              <Route path="/twin/incident" element={<LocationProbe />} />
              <Route path="/twin/simulation" element={<LocationProbe />} />
            </Routes>
          )}
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
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

/**
 * `/twin/live` 의 기본 탭은 '3D 공장 뷰'(§17.2)다. 차량 단위 화면을 검증하는 테스트는
 * 먼저 차량 뷰 탭으로 이동한다.
 */
const gotoTab = (name: '3D 차량 뷰' | 'Fleet 평면도' | '3D 공장 뷰') =>
  fireEvent.click(screen.getByRole('button', { name }));
const gotoVehicleTab = () => gotoTab('3D 차량 뷰');

const partsGroup = () => screen.getByRole('group', { name: '차량 부품 목록' });
const eventsCard = () => screen.getByTestId('twinlive-events');
const vinSelect = () => screen.getByRole('combobox', { name: 'VIN' }) as HTMLSelectElement;

beforeEach(() => {
  // rate 0 → provider 가 스스로 tick 하지 않는다 (결정적 렌더)
  localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  stubWebgl(true);
});

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).WebGLRenderingContext;
  vi.restoreAllMocks();
});

describe('§12.6 Live Visual Twin — 헤더·재생 컨트롤', () => {
  it('LIVE/PAUSED 상태·시뮬레이션 시각·이벤트 카운터가 표시된다', () => {
    renderLive();
    expect(screen.getByRole('heading', { name: /Live Visual Twin/ })).toBeInTheDocument();
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(screen.getByText('10:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('tick 0')).toBeInTheDocument();
    expect(screen.getByText('evt #0')).toBeInTheDocument();
    // 데이터 등급 고지(§19) + revision 표기
    expect(screen.getByText(/실차 아님/)).toBeInTheDocument();
  });

  it('배속 전환과 +5s 스텝이 시뮬레이션 클럭을 진행시킨다', () => {
    renderLive();
    expect(screen.getByRole('button', { name: '재생' })).toHaveTextContent('▶ 재생');

    fireEvent.click(screen.getByRole('button', { name: '5×' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toHaveTextContent('⏸ 정지');
    expect(screen.queryByText('PAUSED')).toBeNull();
    expect(screen.getByText('LIVE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '0×' }));
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    expect(screen.getByText('10:00:05Z')).toBeInTheDocument();
    expect(screen.getByText('tick 1')).toBeInTheDocument();
  });
});

describe('§12.6 Live Visual Twin — 3D 차량 뷰', () => {
  it('가장 문제가 큰 VIN 을 기본 선택하고 부품 10종을 상태와 함께 보여준다', () => {
    renderLive();
    gotoVehicleTab();
    // 시드 Fleet 의 첫 Critical Drift 차량
    expect(vinSelect().value).toBe('VIN-DEMO-029');

    const parts = within(partsGroup()).getAllByRole('button');
    expect(parts).toHaveLength(10);
    expect(within(partsGroup()).getByText('배터리 팩 (Feature 호스트)')).toBeInTheDocument();
    expect(within(partsGroup()).getByText('Local Guard (차량 로컬 판정)')).toBeInTheDocument();
    expect(within(partsGroup()).getByText('BMS (요구 SW 3.2.0 이상)')).toBeInTheDocument();
    // 선택된 부품(기본: 배터리 팩)의 상세가 노출된다
    expect(screen.getByTestId('twinlive-part-detail')).toHaveTextContent('Feature Instance Desired/Reported/Effective');
  });

  it('부품을 선택하면 상세와 Explanation 패널이 함께 갱신된다', () => {
    renderLive();
    gotoVehicleTab();
    fireEvent.click(within(partsGroup()).getByText('Local Guard (차량 로컬 판정)'));
    const detail = screen.getByTestId('twinlive-part-detail');
    expect(detail).toHaveTextContent('Local Guard (차량 로컬 판정)');
    expect(detail).toHaveTextContent('출처: Reported.guardResult');

    const explain = screen.getByTestId('twinlive-explain');
    expect(explain).toHaveTextContent('Local Guard (차량 로컬 판정)');
    expect(explain).toHaveTextContent(/conf \d+%/);
  });

  it('Explanation 패널이 원인 코드·권장 조치·승인 필요 여부를 보여준다', () => {
    renderLive();
    gotoVehicleTab();
    const explain = screen.getByTestId('twinlive-explain');
    expect(explain).toHaveTextContent('→ 권장 조치');
    expect(explain).toHaveTextContent('인간 승인 필요');
    expect(explain).toHaveTextContent(/적용 경로/);
  });

  it('차량 3D 씬이 자체 HUD(X-ray · 카메라 프리셋 · 레이어 · Explode)를 갖고 상호작용한다', () => {
    renderLive();
    gotoVehicleTab();

    // 씬은 자체 완결 위젯이다 — 강등 경로가 아니어야 한다.
    expect(screen.getByTestId('veh-scene-root')).toBeInTheDocument();
    expect(screen.queryByTestId('veh-fallback')).toBeNull();

    const hud = within(screen.getByTestId('veh-hud'));

    // X-ray 토글 — 상태가 라벨에 그대로 드러난다 (기본 OFF → ON).
    expect(hud.getByRole('button', { name: /X-ray 차체 OFF/ })).toBeInTheDocument();
    fireEvent.click(hud.getByRole('button', { name: /X-ray 차체 OFF/ }));
    expect(hud.getByRole('button', { name: /X-ray 차체 ON/ })).toBeInTheDocument();

    // 카메라 프리셋 6종 — 기존 3종이 아닌 확장 세트.
    for (const label of ['외관', '배터리 팩', 'E·E 아키텍처', 'HV 케이블', '열관리', '운전자']) {
      expect(hud.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(hud.getByRole('button', { name: 'HV 케이블' }));
    expect(hud.getByRole('button', { name: 'HV 케이블' })).toHaveAttribute('aria-pressed', 'true');

    // 레이어 필터 · Explode 슬라이더 · 흐름 토글
    fireEvent.click(hud.getByRole('button', { name: 'ECU' }));
    expect(hud.getByRole('button', { name: 'ECU' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(hud.getByRole('slider', { name: 'explode 비율' }), { target: { value: '40' } });
    expect(hud.getByText('40%')).toBeInTheDocument();
    fireEvent.click(hud.getByRole('button', { name: /흐름 표시 ON/ }));
    expect(hud.getByRole('button', { name: /흐름 표시 OFF/ })).toBeInTheDocument();
  });

  it('씬의 모션은 시뮬레이터 시계에 종속된다 — 정지하면 일시정지로 표시된다', () => {
    renderLive();
    gotoVehicleTab();
    const root = screen.getByTestId('veh-scene-root');
    // rate 0(정지) — 파생 애니메이션이 멈춰야 한다.
    expect(root).toHaveAttribute('data-paused', 'true');
    expect(screen.getByTestId('veh-paused-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1×' }));
    expect(screen.getByTestId('veh-scene-root')).toHaveAttribute('data-paused', 'false');
    expect(screen.queryByTestId('veh-paused-banner')).toBeNull();
  });

  it('WebGL 을 쓸 수 없으면 2D 개략도로 강등되고 부품 선택은 그대로 동작한다', () => {
    stubWebgl(false);
    renderLive();
    gotoVehicleTab();
    expect(screen.queryByTestId('veh-canvas')).toBeNull();
    expect(screen.getByTestId('veh-fallback')).toBeInTheDocument();

    const svg = screen.getByTestId('twinlive-schematic');
    expect(within(svg).getAllByRole('button')).toHaveLength(10);

    fireEvent.click(within(svg).getByRole('button', { name: /BMS/ }));
    expect(screen.getByTestId('twinlive-part-detail')).toHaveTextContent('As-Deployed (ecuSoftware)');

    // 부품 목록도 그대로 사용 가능
    fireEvent.click(within(partsGroup()).getByText('차체 · 트림'));
    expect(screen.getByTestId('twinlive-part-detail')).toHaveTextContent('As-Designed (identity)');
  });

  it('부품 색(정적 스냅샷)과 별개로 실시간 텔레메트리 카드가 함께 붙는다', () => {
    renderLive();
    // 이 탭에만 있는 카드다 — 다른 탭에서는 렌더되지 않는다.
    expect(screen.queryByTestId('vehicle-telemetry-live')).toBeNull();
    gotoVehicleTab();

    const card = screen.getByTestId('vehicle-telemetry-live');
    expect(within(card).getAllByTestId('vtel-signal')).toHaveLength(6);
    expect(card).toHaveAttribute('data-paused', 'true');
    expect(screen.getByTestId('vtel-summary').textContent).not.toBe('');

    // 재생하면 카드도 LIVE 로 전환된다(모션은 시뮬레이터 시계에서만 온다).
    fireEvent.click(screen.getByRole('button', { name: '1×' }));
    expect(screen.getByTestId('vehicle-telemetry-live')).toHaveAttribute('data-paused', 'false');
  });
});

describe('§12.6 Live Visual Twin — Fleet 평면도', () => {
  it('cohort 별 30대 타일과 브로드캐스트 상태를 표시한다', () => {
    renderLive();
    fireEvent.click(screen.getByRole('button', { name: 'Fleet 평면도' }));
    const floor = screen.getByTestId('twinlive-floor');
    expect(within(floor).getAllByRole('button')).toHaveLength(30);
    expect(within(floor).getByText('wave-1-kr')).toBeInTheDocument();
    expect(within(floor).getByText('legacy-kr')).toBeInTheDocument();
    // 롤아웃 미시작 + rate 0 → 대기
    expect(within(floor).getByText('⏸ 대기')).toBeInTheDocument();
  });

  it('타일을 클릭하면 선택 VIN 이 바뀌고 상세 이동이 가능하다', () => {
    renderLive();
    fireEvent.click(screen.getByRole('button', { name: 'Fleet 평면도' }));
    const floor = screen.getByTestId('twinlive-floor');
    fireEvent.click(within(floor).getByText('#005'));
    expect(vinSelect().value).toBe('VIN-DEMO-005');

    fireEvent.click(screen.getByRole('button', { name: '상세 →' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/twin/vehicle/VIN-DEMO-005');
  });

  it('수렴 스캔 스트립이 시뮬레이터 틱·배속을 그대로 반영한다', () => {
    renderLive();
    gotoTab('Fleet 평면도');
    const scan = () => screen.getByTestId('twinlive-scan');

    expect(scan()).toHaveAttribute('data-tick', '0');
    expect(scan()).toHaveTextContent('수렴 스캔 #0 · 정지');

    // 배속을 켜면 '정지' 가 진행 표기로 바뀐다.
    fireEvent.click(screen.getByRole('button', { name: '1×' }));
    expect(scan()).toHaveTextContent('수렴 스캔 #0 · 1× 진행');

    // 스텝은 틱을 실제로 올린다 — 화면의 진행 표기는 이 값에서만 나온다.
    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    expect(Number(scan().getAttribute('data-tick'))).toBeGreaterThan(0);
  });

  it('타일별 관측 경과가 시뮬레이터 시계에서만 파생된다(오프라인 VIN)', () => {
    renderLive();
    gotoTab('Fleet 평면도');

    // VIN-DEMO-024 = OFFLINE 시드 → lastSeenAt 이 갱신되지 않는다.
    // (이벤트 피드에도 같은 '#024' 표기가 있으므로 평면도 안으로 범위를 좁힌다.)
    const floor = screen.getByTestId('twinlive-floor');
    const tile = within(floor).getByText('#024').closest('button') as HTMLElement;
    const age = () => Number(within(tile).getByTestId('twinlive-tile-age').getAttribute('data-age'));
    const before = age();
    expect(Number.isFinite(before)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    expect(age()).toBe(before + 5);
  });
});

describe('§12.6 Live Visual Twin — 이벤트 피드·KPI·Kill-Switch', () => {
  it('Recent Events 에 시드된 Twin 이력이 채워지고 VIN 필터가 동작한다', () => {
    renderLive();
    const rows = eventsCard().querySelectorAll('li.twinlive-event-row');
    expect(rows).toHaveLength(16);
    expect(within(eventsCard()).getAllByText('audit').length).toBeGreaterThan(0);
    expect(within(eventsCard()).getAllByText(/EOL 시스템|Policy Engine|Reconciliation Service/).length).toBeGreaterThan(0);

    fireEvent.click(within(eventsCard()).getByRole('checkbox', { name: '선택 VIN 만 보기' }));
    // 선택 VIN(029) 외의 행은 사라진다
    expect(within(eventsCard()).queryByText('#001')).toBeNull();
    expect(within(eventsCard()).getAllByText('#029').length).toBeGreaterThan(0);
  });

  it('Fleet 브로드캐스트 이벤트는 VIN 대신 "전체 N대" 로 표기되고 VIN 선택을 바꾸지 않는다', () => {
    renderLive();
    fireEvent.click(screen.getByRole('button', { name: '+5s' }));
    fireEvent.change(vinSelect(), { target: { value: 'VIN-DEMO-005' } });

    // 차량이 아닌 스코프(브로드캐스트)는 존재하지 않는 VIN 을 노출하지 않는다
    const fleet = within(eventsCard()).getByText(/^전체 \d+대$/);
    expect(within(eventsCard()).queryByText(/VIN-DEMO-\*/)).toBeNull();
    const row = fleet.closest('li') as HTMLElement;
    expect(row).not.toHaveAttribute('role', 'button');

    fireEvent.click(row);
    // 클릭해도 선택 VIN 은 그대로여야 한다(가짜 VIN 으로 점프하지 않는다)
    expect(vinSelect().value).toBe('VIN-DEMO-005');
  });

  it('KPI 카드가 Fleet 수렴 지표를 보여준다', () => {
    renderLive();
    expect(screen.getByText('수렴률 (임계 95%)')).toBeInTheDocument();
    expect(screen.getByText('활성화 VIN')).toBeInTheDocument();
    expect(screen.getByText('Drift / Unknown')).toBeInTheDocument();
    expect(screen.getByText('미해결 Incident')).toBeInTheDocument();
    expect(screen.getByText(/Guard 차단 \d+/)).toBeInTheDocument();
  });

  it('Kill-Switch 를 실행하면 journal 이벤트가 피드에 쌓이고 차량이 차단 상태로 표시된다', () => {
    renderLive();
    gotoVehicleTab();
    fireEvent.click(screen.getByRole('button', { name: /Kill-Switch/ }));
    expect(screen.getByText(/^evt #[1-9]/)).toBeInTheDocument();
    expect(within(eventsCard()).getAllByText('kill-switch.applied').length).toBeGreaterThan(0);
    // Fleet 전체 Kill-Switch 요청(vin=ALL)도 가짜 VIN 대신 "전체" 로만 표기된다
    const broadcast = within(eventsCard()).getByText('kill-switch.requested').closest('li') as HTMLElement;
    expect(broadcast).toHaveTextContent('전체');
    expect(broadcast).not.toHaveAttribute('role', 'button');
    expect(within(partsGroup()).getAllByText('Guard 차단').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Fleet 평면도' }));
    expect(within(screen.getByTestId('twinlive-floor')).getAllByText('KS')).toHaveLength(1);
  });

  it('운영자 역할이 아니면 Kill-Switch 가 비활성화된다', () => {
    renderLive({ role: '기획 P1' });
    expect(screen.getByRole('button', { name: /Kill-Switch/ })).toBeDisabled();
  });

  it('Incident·What-if 화면으로 이동한다', () => {
    renderLive();
    fireEvent.click(screen.getByRole('button', { name: 'Incident' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/twin/incident');
  });
});

describe('§12.6 Live Visual Twin — 공장 뷰 Feature Flag 로그 터미널', () => {
  it('터미널이 트윈 저널·감사 로그를 실제 라인으로 보여주고 레벨 필터가 동작한다', () => {
    renderLive();
    const term = screen.getByTestId('flaglog');
    expect(term).toBeInTheDocument();
    expect(within(term).getByText(/DigitalTwinPort\.journal/)).toBeInTheDocument();
    // t0 에도 시드 감사 로그가 있으므로 빈 화면이 아니다
    expect(within(term).getAllByTestId('flaglog-row').length).toBeGreaterThan(0);
    fireEvent.click(within(term).getByRole('button', { name: /^ERROR/ }));
    expect(within(term).getByText(/필터에 맞는 라인이 없습니다/)).toBeInTheDocument();
  });

  it('터미널 HUD 토글로 로그를 숨기고 다시 보여준다', () => {
    renderLive();
    const toggle = screen.getByRole('button', { name: /Feature Flag 로그/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('flaglog')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByTestId('flaglog')).toBeInTheDocument();
  });
});

describe('§12.6 Live Visual Twin — 라우팅 통합', () => {
  // 공장 뷰가 기본 탭이라 jsdom 초기 마운트가 무겁다 → 이 테스트만 개별 타임아웃을 준다
  // (전역 testTimeout 5000ms가 먼저 걸리면 안쪽 findBy 타임아웃은 의미가 없다)
  it('App 의 /twin/live 라우트와 G12 메뉴로 진입할 수 있다', async () => {
    render(
      <MemoryRouter initialEntries={['/twin/live']}>
        <AppProvider>
          <TwinProvider>
            <App />
          </TwinProvider>
        </AppProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: /Live Visual Twin/ }, { timeout: 15000 })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '차량 운영' }, { timeout: 15000 }));
    expect(await screen.findByRole('link', { name: 'Live Visual Twin (3D)' }, { timeout: 15000 })).toBeInTheDocument();
  }, 60000);
});
