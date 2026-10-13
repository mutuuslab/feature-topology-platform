// 기능안전 부품(design/safety.tsx) — 보고서 v1.1 규칙이 화면 모양으로 지켜지는지와, 디자인 키트 부품이 모두 갤러리(/_design, 시각 회귀 기준)에 있는지.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { deactStages, stageIndexOf } from '@ff/contracts';
import * as Kit from '../design';
import { ApprovalSlots, ClassBadge, ClassBadges, ReasonActionNote, RuleChecklist, StageStrip, WindowGauge } from '../design';

afterEach(cleanup);

describe('디자인 키트 → 갤러리', () => {
  it('키트가 내보내는 화면 부품(대문자 함수)은 모두 /_design 갤러리에 있다 — 시각 회귀·접근성 검사 대상', () => {
    const gallery = readFileSync(join(__dirname, '..', 'screens', 'design-gallery.tsx'), 'utf8');
    // 갤러리 밖에서만 의미가 있는 셸·내부 부품
    const exempt = new Set(['Icon', 'StatusGlyph', 'PageHeader', 'Toolbar', 'Segmented', 'Select', 'Field', 'ErrorNote', 'KeyValue']);
    const missing = Object.entries(Kit)
      .filter(([k, v]) => typeof v === 'function' && /^[A-Z]/.test(k) && !exempt.has(k))
      .map(([k]) => k)
      .filter((k) => !new RegExp(`<${k}[\\s/>]`).test(gallery));
    expect(missing).toEqual([]);
  });
});

describe('등급 배지 (보고서 5장)', () => {
  it('등급 의미를 접근 이름으로 읽어 준다 — 색만으로 구분하지 않음', () => {
    render(<ClassBadges f="F3" dc="DC2" r="R1" type="OPS" />);
    expect(screen.getByLabelText(/처리강도 F3: ASIL C\/D/)).toBeTruthy();
    expect(screen.getByLabelText(/비활성화 등급 DC2: 경고·이양/)).toBeTruthy();
    expect(screen.getByLabelText(/법규 등급 R1/)).toBeTruthy();
    expect(screen.getByLabelText(/Flag 유형 Ops/)).toBeTruthy();
  });
  it('DC4·R2는 잠금 표시(원격 요청 금지)', () => {
    const { container } = render(
      <>
        <ClassBadge axis="DC" value="DC4" />
        <ClassBadge axis="R" value="R2" />
        <ClassBadge axis="DC" value="DC2" />
      </>,
    );
    const locked = [...container.querySelectorAll('.ds-cls')].map((e) => e.getAttribute('data-locked'));
    expect(locked).toEqual(['true', 'true', null]);
  });
});

describe('게이트 판정 목록', () => {
  it('위반이 있으면 요약이 위반 건수, 없으면 대기 건수', () => {
    const { rerender } = render(
      <RuleChecklist
        items={[
          { id: 'FFG-PLT-005', status: 'pending' },
          { id: 'FFG-PLT-009', status: 'fail', reason: '리콜 근거 없음' },
        ]}
      />,
    );
    const sum = () => document.querySelector('.ds-rules__sum')!;
    expect(sum().textContent).toBe('위반 1건 · 대기 1건'); // 대기도 함께 — 위반만 보고 대기를 놓치지 않게
    expect(sum().querySelector('.ds-rules__sum-pending')?.textContent).toBe('대기 1건'); // 대기는 빨강(위반)과 다른 색
    expect(screen.getByText('리콜 근거 없음')).toBeTruthy();
    rerender(
      <RuleChecklist
        items={[
          { id: 'FFG-PLT-005', status: 'pending' },
          { id: 'FFG-PLT-002', status: 'pass' },
        ]}
      />,
    );
    expect(sum().textContent).toBe('대기 1건');
  });
});

describe('비활성화 단계 줄 (보고서 7.3)', () => {
  it('DC2 진행 위치와 Registry 시간값을 보인다', () => {
    const st = deactStages('DC2', 'SAFETY');
    render(<StageStrip caption="DC2" stages={st} current={stageIndexOf(st, 'DEACT_RAMP')} params={{ takeover_ms: 4000, ramp_ms: 1500 }} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.getAttribute('data-status'))).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(steps[2].textContent).toContain('4.0 s');
    expect(steps[3].textContent).toContain('1.5 s');
  });
  it('UNKNOWN이면 진행 표시 없이 미확인 안내 — 확인 전에는 비활성으로 보지 않는다', () => {
    const st = deactStages('DC2', 'SAFETY');
    render(<StageStrip stages={st} current={stageIndexOf(st, 'UNKNOWN')} />);
    expect(screen.getAllByRole('listitem').every((s) => s.getAttribute('data-status') === 'todo')).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('UNKNOWN');
  });
});

describe('승인 칸·누적 상한 (FFG-PLT-005·016·SEC-003)', () => {
  it('요청자는 승인할 수 없다는 안내, 서명 대기 타이머', () => {
    render(
      <ApprovalSlots
        now={Date.parse('2026-10-13T10:05:12Z')}
        requester={{ id: 'u-1' }}
        slots={[
          {
            role: 'FSM',
            approver: { id: 'u-3', signedAt: '2026-10-13T10:02:41Z' },
          },
          { role: 'OPS_LEAD', waitingSince: '2026-10-13T10:02:41Z' },
        ]}
      />,
    );
    expect(screen.getByText(/FFG-PLT-016/)).toBeTruthy();
    expect(screen.getByText('대기 02:31')).toBeTruthy();
  });
  it('상한을 넘으면 meter 값은 상한에서 멈추고 FSM+CSM 안내', () => {
    render(<WindowGauge used={4200} adding={1200} cap={5000} />);
    const m = screen.getByRole('meter');
    expect(m.getAttribute('aria-valuenow')).toBe('5000');
    expect(screen.getByRole('status').textContent).toContain('FFG-SEC-003');
  });
});

describe('차량 회신 조치 (보고서 9.3)', () => {
  it('보안 코드는 재전송 안 함, 영속 대기는 같은 명령 재발행', () => {
    const { container, rerender } = render(<ReasonActionNote result="REJECTED" code="REPLAY" />);
    expect(container.textContent).toContain('재전송 안 함');
    rerender(<ReasonActionNote result="ACCEPTED_NOT_DURABLE" />);
    expect(container.textContent).toContain('같은 명령 재발행');
  });
});
