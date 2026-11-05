// Feature DB 등록 기준(30-95 §8.2, 엑셀 15_DB운영 2절) — 변경 요청의 자동 점검. 결과 한 줄마다 blocking 여부를 둔다:
//  · 막음 — 필수 정보 누락, ID 형식·재사용(한 번 쓴 ID는 폐기해도 다시 쓰지 않는다)
//  · 보완 필요(막지 않음) — 1차 출처 위치, 규모 근거, 중복 점검 기준 ID·선행 관계 대상 존재, 출처 등록, 관리 정보
// 새 ID 부여(nextRefId)도 여기 — 같은 접두의 가장 큰 일련번호 다음을 쓰므로 지운·폐기한 번호를 다시 쓰지 않는다.
import { REF_ID_PATTERN, type FeatureRefRow, type RefChangeKind, type RefCriterionResult } from '../../schemas/refdb';
import { domainAbbrOf } from './domain-alias';

export type RegistrationCriterionId = 'ID_FORMAT' | 'ID_REUSE' | 'ID_DOMAIN' | 'REQUIRED_INFO' | 'PRIMARY_SOURCE' | 'SIZE_EVIDENCE' | 'DUPLICATE_REF' | 'REQUIRES_TARGETS' | 'SOURCE_REGISTERED' | 'ADMIN_INFO';

/** 등록 기준 표 — 엑셀 2절 항목과 확인할 곳 */
export const REGISTRATION_CRITERIA: { id: RegistrationCriterionId; item: string; rule: string; blocking: boolean }[] = [
  { id: 'ID_FORMAT', item: 'ID', rule: "'도메인 약어-컴포넌트 약어-일련번호'(예: PL-AP-021)", blocking: true },
  { id: 'ID_REUSE', item: 'ID', rule: '한 번 쓴 ID는 폐기해도 다시 쓰지 않는다', blocking: true },
  { id: 'ID_DOMAIN', item: 'ID', rule: 'ID의 도메인 약어가 도메인과 맞다', blocking: false },
  { id: 'REQUIRED_INFO', item: '필수 정보', rule: '도메인·클러스터·컴포넌트·영문·한글 기능명·T-shirt 등급·대표 ASIL·출처 ID를 모두 채운다', blocking: true },
  { id: 'PRIMARY_SOURCE', item: '존재 근거', rule: "1차 출처의 위치(조항·경로·URL)를 출처 상세에 적는다 — 2차 자료만 있으면 '검토 필요'", blocking: false },
  { id: 'SIZE_EVIDENCE', item: '규모 근거', rule: '규모 근거 등급(A 공개 금액·B 사내 실적·C 비교 판단·D 작성자 판단)을 지정하고, 비교 행 ID와 이유를 비고에 적는다', blocking: false },
  { id: 'DUPLICATE_REF', item: '중복 점검', rule: '중복 점검 기준 ID는 있는 기준 행이어야 한다', blocking: false },
  { id: 'REQUIRES_TARGETS', item: '선행 관계', rule: '선행·배타 대상 기준 행이 있어야 한다', blocking: false },
  { id: 'SOURCE_REGISTERED', item: '출처 등록', rule: '출처 ID가 모두 출처 표(09_출처)에 있다', blocking: false },
  { id: 'ADMIN_INFO', item: '관리 정보', rule: '등록 버전·최종 근거 확인일·관리 상태를 채운다', blocking: false },
];

// 순수 표시 — 쓰지 않는 화면 묶음(첫 화면)에서 빠지게(harness/budgets.json)
const CRITERION = /* @__PURE__ */ Object.fromEntries(/* @__PURE__ */ REGISTRATION_CRITERIA.map((c) => [c.id, c])) as Record<RegistrationCriterionId, (typeof REGISTRATION_CRITERIA)[number]>;

export interface RegistrationContext {
  kind: RefChangeKind;
  /** 지금까지 쓴 모든 기준 행 ID — 폐기 행·요청 중 행 포함 */
  usedIds: Iterable<string>;
  /** 지금 있는 기준 행 ID(중복 점검·선행 대상 확인) — 빠지면 usedIds */
  existingIds?: Iterable<string>;
  /** 출처 표의 출처 ID */
  sourceIds: Iterable<string>;
}

const blank = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** 필수 정보 필드(§9 이전 점검과 같은 목록) */
export const REF_REQUIRED_FIELDS = ['domain', 'cluster', 'component', 'nameEn', 'nameKo', 'tshirt', 'asilRep', 'sourceIds'] as const satisfies readonly (keyof FeatureRefRow)[];

const REQUIRED_LABEL: Record<(typeof REF_REQUIRED_FIELDS)[number], string> = {
  domain: '도메인',
  cluster: '클러스터',
  component: '컴포넌트',
  nameEn: '영문 기능명',
  nameKo: '한글 기능명',
  tshirt: 'T-shirt 등급',
  asilRep: '대표 ASIL',
  sourceIds: '출처 ID',
};

/**
 * 변경 요청 반영 뒤 행(row)에 대한 자동 점검 — 결과는 항목마다 한 줄(통과 포함).
 * RETIRE·DEPRECATE는 행 내용을 바꾸지 않으므로 ID 점검만 본다.
 */
