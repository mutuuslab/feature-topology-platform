// Feature 등록 Revision 규칙 — 기준 FP-DETAILED-1.1 (C01-R01~R19 / SPEC_CLOSURE.workflow / SPEC_ERRORS) 을
// 데모에서 실행 가능한 결정적 로직으로 옮긴 것. 서버·DB 는 미연결(LOCAL_UI_ONLY)이며 상태 전이 문구·오류
// 코드는 기준 원문을 그대로 사용한다. 상태를 직접 수정하지 않고 아래 전이만 허용한다(SPEC_REGISTRY_CONTRACT).
import { SPEC_CLOSURE, SPEC_ERRORS } from './specArch';
import { SPEC_REGISTRY_CONTRACT, SPEC_STATES, SPEC_RULES } from './specNav';

/** 업무 상태 — SPEC_REGISTRY_CONTRACT.stateField(lifecycleState) 의 허용 값 */
export type LifecycleState = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'RETIRED';

export const DEFINITION_STATES = SPEC_REGISTRY_CONTRACT.definitionStates as LifecycleState[];
export const STATE_FIELD = SPEC_REGISTRY_CONTRACT.stateField;

/** 미정 항목 (FRI-178~182): 해소 전에는 승인 요청으로 넘길 수 없다. */
export interface UnresolvedItem {
  field: string;
  reason: string;
  owner: string;
  due: string;
}

export interface RevisionEvent {
  ts: string;
  action: string;
  from: string;
  to: string;
  actor: string;
  hash: string;
  note?: string;
}

export interface RevisionRecord {
  /** Feature ID — 업무 식별자 (동시성 Revision 과 별개) */
  id: string;
  /** 업무 버전 (FeatureVersion.definitionVersion) */
  version: string;
  /** 동시성 Revision — If-Match 로 보내는 값 */
  recordRevision: number;
  /** lifecycleState */
  state: LifecycleState;
  /** 검토·승인이 결속되는 내용 hash */
  contentHash: string;
  parentRef?: string;
  actor: string;
  ts: string;
  scope?: string;
  name?: string;
  reason?: string;
  unresolved: UnresolvedItem[];
  history: RevisionEvent[];
}

export const sameRevision = (a: RevisionRecord, b: RevisionRecord) => a.id === b.id && a.version === b.version;

/** If-Match 용 ETag — 승인은 정확 버전과 내용 hash 에 결속된다(IA-R06). */
export const etagOf = (r: RevisionRecord) => `W/"${r.id}@${r.version}#${r.recordRevision}.${r.contentHash}"`;

/** 결정적 32bit hash 2개 → 16자. 운영은 SHA-256 이며 데모는 같은 입력에 같은 값을 만든다. */
export function contentHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase();
}

/** 입력 값 → 내용 hash. 키 순서에 흔들리지 않도록 정렬해 직렬화한다. */
export function payloadHash(values: Record<string, string>): string {
  const keys = Object.keys(values).sort();
  return contentHash(keys.map(k => `${k}=${values[k] ?? ''}`).join('\n'));
}

export function nextFeatureId(existing: string[]): string {
  const n = existing.filter(id => id.startsWith('FEAT-NEW-')).length + 1;
  return `FEAT-NEW-${String(n).padStart(3, '0')}`;
}

/** 승인 원본을 덮지 않고 새 업무 버전으로 분기한다(WF-REVISE). 1.0.0 → 1.1.0 */
export function nextVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  if (!m) return '1.0.0';
  return `${m[1]}.${Number(m[2]) + 1}.0`;
}

export interface WorkflowStep { id: string; from: string[]; action: string; to: string; guard: string }

export const WORKFLOW = SPEC_CLOSURE.workflow as WorkflowStep[];

export const workflowOf = (id: string) => WORKFLOW.find(w => w.id === id);

/** 현재 상태에서 가능한 전이 (직접 수정은 허용하지 않는다) */
export const actionsFor = (state: LifecycleState) => WORKFLOW.filter(w => w.from.includes(state));

export const rulesOf = (ids: string[]) => ids.map(id => SPEC_RULES.find(r => r.id === id)!).filter(Boolean);

export const UI02_S01_RULES = ['IA-R01', 'IA-R06', 'IA-R07', 'IA-R10', 'IA-R12', 'IA-R14', 'IA-R13'];

/** HTTP status → 화면 상태 (SPEC_STATES). 상태별 '입력 보존' 동작이 화면에 함께 표시된다. */
const STATE_FOR_STATUS: Record<number, string> = {
  400: 'validation', 401: 'expired', 403: 'forbidden', 404: 'empty',
  409: 'conflict', 412: 'conflict', 422: 'validation', 428: 'validation',
  429: 'error', 503: 'error',
};

export interface SpecError {
  status: number;
  reason: string;
  description: string;
  behavior: string;
  fieldErrors?: string[];
}

