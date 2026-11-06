// 홈 'Feature 적용 현황' 위젯 — 깔때기 수는 요약(operationSummary.adoption) 그대로, 단계·상태를 누르면 지도 강조(누른 단추만 눌림),
// 되감기는 회신 시각으로만 정해진다(같은 시각 → 같은 적용 수), 동작 줄이기면 재생 대신 끝 상태, 시연 차량 회신 이벤트가 오면 요약을 다시 읽고 알린다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { operationSummary, type OperationInput } from '@ff/contracts';
import { operationOverview as O } from '../copy/operation-overview';
import AdoptionPanel, { appliedAt, layoutClusters, shownAt } from '../screens/home/dashboard/AdoptionPanel';
import { adoptionOf } from '../screens/home/dashboard/ReadOnlyOperationOverview';
import { publishLocalEvents } from '../api/shared-event-source';

const A = O.adoption;
const vins = Array.from({ length: 12 }, (_, i) => `V${String(i).padStart(2, '0')}`);
const INPUT: OperationInput = {
  runtime: vins.map((vin, i) => ({ vin, scope: 'x', quality: 'TRUSTED', link: i === 11 ? 'OFFLINE' : 'ONLINE', last: null, kills: i === 10 ? ['F1'] : [], flags: i < 9 ? [{ flagKey: 'flag_a', publicationId: 'PUB-1', sequence: 1, local: { value: i < 7, reason: 'POLICY_MATCH' }, drift: false }] : [] })) as OperationInput['runtime'],
  vehicles: vins.map((vin, i) => ({ vin, country: i < 6 ? 'KR' : i < 9 ? 'EU' : 'US', canary: i < 2 }) as OperationInput['vehicles'][number]),
  policies: [
    { policyId: 'POL-1', revision: 1, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_a', status: 'DEPLOYED', deployedAt: '2026-11-05T00:00:00Z', stageBasisPoints: 2500 },
    { policyId: 'POL-2', revision: 1, featureId: 'F2', featureVersion: '1.0.0', flagKey: 'flag_b', status: 'DEPLOYED', deployedAt: '2026-11-04T00:00:00Z' },
  ] as OperationInput['policies'],
  features: [],
  publications: [
    { publicationId: 'PUB-1', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-05T00:00:00Z', payload: { targets: vins.slice(0, 11), flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-1', revision: 1 } } },
    { publicationId: 'PUB-2', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-04T00:00:00Z', payload: { targets: vins, flagKey: 'flag_b', featureId: 'F2', policy: { policyId: 'POL-2', revision: 1 } } },
    { publicationId: 'PUB-K', kind: 'KILL', status: 'CONFIRMED', createdAt: '2026-11-05T00:01:00Z', payload: { targets: ['V10'], flagKey: null, featureId: 'F1', policy: null, kill: { featureIds: ['F1'] } } },
  ] as OperationInput['publications'],
  readbacks: [
    ...vins.slice(0, 8).map((vin, i) => ({ vin, publicationId: 'PUB-1', at: new Date(Date.parse('2026-11-05T00:00:00Z') + (i + 1) * 4000).toISOString(), metricType: 'READBACK', observed: 'h' })),
    { vin: 'V10', publicationId: 'PUB-K', at: '2026-11-05T00:01:10.000Z', metricType: 'READBACK', observed: 'DISABLED' },
  ],
  syncs: [],
};
const SUMMARY = operationSummary(INPUT, '2026-11-05T01:00:00Z', true);
const ADOPTION = adoptionOf(SUMMARY)!;