export function checkRegistration(row: Partial<FeatureRefRow> & { refId: string }, ctx: RegistrationContext): RefCriterionResult[] {
  const used = new Set(ctx.usedIds);
  const existing = new Set(ctx.existingIds ?? used);
  const sources = new Set(ctx.sourceIds);
  const out: RefCriterionResult[] = [];
  const put = (id: RegistrationCriterionId, ok: boolean, message: string) => out.push({ id, ok, blocking: CRITERION[id].blocking, message: ok ? '' : message });

  put('ID_FORMAT', REF_ID_PATTERN.test(row.refId), `ID ${row.refId}이(가) '도메인약어-컴포넌트약어-일련번호' 형식이 아닙니다(예: BC-BCM-001).`);
  if (ctx.kind === 'ADD') put('ID_REUSE', !used.has(row.refId), `ID ${row.refId}은(는) 이미 쓴 ID입니다 — 폐기한 ID도 다시 쓰지 않습니다.`);
  else put('ID_REUSE', existing.has(row.refId), `기준 행 ${row.refId}이(가) Feature DB에 없습니다.`);
  if (ctx.kind === 'RETIRE' || ctx.kind === 'DEPRECATE') return out;

  const abbr = row.domain ? domainAbbrOf(row.domain) : undefined;
  put('ID_DOMAIN', !row.domain || abbr === row.refId.split('-')[0], `ID의 도메인 약어(${row.refId.split('-')[0]})가 도메인 '${row.domain}'${abbr ? `(${abbr})` : ''}과 맞지 않습니다.`);

  // 등록 화면 추가 요청(ADD)은 출처 ID 대신 근거 메모로도 받는다(30-95 §6.4) — 그 행은 출처가 생길 때까지 '검토 필요'로 발행된다(§8.2).
  // 근거 메모만 있는 요청을 여기서 막으면 승인할 길이 없다(요청 중 행은 수정 요청도 받지 않는다)
  const basisOnly = ctx.kind === 'ADD' && blank(row.sourceIds) && row.basisType === '근거 메모' && !blank(row.remark);
  const missing = REF_REQUIRED_FIELDS.filter((k) => blank(row[k]) && !(k === 'sourceIds' && basisOnly));
  put('REQUIRED_INFO', missing.length === 0, `필수 정보 누락: ${missing.map((k) => REQUIRED_LABEL[k]).join('·')}`);

  put('PRIMARY_SOURCE', !blank(row.sourceDetail), "1차 출처의 위치(조항·경로·URL)가 출처 상세에 없습니다 — 2차 자료만 있으면 관리 상태를 '검토 필요'로 둡니다.");

  const gradeOk = row.sizeEvidenceGrade != null && (row.sizeEvidenceGrade === 'A' || row.sizeEvidenceGrade === 'B' || !blank(row.remark));
  put('SIZE_EVIDENCE', gradeOk, row.sizeEvidenceGrade == null ? '규모 근거 등급(A~D)이 없습니다.' : '비교한 기존 행 ID와 이유를 비고에 적으세요.');

  put('DUPLICATE_REF', !row.duplicateOf || (row.duplicateOf !== row.refId && existing.has(row.duplicateOf)), `중복 점검 기준 ID ${row.duplicateOf}이(가) Feature DB에 없습니다.`);

  const missingTargets = [...(row.requires ?? []), ...(row.excludes ?? [])].filter((id) => id === row.refId || !existing.has(id));
  put('REQUIRES_TARGETS', missingTargets.length === 0, `선행·배타 대상이 없습니다: ${[...new Set(missingTargets)].join(', ')}`);

  const unknownSources = (row.sourceIds ?? []).filter((s) => !sources.has(s));
  put('SOURCE_REGISTERED', unknownSources.length === 0, `출처 표에 없는 출처 ID: ${unknownSources.join(', ')} — 09_출처에 먼저 등록합니다.`);

  const admin = (['registeredIn', 'evidenceCheckedAt', 'status'] as const).filter((k) => blank(row[k]));
  put('ADMIN_INFO', admin.length === 0, `관리 정보 누락: ${admin.map((k) => ({ registeredIn: '등록 버전', evidenceCheckedAt: '최종 근거 확인일', status: '관리 상태' })[k]).join('·')}`);
  return out;
}

/** 점검 결과 중 승인을 막는 실패 */
export const blockingFailures = (results: readonly RefCriterionResult[]) => results.filter((r) => !r.ok && r.blocking);
/** 보완 필요(막지 않는 실패) */
export const advisoryFailures = (results: readonly RefCriterionResult[]) => results.filter((r) => !r.ok && !r.blocking);

/**
 * 다음 기준 행 ID — `도메인약어-컴포넌트약어-(같은 접두 최대 일련번호 + 1)`.
 * existingIds에는 폐기·요청 중 행과 반려된 요청의 ID까지 모두 넣는다(빈 번호를 채우지 않으므로 다시 쓰지 않는다).
 */
export function nextRefId(domainAbbr: string, componentAbbr: string, existingIds: Iterable<string>): string {
  const prefix = `${domainAbbr}-${componentAbbr}-`;
  let max = 0;
  for (const id of existingIds) if (id.startsWith(prefix)) max = Math.max(max, Number(id.slice(prefix.length)) || 0);
  if (max >= 999) throw new Error(`${prefix} 일련번호가 999를 넘습니다 — 새 컴포넌트 약어가 필요합니다.`);
  const id = `${prefix}${String(max + 1).padStart(3, '0')}`;
  if (!REF_ID_PATTERN.test(id)) throw new Error(`기준 행 ID 형식이 아닙니다: ${id}`);
  return id;
}
