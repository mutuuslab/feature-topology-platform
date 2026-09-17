/**
 * Twin UI 스모크 — §12 화면 5종이 실제 Provider 스택(MemoryRouter + AppProvider + TwinProvider)
 * 위에서 렌더되고 조작 가능한지 검증한다. 렌더 자체가 목적이므로 수치는 최소만 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider } from '../state/twinStore';
import { TwinFleet, TwinImpact, TwinSimulation } from '../pages/twin';
import { TwinVehicle, TwinIncident } from '../pages/twinOps';
import App from '../App';
import { DOMAINS } from '../i18n';

/** 장애 주입(deploy)·Kill-Switch(kill)·승인(approve)은 권한이 필요하다 → 스모크는 전체 verb 를 가진 integrator 로 실행. */
function RoleSetter({ role }: { role: string }) {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role });
  }, [role, dispatch]);
  return null;
}

function renderTwin(ui: ReactNode, opts: { route?: string; initial?: string; role?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.initial ?? '/']}>
      <AppProvider>
        <RoleSetter role={opts.role ?? 'integrator'} />
        <TwinProvider>
          {opts.route ? (
            <Routes>
              <Route path={opts.route} element={<>{ui}</>} />
            </Routes>
          ) : (
            <>{ui}</>
          )}
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // rate 0 → provider 가 스스로 tick 하지 않는다 (setInterval 없음 · 결정적 렌더)
  localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
});

afterEach(() => {
  localStorage.clear();
});

describe('§12.1 Twin Fleet 화면', () => {
  it('제목·KPI·VIN 표가 렌더된다', () => {
    renderTwin(<TwinFleet />, { route: '/twin/fleet', initial: '/twin/fleet' });
    // 화면 제목은 정본 이름을 쓴다 (구현 뷰 이름은 화면 안 「구현 뷰」 행과 같다).
    expect(screen.getByRole('heading', { name: /Twin Fleet \(3D\)/ })).toBeInTheDocument();
    expect(screen.getByText('전체 Twin')).toBeInTheDocument();
    expect(screen.getByText('Local Guard 차단')).toBeInTheDocument();
    expect(screen.getByText('VIN-DEMO-001')).toBeInTheDocument();
    expect(screen.getByText(/표시 30 \/ 30대/)).toBeInTheDocument();
  });

  it('Region 필터를 걸면 목록이 좁혀지고 초기화로 복구된다', () => {
    renderTwin(<TwinFleet />);
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'US' } });
    expect(screen.getByText(/표시 1 \/ 30대/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('필터 초기화'));
    expect(screen.getByText(/표시 30 \/ 30대/)).toBeInTheDocument();
  });

  it('문제 차량 목록에 판정 사유와 상세 링크가 표시된다', () => {
    renderTwin(<TwinFleet />);
    expect(screen.getByText('문제 차량 목록')).toBeInTheDocument();
    expect(screen.getAllByText('상세 →').length).toBeGreaterThan(0);
    // VIN-DEMO-029/030 이 CRITICAL_DRIFT 로 잡힌다
    expect(screen.getAllByText('EFFECTIVE_DRIFT_DETECTED').length).toBeGreaterThan(0);
  });

  it('desired=ON 활성화가 Canary 롤아웃을 시작한다', () => {
    renderTwin(<TwinFleet />);
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'desired=ON 활성화' }));
    expect(screen.getByText(/활성화된 차량 3대 · Binary OTA 대상 3대/)).toBeInTheDocument();
    expect(screen.getByText(/Rollout 진행 중 \(CANARY\)/)).toBeInTheDocument();

    // 일시정지 → 재개 로 상태가 왕복한다 (§13 5~6단계)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(screen.getByText('⏸ Rollout 일시정지')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '재개' }));
    expect(screen.queryByText('⏸ Rollout 일시정지')).toBeNull();
  });
});

