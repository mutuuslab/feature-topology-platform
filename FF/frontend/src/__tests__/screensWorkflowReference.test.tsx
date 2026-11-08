import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { ProcessReference, ReferenceModel, referenceEvidence } from '../screens/procedures/ReferenceModel';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Location() {
  const l = useLocation();
  return <output aria-label="시험 경로">{l.pathname}{l.search}</output>;
}
function mount(element: React.ReactNode, path = '/procedures?view=reference') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{element}<Location /></>} /></Routes></MemoryRouter>);
}

describe('업무 레퍼런스 모델의 조회와 실제 처리 경계', () => {
  it('14부서 조회를 바꿔도 로그인 역할·진행 기록을 바꾸지 않고 해당 책임 업무를 찾는다', () => {
    const state = JSON.stringify({ role: 'author' });
    localStorage.setItem('fp.state.v2', state);
    localStorage.setItem('ff.proc.done.v2', '[]');
    mount(<ReferenceModel doc={WORKFLOWS} />);
    const select = screen.getByRole('combobox', { name: '업무를 살펴볼 부서' });
    expect(within(select).getAllByRole('option')).toHaveLength(15);
    const itsec = WORKFLOWS.departments.find((d) => d.roles.includes('R-SYS'))!;
    fireEvent.change(select, { target: { value: itsec.id } });
    expect(screen.getByRole('link', { name: '플랫폼 접근·운영·복구' })).toBeTruthy();
    expect(screen.getByLabelText('시험 경로').textContent).toContain(`dept=${itsec.id}`);
    expect(localStorage.getItem('fp.state.v2')).toBe(state);
    expect(localStorage.getItem('ff.proc.done.v2')).toBe('[]');
  });

  it('원가 열람 역할의 실제 조회 업무와 산정·승인 책임을 함께 찾되 권한을 부여하지 않는다', () => {
    mount(<ReferenceModel doc={WORKFLOWS} />);
    const d = WORKFLOWS.departments.find((x) => x.roles.includes('R-CV'))!;
    fireEvent.change(screen.getByRole('combobox'), { target: { value: d.id } });
    fireEvent.change(screen.getByRole('textbox', { name: '업무 검색' }), { target: { value: '원가 기준' } });
    expect(screen.getByRole('link', { name: 'SW 개발비·원가 기준 관리' })).toBeTruthy();
    expect(screen.getByText('SW 개발비 산정 열람자')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(localStorage.getItem('fp.state.v2')).toBeNull();
  });

  it('업무 정의를 펼쳐 연결 활동으로 이동하면 기존 활동 ID를 정확히 보존한다', () => {
    const p = WORKFLOWS.processes.find((x) => x.id === 'FPW.8')!;
    const bp = p.basePractices!.find((x) => x.activityIds.includes('FPW.8-A15'))!;
    mount(<ProcessReference doc={WORKFLOWS} process={p} />, '/procedures/FPW.8?docview=reference');
    const details = document.getElementById(bp.id) as HTMLDetailsElement;
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
    expect(within(details).getByText(bp.definition)).toBeTruthy();
    expect(within(details).getByText(bp.notes[0], { exact: false })).toBeTruthy();
    fireEvent.click(within(details).getByRole('link', { name: /FPW\.8-A15/ }));
    expect(screen.getByLabelText('시험 경로').textContent).toBe('/procedures/FPW.8?a=FPW.8-A15');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('BP에 성과를 추가해도 산출물의 명시되지 않은 성과가 연결된 것으로 보이지 않는다', () => {
    const p = structuredClone(WORKFLOWS.processes.find((x) => x.id === 'FPW.15')!);
    p.basePractices![0].outcomes.push('O2');
    expect(referenceEvidence(p).find((r) => r.id === 'WP-COST-SCOPE')!.outcomes).toEqual(['O1']);
    mount(<ProcessReference doc={WORKFLOWS} process={p} />);
    const matrix = screen.getByRole('table', { name: '출력 근거와 성과의 연결' });
    const row = within(matrix).getByRole('rowheader', { name: '산정 범위·과제' }).closest('tr')!;
    expect(within(row).getByRole('cell', { name: 'O1 연결됨' })).toBeTruthy();
    expect(within(row).getByRole('cell', { name: 'O2 연결 없음' })).toBeTruthy();
  });

  it('외부 원천과 다른 프로세스의 입력·출력을 구분해 근거 생산 업무로 이동한다', () => {
    const p = WORKFLOWS.processes.find((x) => x.id === 'FPW.15')!;
    mount(<ProcessReference doc={WORKFLOWS} process={p} />, '/procedures/FPW.15?docview=reference');
    const ins = screen.getByRole('heading', { level: 3, name: '프로세스 입력' }).parentElement!;
    fireEvent.click(within(ins).getByRole('link', { name: /FPW\.1 · Feature 등록/ }));
    expect(screen.getByLabelText('시험 경로').textContent).toBe('/procedures/FPW.1?docview=reference');
  });
});
