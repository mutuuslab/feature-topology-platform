// 감사 표 전후 값(AuditChange) — 회귀(2026-11-06 e2e 배치 점검): 보존 작업 감사의 긴 JSON 값이 띄어쓰기 없이 한 덩어리라
// 칸 폭에서 아무 데나 끊겨 날짜(2026-10-07…)가 두 줄로 갈렸다. 객체 값은 항목 사이를 띄어 써 그 사이에서 줄이 바뀐다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AuditChange } from '../screens/governance/AuditLog';

afterEach(cleanup);

describe('AuditChange', () => {
  it('객체 값은 쉼표·콜론 뒤를 띄어 쓰고, ISO 시각은 화면 표기로 줄인다', () => {
    const { container } = render(<AuditChange before={null} after={{ stores: [{ store: 'vehicle_request', cutoff: '2026-10-07T23:05:00.781Z', deleted: 1 }] }} />);
    const el = container.querySelector('[data-audit-change]')!;
    // ISO 시각은 화면 표기(한국 시각, 분까지)로
    expect(el.getAttribute('title')).toBe('stores: [{"store": "vehicle_request", "cutoff": "2026-10-08 08:05", "deleted": 1}]');
    expect(el.textContent).toContain('"store": "vehicle_request", "cutoff"');
  });
});

// 회귀(2026-11-06 차단 시연 검토): 긴급 차단 감사의 전후 값에 featureIds·vins·kid·SAFETY/FIELD_FAULT가 그대로 보였다 — 업무 말, 원래 값은 툴팁
describe('AuditChange — 차단 감사의 키·값은 업무 말로', () => {
  it('아는 키는 한글, 차량 수는 n대, 승인 키는 이름, 사유는 분류·코드 한글 — 툴팁은 원래 키·값', () => {
    const { container } = render(<AuditChange before={null} after={{ featureIds: ['FEAT-00022', 'FEAT-00188'], vins: 240, reason: 'SAFETY/FIELD_FAULT' }} />);
    const el = container.querySelector('[data-audit-change]')!;
    expect(el.textContent).toContain('함께 차단한 Feature: FEAT-00022, FEAT-00188');
    expect(el.textContent).toContain('대상 차량: 240대');
    expect(el.textContent).toContain('사유: 안전 · 현장 결함 보고');
    expect(el.textContent).not.toMatch(/featureIds|vins|FIELD_FAULT/);
    expect(el.getAttribute('title')).toContain('vins: 240');
    const { container: c2 } = render(<AuditChange before={null} after={{ approvals: 2, role: 'CSM', kid: 'APR-usr-integrator' }} />);
    expect(c2.querySelector('[data-audit-change]')!.textContent).not.toMatch(/usr-|kid/);
  });
});
