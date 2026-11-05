// 검토 포털 협의 요청(P5-1) — 포털 부서·요청 부서·기한·의견 본문
import { describe, expect, it } from 'vitest';
import { AnswerConsultationBody, CONSULT_DEPARTMENTS, consultDaysLeft, consultOrder, CreateConsultationBody, departmentRoles } from './consult';

const ok = { toDept: 'DEP-PUR', fromDept: 'DEP-FS', activityId: 'FPW.2-A01', targetKind: 'SUPPLIER_PACKAGE', targetId: 'ART-RADAR-SVC-3.1.0', targetName: '레이더 서비스 SW 3.1.0', summary: '협력사 레이더 SW 변경 영향 의견', checks: ['계약 범위'], dueAt: '2026-11-12' };

describe('협의 요청', () => {
  it('포털 부서는 업무 절차 모델의 검토 포털 부서(구매·법무·개인정보보호)', () => {
    expect([...CONSULT_DEPARTMENTS].sort()).toEqual(['DEP-DPO', 'DEP-LEG', 'DEP-PUR']);
    expect(departmentRoles('DEP-PUR')).toEqual(['R-PUR', 'R-CE', 'R-CA', 'R-CV', 'R-CBA']);
  });
  it('받는 부서는 포털 부서, 요청 부서는 모델의 부서, 자기 부서에는 요청하지 않는다', () => {
    expect(CreateConsultationBody.safeParse(ok).success).toBe(true);
    expect(CreateConsultationBody.safeParse({ ...ok, toDept: 'DEP-FS' }).success).toBe(false);
    expect(CreateConsultationBody.safeParse({ ...ok, fromDept: 'DEP-XXX' }).success).toBe(false);
    expect(CreateConsultationBody.safeParse({ ...ok, fromDept: 'DEP-PUR' }).success).toBe(false);
    expect(CreateConsultationBody.safeParse({ ...ok, dueAt: '2026/11/12' }).success).toBe(false);
    expect(CreateConsultationBody.safeParse({ ...ok, checks: [] }).success).toBe(false);
  });
  it('의견은 동의·보완·반대 + 메모 2자 이상', () => {
    expect(AnswerConsultationBody.safeParse({ department: 'DEP-LEG', opinion: 'REVISE', memo: '고지 문구 보완' }).success).toBe(true);
    expect(AnswerConsultationBody.safeParse({ department: 'DEP-LEG', opinion: 'MAYBE', memo: '고지 문구 보완' }).success).toBe(false);
    expect(AnswerConsultationBody.safeParse({ department: 'DEP-LEG', opinion: 'AGREE', memo: 'x' }).success).toBe(false);
  });
  it('기한 남은 날과 목록 순서(의견 대기 → 기한 이른 순)', () => {
    expect(consultDaysLeft('2026-11-12', '2026-11-05T09:00:00Z')).toBe(7);
    expect(consultDaysLeft('2026-11-04', '2026-11-05')).toBe(-1);
    const xs = [
      { consultId: 'CON-2026-003', status: 'ANSWERED' as const, dueAt: '2026-11-01' },
      { consultId: 'CON-2026-002', status: 'OPEN' as const, dueAt: '2026-11-20' },
      { consultId: 'CON-2026-001', status: 'OPEN' as const, dueAt: '2026-11-07' },
    ].sort(consultOrder);
    expect(xs.map((x) => x.consultId)).toEqual(['CON-2026-001', 'CON-2026-002', 'CON-2026-003']);
  });
});
