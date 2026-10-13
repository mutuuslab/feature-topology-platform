// 표 배치 회귀 (P11 시각 기준 검토에서 찾은 결함) — 1366에서 Feature 목록 이름이 세 줄로 눌리고, UPG 적용 범위가 낱말 중간에서 잘렸다.
// 보조 열(minor)은 좁은 화면에서 CSS로 숨길 수 있게 표식이 붙고, 목록 값은 구분자에서만 줄을 바꾼다. 실제 픽셀은 e2e 시각 기준(core-*)이 지킨다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable } from '../design';
import { Segments } from '../screens/shared';

afterEach(cleanup);

describe('DataTable 보조 열', () => {
  it('minor 열의 머리·칸에만 data-minor가 붙는다', () => {
    render(
      <DataTable
        caption="t"
        rows={[{ id: 'FEAT-00022', owner: 'ADAS기획팀' }]}
        rowKey={(r) => r.id}
        columns={[
          { key: 'id', header: 'ID', cell: (r) => r.id },
          { key: 'owner', header: '담당', cell: (r) => r.owner, minor: true },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '담당' }).getAttribute('data-minor')).toBe('true');
    expect(screen.getByRole('cell', { name: 'ADAS기획팀' }).getAttribute('data-minor')).toBe('true');
    expect(screen.getByRole('columnheader', { name: 'ID' }).hasAttribute('data-minor')).toBe(false);
  });
});

describe('Segments — 구분자에서만 줄바꿈', () => {
  it('항목마다 줄바꿈 금지 상자로 감싸고 사이에 구분자를 둔다', () => {
    const { container } = render(<Segments items={['KR/GN7/Calligraphy', 'EU/NX4 PE/Ultimate']} />);
    const boxes = [...container.querySelectorAll('.ds-nowrap')].map((e) => e.textContent);
    expect(boxes).toEqual(['KR/GN7/Calligraphy', 'EU/NX4 PE/Ultimate']);
    expect(container.textContent).toBe('KR/GN7/Calligraphy · EU/NX4 PE/Ultimate');
  });
});
