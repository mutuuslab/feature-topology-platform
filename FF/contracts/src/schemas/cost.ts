// SW 개발비 산정 API(20-94 §5·§7, D07-01) — 요청 본문, 역할별 열람(금액은 산정 역할만, D-COST-4), 상태 전이.
import { z } from 'zod';
import { Asil, ROLES, type Role } from '../enums';
import { patchOf } from './patch';
import { DIRECT_PRESET, RATE_BASES, type CostEstimate, type CostSettings } from '../rules/cost/engine';

/** 금액을 보는 역할 — 그 밖의 역할은 공수(M/M)만 본다(서버가 직렬화 전에 뺀다) */
export const COST_MONEY_ROLES: readonly Role[] = ['COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN'];
export const canSeeCost = (role: Role) => COST_MONEY_ROLES.includes(role);
/** 과제 조회 역할 — 사람 역할 전부, 산정 역할을 앞에(같은 계정이 산정 역할을 가지면 그 역할로 읽어 금액을 본다 — actorFor) */
export const COST_READ_ROLES: Role[] = [...COST_MONEY_ROLES, ...ROLES.filter((r) => !COST_MONEY_ROLES.includes(r) && r !== 'VEHICLE' && r !== 'SYSTEM')];

export const COST_PROJECT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'] as const;
export const CostProjectStatus = z.enum(COST_PROJECT_STATUSES);
export type CostProjectStatus = z.infer<typeof CostProjectStatus>;

const ratio = z.number().min(0).max(10);

/** 엑셀 03 입력 목록(데이터 유효성 검사와 같은 값) */
export const COST_PRIORITIES = ['필수', '선택', '후순위'] as const;
export const COST_OWNED = ['보유', '미보유', '불명'] as const;
export const COST_LINE_REVIEW = ['미검토', '검토중', '확정'] as const;
/** 07_검토체크리스트 상태 — 완료율 = 확인 ÷ (전체 − 해당 없음) */
export const COST_CHECK_STATUSES = ['미확인', '확인', '보완 필요', '해당 없음'] as const;
export const CostCheckStatus = z.enum(COST_CHECK_STATUSES);
export type CostCheckStatus = z.infer<typeof CostCheckStatus>;
const mm = z.number().min(0).max(100_000);

/** 과제 설정 — 엑셀 02_프로젝트설정 1·2·4·5·6절 */
export const CostSettingsInput = z
  .object({
    aace: z.string().default('Class 4'),
    confidence: z.string().default('P80'),
    preset: z.string().default(DIRECT_PRESET),
    drivers: z.record(z.string(), z.string().nullable()).default({}),
    rateBasis: z.enum(RATE_BASES).default('KOSA SW기술자 평균임금'),
    method: z.string().default('사용자 정의'),
    ohOverride: ratio.nullable().default(null),
    feeOverride: ratio.nullable().default(null),
    common: z
      .object({ pm: z.boolean(), scm: z.boolean(), pi: z.boolean(), qa: mm.nullable(), fs: mm.nullable(), cs: mm.nullable(), hil: mm.nullable() })
      .default({ pm: true, scm: true, pi: true, qa: 0, fs: 0, cs: 0, hil: 0 }),
    /** 계수 표 directExpenseItems 순서(엑셀 62~69행) — 내보내기는 i번째 행에 쓴다 */
    directExpenses: z.array(z.object({ item: z.string().max(100), qty: z.number().min(0).nullable(), unitPrice: z.number().min(0).nullable() }).strict()).max(8).default([]),
  })
  .strict();
export type CostSettingsInput = z.infer<typeof CostSettingsInput>;

/** 저장된 과제 설정 → 엔진 설정 — 빠진 칸은 null(엔진이 0으로 본다) */
export function costEngineSettings(s: CostSettingsInput): CostSettings {
  return {
    ...s,
    ohOverride: s.ohOverride ?? null,
    feeOverride: s.feeOverride ?? null,
    common: { pm: s.common.pm, scm: s.common.scm, pi: s.common.pi, qa: s.common.qa ?? null, fs: s.common.fs ?? null, cs: s.common.cs ?? null, hil: s.common.hil ?? null },
    directExpenses: s.directExpenses.map((d) => ({ qty: d.qty ?? null, unitPrice: d.unitPrice ?? null })),
  };
}

export const CreateCostProjectBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    /** 대상 제어기·차종·변형 — 엑셀 02 '대상 제어기·차종' */
    target: z.string().trim().max(300).default(''),
    /** 과제 통화(D-COST-10) — 계산은 원화, 표시만 환산. 계수 표의 환율 목록에 있어야 한다 */
    currency: z.string().length(3).default('KRW'),
    settings: CostSettingsInput.default(CostSettingsInput.parse({})),
  })
  .strict();
export type CreateCostProjectBody = z.infer<typeof CreateCostProjectBody>;

/** DRAFT 과제 수정 — useLatestBasis면 최신 발행 계수 표·Feature DB 발행으로 다시 맞춘다(§6.4) */
export const UpdateCostProjectBody = patchOf(CreateCostProjectBody.extend({ settings: CostSettingsInput }))
  .extend({ useLatestBasis: z.literal(true).optional() })
  .strict();
export type UpdateCostProjectBody = z.infer<typeof UpdateCostProjectBody>;

