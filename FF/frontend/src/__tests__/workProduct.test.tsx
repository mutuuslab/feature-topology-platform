import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { WorkProductButton, evidenceHref } from '../screens/procedures/WorkProduct';
import { ProcessFlowDiagram, ProcessFlowText } from '../screens/procedures/flow/ProcessFlow';

const progress = vi.hoisted(() => ({ items: [] as any[], status: 'ready', error: null }));
vi.mock('../store', () => ({ useAppShell: () => ({ role: 'author' }) }));
vi.mock('../data/procedureProgress', () => ({ useProgress: () => progress }));
const process = WORKFLOWS.processes[0];
const productKey = process.activities[0].outputs[0];
const product = process.workProducts.find(w => w.key === productKey)!;
const mount = () => render(<MemoryRouter><WorkProductButton doc={WORKFLOWS} productKey={productKey} /></MemoryRouter>);

beforeEach(() => { progress.items = []; progress.status = 'ready'; progress.error = null; });
afterEach(cleanup);

describe('업무 절차 입력·산출물 내용', () => {
  it('문서 정의와 작성·사용 업무를 열고, 실제 완료 문서가 없다는 점을 구분한다', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: `${product.name} 내용 열기` }));
    const dialog = screen.getByRole('dialog');
    for (const line of product.content) expect(within(dialog).getByText(line)).toBeTruthy();
    expect(within(dialog).getByText('실제 작성·완료 기록')).toBeTruthy();
    expect(within(dialog).getByText(/연결된 작성·완료 기록이 아직 없습니다/)).toBeTruthy();
    expect(within(dialog).getAllByRole('link').length).toBeGreaterThan(0);
  });
  it('서버 완료 기록의 근거를 열고 잘못된 서명을 승인으로 표시하지 않는다', () => {
    progress.items = [{ activityId: process.activities[0].id, completedBy: 'usr-author', completedAt: '2026-11-05T00:00:00Z', note: '검토 기록', signatureValid: false, evidence: [{ kind: 'LINK', name: '등록된 근거', ref: '/features/FEAT-00022/1.0.0' }, { kind: 'LINK', name: '위험 주소', ref: 'javascript:alert(1)' }] }];
    mount(); fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('link', { name: '등록된 근거' }).getAttribute('href')).toBe('/features/FEAT-00022/1.0.0');
    expect(screen.queryByRole('link', { name: '위험 주소' })).toBeNull();
    expect(screen.getByText('서명 확인 실패')).toBeTruthy();
    expect(screen.queryByText('서명 확인됨')).toBeNull();
  });
  it('흐름도의 문서 노드는 키보드로 내용을 연다', () => {
    const view = render(<MemoryRouter><ProcessFlowDiagram doc={WORKFLOWS} process={process} statuses={new Map()} selected={null} onSelect={() => undefined} /></MemoryRouter>);
    const node = view.container.querySelector<SVGGElement>('[data-wp]')!;
    expect(node.getAttribute('role')).toBe('button');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('텍스트 흐름도에서도 입력·산출물의 내용을 열 수 있다', () => {
    render(<MemoryRouter><ProcessFlowText doc={WORKFLOWS} process={process} statuses={new Map()} onSelect={() => undefined} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('button', { name: /내용 열기$/ })[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('의도하지 않은 주소 체계와 자격증명 주소를 링크로 만들지 않는다', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', '//outside.test/x', 'https://u:p@example.test/x', '/\\outside.test/x']) expect(evidenceHref(value), value).toBeUndefined();
    expect(evidenceHref('https://example.test/report')).toBe('https://example.test/report');
  });
});
