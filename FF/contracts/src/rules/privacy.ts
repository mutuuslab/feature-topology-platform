// 개인정보 목록·처리 방법·보존 기한 — 출시 준비 RD-P2-05 (GDPR Art.15·17·20·30, 개인정보 보호법 제21·35·36조).
// 플랫폼이 담는 개인정보를 저장소(표)·칸 단위로 적고, 정보주체 요청(열람·내보내기, 삭제·가명 처리)과 보존 기한을 이 표 하나로 정한다.
// 백엔드(kernel/privacy.service.ts)는 이 표대로 찾고·지우고·가명 처리하며, 화면(데이터·규제 기록 → 개인정보)은 이 표를 그대로 보인다.
//  · 정보주체는 둘이다 — USER(플랫폼 사용자: OIDC sub)와 VEHICLE(차량 소유자·운전자: VIN, Data Lake에는 차량 가명).
//  · 처리 방법: DELETE(행 삭제) · PSEUDONYMISE(식별자를 가명으로 바꿈 — 기록은 남는다) · RETAIN_LEGAL(법정 보존·서명 검증 때문에 그대로, 열람·내보내기만).
//  · 감사 이력은 지울 수 없다(추가 전용·해시 체인). 식별자만 가명으로 바꾸고 체인 검증은 그대로 통과한다(audit.service.ts — 체인 v2: 칸별 소금 해시).
import { z } from 'zod';

export const PRIVACY_SUBJECT_KINDS = ['USER', 'VEHICLE'] as const;
export type PrivacySubjectKind = (typeof PRIVACY_SUBJECT_KINDS)[number];

export const PERSONAL_CATEGORIES = ['ACCOUNT_SESSION', 'COLLABORATION', 'NOTIFICATION', 'ACTIVITY_LOG', 'SIGNED_RECORD', 'VEHICLE_LINKED'] as const;
export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number];

export type PrivacyTreatment = 'DELETE' | 'PSEUDONYMISE' | 'RETAIN_LEGAL';

export interface PersonalDataStore {
  /** 저장소(표) */
  store: string;
  subject: PrivacySubjectKind;
  category: PersonalCategory;
  /** 식별자가 그대로 들어 있는 칸 — 같음(=)으로 찾는다 */
  idColumns: string[];
  /** 식별자가 글 안에 들어 있을 수 있는 칸(JSON 문서·사유) — 경계가 맞는 문자열로 찾는다 */
  textColumns: string[];
  treatment: PrivacyTreatment;
  /** 보존 기한 설명 — 설정 키가 있으면 PERSONAL_RETENTION */
  retention: string;
  basis: string;
}

const SIGNED = '승인·서명 책임 기록 — 서명 검증과 책임 추적에 식별자가 필요하다(ISO 26262-8 cl.10·UN R156 SUMS 보존, GDPR Art.17(3)(b)·개인정보 보호법 제21조 단서). 열람·내보내기만, 보존 기한이 끝나면 가명 처리(D-RD-10)';

