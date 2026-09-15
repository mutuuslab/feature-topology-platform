/**
 * UI02 신규 Feature 등록 — Feature Registry 에 Feature 를 **실제로 만드는 유일한 경로**의 화면 계약.
 *
 * 지켜야 할 계약은 세 가지다.
 *  1. 폼의 항목·라벨·필수성은 등록 속성 사전(FRI)에서만 온다 — 화면이 항목을 새로 만들지 않는다.
 *  2. 등록 게이트는 기준에서만 온다 — 7개 등록 기준 임계(4/7), R0 필수 입력, Taxonomy L2, 생성 권한.
 *     미달이면 등록이 차단되고 보류·Artifact 는 Feature 를 만들지 않는다.
 *  3. 통과하면 Feature Registry(state.features)와 리비전 레지스트리(state.revisions)에 같은
 *     Revision 으로 기록되고 감사 이벤트가 남는다 — Catalog 화면에 즉시 반영된다.
 *
 * 상태는 AppProvider 안에 붙인 Probe 로 직접 읽는다(화면 문구가 아니라 실제 상태를 검증한다).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from '../store';
import { DefineRevision } from '../pages/defineRevision';
import Catalog from '../pages/Catalog';
import { SPEC_REG_ATTRS, SPEC_REG_R0_REQUIRED } from '../data/specRegistration';
import { SPEC_REG_CRITERIA_MIN, SPEC_REG_R1 } from '../data/specRegistrationR1';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

/** 화면 밖에서 실제 상태를 읽는 관측점 — 문구가 아니라 상태를 검증한다. */
const Probe = () => {
  const { state } = useApp();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        features: state.features.length,
        revisions: state.revisions.length,
        audit: state.audit[0] ?? null,
        last: state.features[state.features.length - 1] ?? null,
        lastRevision: state.revisions[state.revisions.length - 1] ?? null,
      })}
    </div>
  );
};

const probe = () => JSON.parse(screen.getByTestId('probe').textContent || '{}');

const renderRegister = () => {
  render(
    <MemoryRouter initialEntries={['/master/define']}>
      <AppProvider>
        <Routes>
          <Route path="/master/define" element={<DefineRevision />} />
          <Route path="/catalog" element={<Catalog />} />
        </Routes>
        <Probe />
      </AppProvider>
    </MemoryRouter>,
  );
  return screen.getByTestId('ui02-register');
};

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
/** 사전 항목 입력칸은 `reg-FRI-###`, 화면 공통 입력칸은 `reg-*` 다. */
const doc = (id: string) => document.getElementById(id) as FieldEl | null;
const field = (id: string) => doc(`reg-${id}`);
const set = (id: string, value: string) => fireEvent.change(field(id)!, { target: { value } });
/** Feature ID 는 자동 채번 값을 시작점으로 하는 별도 입력칸이다(FRI-001). */
const idInput = () => doc('reg-id') as HTMLInputElement;
const valueOf = (id: string) => field(id)?.value ?? '';
const submitBtn = () => screen.getByTestId('reg-submit') as HTMLButtonElement;
const formBtn = (form: HTMLElement, name: RegExp) => within(form).getByRole('button', { name }) as HTMLButtonElement;

/** 부분 입력 3/7 — RC-01(목적·가치)·RC-04(적용 조건 시드)·RC-06(Owner) 만 충족한다. */
const fillPartial = () => { set('FRI-012', '잠금 해제 요청 처리'); set('FRI-024', 'USR-AUTHOR'); set('FRI-025', 'Body Platform Team'); };

