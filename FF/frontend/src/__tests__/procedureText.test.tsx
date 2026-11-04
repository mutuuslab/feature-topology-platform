// 감사·이벤트 값 속 업무 절차 식별자 → 업무 이름(2026-10-25 결정, 3초 ⑨)
// 회귀: 업무 절차 완료 기록의 대상 FPW.1-A01이 /events·/audit 본문에 그대로 보였다(2026-11-05 verify three-second)
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcedureText } from '../screens/shared';

describe('ProcedureText', () => {
  it('활동 식별자는 업무 이름으로 보이고 식별자는 툴팁에만 남는다', async () => {
    render(<ProcedureText text="FPW.1-A01" />);
    await waitFor(() => expect(screen.getByTitle('FPW.1-A01').textContent).toBe('Feature 등록·초안 작성'));
    expect(document.body.textContent).not.toMatch(/FPW\.\d/);
  });

  it('문장 속 식별자도 이름으로 — 식별자가 없으면 그대로', async () => {
    const { container } = render(<ProcedureText text="FPW.1 · 완료" />);
    await waitFor(() => expect(container.textContent).toBe('Feature 등록·분류 · 완료'));
    render(<ProcedureText text="FEAT-00022@1.0.0" />);
    expect(screen.getByText('FEAT-00022@1.0.0')).toBeTruthy();
  });
});
