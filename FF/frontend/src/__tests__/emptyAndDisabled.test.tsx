// 회귀: 빈 상태·비활성 이유(UI 하네스 2판 7단계, 2026-10-23).
// ① "조건을 바꿔 보세요"가 필터 없는 화면에도 반복됐다 — 필터가 걸린 경우에만 말한다.
// ② 비활성 주 버튼에 이유가 없었다 — reason을 주면 버튼 아래에 보이고 aria-describedby로 이어진다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AsyncView, Button } from '../design';

afterEach(cleanup);

describe('빈 상태 문구', () => {
  it('필터가 없으면 "조건을 바꿔"라고 하지 않는다', () => {
    render(<AsyncView state="empty" />);
    const box = document.querySelector('[data-state="empty"]')!;
    expect(box.textContent).not.toContain('조건');
    expect(box.textContent).not.toContain('필터');
    expect(box.textContent).toContain('표시할 항목이 없습니다');
  });

  it('필터가 걸려 있으면 필터를 바꾸라고 안내한다', () => {
    render(<AsyncView state="empty" filtered />);
    const box = document.querySelector('[data-state="empty"]')!;
    expect(box.textContent).toContain('조건에 맞는 항목이 없습니다');
    expect(box.textContent).toContain('필터');
  });

  it('화면이 준 문구가 기본 문구보다 우선한다', () => {
    render(<AsyncView state="empty" filtered empty={{ title: '등록된 Feature가 없습니다' }} />);
    expect(screen.getByText('등록된 Feature가 없습니다')).toBeTruthy();
  });
});

describe('비활성 버튼 이유', () => {
  it('비활성 + reason이면 이유가 보이고 버튼 설명으로 연결된다', () => {
    render(
      <Button variant="primary" disabled reason="승인 권한이 없습니다">
        승인
      </Button>,
    );
    const btn = screen.getByRole('button', { name: '승인' });
    expect(btn).toHaveProperty('disabled', true);
    const id = btn.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('승인 권한이 없습니다');
  });

  it('활성이면 reason을 그리지 않는다', () => {
    render(<Button reason="승인 권한이 없습니다">승인</Button>);
    expect(screen.queryByText('승인 권한이 없습니다')).toBeNull();
    expect(screen.getByRole('button', { name: '승인' }).hasAttribute('aria-describedby')).toBe(false);
  });
});
