import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AppProvider } from '../store';
import { createTwinProvider } from '../state/twinStore';
import { TwinBottomBar, TwinLeftPanel } from '../components/twinPanels';
import { FleetView } from '../components/twinViews';
import * as T from '../data/twin/types';

const twin = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../state/twinStore', async (original) => ({
  ...await original<typeof import('../state/twinStore')>(),
  useTwin: () => twin.value,
}));

afterEach(() => { cleanup(); localStorage.clear(); });

function project(rate: number) {
  const provider = createTwinProvider({ rate: 0 });
  const snapshot = provider.getSnapshot();
  twin.value = {
    snapshot: {
      ...snapshot,
      convergence: { ...snapshot.convergence, convergenceRate: rate, threshold: 0.95, waves: [{ wave: 'UNIT', total: 4, converged: 3, rate: 0.75 }] },
    },
    scope: 'CANARY', targetRule: T.DEMO_TARGET_RULE,
    impact: provider.queryTargetFacts(T.DEMO_TARGET_RULE),
  };
}

describe('독립 차량 콘솔 수렴률 단위', () => {
  it.each([
    [0, '0%', 0, '0%'],
    [0.76, '76%', 80, '80%'],
    [0.95, '95%', 100, '100%'],
    [1, '100%', 100, '100%'],
  ])('원본 비율 %s는 백분율과 95%% 목표 대비 진행률로 표시한다', (rate, label, progress, width) => {
    project(rate as number);
    const { container } = render(<AppProvider><TwinLeftPanel lang="ko" onOpenVehicle={() => {}} /><TwinBottomBar lang="ko" /></AppProvider>);
    const convergence = screen.getByRole('heading', { name: /Fleet 수렴/ }).closest('section')!;
    expect(within(convergence).getByText(`${label} / 95%`)).toBeInTheDocument();
    expect(within(convergence).getByText(label as string, { selector: 'svg text' })).toBeInTheDocument();
    const bar = within(convergence).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', String(progress));
    expect(bar.querySelector('i')).toHaveStyle({ width });
    const kpi = screen.getByText('수렴률').closest('.tkpi')!;
    expect(kpi.querySelector('.v')!.textContent).toBe(label);
    expect(within(kpi).getByText('임계 95%')).toBeInTheDocument();
    expect(container.querySelector('.tshell-ticker')!.textContent).toContain(`CONVERGENCE ${label} / 95%`);
    expect(container.querySelector('.tshell-ticker')!.textContent).toContain('WAVE UNIT 3/4 (75%)');
  });

  it('반복소수 수렴률은 소수 첫째 자리까지 표시한다', () => {
    project(20 / 27);
    render(<AppProvider><TwinBottomBar lang="ko" /></AppProvider>);
    const kpi = screen.getByText('수렴률').closest('.tkpi')!;
    expect(kpi.querySelector('.v')!.textContent).toBe('74.1%');
  });

  it('Wave 표는 3/4를 75% 텍스트와 75% 너비로 보여준다', () => {
    project(0.76);
    render(<AppProvider><FleetView lang="ko" vin="" webgl={false} onSelectVin={() => {}} onOpenVehicle={() => {}} /></AppProvider>);
    const table = screen.getByTestId('tsview-fleet-waves');
    expect(within(table).getByText('75%')).toBeInTheDocument();
    expect(table.querySelector('.tbar i')).toHaveStyle({ width: '75%' });
    expect(within(table).getByText('3 / 4')).toBeInTheDocument();
  });
});
