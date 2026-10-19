// ⌘K 이동·실행 — 회귀: 결과가 클릭만 받는 div여서 키보드로는 이동할 수 없었고, 라우트 표가 아닌 고정 6항목만 보였다.
// 이제 combobox+listbox, ↑↓·Enter·Esc, 닫으면 원래 자리로 포커스 복귀, 항목은 MENU(라우트 표)에서 온다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MENU } from '../routes';
import { CommandPalette, paletteItems } from '../shell/CommandPalette';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <button type="button">before</button>
      <CommandPalette />
      <Where />
    </MemoryRouter>,
  );

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('⌘K 이동·실행', () => {
  it('항목은 라우트 표의 메뉴 화면 전부다', () => {
    const menus = MENU.flatMap((g) => g.items.map((r) => r.menu));
    expect(paletteItems('').map((i) => i.to)).toEqual(menus);
    expect(menus.length).toBeGreaterThan(50);
  });

  it('검색어를 넣으면 Feature 검색이 맨 앞, 이름이 맞는 화면이 뒤에 온다', () => {
    const items = paletteItems('feat-00022');
    expect(items[0].to).toBe('/features?q=FEAT-00022');
    expect(paletteItems('업무 절차').some((i) => i.to === '/procedures')).toBe(true);
  });

  it('키보드만으로: Ctrl+K → 입력 → ↓ → Enter로 이동하고 닫힌다', () => {
    mount();
    openPalette();
    const box = screen.getByRole('combobox', { name: '이동·실행' });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: '업무 절차' } });
    const opts = screen.getAllByRole('option');
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const target = screen.getAllByRole('option')[1];
    expect(target.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(target.id);
    expect(target.textContent).toContain('업무 절차');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/procedures');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('Esc로 닫으면 열기 전 포커스로 돌아간다', () => {
    mount();
    const before = screen.getByRole('button', { name: 'before' });
    before.focus();
    openPalette();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