/** 기준 오류 사전(SPEC_ERRORS) + 상태 규칙(SPEC_STATES)을 합친 표시 값 */
export function specError(status: number, extra?: string, fieldErrors?: string[]): SpecError {
  const e = SPEC_ERRORS.find(x => x.status === status);
  const s = SPEC_STATES.find(x => x.id === STATE_FOR_STATUS[status]);
  return {
    status,
    reason: e?.reason || 'UNKNOWN',
    description: extra ? `${extra} ${e?.description || ''}`.trim() : e?.description || '',
    behavior: s ? `${s.label} — ${s.behavior}` : '',
    fieldErrors,
  };
}

export interface TransitionContext {
  /** 현재 역할 (기준 9 역할 키) */
  actor: string;
  /** 승인 시 작성자와 동일인 여부 — 자기 승인 금지(IA-R06) */
  sameAuthor?: boolean;
  /** 미해소 필수 항목 (미정·미입력) — 비어 있지 않으면 승인 요청 차단 */
  fieldErrors?: string[];
  /** If-Match 로 보낸 recordRevision — 다르면 412 */
  expectRevision?: number;
  /** If-Match · Idempotency-Key 누락 — 428 */
  preconditionMissing?: boolean;
  /** 동일 ID·버전에 다른 payload 재사용 — 409 */
  identityConflict?: boolean;
  /** 원천·파생 속성을 사용자가 직접 입력 — WF-DRAFT 가드 거부 대상 */
  derivedWrite?: boolean;
  reason?: string;
  owner?: string;
  due?: string;
}

export interface TransitionResult {
  ok: boolean;
  /** 성공 시 record 에 덮어쓸 패치 */
  patch?: Partial<RevisionRecord>;
  error?: SpecError;
}

const APPROVER_ROLES = ['approver', 'quality', 'operator'];

/**
 * 기준 워크플로 가드를 실행한다. WF-DRAFT / WF-SUBMIT / WF-APPROVE / WF-RETURN / WF-REVISE / WF-RETIRE.
 * WF-COMMAND·WF-RESULT 는 명령 접수·결과 조회 축이라 이 화면에서는 상태 전이로 실행하지 않는다.
 */
