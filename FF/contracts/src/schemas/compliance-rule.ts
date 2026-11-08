// 컴플라이언스 룰 레지스트리(D03-01, 기능명세서 FR-CRC-001) — 지역별 법규·개인정보·안전·보안 제약을 룰로 등록·승인·버전 관리하고
// 정책 배포 검증(FR-CRC-002)의 기준으로 쓴다. 적용 지역은 지역 코드 체계(결정 대기 D8) 대신 기존 시장 구분(MARKETS)이다.
// 검증 기준은 플랫폼이 판정할 수 있는 항목 표(COMPLIANCE_CHECKS)에서 고른다 — 판정 로직은 rules/compliance-rule.ts.
import { z } from 'zod';
import { Asil, GATES } from '../enums';
import { CALS } from '../rules/gate-evidence';
import { MARKETS } from './wire';
import type { AccountState, OwnerTransfer } from '../rules/owner-authz';
import { regionCodeIssues } from '../rules/region-code';

export const COMPLIANCE_RULE_TYPES = ['LEGAL', 'PRIVACY', 'SAFETY', 'SECURITY'] as const;
export type ComplianceRuleType = (typeof COMPLIANCE_RULE_TYPES)[number];

export const COMPLIANCE_RULE_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED', 'RETIRED'] as const;
export type ComplianceRuleStatus = (typeof COMPLIANCE_RULE_STATUSES)[number];

/** 검증 기준 항목 — 정책 배포 검증 입력(정책·Feature·Gate·시장 Profile·TARA)으로 판정할 수 있는 것만 */
export const COMPLIANCE_CHECKS = ['SAFE_DEFAULT_OFF', 'STAGED_ROLLOUT', 'REQUIREMENT_TRACE', 'GATE_PASS', 'ENTITLEMENT_REQUIRED', 'NO_VEHICLE_ID_TARGETING', 'MARKET_PROFILE_CONFIRMED', 'TARA_RECORDED'] as const;
export type ComplianceCheck = (typeof COMPLIANCE_CHECKS)[number];

/** 배포 유형 = 정책 rollout 방식 */
export const COMPLIANCE_ROLLOUT_MODES = ['ALL', 'COHORT', 'NONE'] as const;

/** 룰 등록·수정 역할 — 법규 담당·기능안전·사이버보안. 승인은 이 역할 중 룰에 지정된 승인 대상자 본인만(작성자 제외) */
export const COMPLIANCE_RULE_ROLES = ['REGULATORY_OWNER', 'SAFETY_OFFICER', 'SECURITY_OFFICER'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z
  .string()
  .regex(DAY, '날짜는 YYYY-MM-DD로 적으세요.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, '없는 날짜입니다.');

export const ComplianceRuleId = z
  .string()
  .trim()
  .max(32)
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+){1,4}$/, '룰 ID는 영문 대문자·숫자를 하이픈으로 잇습니다(예: CR-SAF-001).');

/** http·https만 — 형식이 틀리면 저장하지 않는다(FR-CRC-001-007) */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && /^https?:\/\//i.test(v);
    } catch {
      return false;
    }
  }, 'URL은 http:// 또는 https://로 시작하는 주소여야 합니다.');

const opt = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);

/** 근거 정보 — URL·문서명·조항 번호·메모를 나눠 받는다(FR-CRC-001-006). URL 또는 문서명 하나는 있어야 한다 */
export const ComplianceEvidence = z
  .object({ url: httpUrl.nullable().default(null), docName: opt(200), clause: opt(100), memo: opt(1000) })
  .strict()
  .refine((e) => !!(e.url || e.docName), { message: '근거 정보(URL 또는 문서명)를 하나 이상 입력하세요.', path: ['docName'] });
export type ComplianceEvidence = z.infer<typeof ComplianceEvidence>;

export const ComplianceCriterion = z
  .object({ check: z.enum(COMPLIANCE_CHECKS), gate: z.enum(GATES).optional() })
  .strict()
  .refine((c) => (c.check === 'GATE_PASS') === !!c.gate, { message: 'Gate 통과 기준은 Gate를 하나 고르고, 다른 기준에는 Gate를 적지 않습니다.', path: ['gate'] });
export type ComplianceCriterion = z.infer<typeof ComplianceCriterion>;

/** 적용 범위 — 지역(시장)은 필수, 나머지는 빈 목록이면 모두(FR-CRC-002-001: Feature·지역·배포 유형·Safety/Security 등급) */
export const ComplianceScope = z
  .object({
    markets: z.array(z.enum(MARKETS)).min(1, '적용 지역을 하나 이상 고르세요.').max(MARKETS.length),
    featureIds: z.array(z.string().regex(/^FEAT-\d{5}$/, 'Feature ID 형식(FEAT-00000)이 아닙니다.')).max(50).default([]),
    rolloutModes: z.array(z.enum(COMPLIANCE_ROLLOUT_MODES)).max(3).default([]),
    asil: z.array(Asil).max(5).default([]),
    cal: z.array(z.enum(CALS)).max(4).default([]),
    /** 적용 지역 코드(1~9·A~D·G, rules/region-code.ts) — 선택. 코드의 시장은 markets에 있어야 한다(FR-CRC-001-002) */
    regionCodes: z.array(z.string().trim().max(2)).max(14).default([]),
  })
  .strict();
export type ComplianceScope = z.infer<typeof ComplianceScope>;

