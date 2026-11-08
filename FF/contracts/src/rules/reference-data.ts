// 고객 기준 값과 운영 출처 — 출시 준비 RD-OPS-03.
// 예전에는 권한 출처(DEMO|SYNTHETIC)·Fleet 구분(DEMO|SAMPLE)이 데모 전용 열거값이라 실제 고객 설치의 차량·권한을 적을 자리가 없었고,
// 판매국·지역·차종·트림 선택지는 데모 데이터셋 목록(KR·US·EU, NX4 PE·GN7·NE)을 화면이 그대로 썼다.
//  · 운영 값: 고객 Fleet 차량은 PRODUCTION, 그 차량에 낸 권한도 PRODUCTION으로 기록하고 만료 처리도 같은 길을 탄다.
//  · 고객 기준 값: 판매국·지역·차종·트림은 설치마다 등록한다(GET/POST /api/reference-values). 데모 목록은 시드일 뿐이다(origin SEED).
//  · 표준이 정한 값(Gate·ASIL·Lifecycle·메시지 v2 시장 MARKETS·역할)은 그대로 열거값이다 — 고객이 바꾸는 값이 아니다.
import { z } from 'zod';

/** Fleet 구분 — PRODUCTION = 고객 차량(IF-06 등록), DEMO = 시연 차량, SAMPLE = 5년 운영 모집단의 수신 표본 */
export const FLEET_KINDS = ['PRODUCTION', 'DEMO', 'SAMPLE'] as const;
export type FleetKind = (typeof FLEET_KINDS)[number];

/** 권한 출처 — PRODUCTION = 고객 차량에 낸 권한, DEMO = 시연 차량 권한, SYNTHETIC = 통계용 합성·표본 권한 */
export const GRANT_SOURCES = ['PRODUCTION', 'DEMO', 'SYNTHETIC'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

/**
 * 목록·지도 질의의 출처 고르기. FLEET = 등록 차량(운영 + 시연 — 기본), ALL = 합성 포함 전체.
 * PRODUCTION·DEMO·SYNTHETIC은 그 출처만. 모르는 값은 기본(FLEET)으로 본다.
 */
export const SOURCE_FILTERS = ['FLEET', 'ALL', ...GRANT_SOURCES] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export const asSourceFilter = (s?: string | null): SourceFilter => ((SOURCE_FILTERS as readonly string[]).includes(s ?? '') ? (s as SourceFilter) : 'FLEET');

/** 이 출처가 고른 범위에 드는가 */
export function sourceMatches(filter: SourceFilter, source: GrantSource): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'FLEET') return source !== 'SYNTHETIC';
  return filter === source;
}

/** 질의 범위의 출처 목록(SQL IN 절용) — ALL은 null(거르지 않는다) */
export function sourcesOf(filter: SourceFilter): GrantSource[] | null {
  if (filter === 'ALL') return null;
  return GRANT_SOURCES.filter((s) => sourceMatches(filter, s));
}

/**
 * 권한 출처 — 등록 차량이면 차량의 Fleet 구분에서, 등록 차량이 아니고 표본 성향만 있으면 SYNTHETIC.
 * 수신 표본(SAMPLE)은 통계 가중 집계 대상이라 SYNTHETIC이다.
 */
export function grantSourceOf(vehicle: { fleet?: FleetKind } | null | undefined): GrantSource {
  if (!vehicle) return 'SYNTHETIC';
  if (vehicle.fleet === 'PRODUCTION') return 'PRODUCTION';
  if (vehicle.fleet === 'SAMPLE') return 'SYNTHETIC';
  return 'DEMO';
}

/**
 * 체험 만료 sweep 대상 — 운영·시연 권한과 실제 경로로 제안·수락된 표본 권한. 통계용 합성 시드(SYN-…)는 과거 기록이라 돌리지 않는다.
 * 예전에는 DEMO만 보아 고객 권한이 만료되지 않았다(RD-OPS-03).
 */
export const trialSweepIncludes = (source: GrantSource, sampleVin: boolean): boolean => source === 'PRODUCTION' || source === 'DEMO' || (source === 'SYNTHETIC' && sampleVin);

// ── 고객 기준 값 ─────────────────────────────────────────────────────────────