describe('§12.2 Twin Impact Preview 화면', () => {
  it('대상 규모·활성화 전망·차단 사유가 렌더된다', () => {
    renderTwin(<TwinImpact />, { route: '/twin/impact', initial: '/twin/impact' });
    expect(screen.getByRole('heading', { name: /Impact Preview/ })).toBeInTheDocument();
    // DEMO_TARGET_RULE(KR · 2027 · EV) 매칭 25대 / 전체 30대
    expect(screen.getByText(/전체 Twin 30대 중 지역·차종·연식 조건 일치/)).toBeInTheDocument();
    expect(screen.getByText('Policy-only 가능')).toBeInTheDocument();
    expect(screen.getByText('⛔ Production Rollout 차단 중')).toBeInTheDocument();
    expect(screen.getByLabelText('impact scope')).toBeInTheDocument();
  });

  it('Eligibility 버킷을 선택하면 대상 표가 좁혀진다', () => {
    const { container } = renderTwin(<TwinImpact />);
    const buckets = Array.from(container.querySelectorAll('.twin-bucket')) as HTMLElement[];
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets[0].className).toContain('active');

    const target = buckets[buckets.length - 1];
    fireEvent.click(target);
    expect(target.className).toContain('active');
    expect(buckets[0].className).not.toContain('active');
    expect(screen.getByText(/^대상 차량 — /)).toBeInTheDocument();

    fireEvent.click(buckets[0]);
    expect(screen.getByText(/^대상 차량 — 전체/)).toBeInTheDocument();
  });

  it('Production 차단은 Impact Preview + Quality Gate 통과 후에만 열린다', () => {
    renderTwin(<TwinImpact />);
    // FLEET Scope 일 때만 Production 버튼이 된다
    fireEvent.change(screen.getByLabelText('impact scope'), { target: { value: 'FLEET' } });
    expect(screen.getByRole('button', { name: 'Production Rollout 실행' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Impact Preview 검토 완료/ }));
    fireEvent.click(screen.getByRole('button', { name: /Quality Gate 통과로/ }));
    expect(screen.getByText('✓ Production Rollout 가능')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Production Rollout 실행' })).toBeEnabled();
  });
});