const fields = {
  name: z.string().trim().min(2, '룰 명칭을 2자 이상 입력하세요.').max(120),
  type: z.enum(COMPLIANCE_RULE_TYPES),
  scope: ComplianceScope,
  criteria: z.array(ComplianceCriterion).min(1, '검증 기준을 하나 이상 고르세요.').max(8),
  approverIds: z.array(z.string().trim().min(2).max(80)).min(1, '승인 대상자를 한 명 이상 지정하세요.').max(5),
  evidence: ComplianceEvidence,
  validFrom: day,
  validTo: day.nullable().default(null),
};

const datesOk = (v: { validFrom?: string; validTo?: string | null }, ctx: z.RefinementCtx) => {
  if (v.validFrom && v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', message: '유효 종료일은 유효 시작일보다 빠를 수 없습니다.', path: ['validTo'] });
};
/** 적용 지역 코드 — 체계 밖·중복·시장 불일치면 사유와 함께 거부 @req FR-CRC-001-002 */
const regionOk = (v: { scope?: { markets: string[]; regionCodes?: string[] } }, ctx: z.RefinementCtx) => {
  for (const message of v.scope ? regionCodeIssues(v.scope.regionCodes ?? [], v.scope.markets) : []) ctx.addIssue({ code: 'custom', message, path: ['scope', 'regionCodes'] });
};

/**
 * 등록 — 룰 ID는 등록한 뒤 바꾸지 않는다. 필수 정보·근거(URL·문서명·조항·메모)·유효 기간(종료일 없음 = 무기한, 종료일 ≥ 시작일)
 * @req FR-CRC-001-001, FR-CRC-001-005, FR-CRC-001-006, FR-CRC-001-007, FR-CRC-001-008, FR-CRC-001-009
 */
export const CreateComplianceRuleBody = z
  .object({ ruleId: ComplianceRuleId, ...fields, reason: z.string().trim().min(2).max(500).optional() })
  .strict()
  .superRefine((v, ctx) => {
    datesOk(v, ctx);
    regionOk(v, ctx);
  });
export type CreateComplianceRuleBody = z.infer<typeof CreateComplianceRuleBody>;

/** 수정 — 바꿀 항목만, 사유는 필수. 승인된 룰을 고치면 다시 제안 상태(FR-CRC-001-021) */
export const UpdateComplianceRuleBody = z
  .object({
    name: fields.name.optional(),
    type: fields.type.optional(),
    scope: ComplianceScope.optional(),
    criteria: fields.criteria.optional(),
    approverIds: fields.approverIds.optional(),
    evidence: ComplianceEvidence.optional(),
    validFrom: day.optional(),
    validTo: day.nullable().optional(),
    reason: z.string().trim().min(2, '수정 사유를 2자 이상 입력하세요.').max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!Object.keys(v).some((k) => k !== 'reason')) ctx.addIssue({ code: 'custom', message: '바꿀 항목을 하나 이상 넣으세요.', path: [] });
    datesOk(v, ctx);
    regionOk(v, ctx);
  });
export type UpdateComplianceRuleBody = z.infer<typeof UpdateComplianceRuleBody>;

export const ComplianceApprovalRequestBody = z.object({ note: z.string().trim().min(2).max(500).optional() }).strict();
export type ComplianceApprovalRequestBody = z.infer<typeof ComplianceApprovalRequestBody>;

export const ComplianceDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500) }).strict();
export type ComplianceDecisionBody = z.infer<typeof ComplianceDecisionBody>;

/** 룰 내용(버전마다 보존하는 부분) */
export type ComplianceRuleContent = Omit<CreateComplianceRuleBody, 'ruleId' | 'reason'>;

/** 저장된 룰 — 현재 버전 */
export interface ComplianceRule extends ComplianceRuleContent {
  ruleId: string;
  /** Major.Minor */
  version: string;
  status: ComplianceRuleStatus;
  /** 수정 권한이 있는 소유자(등록자) */
  ownerId: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  retiredAt: string | null;
}

/** 버전 행 — 버전마다 내용·상태를 보존(FR-CRC-001-023) */
export interface ComplianceRuleVersion {
  ruleId: string;
  version: string;
  status: ComplianceRuleStatus;
  content: ComplianceRuleContent;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

/** 변경 이력 한 줄 — 등록·수정·승인·반려·만료(FR-CRC-001-022) */
export interface ComplianceRuleChange {
  id: number;
  ruleId: string;
  version: string;
  action: 'CREATE' | 'UPDATE' | 'REQUEST' | 'APPROVE' | 'REJECT' | 'RETIRE';
  field: string;
  before: unknown;
  after: unknown;
  by: string;
  at: string;
  reason: string | null;
}

/** 승인 요청 — 요청자·대상 룰(버전)·승인 대상자·요청 일시(FR-CRC-001-014), 결과(FR-CRC-001-015) */
export interface ComplianceApprovalRequest {
  requestId: string;
  ruleId: string;
  version: string;
  requestedBy: string;
  approverIds: string[];
  requestedAt: string;
  note: string | null;
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface ComplianceRuleDetail {
  rule: ComplianceRule;
  versions: ComplianceRuleVersion[];
  changes: ComplianceRuleChange[];
  requests: ComplianceApprovalRequest[];
  /** 소유자 계정 상태(F0) — 없거나 비활성이면 시스템 관리자가 소유자를 이관할 수 있다 */
  ownerState?: AccountState;
  /** 소유자 이관 이력(추가만, 오래된 순) */
  ownerTransfers?: OwnerTransfer[];
}