export const REFERENCE_KINDS = ['COUNTRY', 'REGION', 'VEHICLE_MODEL', 'TRIM'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
/** 하위 값의 부모 종류 — 지역은 판매국 아래, 트림은 차종 아래 */
export const REFERENCE_PARENT: Record<ReferenceKind, ReferenceKind | null> = { COUNTRY: null, REGION: 'COUNTRY', VEHICLE_MODEL: null, TRIM: 'VEHICLE_MODEL' };

/** 기준 값 코드 — 화면·문맥 평가·Feature 적용 범위에 그대로 쓰이는 문자열(예: KR, NX4 PE, Premium) */
const CODE = /^[\p{L}\p{N}][\p{L}\p{N} ._·+-]{0,39}$/u;

export const ReferenceValueBody = z
  .object({
    kind: z.enum(REFERENCE_KINDS),
    code: z.string().trim().regex(CODE, '기준 값 코드는 글자·숫자로 시작하고 40자 이내(공백·. _ · + - 허용)여야 합니다'),
    label: z.string().trim().min(1).max(80),
    parent: z.string().trim().regex(CODE).nullable().default(null),
  })
  .strict();
export type ReferenceValueBody = z.infer<typeof ReferenceValueBody>;

/** 사용 중지 — 같은 코드가 여러 부모(판매국·차종) 아래 있으면 parent로 고른다 */
export const ReferenceRetireBody = z.object({ reason: z.string().trim().min(2).max(300), parent: z.string().trim().min(1).optional() }).strict();
export type ReferenceRetireBody = z.infer<typeof ReferenceRetireBody>;

export interface ReferenceValue {
  kind: ReferenceKind;
  code: string;
  label: string;
  parent: string | null;
  /** SEED = 데모 데이터셋이 넣은 값, CUSTOMER = 설치 뒤 고객이 등록한 값 */
  origin: 'SEED' | 'CUSTOMER';
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  createdBy: string;
}

/** 등록 검사 — 부모가 필요한 종류인데 부모가 없거나 등록되지 않았으면 오류 문구 */
export function referenceValueProblems(body: ReferenceValueBody, existing: readonly Pick<ReferenceValue, 'kind' | 'code' | 'status'>[]): string[] {
  const out: string[] = [];
  const parentKind = REFERENCE_PARENT[body.kind];
  if (parentKind && !body.parent) out.push(`${body.kind}에는 부모(${parentKind}) 값이 필요합니다`);
  if (!parentKind && body.parent) out.push(`${body.kind}에는 부모 값을 두지 않습니다`);
  if (parentKind && body.parent && !existing.some((v) => v.kind === parentKind && v.code === body.parent && v.status === 'ACTIVE')) out.push(`부모 ${parentKind} ${body.parent}이(가) 등록되지 않았습니다`);
  return out;
}

/** 운영 차량 등록 — IF-06 Fleet 연계(또는 차량 사양 담당자). 판매국·차종·트림은 등록된(ACTIVE) 기준 값이어야 한다 */
export const VehicleRegisterBody = z
  .object({
    vin: z.string().trim().min(3).max(40),
    label: z.string().trim().min(1).max(80),
    country: z.string().trim().min(1),
    vehicleModel: z.string().trim().min(1),
    trim: z.string().trim().min(1),
    modelYear: z.string().trim().regex(/^\d{4}$/),
    upgVc: z.string().trim().min(1),
    swVersion: z.string().trim().min(1),
    canary: z.boolean().default(false),
  })
  .strict();
export type VehicleRegisterBody = z.infer<typeof VehicleRegisterBody>;

/** 차량 등록 검사 — 기준 값에 없는 판매국·차종·트림 */
export function vehicleReferenceProblems(body: Pick<VehicleRegisterBody, 'country' | 'vehicleModel' | 'trim'>, values: readonly ReferenceValue[]): string[] {
  const active = (kind: ReferenceKind, code: string, parent?: string) => values.some((v) => v.kind === kind && v.code === code && v.status === 'ACTIVE' && (parent === undefined || v.parent === parent));
  const out: string[] = [];
  if (!active('COUNTRY', body.country)) out.push(`판매국 ${body.country}이(가) 기준 값에 없습니다`);
  if (!active('VEHICLE_MODEL', body.vehicleModel)) out.push(`차종 ${body.vehicleModel}이(가) 기준 값에 없습니다`);
  if (!active('TRIM', body.trim, body.vehicleModel)) out.push(`트림 ${body.trim}이(가) ${body.vehicleModel}의 기준 값에 없습니다`);
  return out;
}

/** 등록된(ACTIVE) 값의 코드 — 화면 선택지. 부모를 주면 그 아래만 */
export const referenceCodes = (values: readonly ReferenceValue[] | undefined, kind: ReferenceKind, parent?: string | null): string[] =>
  (values ?? []).filter((v) => v.kind === kind && v.status === 'ACTIVE' && (parent === undefined || parent === null || v.parent === parent)).map((v) => v.code);

/**
 * 데모 데이터셋의 기준 값 — 데모 시드(FF_SEED)만 넣는다(origin SEED). 고객 설치(시드 없음)는 빈 목록에서 시작해 고객 값을 등록한다.
 * 합성 모집단(trial.ts·population.ts)의 판매국·지역·차종·트림 분포와 같은 값이다.
 */
export const DEMO_REFERENCE_SEED: Omit<ReferenceValue, 'origin' | 'status' | 'createdAt' | 'createdBy'>[] = [
  ...(
    [
      ['KR', '대한민국'],
      ['US', '미국'],
      ['EU', '유럽연합'],
    ] as const
  ).map(([code, label]) => ({ kind: 'COUNTRY' as const, code, label, parent: null })),
  ...(
    [
      ['KR', ['수도권', '영남', '충청', '호남', '강원·제주']],
      ['US', ['West', 'East', 'South', 'Midwest']],
      ['EU', ['DE', 'FR', 'IT', 'ES', 'NL']],
    ] as const
  ).flatMap(([country, regions]) => regions.map((code) => ({ kind: 'REGION' as const, code, label: code, parent: country }))),
  ...(['NX4 PE', 'GN7', 'NE'] as const).map((code) => ({ kind: 'VEHICLE_MODEL' as const, code, label: code, parent: null })),
  ...(
    [
      ['NX4 PE', ['Premium', 'Inspiration', 'Modern', 'Ultimate', 'Limited', 'SEL']],
      ['GN7', ['Calligraphy', 'Exclusive', 'Premium', 'Limited']],
      ['NE', ['Long Range', 'Standard']],
    ] as const
  ).flatMap(([model, trims]) => trims.map((code) => ({ kind: 'TRIM' as const, code, label: code, parent: model }))),
];