/** FF Feature 담기(D-COST-9) — 그 버전의 Feature DB 연결(대표 + 포함)이 기준 행마다 한 줄로 펼쳐진다 */
export const AddCostFeatureBody = z.object({ featureId: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict();
export type AddCostFeatureBody = z.infer<typeof AddCostFeatureBody>;

/** 줄 입력 — 엑셀 03_FeatureDB AF~AQ열 */
export const UpdateCostLineBody = z
  .object({
    qty: z.number().min(0).max(1000).nullable(),
    changeType: z.string().max(40).nullable(),
    asil: Asil.nullable(),
    variants: z.number().int().min(0).max(100).nullable(),
    m: mm.nullable(),
    o: mm.nullable(),
    p: mm.nullable(),
    priority: z.enum(COST_PRIORITIES).nullable(),
    owned: z.enum(COST_OWNED).nullable(),
    actual: mm.nullable(),
    reviewStatus: z.enum(COST_LINE_REVIEW).nullable(),
    memo: z.string().max(500).nullable(),
  })
  .partial()
  .strict();
export type UpdateCostLineBody = z.infer<typeof UpdateCostLineBody>;
export type CostLineInputs = UpdateCostLineBody;

/** MBD 복잡도 작업 단위(12 시트) — 한 기준 행의 작업 행 목록을 통째로 바꾼다 */
export const PutCostMbdBody = z.object({ items: z.array(z.object({ counts: z.array(z.number().int().min(0).max(1000).nullable()).length(5) }).strict()).max(50) }).strict();
export type PutCostMbdBody = z.infer<typeof PutCostMbdBody>;

/** 전이 — 제출(작성자) · 승인/반려(승인자, SOD-16) · 개정(승인된 과제를 DRAFT로 다시 — 새 rev) */
export const COST_TRANSITIONS = [
  { from: 'DRAFT', to: 'SUBMITTED', action: 'SUBMIT', roles: ['COST_ESTIMATOR'] },
  { from: 'SUBMITTED', to: 'APPROVED', action: 'APPROVE', roles: ['COST_APPROVER'] },
  { from: 'SUBMITTED', to: 'DRAFT', action: 'REJECT', roles: ['COST_APPROVER'] },
  { from: 'APPROVED', to: 'DRAFT', action: 'REVISE', roles: ['COST_ESTIMATOR'] },
] as const satisfies readonly { from: CostProjectStatus; to: CostProjectStatus; action: string; roles: readonly Role[] }[];
export const CostTransitionBody = z.object({ action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'REVISE']), reason: z.string().trim().min(2).max(500) }).strict();
export type CostTransitionBody = z.infer<typeof CostTransitionBody>;

/** 계수 표 새 버전(DRAFT) — 원가 기준 관리자. 앞 버전을 복사해 바꾼 전체 표를 보낸다 */
export const CostBasisDraftBody = z.object({ basis: z.record(z.string(), z.unknown()), note: z.string().trim().min(2).max(500) }).strict();
export type CostBasisDraftBody = z.infer<typeof CostBasisDraftBody>;

/** 검토 체크리스트 한 항목 — 작성자·승인자(DRAFT·SUBMITTED) */
export const PutCostCheckBody = z.object({ status: CostCheckStatus, memo: z.string().max(500).default('') }).strict();
export type PutCostCheckBody = z.infer<typeof PutCostCheckBody>;

/** 완료율 — 엑셀 07 D5와 같은 식: 확인 ÷ (항목 수 − 해당 없음). 항목이 모두 해당 없음이면 null */
export function costCheckRate(statuses: readonly CostCheckStatus[]): number | null {
  const applicable = statuses.filter((x) => x !== '해당 없음').length;
  return applicable === 0 ? null : statuses.filter((x) => x === '확인').length / applicable;
}

// ── 역할별 열람(MM_ONLY) ───────────────────────────────────────

/** 계산 결과를 역할에 맞춘다 — 금액을 볼 수 없는 역할에는 원화·단가·벤치마크 값을 아예 빼고 보낸다(빈 값으로도 두지 않는다) */
export function costEstimateView(r: CostEstimate, role: Role) {
  if (canSeeCost(role)) return { ...r, view: 'FULL' as const };
  return {
    view: 'MM_ONLY' as const,
    lines: r.lines.map(({ laborKrw: _l, benchEur: _b, ...rest }) => rest),
    mbdItems: r.mbdItems,
    factors: { drivers: r.factors.drivers, eaf: r.factors.eaf, mmPerPt: r.factors.mmPerPt, mbdHours: r.factors.mbdHours },
    common: { rows: r.common.rows.map(({ item, mm }) => ({ item, mm })), mm: r.common.mm },
    totals: { eFeat: r.totals.eFeat, mFeat: r.totals.mFeat, sd: r.totals.sd, cv: r.totals.cv, z: r.totals.z, totalMm: r.totals.totalMm },
    counts: r.counts,
    sizeEvidenceShare: r.sizeEvidenceShare,
    effortRatio: r.effortRatio,
  };
}
export type CostEstimateView = ReturnType<typeof costEstimateView>;

/** 과제 설정의 금액(직접경비 단가) — 금액을 볼 수 없는 역할에는 뺀다 */
export function costSettingsView(s: CostSettingsInput, role: Role) {
  if (canSeeCost(role)) return s;
  return { ...s, directExpenses: s.directExpenses.map(({ item, qty }) => ({ item, qty })) };
}
