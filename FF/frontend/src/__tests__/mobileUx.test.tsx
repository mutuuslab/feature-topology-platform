import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppProvider } from '../store';
import { Tabs } from '../design';
import { RefPicker } from '../screens/home/propose/RefPicker';
import type { RefLite } from '../screens/home/propose/prefill';
import { PolicyList } from '../screens/policy/Policies';
import { propose as P } from '../copy/propose';

const observers: { callback: ResizeObserverCallback; elements: Element[] }[] = [];
const resize = (element: Element, width: number) => act(() => {
  for (const observer of [...observers]) if (observer.elements.includes(element))
    observer.callback([{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
});
const active: RefLite = { refId: 'CH-BRK-009', nameKo: '오토 홀드', nameEn: 'Auto hold', domain: 'Chassis', component: 'Brake', asilRep: 'B', tshirt: 'S', status: 'ACTIVE' };
const retired: RefLite = { ...active, refId: 'CH-BRK-001', nameKo: '폐기된 기능', status: 'RETIRED' };
let policyStatus = 'APPROVED';
beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    record: { callback: ResizeObserverCallback; elements: Element[] };
    constructor(callback: ResizeObserverCallback) { this.record = { callback, elements: [] }; observers.push(this.record); }
    observe(element: Element) { this.record.elements.push(element); }
    unobserve() {}
    disconnect() { this.record.elements.length = 0; }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.startsWith('/api/refdb/refs') ? { items: [active, retired], total: 2 } : url.startsWith('/api/policies') ? { items: [{ policyId: 'POL-00003', status: policyStatus, featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_trial', controlPoint: 'Flag', revision: 2, rollout: { mode: 'ALL', basisPoints: 10000 } }] } : { items: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(element: JSX.Element) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider>{element}</AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('좁은 등록 결과', () => {
  it('정보와 두 선택의 설명을 같은 결과행에서 보여 주고 기존 역할을 전달한다', async () => {
    const choose = vi.fn();
    const { container } = mount(<RefPicker picked={[]} onChoose={choose} onRemove={() => {}} onMakePrimary={() => {}} nodes={[]} domain="" setDomain={() => {}} />);
    await screen.findByText(active.nameKo);
    const root = container.querySelector('.ds-stack')!;
    resize(root, 300);
    const list = screen.getByRole('list', { name: P.results });
    expect(within(within(list).getByRole('listitem', { name: active.nameKo })).getByText('B')).toBeTruthy();
    expect(within(list).getAllByText(P.selection.primaryEffect)).toHaveLength(2);
    expect(within(list).getByText(P.selection.includedEffect)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: P.primaryLabel(active.refId) }));
    fireEvent.click(within(list).getByRole('button', { name: P.includeLabel(active.refId) }));
    expect(choose.mock.calls.map((call) => [call[0].refId, call[1]])).toEqual([[active.refId, 'PRIMARY'], [active.refId, 'INCLUDED']]);
    expect(within(list).getByRole('button', { name: P.primaryLabel(retired.refId) })).toBeDisabled();
    expect(within(list).queryByRole('button', { name: P.includeLabel(retired.refId) })).toBeNull();
    resize(root, 900);
    expect(screen.getByRole('table', { name: P.results })).toBeTruthy();
    expect(screen.queryByRole('list', { name: P.results })).toBeNull();
  });
});

describe('정책 식별자와 상태', () => {
  it.each(['DRAFT', 'APPROVED', 'DEPLOYED', 'REJECTED'])('%s를 식별자 가까이 요약하며 전체 열은 보존한다', async (status) => {
    policyStatus = status;
    mount(<PolicyList />);
    const id = await screen.findByRole('link', { name: 'POL-00003' });
    expect(within(id.closest('td')!).getByText(status)).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
    expect(screen.getByText('care_00022_trial')).toBeTruthy();
  });
});

describe('넘치는 탭', () => {
  it('추가 탭을 양방향으로 드러내고 경계·키보드·URL 선택을 보존한다', async () => {
    function Location() { return <output data-testid="tab-location">{useLocation().search}</output>; }
    render(<MemoryRouter><Tabs tabs={[{ key: 'a', label: '첫 탭' }, { key: 'b', label: '둘째 탭' }, { key: 'c', label: '마지막 탭' }]}>{(key) => <p>{key}</p>}</Tabs><Location /></MemoryRouter>);
    const strip = screen.getByRole('tablist');
    Object.defineProperties(strip, { clientWidth: { configurable: true, value: 240 }, scrollWidth: { configurable: true, value: 600 } });
    strip.scrollBy = vi.fn((options: ScrollToOptions) => { strip.scrollLeft = Math.max(0, Math.min(360, strip.scrollLeft + Number(options.left))); fireEvent.scroll(strip); }) as typeof strip.scrollBy;
    resize(strip, 240);
    await screen.findByRole('button', { name: '다음 탭 보기' });
    expect(screen.getByRole('button', { name: '이전 탭 보기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '다음 탭 보기' }));
    expect(strip.scrollLeft).toBe(180);
    fireEvent.click(screen.getByRole('button', { name: '다음 탭 보기' }));
    expect(screen.getByRole('button', { name: '다음 탭 보기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '이전 탭 보기' }));
    expect(strip.scrollLeft).toBe(180);
    fireEvent.keyDown(screen.getByRole('tab', { name: '첫 탭' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '둘째 탭' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '둘째 탭' })).toHaveFocus();
    expect(screen.getByTestId('tab-location')).toHaveTextContent('?tab=b');
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 800 });
    strip.scrollLeft = 0;
    resize(strip, 800);
    expect(screen.queryByRole('button', { name: '다음 탭 보기' })).toBeNull();
  });
});
