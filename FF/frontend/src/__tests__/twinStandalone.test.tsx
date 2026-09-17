/**
 * §18 독립 Twin 콘솔 (twin.html) 검증.
 *
 * 이 화면의 존재 이유는 두 가지다:
 *  1) Feature Platform 크롬(Sidebar/Topbar/라우터) **없이** 단독으로 뜬다.
 *  2) 헤더/좌/중앙/우/하단 4구역이 모두 살아 있고, "live" 라고 쓴 값이
 *     시뮬레이터 시각을 진행시키면 **실제로 바뀐다**.
 *
 * 그래서 테스트도 스냅샷이 아니라 행동을 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider, useTwin } from '../state/twinStore';
import TwinStandalone from '../pages/twinStandalone';
import { simClockLabel } from '../components/liveMonitor';
import { createTwinProvider } from '../state/twinStore';

function RoleSetter() {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ t: 'ROLE', role: 'integrator' });
  }, [dispatch]);
  return null;
}

/** 시뮬레이터를 수동으로만 진행시켜 결정적으로 검증한다(자동 interval 없음). */
function Stepper() {
  const { step, activate, setRate } = useTwin();
  return (
    <div>
      <button onClick={() => step(5)}>TEST_STEP</button>
      <button onClick={() => activate('CANARY')}>TEST_ACTIVATE</button>
      <button onClick={() => setRate(0)}>TEST_PAUSE</button>
    </div>
  );
}

function renderConsole() {
  return render(
    <AppProvider>
      <RoleSetter />
      <TwinProvider>
        <TwinStandalone />
        <Stepper />
      </TwinProvider>
    </AppProvider>,
  );
}

const clockText = () => screen.getByTestId('tshell-clock').textContent ?? '';

