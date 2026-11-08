// 저장하지 않은 변경 보호 — 앱 안 링크 이동·새로 고침·창(Drawer) 닫기 전에 묻는다(출시 준비 RD-UX-02).
// readiness: RD-UX-02
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Drawer, useUnsavedGuard } from '../design';
import { UnsavedPrompt } from '../design/unsaved';

afterEach(cleanup);

function Editor() {
  const [v, setV] = useState('');
  useUnsavedGuard(v !== '');
  return (
    <div>
      <input aria-label="이름" value={v} onChange={(e) => setV(e.target.value)} />
      <Link to="/other">다른 화면</Link>
    </div>
  );
}
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/edit']}>
      <Routes>
        <Route path="/edit" element={<Editor />} />
        <Route path="/other" element={<p>다른 화면 내용</p>} />
      </Routes>
      <Where />
      <UnsavedPrompt />
    </MemoryRouter>,
  );

describe('저장하지 않은 변경 보호', () => {
  it('입력이 없으면 바로 이동한다', () => {
    mount();
    fireEvent.click(screen.getByText('다른 화면'));
    expect(screen.getByTestId('where').textContent).toBe('/other');
  });

  it('입력이 있으면 링크를 누를 때 묻고 — 계속 편집이면 그대로, 버리고 이동이면 간다', () => {
    mount();
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '초안' } });
    fireEvent.click(screen.getByText('다른 화면'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/edit');
    fireEvent.click(screen.getByRole('button', { name: '계속 편집' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('초안');
    fireEvent.click(screen.getByText('다른 화면'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByText('다른 화면'));
    fireEvent.click(screen.getByRole('button', { name: '버리고 이동' }));
    expect(screen.getByTestId('where').textContent).toBe('/other');
  });

  it('새로 고침·창 닫기는 브라우저 확인(beforeunload)을 요청한다 — 입력이 없으면 요청하지 않는다', () => {
    mount();
    const ask = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(ask()).toBe(false);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '초안' } });
    expect(ask()).toBe(true);
  });

  it('창(Drawer) — 입력이 있으면 ×·Esc·바깥을 눌러도 창 안에서 묻고, 버리고 닫기만 닫는다', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Drawer open title="초안 편집" dirty onClose={onClose}>
          <p>본문</p>
        </Drawer>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('저장하지 않은 변경');
    fireEvent.click(screen.getByRole('button', { name: '계속 편집' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '버리고 닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('창 — 입력이 없으면 바로 닫는다', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Drawer open title="초안 편집" onClose={onClose}>
          <p>본문</p>
        </Drawer>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
