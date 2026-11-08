import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Workbook } from '../design/workbook';

afterEach(cleanup);
it('긴 필터는 접고, 선택된 0건 조건은 보존하며 펼쳐서 추가하거나 해제할 수 있다', () => {
  function View() {
    const [selected, setSelected] = useState(['selected-zero']);
    return <Workbook label="탐색" tree={[]} metrics={[]} filters={[{ key: 'axis', label: '분류', selected, onChange: setSelected, options: [
      { value: 'other-zero', label: '빈 항목', count: 0 }, ...Array.from({ length: 6 }, (_, i) => ({ value: `v${i}`, label: `항목 ${i}`, count: i + 1 })), { value: 'selected-zero', label: '선택한 빈 항목', count: 0 },
    ] }]} onClearAll={() => setSelected([])}>표</Workbook>;
  }
  render(<View />);
  const group = screen.getByRole('group', { name: /^분류/ });
  const chosen = within(group).getByRole('button', { name: '분류 선택한 빈 항목 0건' });
  expect(chosen).toHaveAttribute('aria-pressed', 'true');
  expect(within(group).queryByRole('button', { name: '분류 빈 항목 0건' })).toBeNull();
  fireEvent.click(within(group).getByRole('button', { name: '2개 더 보기' }));
  fireEvent.click(within(group).getByRole('button', { name: '분류 빈 항목 0건' }));
  expect(within(group).getByRole('button', { name: '분류 빈 항목 0건' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(group).getByRole('button', { name: '분류 해제' }));
  expect(within(group).queryAllByRole('button', { pressed: true })).toHaveLength(0);
});
