// readiness: RD-UX-03 — 큰 목록은 나눠 그린다: 1만 행이어도 DOM 행은 한 쪽(100행), 정렬은 전체에, 쪽 넘김으로 끝까지.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataTable, TABLE_PAGE_SIZE } from '../design';
import { lists as L } from '../copy/lists';

afterEach(cleanup);

const ROWS = Array.from({ length: 10_000 }, (_, i) => ({ id: `FEAT-${String(i + 1).padStart(5, '0')}`, n: i }));
const table = (rows = ROWS, pageSize?: number) => (
  <DataTable
    caption="큰 목록"
    rows={rows}
    rowKey={(r) => r.id}
    pageSize={pageSize}
    columns={[
      { key: 'id', header: 'ID', cell: (r) => r.id, sort: (r) => r.id },
      { key: 'n', header: '번호', cell: (r) => String(r.n), sort: (r) => r.n },
    ]}
  />
);

const bodyRows = () => document.querySelectorAll('tbody tr');

describe('DataTable 나눠 그리기 (RD-UX-03)', () => {
  it('1만 행 — DOM 행은 한 쪽 크기만, 범위·쪽 수를 보인다', () => {
    render(table());
    expect(bodyRows().length).toBe(TABLE_PAGE_SIZE);
    expect(screen.getByText(new RegExp(L.range(1, 100, 10_000).replace(/[()]/g, '\\$&')))).toBeTruthy();
    expect(screen.getByRole('button', { name: `큰 목록 ${L.prev}` })).toHaveProperty('disabled', true);
  });

  it('쪽 넘김 — 다음 쪽은 101번째부터, 마지막 쪽에서 다음은 막힌다', () => {
    render(table());
    fireEvent.click(screen.getByRole('button', { name: `큰 목록 ${L.next}` }));
    expect(bodyRows()[0].getAttribute('data-key')).toBe('FEAT-00101');
    for (let i = 0; i < 98; i++) fireEvent.click(screen.getByRole('button', { name: `큰 목록 ${L.next}` }));
    expect(bodyRows()[bodyRows().length - 1].getAttribute('data-key')).toBe('FEAT-10000');
    expect(screen.getByRole('button', { name: `큰 목록 ${L.next}` })).toHaveProperty('disabled', true);
  });

  it('정렬은 전체 행에 — 내림차순이면 첫 쪽 첫 행이 마지막 항목, 정렬하면 첫 쪽으로', () => {
    render(table());
    fireEvent.click(screen.getByRole('button', { name: `큰 목록 ${L.next}` }));
    const sortBtn = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('번호 '))!;
    fireEvent.click(sortBtn); // 오름차순
    fireEvent.click(sortBtn); // 내림차순
    expect(bodyRows()[0].getAttribute('data-key')).toBe('FEAT-10000');
  });

  it('작은 목록·pageSize=0이면 쪽 넘김 없이 전부', () => {
    render(table(ROWS.slice(0, 40)));
    expect(bodyRows().length).toBe(40);
    expect(document.querySelector('.ds-pager')).toBeNull();
    cleanup();
    render(table(ROWS.slice(0, 300), 0));
    expect(bodyRows().length).toBe(300);
  });

  it('행이 줄어 지금 쪽이 없어지면 마지막 쪽을 보인다', () => {
    const { rerender } = render(table());
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: `큰 목록 ${L.next}` }));
    rerender(table(ROWS.slice(0, 150)));
    expect(bodyRows()[0].getAttribute('data-key')).toBe('FEAT-00101');
    expect(bodyRows().length).toBe(50);
  });
});