/** 플랫폼 개인정보 목록 — 저장소마다 정보주체·범주·처리 방법·보존. 새 표에 사용자·차량 식별자를 넣으면 여기에 적는다(백엔드 시험이 표를 확인한다) */
export const PERSONAL_DATA_INVENTORY: PersonalDataStore[] = [
  // 계정·세션 — 사용자가 떠나면 남길 이유가 없다
  { store: 'auth_session', subject: 'USER', category: 'ACCOUNT_SESSION', idColumns: ['sub'], textColumns: [], treatment: 'DELETE', retention: '만료 뒤 FF_RETENTION_SESSION_DAYS(기본 30일)', basis: 'OIDC 로그인 세션(sub·이름·이메일·부여 역할) — 로그인 유지 목적' },
  // 협업 — 개인 작업 공간
  { store: 'dashboard', subject: 'USER', category: 'COLLABORATION', idColumns: ['owner_id'], textColumns: [], treatment: 'DELETE', retention: '삭제 요청까지', basis: '내가 만든 대시보드(이름·판) — 개인 작업 공간' },
  { store: 'dashboard_star', subject: 'USER', category: 'COLLABORATION', idColumns: ['actor_id'], textColumns: [], treatment: 'DELETE', retention: '삭제 요청까지', basis: '대시보드 즐겨찾기' },
  { store: 'ext_link', subject: 'USER', category: 'COLLABORATION', idColumns: ['created_by'], textColumns: [], treatment: 'PSEUDONYMISE', retention: '연계가 남는 동안', basis: '외부 시스템 연결을 만든 사람 — 연결은 남기고 사람만 가명' },
  // 알림 — 받는 사람·읽음
  { store: 'notification_read', subject: 'USER', category: 'NOTIFICATION', idColumns: ['user_id'], textColumns: [], treatment: 'DELETE', retention: '알림과 같이', basis: '계정별 읽음 표시' },
  { store: 'notification_exclude', subject: 'USER', category: 'NOTIFICATION', idColumns: ['user_id'], textColumns: [], treatment: 'DELETE', retention: '알림과 같이', basis: '본인이 낸 알림 제외' },
  { store: 'notification_recipient', subject: 'USER', category: 'NOTIFICATION', idColumns: [], textColumns: ['rkey'], treatment: 'PSEUDONYMISE', retention: 'FF_RETENTION_NOTIFICATION_DAYS(기본 0 = 지우지 않음)', basis: '개인 수신자 키(user:…)' },
  { store: 'notification', subject: 'USER', category: 'NOTIFICATION', idColumns: [], textColumns: ['doc'], treatment: 'PSEUDONYMISE', retention: 'FF_RETENTION_NOTIFICATION_DAYS(기본 0 = 지우지 않음)', basis: '알림 본문의 요청자·승인자' },
  // 활동 기록 — 기록은 남기고 식별자만 가명
  { store: 'audit', subject: 'USER', category: 'ACTIVITY_LOG', idColumns: ['actor_id', 'target'], textColumns: ['reason', 'before_doc', 'after_doc'], treatment: 'PSEUDONYMISE', retention: '기록은 Safety Case 보존(지우지 않음), 식별자는 FF_RETENTION_AUDIT_IDENTITY_DAYS(기본 0 = 가명 처리 안 함)', basis: '감사 이력(FFG-PLT-015 추가 전용·해시 체인) — 행위자·대상·사유·전후 문서의 식별자만 가명, 체인 검증은 통과' },
  { store: 'events', subject: 'USER', category: 'ACTIVITY_LOG', idColumns: [], textColumns: ['payload'], treatment: 'PSEUDONYMISE', retention: 'FF_RETENTION_EVENT_DAYS(기본 0 = 지우지 않음, 결정 D-RD-9)', basis: '이벤트 이력·Data Lake 라벨 원천' },
  { store: 'idempotency', subject: 'USER', category: 'ACTIVITY_LOG', idColumns: [], textColumns: ['response'], treatment: 'PSEUDONYMISE', retention: 'FF_RETENTION_IDEMPOTENCY_DAYS(기본 7일)', basis: '재전송 응답 보관' },
  { store: 'otel_span', subject: 'USER', category: 'ACTIVITY_LOG', idColumns: [], textColumns: ['doc'], treatment: 'PSEUDONYMISE', retention: 'FF_RETENTION_SPAN_DAYS(기본 30일)', basis: '추적 스팬(IF-11)' },
  // 서명·승인 책임 기록 — 법정 보존
  { store: 'approver_key', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['user_id'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `승인자 공개키 — 지난 긴급 차단 승인 서명을 다시 검증한다. ${SIGNED}` },
  { store: 'procedure_completion', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['completed_by', 'undone_by'], textColumns: ['note', 'signature_doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `업무 절차 완료 서명. ${SIGNED}` },
  { store: 'feature_version', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['created_by'], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `Feature 작성자·Owner(Owner는 담당 교체로 바꾼다). ${SIGNED}` },
  { store: 'baseline', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['approved_by'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `BOM 기준선 승인자. ${SIGNED}` },
  { store: 'baseline_request', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['requested_by', 'decided_by'], textColumns: ['reason', 'decision_reason'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `기준선 확정 요청·결정. ${SIGNED}` },
  { store: 'product', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['created_by', 'config_approved_by', 'release_approved_by'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `상품 작성·승인. ${SIGNED}` },
  { store: 'policy_revision', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['changed_by'], textColumns: ['reason'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `정책 개정 이력(내용 해시). ${SIGNED}` },
  { store: 'validation_run', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['by_actor'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `정책 검증 실행자. ${SIGNED}` },
  { store: 'release_signoff', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['signed_by'], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `Release Sign-off 서명. ${SIGNED}` },
  { store: 'kill_request', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'SUMS 보존(시장 최장)', basis: `긴급 차단 요청·승인. ${SIGNED}` },
  { store: 'kill_command', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'SUMS 보존(시장 최장)', basis: `긴급 차단 명령의 승인 서명(승인자·역할이 서명 대상). ${SIGNED}` },
  { store: 'kill_post_review', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['reviewer'], textColumns: ['summary'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `긴급 권한 사후 검토. ${SIGNED}` },
  { store: 'gate_decision', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `Gate 판정 서명. ${SIGNED}` },
  { store: 'change_record', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `SW 변경 기록. ${SIGNED}` },
  { store: 'safety_metric_plan', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['recorded_by'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `안전 지표 계획 기록자. ${SIGNED}` },
  { store: 'rollback_request', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `되돌리기 요청·승인. ${SIGNED}` },
  { store: 'flag_retirement', subject: 'USER', category: 'SIGNED_RECORD', idColumns: [], textColumns: ['doc'], treatment: 'RETAIN_LEGAL', retention: 'Safety Case 보존', basis: `Flag Retirement 승인. ${SIGNED}` },
  { store: 'data_act_contract_basis', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['recorded_by'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '계약 기간', basis: `계약 근거 등록자. ${SIGNED}` },
  { store: 'privacy_subject', subject: 'USER', category: 'ACCOUNT_SESSION', idColumns: ['subject_id'], textColumns: [], treatment: 'DELETE', retention: '삭제 처리까지', basis: '사람 ↔ 가명 대응표(가명처리 추가 정보, 따로 둔다) — 삭제 처리 때 지워 가명을 되돌릴 수 없게 한다' },
  { store: 'privacy_subject', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['subject_id'], textColumns: [], treatment: 'DELETE', retention: '삭제 처리까지', basis: '차량 ↔ 가명 대응표 — 삭제 처리 때 지운다' },
  { store: 'privacy_request', subject: 'USER', category: 'SIGNED_RECORD', idColumns: ['requested_by', 'decided_by'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '처리 기록 보존', basis: '정보주체 요청 처리 기록(GDPR Art.5(2)·30) — 요청·결정한 담당자. 대상 식별자는 처리 뒤 가명만 남는다' },
  // 차량 소유자·운전자(VIN) — 개인과 연결될 수 있는 차량 기록
  { store: 'vehicle_request', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'DELETE', retention: '30일(보존 규칙 rules/retention.ts)', basis: '차량 발신 보고(문맥·고장·체험 수락) — 목적 달성 후 지체 없이 삭제(GDPR Art.5, PIPL)' },
  { store: 'vehicle_request_nonce', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'DELETE', retention: '허용 시각 창', basis: '차량 요청 재전송 방지 기록' },
  { store: 'vehicle_profile', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'DELETE', retention: '삭제 요청까지', basis: '성향 구간값(연령대·주행 성향·ADAS 사용) — 분석 목적' },
  { store: 'vehicle', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '차량 운행 기간', basis: 'Fleet 기준 정보 — 리콜·안전 시정 대상 식별(자동차관리법 제31조, UN R156)' },
  { store: 'entitlement', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '거래 기록 5년', basis: '구독·구매·체험 권한 — 거래 기록 보존(전자상거래법 제6조)' },
  { store: 'data_access_request', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '처리 기록 보존', basis: 'EU Data Act 접근 요청 처리 기록(FFG-TEL-006)' },
  { store: 'status_report', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '730일(보존 규칙, 열린 건은 보류)', basis: '운행 중 안전 데이터 — 시정 조치·검토(FFG-TEL-008)' },
  { store: 'readback', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '730일(보존 규칙)', basis: '적용 확인 — 시정 조치·검토(FFG-TEL-008)' },
  { store: 'vehicle_delivery', subject: 'VEHICLE', category: 'VEHICLE_LINKED', idColumns: ['vin'], textColumns: [], treatment: 'RETAIN_LEGAL', retention: '게시본과 같이', basis: '게시본 전달·확인 기록(UN R156 SUMS)' },
];

export const personalStores = (subject: PrivacySubjectKind) => PERSONAL_DATA_INVENTORY.filter((s) => s.subject === subject);

/** 개인정보 범주별 보존 기한 — 하루 한 번 운영 보조 정리(kernel/housekeeping.service.ts)가 함께 돈다. 0 = 지우지(가명 처리하지) 않는다 */
export interface PersonalRetention {
  key: 'session' | 'notification' | 'audit_identity' | 'events';
  store: string;
  env: string;
  defaultDays: number;
  action: 'DELETE' | 'PSEUDONYMISE';
  basis: string;
  /** 사용자 결정이 남은 기본값 */
  decision?: string;
}

export const PERSONAL_RETENTION: PersonalRetention[] = [
  { key: 'session', store: 'auth_session', env: 'FF_RETENTION_SESSION_DAYS', defaultDays: 30, action: 'DELETE', basis: '끝난 로그인 세션(만료 시각 기준) — 로그인 문제 조사 여유' },
  { key: 'notification', store: 'notification', env: 'FF_RETENTION_NOTIFICATION_DAYS', defaultDays: 0, action: 'DELETE', basis: '화면 알림·받는 사람·읽음 — 알림은 이벤트 이력의 사본이라 고객 정책으로만 줄인다' },
  { key: 'audit_identity', store: 'audit', env: 'FF_RETENTION_AUDIT_IDENTITY_DAYS', defaultDays: 0, action: 'PSEUDONYMISE', basis: '감사 이력은 지우지 않는다(Safety Case 보존). 이 기한이 지난 행의 사람 행위자 식별만 가명으로 바꾼다 — 0 = 실명 유지' },
  { key: 'events', store: 'events', env: 'FF_RETENTION_EVENT_DAYS', defaultDays: 0, action: 'DELETE', basis: '이벤트 이력 — 화면 이력·알림·Data Lake 라벨 원천. 보존 일수는 사용자 결정 대기(D-RD-9)', decision: 'D-RD-9' },
];

/** 보존 일수 — 숫자가 아니거나 음수면 기본값, 0이면 지우지 않는다 */
export function personalRetentionDays(p: Pick<PersonalRetention, 'env' | 'defaultDays'>, env: Record<string, string | undefined>): number {
  const raw = env[p.env];
  if (raw === undefined || raw.trim() === '') return p.defaultDays;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : p.defaultDays;
}

// ── 정보주체 요청 ─────────────────────────────────────────────────────────────

/** Data Lake 삭제 근거(80-75 §7 ErasureRequest.basis)와 같은 값 + 사용자 퇴직 */
export const ERASURE_BASES = ['DATA_SUBJECT_REQUEST', 'CONSENT_WITHDRAWN', 'CONTRACT_END', 'EMPLOYMENT_END'] as const;
export type ErasureBasis = (typeof ERASURE_BASES)[number];

const SubjectId = z.string().trim().min(2).max(200);

export const PrivacyExportBody = z.object({ subjectKind: z.enum(PRIVACY_SUBJECT_KINDS), subjectId: SubjectId, reason: z.string().trim().min(2).max(500) }).strict();
export type PrivacyExportBody = z.infer<typeof PrivacyExportBody>;

export const ErasureRequestBody = z.object({ subjectKind: z.enum(PRIVACY_SUBJECT_KINDS), subjectId: SubjectId, basis: z.enum(ERASURE_BASES), reason: z.string().trim().min(2).max(500) }).strict();
export type ErasureRequestBody = z.infer<typeof ErasureRequestBody>;

export const ErasureExecuteBody = z.object({}).strict();
export const ErasureRejectBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();

export type PrivacyRequestStatus = 'REQUESTED' | 'DONE' | 'REJECTED';

export interface ErasureResult {
  deleted: Record<string, number>;
  pseudonymised: Record<string, number>;
  retained: Record<string, number>;
  /** 감사 이력에서 식별자를 가명으로 바꾼 행 수(체인은 그대로) */
  auditRows: number;
  /** Data Lake 삭제 요청(VEHICLE만) — SENT: Lake가 받음, NOT_CONNECTED: Lake 연결 전(설정이 생기면 다시 보낸다), FAILED: 보냈지만 실패 */
  lake: { status: 'SENT' | 'NOT_CONNECTED' | 'FAILED' | 'NOT_APPLICABLE'; lakeRequestId: string | null; detail: string | null };
}

export interface PrivacyRequestView {
  requestId: string;
  subjectKind: PrivacySubjectKind;
  /** 처리가 끝나면(완료·거절) 지운다 — 가명만 남는다 */
  subjectId: string | null;
  pseudonym: string;
  basis: ErasureBasis;
  reason: string;
  status: PrivacyRequestStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** 요청 때 센 저장소별 대상 행 수 */
  preview: Record<string, number>;
  result: ErasureResult | null;
}

/** 가명 — psn- + 16자리 16진수(무작위). 같은 사람은 같은 가명(privacy_subject 대응표, 삭제 때 대응표를 지운다) */
export const PSEUDONYM = /^psn-[0-9a-f]{16}$/;
export const isPseudonym = (s: string) => PSEUDONYM.test(s);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * 식별자 경계 — 앞뒤가 영문·숫자·_·@·-·.(다음이 영숫자일 때)가 아니어야 같은 식별자다(usr-kim이 usr-kim2·x.usr-kim@a.b에 걸리지 않게).
 * 한글은 경계로 본다 — 식별자 바로 뒤에 조사가 붙는다("usr-kim의 승인 요청").
 */
const pattern = (needles: readonly string[]) => new RegExp(`(?<![A-Za-z0-9_@.-])(?:${[...needles].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9_@-]|\\.[A-Za-z0-9])`, 'g');

/** 글 안에 식별자가 있는가 */
export function mentionsIdentifier(text: string | null | undefined, needles: readonly string[]): boolean {
  const xs = needles.filter((n) => n.length >= 2);
  return !!text && xs.length > 0 && pattern(xs).test(text);
}

/** 글 안의 식별자를 가명으로 바꾼다 — JSON 문서도 그대로 유효하다(식별자에 따옴표·역슬래시가 없을 때) */
export function redactIdentifiers(text: string, needles: readonly string[], pseudonym: string): string {
  const xs = needles.filter((n) => n.length >= 2 && !/["\\]/.test(n));
  return xs.length ? text.replace(pattern(xs), pseudonym) : text;
}