describe('UI02 신규 Feature 등록 — 폼은 기준 사전에서만 온다', () => {
  it('R0 사람 입력 필수 항목과 심사 기준 참조 항목을 기준 사전 라벨로 렌더한다', () => {
    const form = renderRegister();

    // R0 필수 20건 중 자동·파생(DERIVED)을 뺀 사람 입력 항목은 모두 폼에 있어야 한다
    const humanRequired = SPEC_REG_R0_REQUIRED.filter(id => SPEC_REG_ATTRS[id]?.responsibility !== 'DERIVED');
    expect(humanRequired.length).toBe(14);
    for (const id of humanRequired) expect(field(id), `${id} 입력칸`).toBeTruthy();

    // 심사 기준이 직접 참조하는 3건(포함·제외 범위, 원천 객체 ID)까지 17개
    expect(form.querySelectorAll('[id^="reg-FRI-"]').length).toBe(17);

    // 라벨은 기준 사전 문구를 그대로 쓰고 입력칸과 htmlFor 로 연결된다
    expect(within(form).getByLabelText(/FRI-005/)).toBeTruthy();
    expect(within(form).getByLabelText(/FRI-029/)).toBeTruthy();
    expect(within(form).getAllByText(SPEC_REG_ATTRS['FRI-005'].label).length).toBeGreaterThan(0);

    // 임계·게이트 값도 기준에서 온다
    expect(SPEC_REG_CRITERIA_MIN).toBe(4);
    expect(SPEC_REG_R1.threshold.total).toBe(7);
    expect(within(form).getByText(new RegExp(`임계 ${SPEC_REG_CRITERIA_MIN} 이상일 때만 후보 등록`))).toBeTruthy();
  });

  it('빈 초안은 1/7 이고 R0 필수 누락 14건을 사유와 함께 차단한다', () => {
    const form = renderRegister();
    expect(within(form).getByText('1 / 7')).toBeTruthy();
    expect(within(form).getByText('0 / 14')).toBeTruthy();
    expect(within(form).getAllByText('R0 등록 필수 항목 미입력').length).toBe(14);
    expect(submitBtn().disabled).toBe(true);
    // 생성 권한은 있으므로 차단 사유는 명칭·Category·기준 임계·R0 누락 4건이다
    expect(within(form).getByText(/등록 차단 조건 4건/)).toBeTruthy();
  });

  it('같은 동작을 하는 합성 예제 버튼을 화면에 하나만 둔다', () => {
    const form = renderRegister();
    const same = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === 'R0 합성 예제 값 채우기');
    expect(same.length).toBe(1);
    expect(form.contains(same[0])).toBe(true);
  });
});