describe('§12.3 What-if Twin Simulation 화면', () => {
  it('프리셋 11개가 렌더되고 적용 시 결과가 재평가된다', () => {
    const { container } =     renderTwin(<TwinSimulation />, { route: '/twin/simulation', initial: '/twin/simulation' });
    expect(screen.getByRole('heading', { name: /What-if Simulation/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.twin-preset').length).toBe(11);
    expect(screen.getByText('실행 결과')).toBeInTheDocument();

    // 기본은 정상 수렴 — 결과 코드는 실행 패널과 Open-loop 검증 카드 양쪽에 나타난다.
    expect(screen.getAllByText('POLICY_APPLIED_OK').length).toBeGreaterThan(0);

    // HW Capability 부족 → Eligibility 가 INCOMPATIBLE_HARDWARE 로 재평가된다 (배지에는 한글 라벨 표기)
    fireEvent.click(screen.getByText('HW Capability 부족'));
    expect(screen.getAllByText('HW Capability 부족').length).toBeGreaterThan(1);
    expect(screen.getAllByText('POLICY_NOT_RECEIVED').length).toBeGreaterThan(0);
  });

  it('입력을 직접 바꾸면 결과가 즉시 다시 계산된다', () => {
    renderTwin(<TwinSimulation />);
    expect(screen.queryByText('BATTERY_TEMP_SIGNAL_STALE')).toBeNull();

    // 온도 신호 900초 경과 → TTL(120초) 초과로 Local Guard 가 차단한다
    fireEvent.change(screen.getByLabelText('telemetryAge'), { target: { value: '900' } });
    expect(screen.getAllByText('BATTERY_TEMP_SIGNAL_STALE').length).toBeGreaterThan(0);
    expect(screen.getByText('차량 정보 오래됨')).toBeInTheDocument();
  });

  it('Local Guard 체크와 Quality Gate 10종이 표시된다', () => {
    renderTwin(<TwinSimulation />);
    expect(screen.getByText(/Quality Gate 결과 \(QG-01~QG-10\)/)).toBeInTheDocument();
    expect(screen.getByText('GS-10')).toBeInTheDocument();
    expect(screen.getByText('QG-10')).toBeInTheDocument();
  });
});

describe('§12.4 Vehicle Twin 상세 화면', () => {
  it('7단계 상태 스트립과 판정 요약이 렌더된다', () => {
    renderTwin(<TwinVehicle />, { route: '/twin/vehicle/:vin', initial: '/twin/vehicle/VIN-DEMO-017' });
    // UI12 정본 상세 영역 이름 + 대상 VIN
    expect(screen.getByRole('heading', { name: /목표와 보고 상태 · VIN-DEMO-017/ })).toBeInTheDocument();
    expect(screen.getByLabelText('VIN-DEMO-017 상태 단계')).toBeInTheDocument();
    expect(
      screen.getByText('As-Designed → As-Built → As-Deployed → Desired → Reported → Effective → Observed'),
    ).toBeInTheDocument();
    expect(screen.getByText('현재 판정 요약')).toBeInTheDocument();
  });

  it('탭을 바꾸면 해당 패널이 나타난다', () => {
    renderTwin(<TwinVehicle />, { route: '/twin/vehicle/:vin', initial: '/twin/vehicle/VIN-DEMO-017' });
    expect(screen.queryByText('판정 Evidence')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    expect(screen.getByText('판정 Evidence')).toBeInTheDocument();
  });

  it('없는 VIN 은 EmptyState 로 안내한다', () => {
    renderTwin(<TwinVehicle />, { route: '/twin/vehicle/:vin', initial: '/twin/vehicle/VIN-NOPE' });
    expect(screen.getByText(/차량 Twin 을 찾을 수 없습니다/)).toBeInTheDocument();
  });
});

describe('§12.5 / §15 / §18 Closed-Loop 화면', () => {
  it('초기에는 Incident 가 없고 장애 주입 시 12단계가 1-based 로 표시된다', () => {
    renderTwin(<TwinIncident />, { route: '/twin/incident', initial: '/twin/incident' });
    expect(screen.getByRole('heading', { name: /ECU별 조치와 결과/ })).toBeInTheDocument();
    // Incident 가 없어도 빈 화면이 아니라 "개시 대기" 상태 + 12단계 표를 보여준다
    expect(screen.getByText(/개시 대기/)).toBeInTheDocument();
    expect(screen.getByTestId('seed-incident')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Effective Drift' }));
    expect(screen.getByText(/INC-0001 생성/)).toBeInTheDocument();
    expect(screen.getAllByText('EFFECTIVE_DRIFT_DETECTED').length).toBeGreaterThan(0);

    // 단계 번호는 1..12 (off-by-one 회귀 방지)
    const autoPause = screen.getByText('신규 Rollout 자동 Pause').closest('tr') as HTMLTableRowElement;
    expect(within(autoPause).getAllByRole('cell')[0]).toHaveTextContent('6');
    const close = screen.getByText('Incident Close').closest('tr') as HTMLTableRowElement;
    expect(within(close).getAllByRole('cell')[0]).toHaveTextContent('12');
  });

  it('Kill-Switch 는 영향 범위 확인 전에는 실행되지 않는다', () => {
    renderTwin(<TwinIncident />);
    fireEvent.click(screen.getByRole('button', { name: 'Effective Drift' }));

    const killBtn = screen.getByRole('button', { name: /Kill-Switch 실행/ });
    expect(killBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Safe State OFF 를 확인했습니다/));
    expect(screen.getByRole('button', { name: /Kill-Switch 실행/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Kill-Switch 실행/ }));

    // Incident 는 활성 Rollout 에서만 만들어지므로 Drift 는 대상 Rollout 파동(3대)에 영향을 준다
    expect(screen.getByText(/Kill-Switch 실행 — 3대 Safe State OFF/)).toBeInTheDocument();
    expect(screen.getAllByText('KILL_SWITCH_ACTIVE').length).toBeGreaterThan(0);
  });

  it('Incident 종료 시 Evidence 가 저장되고 상태가 CLOSED 로 바뀐다', () => {
    renderTwin(<TwinIncident />);
    fireEvent.click(screen.getByRole('button', { name: 'Effective Drift' }));
    fireEvent.click(screen.getByRole('button', { name: /Incident 종료/ }));
    expect(screen.getByText(/Incident 종료 — Evidence 3건 저장/)).toBeInTheDocument();
    expect(screen.getAllByText('CLOSED').length).toBeGreaterThan(0);
  });
});

describe('라우팅·네비게이션 통합', () => {
  it('구현 화면 메뉴(차량 운영 레일 → Twin Fleet)에서 VIN 상세까지 이동한다', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProvider>
          <TwinProvider>
            <App />
          </TwinProvider>
        </AppProvider>
      </MemoryRouter>,
    );

    // 1차 IA 레일은 기준 7 업무 그룹이고, 서브내비에는 정본 화면 30개만 올라온다.
    fireEvent.click(await screen.findByRole('button', { name: '차량 운영' }));
    // 메뉴 항목 이름은 정본 화면 이름뿐이고(화면 ID 배지는 정본 업무 메뉴에 없다), 기준 화면 정의서(/ui/UI11)는 제품에 없다.
    const row = await screen.findByRole('link', { name: /^차량 운영 현황$/ }, { timeout: 5000 });
    expect(row.textContent).toBe('차량 운영 현황');
    expect(document.querySelector('a[href^="/ui/UI"]')).toBeNull();
    expect(row).toHaveAttribute('href', '/fleet');
    fireEvent.click(row);
    // 화면으로 들어가면 그 화면의 나머지 구현 뷰가 「구현 뷰」 행에 나타난다.
    fireEvent.click(await screen.findByRole('link', { name: /Twin Fleet/, }, { timeout: 5000 }));
    // 두 페이지 모두 lazy 라우트다. 청크 로드 + Suspense 재시도 + 무거운 페이지 마운트가
    // 겹치면 기본 1000ms 를 넘길 수 있으므로(머신 부하에 따라 편차가 큼) 여유를 준다.
    // 검증 대상은 '이동'이지 '지연'이 아니다.
    expect(await screen.findByRole('heading', { name: /Twin Fleet/ }, { timeout: 5000 })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '상세 →' })[0]);
    expect(await screen.findByRole('heading', { name: /Vehicle Twin ·/ }, { timeout: 5000 })).toBeInTheDocument();
    // 레일 → 화면 → 구현 뷰 → 상세로 세 번 이동하므로 기본 5s 로는 부족하다(검증 대상은 이동 경로).
  }, 20000);

  /**
   * 정본 업무 메뉴(FP_UI_Menu_Map_v1_3 의 「업무 메뉴」 판)는 그룹 이름과 화면 이름만 쓴다.
   * 화면 ID 는 화면 헤더 pill(`UI10 · C46 …`)에만 남고 메뉴 줄에는 붙지 않아야 한다.
   */
  it('서브내비 줄에는 화면 ID 코드가 붙지 않는다 (이름만 남는다)', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProvider>
          <TwinProvider>
            <App />
          </TwinProvider>
        </AppProvider>
      </MemoryRouter>,
    );
    const ids = /(^|\s)UI\d\d(-S\d\d)?(\s|$)/;
    for (const domain of DOMAINS) {
      fireEvent.click(await screen.findByRole('button', { name: domain.ko }));
      const subnav = document.querySelector('.subnav') as HTMLElement;
      expect(subnav, domain.key).toBeTruthy();
      const rows = domain.screens.map(s => within(subnav).getByRole('link', { name: s.ko }));
      expect(rows).toHaveLength(domain.screens.length);
      rows.forEach((row, i) => {
        expect(row.textContent, domain.screens[i].id).toBe(domain.screens[i].ko);
        expect(ids.test(row.textContent || ''), domain.screens[i].id).toBe(false);
      });
    }
  }, 20000);

  it('시뮬레이션 입력은 localStorage 에 저장되어 새로고침 후에도 유지된다', () => {
    const view = renderTwin(<TwinSimulation />);
    fireEvent.click(screen.getByText('HW Capability 부족'));

    const saved = JSON.parse(localStorage.getItem('fp.twin.v1') ?? '{}');
    expect(saved.simInputs.hardwareCapability).toBe(false);

    view.unmount();
    renderTwin(<TwinSimulation />);
    expect((screen.getByLabelText('hwCapability') as HTMLInputElement).checked).toBe(false);
  });

  it('/twin/fleet 라우트가 App 스택에서 렌더된다', async () => {
    render(
      <MemoryRouter initialEntries={['/twin/fleet']}>
        <AppProvider>
          <TwinProvider>
            <App />
          </TwinProvider>
        </AppProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: /Twin Fleet/ })).toBeInTheDocument();
  });
});
