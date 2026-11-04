// Feature DB 변경 요청 규칙(30-95 §8.2·§8.3) — 순수 함수: 필드 단위 차이, 추가 요청의 빈 행, 발행 때 적용, 승인을 막는 점검, 영향(재계산 필요).
// 서비스(refdb-change.service)가 저장소·감사·이벤트와 묶어 쓴다. 발행 전 승인된 변경은 기준 행(feature_ref)에 쓰지 않는다 — 발행만 쓴다.
import { blockingFailures, canonicalJson, type FeatureRefRow, type RefChange, type RefChangeKind, type RefCriterionResult, type RefFieldDiff } from '@ff/contracts';

/** 진행 중(아직 발행되지 않은) 변경 요청 — 같은 행에 둘을 동시에 열지 않는다(차이의 '전' 값이 어긋나지 않게) */
export const isOpenChange = (c: RefChange) => c.release === null && (c.status === 'DRAFT' || c.status === 'REVIEW' || c.status === 'APPROVED' || (c.status === 'REJECTED' && c.kind === 'ADD'));

/** 발행 대기 — 승인됐지만 아직 발행되지 않음(등록 화면에는 반영되지 않는다) */
export const isAwaitingPublish = (c: RefChange) => c.status === 'APPROVED' && c.release === null;

/** 대표 ASIL·T-shirt가 바뀌면 산정 과제에 '기준 변경됨, 재계산 필요'(20-94 §6.4) */
export const RECALC_FIELDS = ['asilRep', 'tshirt'] as const satisfies readonly (keyof FeatureRefRow)[];

/** MODIFY로 바꿀 수 없는 필드 — ID는 영구, 폐기 예정·폐기는 각 종류로 */
const IMMUTABLE_FIELDS: readonly string[] = ['refId'];
/** MODIFY가 둘 수 있는 상태 — 활성 ↔ 검토 필요만(폐기 예정·폐기는 DEPRECATE·RETIRE, 요청 중은 추가 요청만) */
export const MODIFY_STATUSES: readonly string[] = ['ACTIVE', 'REVIEW'];

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

/** 화면 표시용 필드별 차이 — before에 없는 필드는 null(ADD는 모든 필드가 새 값) */
export function fieldDiff(before: RefFieldDiff | null, after: RefFieldDiff): FieldDiff[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => !same(b[k], a[k]))
    .sort()
    .map((k) => ({ field: k, before: k in b ? b[k] : null, after: a[k] ?? null }));
}

/** 지금 행과 요청 값을 견줘 바뀐 필드만 — { before, after } (같은 값은 뺀다) */
export function changedFields(cur: FeatureRefRow, requested: RefFieldDiff): { before: RefFieldDiff; after: RefFieldDiff } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(requested)) {
    if (v === undefined || IMMUTABLE_FIELDS.includes(k)) continue;
    const old = (cur as Record<string, unknown>)[k];
    if (same(old, v)) continue;
    before[k] = old ?? null;
    after[k] = v;
  }
  return { before: before as RefFieldDiff, after: after as RefFieldDiff };
}

/** 발행 시점 행이 요청 때 본 '전' 값과 다른 필드 — 있으면 발행·승인을 막는다(그사이 다른 발행이 같은 필드를 바꿈) */
export function staleFields(cur: FeatureRefRow, before: RefFieldDiff | null): string[] {
  return Object.entries(before ?? {})
    .filter(([k, v]) => !same((cur as Record<string, unknown>)[k], v))
    .map(([k]) => k)
    .sort();
}

/** 변경 요청 작성의 ADD — 빈 값으로 채운 새 행(요청 값이 덮는다). 등록 버전은 발행 때 정한다 */
export function draftRefRow(refId: string, patch: RefFieldDiff, today: string): Partial<FeatureRefRow> & { refId: string } {
  return {
    replacedBy: null,
    registeredIn: '',
    evidenceCheckedAt: today,
    domain: '',
    cluster: '',
    component: '',
    swStack: '',
    lifecycle: '',
    techStack: '',
    vehicleType: '',
    region: '',
    nameEn: '',
    nameKo: '',
    aliases: [],
    autoQuality: '',
    techQuality: '',
    method: '',
    tshirt: '',
    bundleId: null,
    bundleRep: null,
    sizeEvidenceGrade: null,
    benchmarkEur: null,
    kearneyNote: '',
    makeBuyVolume: '',
    makeBuyPremium: '',
    relevance: '',
    sourceIds: [],
    sourceDetail: '',
    remark: '',
    basisType: '',
    duplicateOf: null,
    requires: [],
    excludes: [],
    procurement: '',
    swPackage: '',
    licenseItem: '',
    billing: '',
    definition: null,
    adminMemo: '',
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    refId,
    status: 'PENDING',
  };
}

/**
 * 근거 부족 — 출처 ID 없음(근거 메모만) 또는 출처 표에 없는 출처 ID. 승인된 추가 행은 '검토 필요'(REVIEW)로 발행한다(§5.1 '1차 출처 없으면 REVIEW', §6.4).
 * 1차 출처 위치(출처 상세) 누락은 '보완 필요'로만 남기고 상태를 바꾸지 않는다 — 등록 화면 추가 요청은 출처 상세를 받지 않는다.
 */
export function sourceMissing(checks: readonly RefCriterionResult[], row: Partial<FeatureRefRow>): boolean {
  return !row.sourceIds?.length || checks.some((c) => c.id === 'SOURCE_REGISTERED' && !c.ok);
}

/**
 * 승인을 막는 점검 실패. 등록 화면 추가 요청(fromRegistration)이 출처 ID 없이 근거 메모만 냈으면 출처 ID 누락은 막지 않는다 —
 * 승인하면 '검토 필요'로 발행된다(30-95 §6.4 "근거 부족 시 REVIEW"). 다른 필수 정보 누락·ID 문제는 그대로 막는다.
 */
export function approvalBlockers(checks: readonly RefCriterionResult[], change: Pick<RefChange, 'kind' | 'fromRegistration'>, row: Partial<FeatureRefRow>): RefCriterionResult[] {
  return blockingFailures(checks).filter((c) => {
    if (c.id !== 'REQUIRED_INFO' || change.kind !== 'ADD' || !change.fromRegistration) return true;
    const onlySources = /^필수 정보 누락: 출처 ID$/.test(c.message);
    return !(onlySources && !!row.remark?.trim());
  });
}

/** 종류별 적용 — 발행 때 지금 행(cur)에 요청 차이를 덮는다. ADD의 상태·등록 버전은 서비스가 정한다 */
export function applyDiff(kind: RefChangeKind, cur: FeatureRefRow, after: RefFieldDiff): FeatureRefRow {
  const next = { ...cur, ...after, refId: cur.refId } as FeatureRefRow;
  if (kind === 'DEPRECATE') next.status = 'DEPRECATED';
  if (kind === 'RETIRE') next.status = 'RETIRED';
  return next;
}

/** 관리 메모에 변경 요청 번호를 붙인다(엑셀 BR '변경 요청 번호 함께') */
export const appendMemo = (memo: string, line: string) => (memo.trim() ? `${memo.trim()}\n${line}` : line);

/** 변경 요청 번호 정렬 — CR-연도-일련번호(자리 수가 달라도 숫자 순) */
export const byChangeId = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
