// 모션 체계 v1 2단계 — 상태 변화 모션. 장식이 아니라 '값이 바뀌었다'는 신호만, 첫 화면에는 절대 움직이지 않는다(3초 테스트).
//   ① useChangeFlash: 첫 렌더·건너뛰기 규칙에는 표식이 없고, 값이 바뀔 때마다 표식이 a↔b로 바뀌어 한 번 재생이 다시 시작된다
//   ② 핵심 메시지: 처음 그릴 때·불러오는 중('—')→첫 값에는 data-changed가 없고, 그 뒤 값·판정 색이 바뀌면 붙는다
//   ③ 진행 표시(Lifecycle·Gate·차단 단계·따라하기 단계·진행 막대)는 단계가 바뀔 때 --t-slow로 채워진다(뛰지 않는다)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KeyMessage, useChangeFlash, type KeyMessageSpec } from '../design';

afterEach(cleanup);

function Probe({ v, skip }: { v: string; skip?: (prev: string, next: string) => boolean }) {
  const mark = useChangeFlash(v, skip);
  return <span data-testid="p" data-changed={mark} />;
}
const mark = () => document.querySelector('[data-testid="p"]')!.getAttribute('data-changed');

describe('useChangeFlash — 값이 바뀌면 한 번', () => {
  it('첫 렌더와 같은 값 다시 그리기에는 표식이 없다', () => {
    const r = render(<Probe v="on" />);
    expect(mark()).toBeNull();
    r.rerender(<Probe v="on" />);
    expect(mark()).toBeNull();
  });
  it('값이 바뀔 때마다 a↔b로 바뀐다(키프레임 이름이 바뀌어야 애니메이션이 다시 시작된다)', () => {
    const r = render(<Probe v="on" />);
    r.rerender(<Probe v="off" />);
    expect(mark()).toBe('a');
    r.rerender(<Probe v="off" />);
    expect(mark()).toBe('a');
    r.rerender(<Probe v="on" />);
    expect(mark()).toBe('b');
  });
  it('건너뛰기 규칙(불러오는 중 → 첫 값)은 표식을 만들지 않는다', () => {
    const skip = (p: string) => p === '—';
    const r = render(<Probe v="—" skip={skip} />);
    r.rerender(<Probe v="3" skip={skip} />);
    expect(mark()).toBeNull();
    r.rerender(<Probe v="4" skip={skip} />);
    expect(mark()).toBe('a');
  });
});

describe('핵심 메시지 — 바뀐 뒤에만 강조', () => {
  const key = () => document.querySelector('[data-key-message]')!;
  const Km = (p: KeyMessageSpec) => <KeyMessage {...p} />;
  it('처음 그릴 때는 data-changed가 없다', () => {
    render(<Km tone="warn" value={3} text="x" />);
    expect(key().hasAttribute('data-changed')).toBe(false);
  });
  it("불러오는 중('—') → 첫 값은 첫 등장이라 강조하지 않는다", () => {
    const r = render(<Km tone="neutral" value="—" text="x" />);
    r.rerender(<Km tone="warn" value={3} text="x" />);
    expect(key().hasAttribute('data-changed')).toBe(false);
  });
  it('그 뒤 값이 바뀌면 data-changed가 붙는다', () => {
    const r = render(<Km tone="neutral" value="—" text="x" />);
    r.rerender(<Km tone="warn" value={3} text="x" />);
    r.rerender(<Km tone="warn" value={4} text="x" />);
    expect(key().hasAttribute('data-changed')).toBe(true);
  });
  it('값이 같아도 판정 색이 바뀌면 data-changed가 붙는다(숫자 없는 문장형 포함)', () => {
    const r = render(<Km tone="warn" text="x" />);
    expect(key().hasAttribute('data-changed')).toBe(false);
    r.rerender(<Km tone="ok" text="x" />);
    expect(key().hasAttribute('data-changed')).toBe(true);
  });
  it('글자만 바뀌면(값·색 그대로) 강조하지 않는다', () => {
    const r = render(<Km tone="warn" value={3} text="x" />);
    r.rerender(<Km tone="warn" value={3} text="y" />);
    expect(key().hasAttribute('data-changed')).toBe(false);
  });
});

describe('진행 표시 — 단계 전이는 --t-slow로 채운다', () => {
  const css = readFileSync(join(__dirname, '..', 'design', 'design.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** 선택자 규칙 본문(첫 번째 블록) */
  const rule = (sel: string) => {
    const i = css.search(new RegExp(`(^|\\n)${sel.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{`));
    expect(i, `${sel} 규칙`).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf('}', i));
  };
  for (const [sel, prop] of [
    ['.ds-step', 'background'],
    ['.ds-step', 'border-color'],
    ['.ds-gate__status', 'color'],
    ['.ds-stages__step', 'border-color'],
    ['.ds-learn-steps__no', 'background'],
    ['.ds-progress__fill', 'width'],
  ] as const)
    it(`${sel}: ${prop} 전이 var(--t-slow)`, () => {
      expect(rule(sel)).toMatch(new RegExp(`transition:[^;]*\\b${prop} var\\(--t-slow\\)`));
    });
});