describe('§18 독립 Twin 콘솔 — 셸', () => {
  beforeEach(() => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('플랫폼 크롬 없이 4구역(헤더/좌/중앙/우/하단)이 모두 존재한다', () => {
    renderConsole();

    expect(screen.getByTestId('twin-standalone')).toBeInTheDocument();
    expect(screen.getByTestId('tshell-left')).toBeInTheDocument();
    expect(screen.getByTestId('tshell-center')).toBeInTheDocument();
    expect(screen.getByTestId('tshell-right')).toBeInTheDocument();
    expect(screen.getByTestId('tshell-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('tshell-stage')).toBeInTheDocument();

    // 플랫폼 크롬이 섞여 들어오지 않았는지 — 이 화면의 핵심 계약이다.
    expect(document.querySelector('.topbar')).toBeNull();
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(document.querySelector('nav')).toBeNull();

    // 헤더에 버전/리비전 식별자가 있다.
    const head = document.querySelector('.tshell-head') as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.textContent).toContain('Vehicle Feature Control Room');
    expect(head.textContent).toMatch(/rev \d+/);
  });

  it('한국어·영어의 모든 운영 뷰에서 Digital Twin 용어를 사용자에게 노출하지 않는다', () => {
    renderConsole();
    const ids = ['factory', 'vehicle', 'fleet', 'arch', 'simulation', 'incident', 'revision'] as const;
    const assertRemoved = () => {
      const term = /\bdigital\s+twin\b|\btwin\b/i;
      const visibleTerms = Array.from(document.body.querySelectorAll('*')).flatMap((element) =>
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? '')
          .filter((text) => term.test(text)),
      );
      expect(visibleTerms).toEqual([]);
    };

    ids.forEach((id) => {
      fireEvent.click(screen.getByTestId(`tshell-view-${id}`));
      assertRemoved();
    });

    fireEvent.click(screen.getByRole('button', { name: '언어 전환' }));
    ids.forEach((id) => {
      fireEvent.click(screen.getByTestId(`tshell-view-${id}`));
      assertRemoved();
    });
  });

  it('7개 뷰 탭이 모두 있고, 탭을 누르면 중앙 스테이지가 실제로 교체된다', () => {
    renderConsole();
    const ids = ['factory', 'vehicle', 'fleet', 'arch', 'simulation', 'incident', 'revision'] as const;
    const stage = screen.getByTestId('tshell-stage');

    expect(stage.getAttribute('data-view')).toBe('factory');

    // jsdom 에는 WebGL 이 없다. 그래도 뷰가 통째로 사라지면 안 된다 —
    // 각 뷰가 자체 2D 폴백을 갖고 있으므로 여기서는 "렌더되었는가"를 본다.
    const landing: Record<string, string> = {
      factory: 'tsview-plant',
      vehicle: 'tsview-vehicle',
      fleet: 'tsview-fleet',
      arch: 'tsview-arch',
      simulation: 'tsview-simulation',
      incident: 'tsview-incident-empty',
      revision: 'tsview-revision',
    };

    for (const id of ids) {
      fireEvent.click(screen.getByTestId(`tshell-view-${id}`));
      expect(screen.getByTestId('tshell-stage').getAttribute('data-view')).toBe(id);
      const inner = within(screen.getByTestId('tshell-stage'));
      expect(inner.getByTestId(landing[id])).toBeInTheDocument();
      expect((inner.getByTestId(landing[id]).textContent ?? '').length).toBeGreaterThan(20);
    }
  });

  it('공장 프리셋과 선택 VIN 추적은 현재 초점의 대상과 설명을 명시한다', () => {
    renderConsole();
    const presets = screen.getByRole('group', { name: '공장 카메라 프리셋' });
    fireEvent.click(within(presets).getByRole('button', { name: '배터리' }));

    const focus = screen.getByTestId('plant-focus-readout');
    expect(focus).toHaveTextContent('현재 초점');
    expect(focus).toHaveTextContent('배터리');
    expect(focus).toHaveTextContent('HW Capability');

    fireEvent.click(screen.getByRole('button', { name: /선택 VIN 추적/ }));
    expect(focus).toHaveTextContent(/선택 VIN VIN-DEMO-\d{3}/);
    expect(focus).toHaveTextContent('선택 차량을 출하 야드 중앙에 고정');
  });

  it('투어 중에는 현재 공정 프리셋과 투어 순번을 함께 강조한다', () => {
    renderConsole();
    const presets = screen.getByRole('group', { name: '공장 카메라 프리셋' });
    fireEvent.click(screen.getByRole('button', { name: /▶ 투어/ }));

    expect(screen.getByRole('button', { name: /⏸ 투어 \(1\/8\) 정지/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(presets).getByRole('button', { name: '전체 조망' }).className).toContain('is-on');
    expect(screen.getByTestId('plant-focus-readout')).toHaveTextContent('전체 조망');
  });

  it('3D 뷰는 WebGL 미지원을 알리되 뷰 자체를 가리지는 않는다', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    // jsdom 에는 WebGL 컨텍스트가 없다 — 그 상황을 명시적으로 재현한다.
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => null;
    try {
      renderConsole();

      const note = screen.getByTestId('tshell-webgl-note');
      expect(note.textContent).toContain('2D 개략도');
      // 안내 띠가 있어도 공장 뷰는 여전히 보여야 한다(이전엔 통째로 가려졌다).
      expect(screen.getByTestId('tsview-plant')).toBeInTheDocument();
      // WebGL 이 필요 없는 뷰에는 이 띠가 뜨지 않는다.
      fireEvent.click(screen.getByTestId('tshell-view-fleet'));
      expect(screen.queryByTestId('tshell-webgl-note')).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  it('LIVE 표시는 실제 rate 를 반영한다 — 정지하면 PAUSED 로 바뀐다', () => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 1 }));
    renderConsole();

    const live = screen.getByTestId('tshell-live');
    expect(live.getAttribute('data-paused')).toBe('false');
    expect(live.textContent).toContain('LIVE');

    fireEvent.click(screen.getByText('TEST_PAUSE'));
    const paused = screen.getByTestId('tshell-live');
    expect(paused.getAttribute('data-paused')).toBe('true');
    expect(paused.textContent).toContain('PAUSED');
  });
});

describe('§18 독립 Twin 콘솔 — 라이브니스', () => {
  beforeEach(() => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('시뮬레이터 시각 1초 진행이 헤더 클럭을 실제로 바꾼다', () => {
    renderConsole();
    const before = clockText();
    expect(before).toContain('T+0s');

    fireEvent.click(screen.getByText('+1s'));
    expect(clockText()).not.toBe(before);
    expect(clockText()).toContain('T+1s');
  });

  it('하단 대시보드 KPI 가 tick 진행에 따라 갱신된다(정지 화면 방지)', () => {
    renderConsole();
    const before = screen.getByTestId('tshell-bottom').textContent ?? '';
    expect(before).toContain('Sim Tick');

    fireEvent.click(screen.getByText('TEST_STEP'));
    fireEvent.click(screen.getByText('TEST_STEP'));

    const after = screen.getByTestId('tshell-bottom').textContent ?? '';
    expect(after).not.toBe(before);
    expect(screen.getByTestId('tshell-bottom').textContent).toMatch(/tick 2/);
  });

  it('Rollout 을 활성화하면 하단 대상/수렴 수치와 좌측 패널이 함께 움직인다', () => {
    renderConsole();
    const before = screen.getByTestId('tshell-bottom').textContent ?? '';

    fireEvent.click(screen.getByText('TEST_ACTIVATE'));

    const after = screen.getByTestId('tshell-bottom').textContent ?? '';
    expect(after).not.toBe(before);
    expect(screen.getByTestId('tshell-left').textContent).not.toBe('');
  });
});

describe('§18 독립 Twin 콘솔 — Closed-Loop 실제 진행', () => {
  beforeEach(() => {
    localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('Incident 가 없을 때는 빈 화면이 아니라 12단계 골격과 개시 버튼을 보여준다', () => {
    renderConsole();
    fireEvent.click(screen.getByTestId('tshell-view-incident'));

    const rail = screen.getByTestId('tsloop').querySelectorAll('.tsloop-step');
    expect(rail).toHaveLength(12);
    expect([...rail].every((s) => s.getAttribute('data-status') === 'PENDING')).toBe(true);
    expect(screen.getByTestId('tsseed-incident')).toBeInTheDocument();
  });

  it('개시 버튼 한 번으로 Activate + 결함 주입이 일어나 파이프라인이 실제로 전진한다', () => {
    renderConsole();
    fireEvent.click(screen.getByTestId('tshell-view-incident'));
    expect(screen.getByTestId('tsview-incident-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tsseed-incident'));

    // 이제는 빈 상태가 아니라 실제 Incident 화면이다.
    expect(screen.queryByTestId('tsview-incident-empty')).toBeNull();
    const view = screen.getByTestId('tsview-incident');
    expect(view.getAttribute('data-incident')).toBeTruthy();

    // 시뮬레이터 시각이 지나가면 자동 진행이 앞선다 — 시각 파생이므로 멈춰 있으면 안 된다.
    const pctBefore = screen.getByTestId('tsloop-pct').textContent;
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByText('TEST_STEP'));
    expect(screen.getByTestId('tsloop-pct').textContent).not.toBe(pctBefore);

    // 원인/증거/영향 VIN 3분할이 함께 보인다.
    expect(view.textContent).toContain('근본 원인');
    expect(screen.getByTestId('tsview-incident-evidence')).toBeInTheDocument();
  });
});

describe('§18 독립 콘솔 — 시뮬레이터 클럭 표기', () => {
  it('경과 시간은 startedAtMs 기준이며 에포크 값을 지속시간으로 오표기하지 않는다', () => {
    const provider = createTwinProvider({ rate: 0 });
    const clock = provider.getSnapshot().clock;

    const atStart = simClockLabel(clock);
    expect(atStart.elapsed).toBe('0s');
    expect(atStart.text).toContain('T+0s');
    expect(atStart.text).not.toMatch(/d \d+h/);

    provider.step(90);
    const after = simClockLabel(provider.getSnapshot().clock);
    expect(after.elapsed).toBe('1m 30s');
    expect(after.tick).toBe(atStart.tick + 1);
    // 절대 시각은 시뮬레이터 시각의 ISO 표기여야 한다.
    expect(after.at).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
