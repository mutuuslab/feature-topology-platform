// 회귀: 헤드라인 한 패턴(UI 하네스 3판, 결함 3 — 2026-10-23 하네스 2판 보고서).
// - 패턴이 셋이었다: 숫자+라벨 / 색 문장 / 거대 mono 상태어(/policies/POL-00001 DEPLOYED·/products/CAT-00001/3.0.0 DEVELOPING)
// - 0건에도 초록이 붙었다 → 값이 0이면 neutral
// 이제: [큰 숫자] + 본문색 문장 + [상태 pill], 숫자가 없으면 판정 색은 앞 표식에만.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KeyMessage, isZeroValue } from '../design';

afterEach(cleanup);

const key = (c: HTMLElement) => c.querySelector('[data-key-message]')!;

describe('핵심 메시지 한 패턴', () => {
  it('값이 0이면 ok·warn·danger를 neutral로 낮춘다', () => {
    for (const v of [0, '0', '0%', '0/5', '0 건']) {
      const { container } = render(<KeyMessage tone="ok" value={v} text="열린 이상 건" />);
      expect(key(container).getAttribute('data-tone'), String(v)).toBe('neutral');
      cleanup();
    }
    const { container } = render(<KeyMessage tone="warn" value={3} text="열린 이상 건" />);
    expect(key(container).getAttribute('data-tone')).toBe('warn');
  });

  it('isZeroValue는 0이 아닌 값·소수·분수 분자를 구분한다', () => {
    expect([0, '0.0', '0/12'].map(isZeroValue)).toEqual([true, true, true]);
    expect([1, '10', '0.5', '3/12', '—', undefined].map((v) => isZeroValue(v as never))).toEqual([false, false, false, false, false, false]);
  });

  it('낱말 상태는 큰 값이 아니라 상태 pill로 그린다', () => {
    const { container } = render(<KeyMessage tone="ok" value="3/7" text="Gate PASS" status={{ label: 'RELEASED', tone: 'ok' }} />);
    expect(container.querySelector('.ds-key__value')!.textContent).toBe('3/7');
    const pill = container.querySelector('.ds-key__status')!;
    expect(pill.textContent).toBe('RELEASED');
    expect(pill.getAttribute('data-tone')).toBe('ok');
  });

  it('숫자가 없는 문장형은 판정 색 표식을 앞에 두고, neutral이면 표식도 없다', () => {
    const ok = render(<KeyMessage tone="ok" text="열린 이상 징후가 없습니다" />);
    expect(ok.container.querySelector('.ds-key__mark')).not.toBeNull();
    expect(ok.container.querySelector('.ds-key__text')!.hasAttribute('data-solo')).toBe(true);
    cleanup();
    const neutral = render(<KeyMessage tone="neutral" text="아직 검증 기록이 없습니다" />);
    expect(neutral.container.querySelector('.ds-key__mark')).toBeNull();
  });
});
