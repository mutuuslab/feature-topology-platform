// 묶음 P2 화면 — API 키(발급 원문 1회·삭제), API 명세·버전, 정산 전송(사용량·전송 기록·보내기), Legacy 연계 설정·변환 규칙·메시지 변환 기록. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { IntegrationsScreen, LegacyScreen } from '../screens/ext/Integrations';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];
const sent = (method: string, path: string) => calls.find((c) => c.init?.method === method && c.url === path);
const bodyOf = (method: string, path: string) => JSON.parse(String(sent(method, path)!.init!.body));

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, routePath: string, el: JSX.Element, role = 'integrator') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={routePath} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const KEY = (o: Record<string, unknown>) => ({ keyId: 'AK-0001', name: 'TMA 공장 주문 수집', system: 'TMA 공장 ERP', role: 'SYSTEM', prefix: 'ffk_AK-0001_Ab3d', state: 'ACTIVE', createdBy: 'usr-integrator', createdAt: '2026-11-07T01:00:00.000Z', expiresOn: '2027-11-07', lastUsedAt: null, revokedAt: null, revokedBy: null, revokeReason: null, ...o });

describe('API 키 (FR-AGW-001-003~005)', () => {
  it('목록·상태, 발급하면 원문을 한 번 보이고 닫으면 사라진다, 삭제는 이유와 함께 DELETE', async () => {
    const secret = `ffk_AK-0002_${'z'.repeat(43)}`;
    handler = (url, init) => {
      if (init?.method === 'POST' && url === '/api/api-keys') return { status: 201, body: { ...KEY({ keyId: 'AK-0002', name: '감사 조회', role: 'AUDITOR' }), secret } };
      if (init?.method === 'DELETE') return { body: KEY({ state: 'REVOKED' }) };
      if (url.startsWith('/api/api-keys')) return { body: { items: [KEY({ keyId: 'AK-0003', name: 'VOC 수집(이전)', prefix: 'ffk_AK-0003_Qq9x', state: 'REVOKED' }), KEY({ lastUsedAt: '2026-11-07T02:00:00.000Z' })] } };
    };
    mount('/integration/connectors?tab=apikeys', '/integration/connectors', <IntegrationsScreen />);
    const row = (await screen.findByText('ffk_AK-0001_Ab3d')).closest('tr')!;
    expect(within(row).getByText('사용 중')).toBeTruthy();
    expect(screen.getByText('사용 중인 키 1개 · 전체 2개')).toBeTruthy();
    // 삭제된 키는 다시 삭제하지 않는다
    const gone = screen.getByText('VOC 수집(이전)').closest('tr')!;
    expect(within(gone).queryByRole('button', { name: '삭제' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'API 키 발급' }));
    const dlg = await screen.findByRole('dialog', { name: 'API 키 발급' });
    fireEvent.change(within(dlg).getByLabelText('키 이름'), { target: { value: '감사 조회' } });
    fireEvent.change(within(dlg).getByLabelText('쓰는 외부 시스템'), { target: { value: '외부 감사 도구' } });
    fireEvent.change(within(dlg).getByLabelText('맡을 역할'), { target: { value: 'AUDITOR' } });
    fireEvent.change(within(dlg).getByLabelText('발급 이유'), { target: { value: '분기 감사' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '발급' }));
    await waitFor(() => expect(bodyOf('POST', '/api/api-keys')).toEqual({ name: '감사 조회', system: '외부 감사 도구', role: 'AUDITOR', reason: '분기 감사' }));
    const shown = await screen.findByRole('dialog', { name: '발급한 키 원문' });
    expect(within(shown).getByText(secret)).toBeTruthy();
    fireEvent.click(within(shown).getByRole('button', { name: '확인했습니다' }));
    await waitFor(() => expect(screen.queryByText(secret)).toBeNull());

    fireEvent.click(within(screen.getByText('ffk_AK-0001_Ab3d').closest('tr')!).getByRole('button', { name: '삭제' }));
    const rv = await screen.findByRole('dialog', { name: 'AK-0001 삭제' });
    fireEvent.change(within(rv).getByLabelText('삭제 이유'), { target: { value: '연계 종료' } });
    fireEvent.click(within(rv).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(bodyOf('DELETE', '/api/api-keys/AK-0001')).toEqual({ reason: '연계 종료' }));
  });

  it('발급 권한이 없는 역할은 발급 버튼이 막힌다', async () => {
    handler = (url) => (url.startsWith('/api/api-keys') ? { body: { items: [KEY({})] } } : undefined);
    mount('/integration/connectors?tab=apikeys', '/integration/connectors', <IntegrationsScreen />, 'author');
    await screen.findByText('ffk_AK-0001_Ab3d');
    expect((screen.getByRole('button', { name: 'API 키 발급' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('API 명세·버전 (FR-AGW-001-006·007)', () => {
  it('명세 요약·받기 링크, 버전별 상태·일정·정책', async () => {
    handler = (url) =>
      url.startsWith('/api/api-versions')
        ? {
            body: {
              header: 'X-Api-Version',
              current: '2026-11',
              policy: { compatibility: 'ADDITIVE_ONLY', minNoticeDays: 180, deprecatedResponse: '같은 본문 + 머리글', retiredResponse: '410 + Sunset' },
              versions: [
                { version: '2026-11', state: 'CURRENT', releasedAt: '2026-11-01', deprecatedAt: null, sunsetAt: null, changes: ['API 키'] },
                { version: '2025-12', state: 'RETIRED', releasedAt: '2025-12-01', deprecatedAt: '2026-04-01', sunsetAt: '2026-10-01', changes: ['첫 공개'] },
              ],
              spec: { openapi: '3.0.3', version: '2026-11', paths: 380, operations: 408, sha256: 'a'.repeat(64), url: '/api/openapi.json' },
            },
          }
        : undefined;
    mount('/integration/connectors?tab=apispec', '/integration/connectors', <IntegrationsScreen />);
    expect(await screen.findByText('경로 380개 · 연산 408개')).toBeTruthy();
    expect(screen.getByRole('link', { name: '명세 받기' }).getAttribute('href')).toBe('/api/openapi.json');
    const retired = screen.getByText('2025-12').closest('tr')!;
    expect(within(retired).getByText('지원 종료')).toBeTruthy();
    expect(within(retired).getByText('2026-10-01')).toBeTruthy();
    expect(screen.getByText(/추가만/)).toBeTruthy();
  });
});

const USAGE = (o: Record<string, unknown> = {}) => ({
  period: '2026-10',
  from: '2026-10-01',
  to: '2026-11-01',
  closed: true,
  items: [{ key: 'subscriptionVehicles', label: '구독 이용 차량 수', unit: '대', billable: true, rule: '겹치는 구독' }],
  cycle: { period: 'MONTHLY', sendDay: 1, retryHours: 24, description: '매월 1일 직전 달을 보낸다' },
  lines: [{ catalogId: 'CAT-00019', name: '원격 시동 구독', subscriptionVehicles: 3, subscriptionDays: 62, purchases: 1, conversions: 2, trialVehicles: 4 }],
  totals: { lines: 1, subscriptionVehicles: 3, subscriptionDays: 62, purchases: 1, conversions: 2 },
  sent: null,
  ...o,
});
const TX = (o: Record<string, unknown>) => ({ transmissionId: 'STL-00001', period: '2026-09', at: '2026-10-01T00:00:00.000Z', status: 'SENT', trigger: 'SCHEDULE', actorId: 'system:settlement', attempt: 1, lines: 1, totals: {}, receiptId: 'SETL-2026-09-0001', reason: null, errorId: null, ...o });

describe('정산 전송 (FR-BIL-001-002)', () => {
  it('상품별 사용량·항목·주기, 전송 기록(실패 사유), 보내기는 기간·이유로 POST', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: TX({ transmissionId: 'STL-00003', period: '2026-10' }) };
      if (url.startsWith('/api/settlement/usage')) return { body: USAGE() };
      if (url.startsWith('/api/settlement/transmissions')) return { body: { items: [TX({ transmissionId: 'STL-00002', status: 'FAILED', reason: '정산 시스템 연계가 꺼져 있습니다', receiptId: null, attempt: 2, trigger: 'MANUAL' }), TX({})] } };
    };
    mount('/integration/connectors?tab=settlement', '/integration/connectors', <IntegrationsScreen />, 'operator');
    const line = (await screen.findByText('원격 시동 구독')).closest('tr')!;
    expect(within(line).getByText('62')).toBeTruthy();
    expect(screen.getByText('매월 1일 직전 달을 보낸다')).toBeTruthy();
    const failed = screen.getByText('정산 시스템 연계가 꺼져 있습니다').closest('tr')!;
    expect(within(failed).getByText('실패')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '정산 보내기' }));
    await waitFor(() => expect(bodyOf('POST', '/api/settlement/transmissions')).toEqual({ period: '2026-10', reason: '월 정산' }));
  });

  it('이미 보낸 달·진행 중인 달은 보내기를 막는다', async () => {
    handler = (url) => (url.startsWith('/api/settlement/usage') ? { body: USAGE({ sent: { transmissionId: 'STL-00009', at: '2026-11-01T00:00:00Z', receiptId: 'SETL-1' } }) } : url.startsWith('/api/settlement/transmissions') ? { body: { items: [] } } : undefined);
    mount('/integration/connectors?tab=settlement', '/integration/connectors', <IntegrationsScreen />, 'operator');
    expect((await screen.findAllByText('보냄 — STL-00009')).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: '정산 보내기' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const LINK = (o: Record<string, unknown>) => ({
  linkId: 'LNK-0001',
  system: 'ERP-TMA',
  name: 'TMA 공장 ERP',
  kind: 'PLANT-ERP',
  endpoint: 'https://erp.tma.example/api/orders',
  bridgeType: 'BATCH',
  schedule: 'DAILY',
  plant: 'TMA',
  status: 'ACTIVE',
  note: null,
  version: 1,
  bridge: { bridgeId: 'BRG-ERP-TMA', type: 'BATCH', direction: 'INBOUND', ifId: 'IF-12', ruleSystem: 'PLANT-ERP', trigger: '매일 가져오기', steps: ['수집', '변환', '적재'] },
  createdBy: 'usr-integrator',
  createdAt: '2026-11-07T01:00:00.000Z',
  updatedBy: 'usr-integrator',
  updatedAt: '2026-11-07T01:00:00.000Z',
  lastRun: { at: '2026-11-07T01:00:00.000Z', status: 'SUCCEEDED', orders: 2, unresolved: ['OPT-XHUD'], reason: null, by: 'usr-operator' },
  ...o,
});

describe('Legacy 연계 설정·변환 규칙·메시지 (FR-LGCY-001-001~006, FR-SDVI-001-002)', () => {
  const legacyHandler = (extra: Handler): Handler => (url, init) =>
    extra(url, init) ??
    (url.startsWith('/api/legacy/links')
      ? { body: { items: [LINK({}), LINK({ linkId: 'LNK-0002', system: 'ERP-HMA', name: 'HMA 공장 ERP(파일)', bridgeType: 'FILE', schedule: 'WEEKLY', plant: 'HMA', status: 'INACTIVE', lastRun: null }), LINK({ linkId: 'LNK-0003', system: 'DMS-KR', name: '국내 딜러 DMS', kind: 'DEALER-DMS', bridgeType: 'REALTIME', schedule: null, plant: null, lastRun: null })] } }
      : url.startsWith('/api/legacy/mappings')
        ? { body: { items: [{ legacyCode: 'OPT-FSD3', system: 'PLANT-ERP', description: 'FSD', featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', note: null, source: 'FIXTURE', version: 0, known: true }, { legacyCode: 'OPT-CNAV', system: 'PLANT-ERP', description: 'China Nav', featureId: 'FEAT-00024', featureName: 'IC·JC 경로 사전안내', note: null, source: 'REGISTERED', version: 1, known: true }] } }
        : url.startsWith('/api/legacy/orders')
          ? { body: { items: [{ orderId: 'PO-TMA-26100002', plant: 'TMA', market: 'EU', vin: 'TMA-NX4-1002', resolved: [], unresolved: ['OPT-XHUD'] }] } }
          : url.startsWith('/api/legacy-sdv/vehicles')
            ? { body: { items: [{ vin: 'KMH-LF-0001', vehicleModel: 'LF', modelYear: '2019', market: 'KR', codingUnit: 'BCM' }] } }
            : url.startsWith('/api/legacy-sdv/messages')
              ? { body: { items: [{ messageId: 'LMSG-00002', at: '2026-11-07T01:00:00.000Z', direction: 'LEGACY_TO_SDV', system: 'DMS-KR', vin: 'KMH-LF-0001', formatIn: 'LGC-CODING-1', formatOut: null, status: 'FAILED', reason: 'DID F1999에 대응하는 Feature가 없습니다', actorId: 'usr-operator', output: null }] } }
              : url.startsWith('/api/legacy-sdv/formats')
                ? { body: { formats: { 'LGC-CODING-1': { side: 'LEGACY', label: '레거시 딜러 코딩 메시지', fields: [] }, 'SDV-FEATURE-STATE-1': { side: 'SDV', label: 'SDV Feature 상태 메시지', fields: [] } } } }
                : undefined);

  it('설정 목록·브리지, 활성 연계는 삭제를 막고 지금 실행은 POST, 등록 폼 본문', async () => {
    handler = legacyHandler((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/run')) return { body: LINK({}) };
      if (init?.method === 'POST' && url === '/api/legacy/links') return { status: 201, body: LINK({ linkId: 'LNK-0003', system: 'DMS-KR' }) };
      return undefined;
    });
    mount('/integration/legacy', '/integration/legacy', <LegacyScreen />);
    const tma = (await screen.findByText('ERP-TMA')).closest('tr')!;
    expect(within(tma).getByText('활성')).toBeTruthy();
    expect((within(tma).getByRole('button', { name: '삭제' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(tma).getByRole('button', { name: '지금 실행' }));
    await waitFor(() => expect(sent('POST', '/api/legacy/links/LNK-0001/run')).toBeTruthy());
    fireEvent.click(screen.getByText('ERP-TMA'));
    expect(await screen.findByText('BRG-ERP-TMA')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: '연계 등록' }));
    const dlg = await screen.findByRole('dialog', { name: '연계 등록' });
    fireEvent.change(within(dlg).getByLabelText('시스템 코드'), { target: { value: 'DMS-KR' } });
    fireEvent.change(within(dlg).getByLabelText('이름'), { target: { value: '국내 딜러 DMS' } });
    fireEvent.change(within(dlg).getByLabelText('시스템 종류'), { target: { value: 'DEALER-DMS' } });
    fireEvent.change(within(dlg).getByLabelText('연결 주소'), { target: { value: 'https://dms.example.kr/coding' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(bodyOf('POST', '/api/legacy/links')).toEqual({ system: 'DMS-KR', name: '국내 딜러 DMS', kind: 'DEALER-DMS', endpoint: 'https://dms.example.kr/coding', bridgeType: 'REALTIME', schedule: null, plant: null, status: 'INACTIVE', note: null }));
  });

  it('미해석 코드에서 규칙 등록 — 코드가 채워진 폼, 규칙 표는 출처·판', async () => {
    handler = legacyHandler((url, init) => (init?.method === 'POST' && url === '/api/legacy/mappings' ? { status: 201, body: {} } : undefined));
    mount('/integration/legacy', '/integration/legacy', <LegacyScreen />);
    const cnav = (await screen.findByText('OPT-CNAV')).closest('tr')!;
    expect(within(cnav).getByText('등록 · v1')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'OPT-XHUD 규칙 등록' }));
    const dlg = await screen.findByRole('dialog', { name: '변환 규칙 등록' });
    expect((within(dlg).getByLabelText('레거시 코드') as HTMLInputElement).value).toBe('OPT-XHUD');
    fireEvent.change(within(dlg).getByLabelText('설명'), { target: { value: 'AR HUD' } });
    fireEvent.change(within(dlg).getByLabelText('대상 Feature'), { target: { value: 'FEAT-00014' } });
    fireEvent.change(within(dlg).getByLabelText('이유'), { target: { value: '공장 옵션 추가' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(bodyOf('POST', '/api/legacy/mappings')).toEqual({ legacyCode: 'OPT-XHUD', system: 'PLANT-ERP', description: 'AR HUD', featureId: 'FEAT-00014', note: null, reason: '공장 옵션 추가' }));
  });

  it('메시지 변환 기록 — 실패 사유·시각, 코딩 메시지 받기 본문', async () => {
    handler = legacyHandler((url, init) => (init?.method === 'POST' && url === '/api/legacy-sdv/messages' ? { body: {} } : undefined));
    mount('/integration/legacy', '/integration/legacy', <LegacyScreen />, 'operator');
    const row = (await screen.findByText('DID F1999에 대응하는 Feature가 없습니다')).closest('tr')!;
    expect(within(row).getByText('변환 실패')).toBeTruthy();
    expect(screen.getByText('변환 실패 1건')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '코딩 메시지 받기' }));
    const dlg = await screen.findByRole('dialog', { name: '레거시 코딩 메시지 받기' });
    await within(dlg).findByRole('option', { name: /KMH-LF-0001/ });
    fireEvent.change(within(dlg).getByLabelText('코딩 위치(DID)'), { target: { value: 'F1024' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '변환' }));
    await waitFor(() => expect(bodyOf('POST', '/api/legacy-sdv/messages')).toMatchObject({ format: 'LGC-CODING-1', system: 'DMS-KR', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1024', value: '01' }] }));
  });
});
