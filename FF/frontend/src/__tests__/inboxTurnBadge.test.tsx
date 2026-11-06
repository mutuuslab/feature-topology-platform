// 검토함 '내 차례' 칸 — 행동 자격(검토 가능)을 판정 결과(PASS·승인됨)와 같은 녹색 PASS로 그려
// 아직 승인하지 않은 업무가 이미 통과한 것으로 읽혔다(디자인 검토 2026-11-05).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MineCell } from '../screens/home/Inbox';
import { inbox as IX } from '../copy/inbox';

afterEach(cleanup);

const item = (over: Record<string, unknown>) => ({ key: 'k', queue: 'q', item: 'FEAT-1', detail: 'd', since: '', who: null, to: '/', mine: true, ...over }) as Parameters<typeof MineCell>[0]['r'];

describe('검토함 내 차례 칸', () => {
  it('내 차례는 판정 PASS가 아니라 검토 가능으로 보인다', () => {
    const { container } = render(<MineCell r={item({ slot: 'FSM' })} />);
    expect(screen.getByText(IX.reviewable)).toBeTruthy();
    expect(container.querySelector('[data-verdict="PASS"]')).toBeNull();
    expect(container.textContent).not.toMatch(/PASS/);
    expect(container.querySelector('[data-turn="mine"]')).not.toBeNull();
  });

  it('내 차례가 아니면 이유만 보인다', () => {
    const { container } = render(<MineCell r={item({ mine: false, why: IX.reviewed })} />);
    expect(container.textContent).toBe(IX.reviewed);
    expect(container.querySelector('[data-turn]')).toBeNull();
  });
});