describe('UI02 신규 Feature 등록 — 게이트와 실제 기록', () => {
  it('7기준 미달이면 등록이 비활성이고, Artifact 구분은 Feature 를 만들지 않는다', () => {
    const form = renderRegister();
    const before = probe();
    fillPartial();
    expect(within(form).getByText('3 / 7')).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
    expect(within(form).getByText(/Feature 후보가 아니므로 업무 Lifecycle 을 시작할 수 없습니다/)).toBeTruthy();

    // 미달 → BOM 하위 Artifact 후보로 구분 (Feature 등록 아님)
    fireEvent.click(formBtn(form, /BOM 하위 Artifact 후보로 표시/));
    expect(screen.queryByTestId('reg-result')).toBeNull();
    const after = probe();
    expect(after.features).toBe(before.features);
    expect(after.audit.action).toBe('CLASSIFY_ARTIFACT');
    expect(after.lastRevision.reason).toContain('BOM 하위 Artifact 후보');
    // Feature Registry 에는 아무것도 추가되지 않았다
    expect(after.last?.id ?? null).toBe(before.last?.id ?? null);
  });

  it('보류는 재심사 시점 없이는 422 로 거부되고, 지정하면 Feature 없이 미정 항목으로 남는다', () => {
    const form = renderRegister();
    fillPartial();
    const before = probe();
    const holdBtn = formBtn(form, /보류 등록/);
    fireEvent.click(holdBtn);
    expect(within(screen.getByTestId('ui02-error')).getByText(/422 BUSINESS_RULE_FAILED/)).toBeTruthy();
    expect(screen.queryByTestId('reg-result')).toBeNull();

    set('hold-due', '2026-11-30');
    set('hold-reason', '적용 조건 미확정 — 국가 법규 확인 필요');
    fireEvent.click(holdBtn);
    const after = probe();
    expect(after.features).toBe(before.features);
    expect(after.audit.action).toBe('REGISTRATION_HOLD');
    expect(after.lastRevision.unresolved[0].due).toBe('2026-11-30');
    expect(after.lastRevision.unresolved[0].field).toContain('보류');
  });

  it('합성 예제로 4/7 을 넘기면 등록되어 Feature Registry·리비전 레지스트리·감사에 함께 기록된다', () => {
    const form = renderRegister();
    const before = probe();
    fireEvent.click(formBtn(form, /R0 합성 예제 값 채우기/));

    expect(within(form).getByText('4 / 7')).toBeTruthy();
    expect(submitBtn().disabled).toBe(false);

    const id = idInput().value;
    fireEvent.click(submitBtn());

    const after = probe();
    expect(after.features).toBe(before.features + 1);
    expect(after.revisions).toBe(before.revisions + 1);
    expect(after.audit.action).toBe('REGISTER');
    expect(after.audit.detail).toContain(`REGISTER ${id} 7-criteria 4/7`);
    // 등록된 Feature 는 L2 원자 Feature 이고 Lifecycle 은 Proposed 로 시작한다
    expect(after.last.id).toBe(id);
    expect(after.last.level).toBe('L2');
    expect(after.last.lifecycle).toBe('Proposed');
    expect(after.last.baselineVer).toBe('1.0.0');
    // 안전·보안은 미검토를 임의 확정하지 않는다
    expect(after.last.security).toBe('UNASSESSED');
    expect(after.last.safety).toContain('UNASSESSED');

    // 결과 카드와 등록 접수(201) 표시
    const result = screen.getByTestId('reg-result');
    expect(within(result).getByText(`${id} 등록 완료`)).toBeTruthy();
    expect(result.textContent).toContain(SPEC_REG_R1.threshold.pass);
    expect(screen.getByText(/201 CREATED/)).toBeTruthy();

    // Feature Registry 화면에 실제로 반영된다
    fireEvent.click(within(result).getByRole('link', { name: /Feature Registry 에서 확인/ }));
    fireEvent.change(screen.getByPlaceholderText(/Search ID\/Name/), { target: { value: id } });
    expect(screen.getAllByText(id).length).toBeGreaterThan(0);
  });

  it('같은 ID 로 다시 등록하면 409 이고 입력값은 보존된다', () => {
    const form = renderRegister();
    fireEvent.click(formBtn(form, /R0 합성 예제 값 채우기/));
    const id = idInput().value;
    fireEvent.click(submitBtn());
    const typed = valueOf('FRI-011');

    set('reason', '재등록 시도');
    fireEvent.click(submitBtn());

    expect(within(screen.getByTestId('ui02-error')).getByText(/409 IDENTITY_OR_STATE_CONFLICT/)).toBeTruthy();
    // 입력 보존 — 같은 ID·같은 입력값이 그대로 남는다
    expect(idInput().value).toBe(id);
    expect(valueOf('FRI-011')).toBe(typed);
    expect(doc('reg-reason')?.value).toBe('재등록 시도');
  });

  it('Enter 로 등록하고 Esc 로 오류를 닫는다 (UI02-AC20)', () => {
    const form = renderRegister();
    const before = probe();

    // 빈 초안에서 Enter — 422 로 차단되고 입력값은 보존된다
    set('id', 'FEAT-UI02-ENTER');
    fireEvent.keyDown(idInput(), { key: 'Enter' });
    expect(within(screen.getByTestId('ui02-error')).getByText(/422 BUSINESS_RULE_FAILED/)).toBeTruthy();
    expect(probe().features).toBe(before.features);
    expect(idInput().value).toBe('FEAT-UI02-ENTER');

    // Esc — 오류 카드만 닫고 입력은 그대로 둔다
    fireEvent.keyDown(idInput(), { key: 'Escape' });
    expect(screen.queryByTestId('ui02-error')).toBeNull();
    expect(idInput().value).toBe('FEAT-UI02-ENTER');

    // 채운 뒤 Enter — 같은 화면에서 등록된다
    fireEvent.click(formBtn(form, /R0 합성 예제 값 채우기/));
    fireEvent.keyDown(idInput(), { key: 'Enter' });
    expect(screen.getByTestId('reg-result')).toBeTruthy();
    expect(probe().audit.action).toBe('REGISTER');
  });

  it('새 등록 초안은 앞 초안 값과 등록 결과를 비우고 ID 를 다시 채번한다', () => {
    const form = renderRegister();
    fireEvent.click(formBtn(form, /R0 합성 예제 값 채우기/));
    const first = idInput().value;
    const before = probe();
    fireEvent.click(submitBtn());
    expect(probe().features).toBe(before.features + 1);

    fireEvent.click(formBtn(form, /새 등록 초안 시작/));
    expect(idInput().value).not.toBe(first);
    expect(valueOf('FRI-005')).toBe('');
    expect(idInput().value).not.toBe(first);
    expect(screen.queryByTestId('reg-result')).toBeNull();
    expect(submitBtn().disabled).toBe(true);
  });
});