function mount(qc = new QueryClient()) {
  return render(<QueryClientProvider client={qc}><MemoryRouter><AdoptionPanel adoption={ADOPTION} /></MemoryRouter></QueryClientProvider>);
}
const stageButton = (stage: string) => within(screen.getByRole('list', { name: A.funnel })).getByRole('button', { name: new RegExp(`^${A.stage[stage].replace(/[()]/g, '\\$&')}`) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('홈 Feature 적용 현황', () => {
  it('요약의 적용 현황 모양을 확인한다 — 차량 수와 문자열 길이가 다르면 그리지 않는다', () => {
    expect(ADOPTION.flags.map((f) => f.flagKey)).toEqual(['flag_a', 'flag_b']);
    expect(adoptionOf({ adoption: { ...ADOPTION, country: ADOPTION.country.slice(1) } })).toBeUndefined();
    expect(adoptionOf({})).toBeUndefined();
  });

  it('깔때기 수는 요약 그대로 — 자동 선택은 긴급 차단 중 Feature의 Flag', () => {
    mount();
    const flag = ADOPTION.flags[0];
    expect(flag.why).toBe('KILL');
    const list = screen.getByRole('list', { name: A.funnel });
    const nums = within(list).getAllByRole('button').map((b) => b.querySelector('.ad-funnel__num')!.textContent);
    expect(nums).toEqual(['TARGET', 'DELIVERED', 'RECEIVED', 'APPLIED', 'USED'].map((s) => (flag.funnel[s as keyof typeof flag.funnel] ?? '—').toString()));
    // 평가 원천이 없는 요약 — 실제 사용 단계는 누를 수 없고 '미집계'
    expect((stageButton('USED') as HTMLButtonElement).disabled).toBe(true);
  });

  it('단계·상태를 누르면 그 단추만 눌리고 다시 누르면 풀린다', () => {
    mount();
    const applied = stageButton('APPLIED');
    fireEvent.click(applied);
    expect(applied.getAttribute('aria-pressed')).toBe('true');
    expect(stageButton('TARGET').getAttribute('aria-pressed')).toBe('false');
    const killed = within(screen.getByRole('list', { name: A.legend })).getByRole('button', { name: new RegExp(A.state.DISABLED) });
    fireEvent.click(killed);
    expect(killed.getAttribute('aria-pressed')).toBe('true');
    expect(applied.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: A.clearHighlight }));
    expect(killed.getAttribute('aria-pressed')).toBe('false');
  });

  it('되감기는 회신 시각으로만 정해진다 — 같은 시각이면 같은 적용 수, 시간이 갈수록 줄지 않는다', () => {
    const flag = ADOPTION.flags[0];
    const ends = flag.at.filter((x): x is number => x !== null);
    let prev = -1;
    for (let t = 0; t <= Math.max(...ends); t += 10) {
      const n = appliedAt(flag, t);
      expect(n).toBe(appliedAt(flag, t));
      expect(n).toBeGreaterThanOrEqual(prev === -1 ? 0 : Math.min(prev, n));
      prev = n;
    }
    // 차단 차량은 차단 회신 전까지 적용, 뒤에는 차단
    const k = vins.indexOf('V10');
    expect(shownAt(flag, k, flag.at[k]! - 1)).toBe('ON');
    expect(shownAt(flag, k, flag.at[k]!)).toBe('DISABLED');
    mount();
    const range = screen.getByRole('slider', { name: A.scrub });
    const t = Math.round(ends[3]);
    fireEvent.change(range, { target: { value: String(t) } });
    expect(screen.getByText(A.appliedAt(appliedAt(flag, t), flag.funnel.TARGET!))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: A.toNow }));
    expect(screen.getByText(A.appliedAt(appliedAt(flag, null), flag.funnel.TARGET!))).toBeTruthy();
  });

  it('점 지도 배치 — 390폭(지도 330×220)에서도 국가 묶음이 서로 덮지 않고, 점은 차량 수만큼 그린다', () => {
    // 공개 데모와 같은 규모 — KR 360·EU 80·US 40대
    const big = { ...ADOPTION, vins: Array.from({ length: 480 }, (_, i) => `S${i}`), countries: ['EU', 'KR', 'US'], country: '0'.repeat(80) + '1'.repeat(360) + '2'.repeat(40) };
    const flag = { ...ADOPTION.flags[0], state: 'O'.repeat(200) + 'F'.repeat(280) };
    for (const [w, h] of [[330, 220], [760, 320], [1200, 500]]) {
      const { clusters, placed } = layoutClusters(big, flag, w, h);
      expect(placed).toHaveLength(480);
      for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
        const p = clusters[a], q = clusters[b];
        expect(Math.hypot(p.x - q.x, p.y - q.y), `${w} ${p.name}↔${q.name}`).toBeGreaterThanOrEqual(p.r + q.r);
      }
    }
  });

  it('동작 줄이기 — 재생 단추는 끝 상태 보기로 바뀐다', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    mount();
    expect(screen.getByRole('button', { name: A.showEnd })).toBeTruthy();
  });

  it('Flag를 바꾸면 그 Flag의 깔때기로 바뀐다', () => {
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: A.pick }), { target: { value: 'flag_b' } });
    const b = ADOPTION.flags[1];
    expect(stageButton('TARGET').querySelector('.ad-funnel__num')!.textContent).toBe(String(b.funnel.TARGET));
  });

  it('시연 차량 회신 이벤트 — 요약을 다시 읽게 무효화하고 도착을 알린다(이벤트 버스는 구독만)', async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mount(qc);
    act(() => publishLocalEvents([{ seq: 101, id: 'e1', type: 'vehicle.readback', at: '2026-11-05T00:02:00Z', aggregate: 'V03', componentId: 'D04-03', payload: { kind: 'KILL' } }]));
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(spy.mock.calls.some(([f]) => JSON.stringify((f as { queryKey?: unknown }).queryKey) === JSON.stringify(['operationSummary']))).toBe(true);
    expect(screen.getByText(A.liveKill(1))).toBeTruthy();
  });
});
