// 로그인 게이트 — 공개 데모 FF/FF는 대소문자 구분 없이 통과하고, 틀리면 세션을 남기지 않는다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { logout } from '../auth';
import { login as demoLogin } from '../auth-demo';
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

  it('FF/FF를 소문자·혼합 대소문자로 입력해도 세션을 남기고 홈으로 들어간다', async () => {
    mount();
    expect(screen.getByText('데모 계정: ID FF · Password FF (대소문자 구분 없음)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'ff' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fF' } });
    fireEvent.click(screen.getByRole('button', { name: '플랫폼 들어가기' }));
    expect(await screen.findByText('home-screen')).toBeTruthy();
    expect(localStorage.getItem('ff.auth')).toBe('1');
  });

  it.each(['FF', 'ff', 'Ff', 'fF'].flatMap((id) => ['FF', 'ff', 'Ff', 'fF'].map((password) => [id, password])))('ID %s / 비밀번호 %s — 모든 대소문자 조합을 허용한다', (id, password) => {
    expect(demoLogin(id, password)).toBe(true);
    expect(localStorage.getItem('ff.auth')).toBe('1');
  });

  it.each([['FF', 'platform'], ['FF', 'wrong'], ['wrong', 'FF'], ['', 'FF'], ['FF', ''], ['FF', 'FF ']])('잘못된 ID %s / 비밀번호 %s는 세션을 만들지 않는다', (id, password) => {
    expect(demoLogin(id, password)).toBe(false);
    expect(localStorage.getItem('ff.auth')).toBeNull();
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

  it('문의 담당자와 메일 링크를 보여 준다', () => {
    mount();
    const link = screen.getByRole('link', { name: 'tobiaskim@mutuus-lab.com' });
    expect(link.getAttribute('href')).toBe('mailto:tobiaskim@mutuus-lab.com');
    expect(link.closest('.lg__contact')?.textContent).toContain('김태호');
  });
});
