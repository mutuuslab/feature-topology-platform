// Grafana 운영 대시보드 링크(80-80) — 빌드 설정이 없으면 숨기고('연결 안 됨'을 보이지 않는다), 있으면 새 창 링크.
// Feature 상세(외부 도구 카드)는 로그인 대시보드면 이 Feature로 좁히고(var-feature), 공개 대시보드면 전체를 연다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { grafanaLinks } from '../external/grafana';
import { ExternalToolLaunchers } from '../external/launchers';
import { TelemetryScreen } from '../screens/master/Ops';

const STACK = 'https://ff-demo.grafana.net';
const PUBLIC = 'https://ff-demo.grafana.net/public-dashboards/0123456789abcdef';

describe('grafanaLinks — 빌드 설정', () => {
  it('설정이 없거나 https가 아니면 모두 숨긴다', () => {
    expect(grafanaLinks({}).telemetry).toBeNull();
    expect(grafanaLinks({}).feature('FEAT-00022', '1.0.0')).toBeNull();
    for (const bad of ['http://ff.grafana.net', 'javascript:alert(1)', 'https://u:p@ff.grafana.net', ' ']) {
      const g = grafanaLinks({ VITE_GRAFANA_PUBLIC_URL: bad, VITE_GRAFANA_URL: bad, VITE_GRAFANA_FEATURE_PUBLIC_URL: bad, VITE_GRAFANA_EMBED: '1' });
      expect([g.telemetry, g.feature('FEAT-00022'), g.embed]).toEqual([null, null, null]);
    }
  });

  it('스택 주소가 있으면 Feature로 좁힌 로그인 대시보드, 공개 주소만 있으면 전체 공개 대시보드', () => {
    const scoped = grafanaLinks({ VITE_GRAFANA_URL: `${STACK}/` }).feature('FEAT-00022', '1.0.0')!;
    expect(scoped.scoped).toBe(true);
    expect(scoped.url).toBe(`${STACK}/d/ff-feature-health?var-feature=FEAT-00022&var-feature_version=1.0.0&from=now-24h&to=now`);
    expect(grafanaLinks({ VITE_GRAFANA_URL: STACK }).telemetry).toBe(`${STACK}/d/ff-vehicle-telemetry`);
    expect(grafanaLinks({ VITE_GRAFANA_FEATURE_PUBLIC_URL: PUBLIC }).feature('FEAT-00022')).toEqual({ url: PUBLIC, scoped: false });
    // 공개 대시보드가 있으면 운영 데이터 화면은 로그인 없이 보이는 공개 주소를 연다
    expect(grafanaLinks({ VITE_GRAFANA_URL: STACK, VITE_GRAFANA_PUBLIC_URL: PUBLIC }).telemetry).toBe(PUBLIC);
    expect(grafanaLinks({ VITE_GRAFANA_PUBLIC_URL: PUBLIC }).embed).toBeNull();
    expect(grafanaLinks({ VITE_GRAFANA_PUBLIC_URL: PUBLIC, VITE_GRAFANA_EMBED: '1' }).embed).toBe(PUBLIC);
  });
});

const mount = (path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('화면 연결', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('운영 데이터 화면 — 설정이 없으면 Grafana 링크가 없다', async () => {
    mount('/ops/telemetry', <TelemetryScreen />);
    expect(await screen.findByRole('tab', { name: '상태 보고 v2' })).toBeTruthy();
    expect(screen.queryByTestId('grafana-telemetry-link')).toBeNull();
    expect(screen.queryByText(/Grafana/)).toBeNull();
  });

  it('운영 데이터 화면 — 공개 대시보드를 새 창으로 연다', async () => {
    vi.stubEnv('VITE_GRAFANA_PUBLIC_URL', PUBLIC);
    mount('/ops/telemetry', <TelemetryScreen />);
    const a = await screen.findByTestId('grafana-telemetry-link');
    expect(a.getAttribute('href')).toBe(PUBLIC);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('Feature 상세 외부 도구 — 스택 주소가 있으면 이 Feature 지표 카드, 없으면 카드가 없다', async () => {
    mount('/features/FEAT-00022/1.0.0', <ExternalToolLaunchers featureId="FEAT-00022" version="1.0.0" />);
    expect(screen.queryByRole('link', { name: /^Grafana .*새 창 열기$/ })).toBeNull();
    cleanup();
    vi.stubEnv('VITE_GRAFANA_URL', STACK);
    mount('/features/FEAT-00022/1.0.0', <ExternalToolLaunchers featureId="FEAT-00022" version="1.0.0" />);
    const card = screen.getByRole('link', { name: /^Grafana .*새 창 열기$/ });
    expect(card.getAttribute('href')).toContain('/d/ff-feature-health?var-feature=FEAT-00022&var-feature_version=1.0.0');
    expect(card.textContent).toContain('이 Feature 지표');
  });
});
