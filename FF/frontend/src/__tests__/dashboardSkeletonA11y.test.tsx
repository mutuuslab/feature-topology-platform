// 불러오기 골격 접근성 — 회귀: 역할 없는 div/p에 aria-label을 붙여 axe aria-prohibited-attr(serious)가 났다.
// 느린 기기에서 홈 가젯·AsyncView가 아직 불러오는 중일 때 홈 화면 axe 검사(e2e login.spec)가 실패했다.
// 이제 골격은 role="progressbar"(이름 허용 역할), 이름 붙인 요약 줄은 role="group"으로 읽는다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GadgetState } from '../screens/home/dashboard/parts';
import { AsyncView } from '../design/primitives';
import { SummaryLine } from '../design/page';

afterEach(cleanup);

function noRolelessLabel() {
  for (const el of document.querySelectorAll('[aria-label]')) expect(el.getAttribute('role'), el.outerHTML.slice(0, 80)).toBeTruthy();
}

describe('불러오기 골격·요약 줄 이름', () => {
  it('가젯 골격은 이름 있는 progressbar(aria-busy)로 읽힌다', () => {
    render(
      <GadgetState state="loading">
        <p>본문</p>
      </GadgetState>,
    );
    const skel = screen.getByRole('progressbar', { name: '불러오는 중' });
    expect(skel.getAttribute('aria-busy')).toBe('true');
    expect(skel.getAttribute('data-state')).toBe('loading');
    noRolelessLabel();
  });

  it('AsyncView 골격도 역할 없는 aria-label을 쓰지 않는다', () => {
    render(<AsyncView state="loading" />);
    const skel = screen.getByRole('progressbar', { name: '불러오는 중' });
    expect(skel.getAttribute('aria-busy')).toBe('true');
    noRolelessLabel();
  });

  it('이름 붙인 요약 줄은 group, 이름 없으면 역할도 없다', () => {
    render(<SummaryLine label="요약" items={[{ k: '기능', v: 3 }]} />);
    expect(screen.getByRole('group', { name: '요약' }).className).toBe('ds-summary');
    noRolelessLabel();
    cleanup();
    const { container } = render(<SummaryLine items={[{ k: '기능', v: 3 }]} />);
    expect(container.querySelector('.ds-summary')?.getAttribute('role')).toBeNull();
  });
});
