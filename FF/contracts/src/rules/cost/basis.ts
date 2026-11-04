// 개발비 산정 계수·단가 표(20-94 §5 cost_basis) — 원가 기준 관리자가 버전으로 발행한다(D-COST-8). 첫 판은 엑셀 산정 도구 v1.3에서 옮김.
import { z } from 'zod';

const n = z.number();
const nn = z.number().nullable();

export const COCOMO_RATINGS = ['VL', 'L', 'N', 'H', 'VH', 'XH'] as const;
export type CocomoRating = (typeof COCOMO_RATINGS)[number];

export const CostBasis = z.object({
  version: z.string().min(1),
  /** 이 판을 옮겨 온 원본(첫 판은 엑셀 산정 도구 v1.3) — 기준값 시나리오와 같은 원본인지 data:check가 본다 */
  source: z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
  priceYear: z.number().int(),
  currency: z.string().min(3).max(3),
  /** A. T-shirt 등급 → 포인트 */
  sizePoints: z.record(z.string(), n),
  /** B. ASIL → RELY·DOCU 승수 (ASIL 계수 = 곱) */
  asil: z.record(z.string(), z.object({ rely: n, docu: n })),
  /** C. 변경 유형별 재사용 모델 입력 — AAF·AAM은 엔진이 계산 */
  reuse: z.array(z.object({ changeType: z.string(), dm: n, cm: n, im: n, aa: n, su: n, unfm: n })).min(1),
  /** D. 구현 난이도 Overall = base + 수명주기 가산 + Automotive 신뢰도 가산 */
  overall: z.object({ base: n, lifecycle: z.record(z.string(), n), quality: z.record(z.string(), n) }),
  /** E. PERT — o = m × optimistic, p = m × (1 + pessimisticSlope × (Overall − 1)) */
  pert: z.object({ optimistic: n, pessimisticSlope: n }),
  variantCoef: n,
  confidence: z.record(z.string(), n),
  /** F. COCOMO II 승수 — 정의 없는 등급은 null(엔진이 1.00 적용) */
  cocomo: z.record(z.string(), z.object({ label: z.string(), VL: nn, L: nn, N: nn, H: nn, VH: nn, XH: nn })),
  /** N. 개발 여건 프리셋 — 프리셋 이름 → 드라이버 → 등급 */
  presets: z.record(z.string(), z.record(z.string(), z.string().nullable())),
  /** G. 역할별 단가 — KOSA 직무 월평균, 엔지니어링 등급 일 노임 × 월 환산 일수, 사내 월단가(있으면) */
  rates: z.object({
    roles: z.array(z.object({ role: z.string(), kosaJob: z.string(), engineeringGrade: z.string(), inhouseMonthly: nn })).min(1),
    kosa: z.record(z.string(), z.object({ daily: n, monthly: n })),
    engineeringDaily: z.record(z.string(), n),
    daysPerMonth: n,
  }),
  /** H. 공정별 공수 비중 */
  phases: z.array(z.object({ phase: z.string(), share: n })).min(1),
  /** I. 역할별 공정 구성비 — phases 순서 */
  roleComposition: z.record(z.string(), z.array(n)),
  /** J. 대가 산정 방식별 제경비·기술료 기본값 */
  methods: z.record(z.string(), z.object({ ohMin: nn, ohMax: nn, oh: n, feeMin: nn, feeMax: nn, fee: n })),
  /** K. AACE 등급 → [하한 넓음, 하한 좁음, 상한 좁음, 상한 넓음] */
  aace: z.record(z.string(), z.tuple([n, n, n, n])),
  /** L. 공통 인력 비율 */
  commonPct: z.object({ pm: n, scm: n, pi: n }),
  /** 02 3절 — 벤치마크(Kearney 등가) 환산 */
  benchmark: z.object({ anchorEur: n, euRate: n, hoursPerPm: n, fx: n }),
  /** 과제 통화 표시용 환율 — 통화 → 원/단위(D-COST-10). 계산은 원화, 표시·내보내기만 환산. KRW는 1 */
  currencies: z.record(z.string(), z.number().positive()),
  vat: n,
  /** 12_MBD복잡도 — 등급 승수 5개, 공통 기준값 y, 19작업의 작업별 y(비면 기준값) */
  mbd: z.object({ multipliers: z.array(n).length(5), baseY: nn, tasks: z.array(z.object({ phase: z.string(), task: z.string(), y: nn })) }),
  /** 06_교정 — 포인트당 € 제안값 표본(단일 Feature·번들) */
  calibration: z.object({ singles: z.array(z.string()), bundles: z.array(z.string()) }),
  /** 02 6절 — 직접경비 항목(엑셀 62~69행 순서). 과제 설정의 directExpenses[i]가 i번째 항목 */
  directExpenseItems: z.array(z.object({ item: z.string(), unit: z.string() })).max(8).default([]),
  /** 07_검토체크리스트 — 제출 전 점검 항목. purchaseKey = '구매 핵심' 표시(●) */
  checklist: z
    .array(z.object({ no: z.number().int().positive(), category: z.string(), item: z.string(), method: z.string(), source: z.string(), purchaseKey: z.boolean() }))
    .default([]),
});
export type CostBasis = z.infer<typeof CostBasis>;
