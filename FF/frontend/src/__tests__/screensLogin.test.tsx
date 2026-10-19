// 로그인 게이트 — 데모 계정(FF/platform)만 통과하고, 틀리면 오류를 보이며 세션을 남기지 않는다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { logout } from '../auth';
import { AppProvider } from '../store';
import { LoginScreen } from '../screens/auth/Login';

beforeEach(() => {
  localStorage.clear();
  logout();
});
afterEach(cleanup);

function mount() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<div>home-screen</div>} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('로그인 화면', () => {
  it('데모 계정이 아니면 오류를 보이고 들어가지 않는다', () => {
    mount();
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'FF' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '플랫폼 들어가기' }));
    expect(screen.getByRole('alert').textContent).toContain('ID 또는 비밀번호가 맞지 않습니다');
    expect(localStorage.getItem('ff.auth')).toBeNull();
  });

  it('FF/platform이면 세션을 남기고 홈으로 들어간다', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'FF' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'platform' } });
    fireEvent.click(screen.getByRole('button', { name: '플랫폼 들어가기' }));
    expect(await screen.findByText('home-screen')).toBeTruthy();
    expect(localStorage.getItem('ff.auth')).toBe('1');
  });

  it('비밀번호 보기/숨기기', () => {
    mount();
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(pw.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: '숨기기' }));
    expect(pw.type).toBe('password');
  });
});
