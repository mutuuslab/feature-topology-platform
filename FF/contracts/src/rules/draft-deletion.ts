// 초안 삭제 공용 규칙(B2 — 2026-11-07 결정 D2 (b)). 도메인(Feature·정책·관계·Variant·조건·시나리오·협력사·타겟)은 이 판정과
// 백엔드 kernel/draft-deletion.ts(묘비·감사·이벤트)를 써서 각자 삭제 API·화면을 만든다(P4·P10·P11b·P12·TX).
//  · 지울 수 있는 것: 아직 초안이고, 승인된 적이 한 번도 없고, 다른 기록이 참조하지 않는 것. 아니면 폐기(RETIRE)·미사용 표시(MARK_UNUSED)로 안내
//  · 지운 ID는 묘비로 남긴다 — 같은 ID로 다시 만들 수 없고 일련번호도 다시 주지 않는다(FFG-CODE-020 ID 재사용 금지)
//  · 삭제 사실은 감사(<대상>_DRAFT_DELETE)와 이벤트(<대상>.draft.deleted)에 남긴다
import { z } from 'zod';

export type DraftDeleteCode = 'DRAFT_NOT_DRAFT' | 'DRAFT_HAS_APPROVAL' | 'DRAFT_REFERENCED';
export type DraftAlternative = 'RETIRE' | 'MARK_UNUSED';
export const DRAFT_ALTERNATIVE_LABEL: Record<DraftAlternative, string> = { RETIRE: '폐기 표시', MARK_UNUSED: '미사용 표시' };

export interface DraftFacts {
  /** 지금 상태 */
  status: string;
  /** 이 도메인의 초안 상태들(예: ['DRAFT']) */
  draftStatuses: readonly string[];
  /** 지금까지 승인된 횟수(되돌아온 초안도 센다) */
  approvals: number;
  /** 이 기록을 참조하는 다른 기록 */
  references: readonly { kind: string; id: string }[];
}

export type DraftDeletion = { ok: true } | { ok: false; code: DraftDeleteCode; message: string; alternative: DraftAlternative; references?: { kind: string; id: string }[] };

/** 삭제 가능 판정 — 초안 아님 → 승인 이력 → 참조 순으로 첫 사유 하나 */
export function draftDeletion(f: DraftFacts): DraftDeletion {
  if (!f.draftStatuses.includes(f.status)) return { ok: false, code: 'DRAFT_NOT_DRAFT', message: '초안이 아니라 지울 수 없습니다 — 폐기 표시로 정리하세요', alternative: 'RETIRE' };
  if (f.approvals > 0) return { ok: false, code: 'DRAFT_HAS_APPROVAL', message: '승인 이력이 있어 지울 수 없습니다 — 승인된 기록은 남기고 폐기 표시로 정리하세요', alternative: 'RETIRE' };
  if (f.references.length) {
    const refs = f.references.map((r) => ({ kind: r.kind, id: r.id }));
    return { ok: false, code: 'DRAFT_REFERENCED', message: `다른 기록이 참조해 지울 수 없습니다(${refs.map((r) => `${r.kind} ${r.id}`).join(', ')}) — 미사용 표시로 정리하세요`, alternative: 'MARK_UNUSED', references: refs };
  }
  return { ok: true };
}

/** 묘비가 있는 ID로 만들려는가 — 막히면 사유 */
export function tombstoneBlocker(id: string, tombstones: readonly string[]): string | null {
  return tombstones.includes(id) ? `${id}은(는) 삭제된 ID라 다시 쓸 수 없습니다 — 새 ID로 만드세요` : null;
}

/** 일련번호 ID — 남은 기록과 묘비 중 가장 큰 번호 다음(마지막 초안을 지워도 번호를 다시 주지 않는다) */
export function nextSequentialId(prefix: string, width: number, existing: readonly string[], tombstones: readonly string[]): string {
  let max = 0;
  for (const id of [...existing, ...tombstones]) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

const ENTITY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const entity = (e: string) => {
  if (!ENTITY.test(e)) throw new Error(`삭제 대상 이름은 소문자·하이픈(kebab-case): ${e}`);
  return e;
};
/** 감사 행위 이름 — feature-relation → FEATURE_RELATION_DRAFT_DELETE */
export const draftDeletionAudit = (e: string) => `${entity(e).replace(/-/g, '_').toUpperCase()}_DRAFT_DELETE`;
/** 이벤트 이름 — feature-relation → feature-relation.draft.deleted */
export const draftDeletionEvent = (e: string) => `${entity(e)}.draft.deleted`;

/** 초안 삭제 요청 본문 — 사유만(감사에 남는다) */
export const DeleteDraftBody = z.object({ reason: z.string().trim().min(4).max(500) }).strict();
export type DeleteDraftBody = z.infer<typeof DeleteDraftBody>;

/** 묘비(지운 초안의 마지막 모습·사유) */
export interface DeletionTombstone {
  entity: string;
  recordId: string;
  deletedBy: string;
  deletedAt: string;
  reason: string;
}
