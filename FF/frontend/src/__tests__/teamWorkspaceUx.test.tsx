import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ConsultInbox, type ConsultView } from '../screens/workspaces/Consults';
import { consult as C } from '../copy/consult';
import { ko } from '../copy/ko';

const observers: { callback: ResizeObserverCallback; elements: Element[] }[] = [];
const resize = (width: number) => act(() => {
  for (const observer of [...observers]) if (observer.elements.length)
    observer.callback(observer.elements.map((target) => ({ target, contentRect: { width } } as ResizeObserverEntry)), {} as ResizeObserver);
});
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    record: { callback: ResizeObserverCallback; elements: Element[] };
    constructor(callback: ResizeObserverCallback) { this.record = { callback, elements: [] }; observers.push(this.record); }
    observe(element: Element) { this.record.elements.push(element); }
    unobserve() {}
    disconnect() { this.record.elements.length = 0; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const request = (overrides: Partial<ConsultView> = {}): ConsultView => ({
  consultId: 'CON-2026-004', activityId: 'FPW.7-A07', activityName: '약관 검토',
  targetKind: 'FEATURE', targetId: 'FEAT-00014@1.0.0', targetName: '증강현실 HUD 1.0.0',
  summary: '협력사 안전 등급 변경에 따른 재시험 비용 부담을 검토해 주세요',
  checks: ['계약 조건 확인'], link: '/features/FEAT-00014/1.0.0',
  fromDept: 'DEP-FS', fromName: '기능안전팀', toDept: 'DEP-PUR', toName: '구매팀',
  requestedBy: 'usr-quality', requestedAt: '2026-11-04T09:00:00Z', dueAt: '2026-11-09', daysLeft: 1,
  status: 'OPEN', opinions: [], ...overrides,
});
function Location() { return <output data-testid="consult-location">{useLocation().pathname}</output>; }
function mount(items: ConsultView[]) {
  return render(<MemoryRouter><ConsultInbox items={items} caption={C.portal.inboxCaption} /><Location /></MemoryRouter>);
}

describe('좁은 부서 검토 요청함', () => {
  it('한 요청에서 전체 요약·대상·요청 부서·기한·상태를 함께 읽고 같은 검토 화면으로 연다', () => {
    const item = request({ daysLeft: -1, dueAt: '2026-11-07' });
    mount([item]); resize(360);
    const list = screen.getByRole('list', { name: C.portal.inboxCaption });
    const row = within(list).getByRole('listitem');
    const link = within(row).getByRole('link', { name: item.summary });
    expect(link).toHaveAttribute('href', '/consults/CON-2026-004');
    expect(within(row).getByText(item.targetName, { exact: false })).toBeTruthy();
    expect(within(row).getByText(item.fromName)).toBeTruthy();
    expect(within(row).getByText(item.dueAt)).toBeTruthy();
    expect(within(row).getByText(C.due(-1))).toBeTruthy();
    expect(within(row).getByText(C.status.OPEN)).toBeTruthy();
    fireEvent.click(link);
    expect(screen.getByTestId('consult-location')).toHaveTextContent('/consults/CON-2026-004');
  });
  it('기한 정렬을 유지하고 넓어진 요청함은 네 열과 기존 행 동작을 보존한다', () => {
    const later = request();
    const earlier = request({ consultId: 'CON-2026-005', summary: '개인정보 동의 범위 확인', dueAt: '2026-11-06', daysLeft: -2, status: 'ANSWERED', opinions: [{ opinion: 'REVISE', memo: '약관 문구 보완', by: 'usr-viewer', department: 'DEP-PUR', at: '2026-11-05T09:00:00Z' }] });
    mount([later, earlier]); resize(360);
    fireEvent.click(screen.getByRole('button', { name: `${C.col.due} ${ko.action.sortAsc}` }));
    let list = screen.getByRole('list', { name: C.portal.inboxCaption });
    expect(within(list).getAllByRole('link')[0]).toHaveTextContent(earlier.summary);
    expect(within(list).getByText(C.opinion.REVISE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `${C.col.due} ${ko.action.sortDesc}` }));
    list = screen.getByRole('list', { name: C.portal.inboxCaption });
    expect(within(list).getAllByRole('link')[0]).toHaveTextContent(later.summary);
    resize(1000);
    const table = screen.getByRole('table', { name: C.portal.inboxCaption });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.queryByRole('list', { name: C.portal.inboxCaption })).toBeNull();
    fireEvent.keyDown(within(table).getAllByRole('row')[1], { key: 'Enter' });
    expect(screen.getByTestId('consult-location')).toHaveTextContent('/consults/CON-2026-004');
  });
});