export function applyTransition(rec: RevisionRecord, actionId: string, ctx: TransitionContext): TransitionResult {
  const wf = workflowOf(actionId);
  if (!wf) return { ok: false, error: specError(400, `기준 워크플로에 없는 전이입니다: ${actionId}.`) };
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const hist = (action: string, from: string, to: string, note?: string): RevisionEvent =>
    ({ ts: now, action, from, to, actor: ctx.actor, hash: rec.contentHash, note });

  // 선행 조건 누락 — 변경 요청은 If-Match(동시성 Revision)와 Idempotency-Key 를 요구한다
  if (ctx.preconditionMissing) {
    return { ok: false, error: specError(428, '변경 요청에 If-Match 또는 Idempotency-Key 가 없습니다.') };
  }
  // If-Match 불일치 — 모든 변경 요청 공통(WF-DRAFT·WF-SUBMIT·WF-APPROVE 가드)
  if (ctx.expectRevision != null && ctx.expectRevision !== rec.recordRevision) {
    return { ok: false, error: specError(412, `전송한 If-Match ${ctx.expectRevision} 가 최신 recordRevision ${rec.recordRevision} 와 다릅니다.`) };
  }
  if (ctx.identityConflict) {
    return { ok: false, error: specError(409, `동일 ID·버전(${rec.id}@${rec.version})에 다른 payload 가 재사용됐습니다.`) };
  }

  switch (wf.id) {
    case 'WF-DRAFT': {
      if (ctx.derivedWrite) return { ok: false, error: specError(422, '자동 생성값과 외부 원천 값은 입력할 수 없습니다.', ['FRI-001', 'FRI-002', 'FRI-173']) };
      if (rec.state !== 'DRAFT' && rec.state !== 'CHANGES_REQUESTED') return { ok: false, error: specError(409, `현재 업무 상태 ${rec.state} 에서는 초안 저장을 허용하지 않습니다.`) };
      // 초안은 미정 항목을 포함할 수 있다. R0 필수 누락은 fieldErrors 로 돌려주고 승인 요청 단계에서 차단한다(WF-SUBMIT).
      return { ok: true, patch: { recordRevision: rec.recordRevision + 1, history: [...rec.history, hist('SAVE_DRAFT', rec.state, rec.state, ctx.reason)] } };
    }
    case 'WF-SUBMIT': {
      if (!wf.from.includes(rec.state)) return { ok: false, error: specError(409, `${rec.state} 상태에서는 검토 요청을 허용하지 않습니다.`) };
      if (ctx.fieldErrors?.length) return { ok: false, error: specError(422, '승인된 등록 정책의 단계별 필수 항목이 남아 있습니다.', ctx.fieldErrors) };
      return { ok: true, patch: { state: 'IN_REVIEW', recordRevision: rec.recordRevision + 1, history: [...rec.history, hist('SUBMIT_REVIEW', rec.state, 'IN_REVIEW', ctx.reason)] } };
    }
    case 'WF-APPROVE': {
      if (!wf.from.includes(rec.state)) return { ok: false, error: specError(409, `${rec.state} 상태에서는 승인을 허용하지 않습니다.`) };
      if (!APPROVER_ROLES.includes(ctx.actor)) return { ok: false, error: specError(403, `검토·승인은 quality / approver / operator 담당입니다(현재 ${ctx.actor}).`) };
      if (ctx.sameAuthor) return { ok: false, error: specError(403, '자기 승인은 허용하지 않습니다. 작성자와 다른 적격 검토자가 필요합니다.') };
      return { ok: true, patch: { state: 'APPROVED', recordRevision: rec.recordRevision + 1, history: [...rec.history, hist('APPROVE', rec.state, 'APPROVED', `hash ${rec.contentHash} 결속`)] } };
    }
    case 'WF-RETURN': {
      if (!wf.from.includes(rec.state)) return { ok: false, error: specError(409, `${rec.state} 상태에서는 보완 요청을 허용하지 않습니다.`) };
      if (!ctx.reason?.trim() || !ctx.owner?.trim() || !ctx.due?.trim()) {
        return { ok: false, error: specError(422, '보완 사유·담당자·기한이 모두 필요합니다.', ['FRI-169', 'FRI-180', 'FRI-182']) };
      }
      return { ok: true, patch: { state: 'CHANGES_REQUESTED', recordRevision: rec.recordRevision + 1, unresolved: rec.unresolved, history: [...rec.history, hist('REQUEST_CHANGES', rec.state, 'CHANGES_REQUESTED', `${ctx.reason} · 담당 ${ctx.owner} · 기한 ${ctx.due}`)] } };
    }
    case 'WF-REVISE': {
      if (!wf.from.includes(rec.state)) return { ok: false, error: specError(409, `${rec.state} 상태에서는 새 Revision 을 만들 수 없습니다.`) };
      const version = nextVersion(rec.version);
      return {
        ok: true,
        patch: {
          version,
          parentRef: `${rec.id}@${rec.version}`,
          state: 'DRAFT',
          recordRevision: 1,
          unresolved: rec.unresolved,
          history: [hist('CREATE_REVISION', rec.state, 'DRAFT', `승인 원본 불변 · parentRef ${rec.id}@${rec.version} → ${version}`)],
        },
      };
    }
    case 'WF-RETIRE': {
      if (!wf.from.includes(rec.state)) return { ok: false, error: specError(409, `${rec.state} 상태에서는 폐기를 허용하지 않습니다.`) };
      if (!APPROVER_ROLES.includes(ctx.actor)) {
        return { ok: false, error: specError(403, `폐기는 독립 승인이 필요합니다. quality / approver / operator 담당입니다(현재 ${ctx.actor}).`) };
      }
      if (ctx.sameAuthor) return { ok: false, error: specError(403, '작성자 단독 폐기는 허용하지 않습니다(독립 승인 필요).') };
      return { ok: true, patch: { state: 'RETIRED', recordRevision: rec.recordRevision + 1, history: [...rec.history, hist('RETIRE', rec.state, 'RETIRED', ctx.reason || 'tombstone 유지 — 삭제하지 않음')] } };
    }
    default:
      // WF-COMMAND(ACCEPT_COMMAND) · WF-RESULT(COMPLETE) 는 명령 접수·결과 조회 축이라 등록 화면에서 실행하지 않는다.
      return { ok: false, error: specError(400, `${wf.action} 은 이 화면에서 실행하지 않습니다(명령 접수·결과 조회 축).`) };
  }
}

export interface RegistrationIssues {
  /** R0 필수인데 값이 없는 항목 (FRI id) */
  missing: string[];
  /** 사유·담당자·기한이 갖춰지지 않은 미정 항목의 위치 */
  unresolved: string[];
  /** 422 fieldErrors 로 돌려줄 표시 문자열 */
  fieldErrors: string[];
  complete: boolean;
}

/**
 * 등록 완전성 검사 (UI02-S07-A02 VALIDATE · WF-SUBMIT 가드).
 * R0 필수 누락과 미정 항목 미해소를 구분하고, 통과 여부만 돌려준다(업무 상태는 바꾸지 않는다).
 */
export function registrationIssues(
  requiredIds: string[],
  values: Record<string, string>,
  unresolved: UnresolvedItem[],
  labelOf: (id: string) => string,
): RegistrationIssues {
  const missing = requiredIds.filter(id => !(values[id] ?? '').trim());
  const openItems = unresolved.filter(u => !u.field.trim() || !u.reason.trim() || !u.owner.trim() || !u.due.trim());
  const fieldErrors = [
    ...missing.map(id => `${labelOf(id)} (${id}) — R0 필수 항목 미입력`),
    ...openItems.map(u => `미정 항목 책임·기한 미지정${u.field ? `: ${u.field}` : ''} (FRI-178~182)`),
  ];
  return { missing, unresolved: openItems.map(u => u.field || '(위치 미지정)'), fieldErrors, complete: fieldErrors.length === 0 };
}
