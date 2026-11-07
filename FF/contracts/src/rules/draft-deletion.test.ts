// 초안 삭제 공용 규칙(B2, 2026-11-07 결정 D2 (b)) — 승인 이력이 없고 다른 기록이 참조하지 않는 초안만 지운다. 아니면 폐기·미사용 표시로 안내.
// 지운 ID는 묘비로 남아 다시 쓰지 않는다(FFG-CODE-020). 감사 행위·이벤트 이름은 규칙으로 만든다
import { describe, expect, it } from 'vitest';
import { DeleteDraftBody, draftDeletion, draftDeletionAudit, draftDeletionEvent, nextSequentialId, tombstoneBlocker } from './draft-deletion';

const DRAFT = { status: 'DRAFT', draftStatuses: ['DRAFT'], approvals: 0, references: [] };

describe('초안 삭제 판정', () => {
  it('초안·승인 이력 없음·참조 없음이면 삭제할 수 있다', () => {
    expect(draftDeletion(DRAFT)).toEqual({ ok: true });
  });
  it('초안이 아니면 거부 — 폐기 표시로 안내', () => {
    expect(draftDeletion({ ...DRAFT, status: 'APPROVED' })).toMatchObject({ ok: false, code: 'DRAFT_NOT_DRAFT', alternative: 'RETIRE' });
  });
  it('한 번이라도 승인된 적 있으면(되돌아온 초안 포함) 거부', () => {
    const r = draftDeletion({ ...DRAFT, approvals: 1 });
    expect(r).toMatchObject({ ok: false, code: 'DRAFT_HAS_APPROVAL', alternative: 'RETIRE' });
    expect(r.ok === false && r.message).toMatch(/승인 이력/);
  });
  it('다른 기록이 참조하면 거부 — 참조한 기록을 사유에 보여 주고 미사용 표시로 안내', () => {
    const r = draftDeletion({ ...DRAFT, references: [{ kind: '배포 계획', id: 'RP-00002' }, { kind: '실험', id: 'EXP-00001' }] });
    expect(r).toMatchObject({ ok: false, code: 'DRAFT_REFERENCED', alternative: 'MARK_UNUSED', references: [{ kind: '배포 계획', id: 'RP-00002' }, { kind: '실험', id: 'EXP-00001' }] });
    expect(r.ok === false && r.message).toContain('배포 계획 RP-00002');
  });
  it('여러 이유가 겹치면 초안 아님 → 승인 이력 → 참조 순으로 하나', () => {
    expect(draftDeletion({ ...DRAFT, status: 'APPROVED', approvals: 2, references: [{ kind: 'x', id: 'y' }] })).toMatchObject({ code: 'DRAFT_NOT_DRAFT' });
    expect(draftDeletion({ ...DRAFT, approvals: 1, references: [{ kind: 'x', id: 'y' }] })).toMatchObject({ code: 'DRAFT_HAS_APPROVAL' });
  });
});

describe('ID 재사용 금지(묘비)', () => {
  it('지운 ID로 새 기록을 만들 수 없다', () => {
    expect(tombstoneBlocker('POL-00010', ['POL-00010'])).toMatch(/삭제된 ID/);
    expect(tombstoneBlocker('POL-00011', ['POL-00010'])).toBeNull();
  });
  it('일련번호는 남은 기록과 묘비 중 가장 큰 번호 다음 — 마지막 초안을 지워도 그 번호를 다시 주지 않는다', () => {
    expect(nextSequentialId('POL-', 5, ['POL-00003'], ['POL-00004'])).toBe('POL-00005');
    expect(nextSequentialId('POL-', 5, [], [])).toBe('POL-00001');
    expect(nextSequentialId('EXP-', 5, ['EXP-00009', 'X-1'], ['EXP-00002'])).toBe('EXP-00010');
  });
});

describe('감사·이벤트 이름 규칙', () => {
  it('감사 행위는 <대상>_DRAFT_DELETE, 이벤트는 <대상>.draft.deleted', () => {
    expect(draftDeletionAudit('policy')).toBe('POLICY_DRAFT_DELETE');
    expect(draftDeletionAudit('feature-relation')).toBe('FEATURE_RELATION_DRAFT_DELETE');
    expect(draftDeletionEvent('policy')).toBe('policy.draft.deleted');
    expect(draftDeletionEvent('feature-relation')).toBe('feature-relation.draft.deleted');
    expect(() => draftDeletionAudit('Bad Name')).toThrow();
  });
  it('삭제 본문은 사유(4자 이상)만', () => {
    expect(DeleteDraftBody.parse({ reason: '잘못 만든 초안' })).toEqual({ reason: '잘못 만든 초안' });
    expect(DeleteDraftBody.safeParse({ reason: '짧' }).success).toBe(false);
    expect(DeleteDraftBody.safeParse({ reason: '잘못 만든 초안', force: true }).success).toBe(false);
  });
});
