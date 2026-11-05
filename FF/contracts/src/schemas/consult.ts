// 검토 포털 협의 요청(업무 절차의 협의 C) — 다른 부서가 구매·법무·개인정보보호 부서에 의견을 구하는 건.
// 한 건 = 대상(Feature·협력사 납품 패키지·정책·기준 행) + 요청 부서 + 기한 + 살펴볼 것. 포털 부서는 동의·보완·반대 의견과 메모를 남긴다.
// 근거 활동(activityId)은 업무 절차 모델에서 그 부서 역할이 협의(C)·통보(I)인 활동이어야 한다(서버가 확인) — 화면에는 코드를 보이지 않는다.
import { z } from 'zod';
import { DEPARTMENTS } from '../generated/departments';

const text = z.string().trim();
const required = text.min(1);

/** 협의 요청 번호 — CON-연도-일련번호 */
export const ConsultId = z.string().regex(/^CON-\d{4}-\d{3,}$/);

/** 검토 포털 부서(업무 절차 모델의 workspace=portal) — 표는 생성 파일이 원천이다 */
export const CONSULT_DEPARTMENTS: readonly string[] = DEPARTMENTS.departments.filter((d) => d.workspace === 'portal').map((d) => d.id);
/** 모든 부서 ID — 요청 부서 확인 */
export const DEPARTMENT_IDS: readonly string[] = DEPARTMENTS.departments.map((d) => d.id);
/** 부서의 업무 절차 역할(R-PUR …) */
export const departmentRoles = (deptId: string): readonly string[] => DEPARTMENTS.departments.find((d) => d.id === deptId)?.roles ?? [];
export const departmentName = (deptId: string): string => DEPARTMENTS.departments.find((d) => d.id === deptId)?.name ?? deptId;

const PortalDept = z.string().refine((d) => CONSULT_DEPARTMENTS.includes(d), { message: '검토 포털 부서(구매·법무·개인정보보호)만 협의 요청을 받습니다.' });
const AnyDept = z.string().refine((d) => DEPARTMENT_IDS.includes(d), { message: '업무 절차 모델의 부서가 아닙니다.' });

/** 협의 대상 — Feature 버전·협력사 납품 패키지·정책·Feature DB 기준 행 */
export const CONSULT_TARGET_KINDS = ['FEATURE', 'SUPPLIER_PACKAGE', 'POLICY', 'REF'] as const;
export const ConsultTargetKind = z.enum(CONSULT_TARGET_KINDS);
export type ConsultTargetKind = z.infer<typeof ConsultTargetKind>;

/** 의견 — 동의·보완·반대(Feature DB 도메인 검토와 같은 낱말) */
export const CONSULT_OPINIONS = ['AGREE', 'REVISE', 'OPPOSE'] as const;
export const ConsultOpinion = z.enum(CONSULT_OPINIONS);
export type ConsultOpinion = z.infer<typeof ConsultOpinion>;

/** 상태 — 의견 대기 · 의견 받음 */
export const ConsultStatus = z.enum(['OPEN', 'ANSWERED']);
export type ConsultStatus = z.infer<typeof ConsultStatus>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식입니다.');

export const ConsultOpinionEntry = z.object({
  opinion: ConsultOpinion,
  memo: required,
  by: required,
  department: required,
  at: z.string(),
});
export type ConsultOpinionEntry = z.infer<typeof ConsultOpinionEntry>;

/** 협의 요청(consultation.doc) */
export const Consultation = z.object({
  consultId: ConsultId,
  /** 근거 업무 절차 활동(협의 C·통보 I) — 없으면 null(모델 밖 임시 협의) */
  activityId: text.nullable(),
  targetKind: ConsultTargetKind,
  targetId: required,
  /** 대상 이름(사람이 읽는 이름) */
  targetName: required,
  /** 한 줄 요약 — 포털 홈 목록 */
  summary: required,
  /** 살펴볼 것 — '검토할 것 한 장' */
  checks: z.array(required).min(1),
  /** 대상 화면 경로(/features/… · /supplier/portal?supplier=…) */
  link: text.nullable(),
  fromDept: required,
  toDept: required,
  requestedBy: required,
  requestedAt: z.string(),
  dueAt: isoDate,
  status: ConsultStatus,
  /** 의견 — 최신이 끝. 같은 부서가 다시 내면 덧붙는다(이력 보존) */
  opinions: z.array(ConsultOpinionEntry),
});
export type Consultation = z.infer<typeof Consultation>;

/** 협의 요청 만들기 — 요청 부서가 포털 부서에 */
export const CreateConsultationBody = z
  .object({
    toDept: PortalDept,
    fromDept: AnyDept,
    activityId: text.max(40).nullable().default(null),
    targetKind: ConsultTargetKind,
    targetId: required.max(120),
    targetName: required.max(200),
    summary: z.string().trim().min(4, '한 줄 요약을 4자 이상 입력하세요.').max(200),
    checks: z.array(required.max(300)).min(1, '살펴볼 것을 하나 이상 적으세요.').max(10),
    link: text.max(300).nullable().default(null),
    dueAt: isoDate,
  })
  .strict()
  .refine((b) => b.toDept !== b.fromDept, { message: '자기 부서에 협의를 요청할 수 없습니다.', path: ['toDept'] });
export type CreateConsultationBody = z.infer<typeof CreateConsultationBody>;

/** 포털 의견 — 의견을 내는 부서(그 요청을 받은 부서여야 한다)·의견·메모 */
export const AnswerConsultationBody = z
  .object({
    department: PortalDept,
    opinion: ConsultOpinion,
    memo: z.string().trim().min(2, '메모를 2자 이상 입력하세요.').max(1000),
  })
  .strict();
export type AnswerConsultationBody = z.infer<typeof AnswerConsultationBody>;

/** 기한까지 남은 날(음수 = 지남) — today는 YYYY-MM-DD */
export function consultDaysLeft(dueAt: string, today: string): number {
  return Math.round((Date.parse(`${dueAt}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** 포털 목록 순서 — 의견 대기 먼저, 기한 이른 순, 번호 순 */
export function consultOrder(a: Pick<Consultation, 'status' | 'dueAt' | 'consultId'>, b: Pick<Consultation, 'status' | 'dueAt' | 'consultId'>): number {
  return Number(a.status !== 'OPEN') - Number(b.status !== 'OPEN') || a.dueAt.localeCompare(b.dueAt) || a.consultId.localeCompare(b.consultId);
}

/** 마지막 의견(없으면 null) */
export const lastOpinion = (c: Pick<Consultation, 'opinions'>): ConsultOpinionEntry | null => c.opinions.at(-1) ?? null;
