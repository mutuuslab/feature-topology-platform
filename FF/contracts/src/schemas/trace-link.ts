// Feature 추적 연결(FR-DEP-005~008, FR-DEP-002-004) — Feature ID에 요구사항·아키텍처 설계 요소·인터페이스 요소·Test Case·OTA 패키지 식별자를 잇는다.
// 연결은 Feature ID 단위(Version을 넘어 유지)이고, 해제해도 지우지 않는다(해제한 사람·시각·사유가 이력으로 남는다).
// Test Evidence는 연결된 Test Case마다 추가만 한다(FR-REG-005-004 Verification Gate가 '필수 Test Case별 Evidence'로 읽는 모델).
import { z } from 'zod';

export const TRACE_KINDS = ['REQUIREMENT', 'ARCHITECTURE', 'INTERFACE', 'TEST_CASE', 'OTA'] as const;
export const TraceKind = z.enum(TRACE_KINDS);
export type TraceKind = z.infer<typeof TraceKind>;

/** 종류별 요소 유형 — 요구(시스템·SW), 설계 요소(HW·SW), 인터페이스(API·Signal·DTC·Event), 검증 유형, OTA(SW 패키지) */
export const TRACE_ELEMENT_TYPES = {
  REQUIREMENT: ['SYSTEM', 'SW'],
  ARCHITECTURE: ['HW', 'SW'],
  INTERFACE: ['API', 'SIGNAL', 'DTC', 'EVENT'],
  TEST_CASE: ['FUNCTIONAL', 'REGRESSION', 'VIRTUAL', 'HIL', 'VEHICLE'],
  OTA: ['SW_PACKAGE'],
} as const satisfies Record<TraceKind, readonly string[]>;

/** 종류별 출처 시스템 — ALM·codeBeamer(IF-01), 기준정보 PLM(IF-02), 인터페이스 정의 도구, TMS(IF-09), SW 패키지 저장소 */
export const TRACE_SOURCES = {
  REQUIREMENT: ['CODEBEAMER', 'ALM'],
  ARCHITECTURE: ['PLM'],
  INTERFACE: ['IDT'],
  TEST_CASE: ['TMS'],
  OTA: ['SW_REPO'],
} as const satisfies Record<TraceKind, readonly string[]>;

export const TraceLinkStatus = z.enum(['ACTIVE', 'UNLINKED']);
export type TraceLinkStatus = z.infer<typeof TraceLinkStatus>;
/** 출처 존재 확인 — VERIFIED(등록 때 출처에서 찾음) · NOT_CHECKED(요구 식별자: ALM 조회 검증은 연계 묶음 몫) */
export const TraceExistence = z.enum(['VERIFIED', 'NOT_CHECKED']);

const elementId = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, '식별자는 영문·숫자·. _ : @ / - 만');

export const CreateTraceLinkBody = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    kind: TraceKind,
    elementId,
    elementType: z.string().min(2).max(20),
    /** 비우면 출처의 이름·버전으로 채운다 */
    elementName: z.string().trim().min(1).max(200).nullable().default(null),
    elementVersion: z.string().trim().min(1).max(40).nullable().default(null),
    sourceSystem: z.string().min(2).max(20),
    /** 필수 Test Case 여부 — TEST_CASE만 */
    required: z.boolean().nullable().default(null),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (!(TRACE_ELEMENT_TYPES[b.kind] as readonly string[]).includes(b.elementType))
      ctx.addIssue({ code: 'custom', path: ['elementType'], message: `${b.kind} 유형은 ${TRACE_ELEMENT_TYPES[b.kind].join('·')} 중 하나` });
    if (!(TRACE_SOURCES[b.kind] as readonly string[]).includes(b.sourceSystem))
      ctx.addIssue({ code: 'custom', path: ['sourceSystem'], message: `${b.kind} 출처는 ${TRACE_SOURCES[b.kind].join('·')} 중 하나` });
    if (b.kind === 'TEST_CASE' && b.required === null) ctx.addIssue({ code: 'custom', path: ['required'], message: 'Test Case는 필수 여부를 정한다' });
    if (b.kind !== 'TEST_CASE' && b.required !== null) ctx.addIssue({ code: 'custom', path: ['required'], message: '필수 여부는 Test Case만' });
  });
export type CreateTraceLinkBody = z.infer<typeof CreateTraceLinkBody>;

export const UnlinkTraceLinkBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type UnlinkTraceLinkBody = z.infer<typeof UnlinkTraceLinkBody>;

export const TestResult = z.enum(['PASS', 'FAIL', 'BLOCKED']);
export type TestResult = z.infer<typeof TestResult>;

/** Test Evidence 등록(FR-DEP-008-003) — Evidence 식별자·실행 일시·결과·실행 환경. 등록자는 요청 계정 */
export const CreateTestEvidenceBody = z
  .object({
    evidenceId: elementId,
    executedAt: z.string().datetime({ offset: true }),
    result: TestResult,
    environment: z.string().trim().min(2).max(120),
  })
  .strict();
export type CreateTestEvidenceBody = z.infer<typeof CreateTestEvidenceBody>;

export interface TraceLinkRow {
  linkId: string;
  featureId: string;
  kind: TraceKind;
  elementId: string;
  elementType: string;
  elementName: string | null;
  elementVersion: string | null;
  sourceSystem: string;
  required: boolean | null;
  existence: z.infer<typeof TraceExistence>;
  /** 출처 조회 기록(외부 연계 호출 키) */
  sourceRef: string | null;
  status: TraceLinkStatus;
  linkedBy: string;
  linkedAt: string;
  unlinkedBy: string | null;
  unlinkedAt: string | null;
  unlinkReason: string | null;
}

export interface TestEvidenceRow {
  recordId: string;
  linkId: string;
  featureId: string;
  testCaseId: string;
  evidenceId: string;
  executedAt: string;
  result: TestResult;
  environment: string;
  registeredBy: string;
  registeredAt: string;
}
