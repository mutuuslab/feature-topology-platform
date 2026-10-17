// 5년 운영 모집단 — "플랫폼을 5년 운영했다"(사용자 결정 2026-10-17)를 숫자로 만든다.
// 판매된 차가 모두 플랫폼 대상은 아니다: 판매 → 서비스 시장 → 플랫폼 탑재 차종(출시 연차별 증가) → 커넥티드 활성 → 말소 제외 순으로 거른다.
// 전체 대수·분해는 이 모델로 계산하고(저장하지 않음), 화면 목록·상세·체험 분석은 층화 가중 표본(sampleVehicles)이 맡는다 — 표본 한 대가 대표 차량 수(weight)를 가진다.
// 비율은 모두 가정값이다(실제 수치 아님). 화면과 보고서에 '가정'으로 표시하고, 실제 비율이 오면 POPULATION_ASSUMPTIONS만 바꾼다.
import { z } from 'zod';
import { VehicleSchema } from '../schemas/policy';
import { addDays, ADAS_USAGE, AGE_BANDS, DRIVING_STYLES, profileTraits, trialPrng, weightedPick, type VehicleProfile } from './trial';

export const POPULATION_ASSUMPTIONS = {
  /** 연 판매 — 사용자 제공(현대차 연 700만 대) */
  annualSales: 7_000_000,
  /** 플랫폼 서비스 시장의 연 판매 — 나머지(약 300만 대)는 서비스하지 않는 시장(국외 이전 보류 시장 포함) */
  servedMarketSales: { KR: 1_300_000, US: 1_600_000, EU: 1_100_000 } as Record<'KR' | 'US' | 'EU', number>,
  /** 플랫폼 탑재 차종 비율 — 개시 후 n년차 판매분 중 OTA·기능 활성화가 가능한 차 */
  platformShareByYear: [0.3, 0.5, 0.7, 0.85, 0.95],
  /** 커넥티드 서비스 가입·활성 비율 */
  connectedActivation: 0.75,
  /** 연 말소율(폐차·수출·통신 해지) */
  annualAttrition: 0.02,
  /** 대상 차종 구성(데이터셋 차종 3종) */
  modelMix: [['NX4 PE', 50], ['GN7', 25], ['NE', 25]] as [string, number][],
};

export const POPULATION_COUNTRIES = ['KR', 'US', 'EU'] as const;
export type PopulationCountry = (typeof POPULATION_COUNTRIES)[number];
export const OPS_YEARS = 5;

/** 플랫폼 개시일 — 기준일(오늘)에서 5년 전. 재생(tools/ops5y)의 시작일이기도 하다 */
export const platformStart = (today: string) => {
  const ymd = `${Number(today.slice(0, 4)) - OPS_YEARS}${today.slice(4, 10)}`;
  return ymd.endsWith('-02-29') ? ymd.replace(/29$/, '28') : ymd; // 윤일 → 2월 28일
};

const monthOf = (ymd: string) => ymd.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** 판매월 목록 — 개시월부터 기준월까지(5년 = 60개월 + 이번 달) */
export function salesMonths(start: string, today: string): string[] {
  const n = monthsBetween(monthOf(start), monthOf(today));
  return Array.from({ length: n + 1 }, (_, i) => addMonths(monthOf(start), i));
}

const opsYearOf = (start: string, ym: string) => Math.min(OPS_YEARS - 1, Math.max(0, Math.floor(monthsBetween(monthOf(start), ym) / 12)));
const modelShare = (model: string) => {
  const total = POPULATION_ASSUMPTIONS.modelMix.reduce((s, [, w]) => s + w, 0);
  return (POPULATION_ASSUMPTIONS.modelMix.find(([m]) => m === model)?.[1] ?? 0) / total;
};

export interface Cohort {
  soldMonth: string;
  country: PopulationCountry;
  vehicleModel: string;
  /** 판매 대수(서비스 시장) */
  sold: number;
  /** 플랫폼 탑재 */
  platform: number;
  /** 커넥티드 활성 */
  connected: number;
  /** 기준일에 운행 중(말소 제외) */
  active: number;
}

/** 판매월 × 국가 × 차종 코호트 — 기준일까지 판매분만. 이번 달은 기준일까지 일할 */
export function cohorts(start: string, today: string): Cohort[] {
  const A = POPULATION_ASSUMPTIONS;
  const out: Cohort[] = [];
  const lastMonth = monthOf(today);
  for (const ym of salesMonths(start, today)) {
    const part = ym === lastMonth ? Number(today.slice(8, 10)) / 30 : ym === monthOf(start) ? (31 - Number(start.slice(8, 10))) / 30 : 1;
    const ageYears = monthsBetween(ym, lastMonth) / 12;
    const share = A.platformShareByYear[opsYearOf(start, ym)];
    for (const country of POPULATION_COUNTRIES) {
      for (const [vehicleModel] of A.modelMix) {
        const sold = (A.servedMarketSales[country] / 12) * part * modelShare(vehicleModel);
        const platform = sold * share;
        const connected = platform * A.connectedActivation;
        out.push({ soldMonth: ym, country, vehicleModel, sold, platform, connected, active: connected * (1 - A.annualAttrition) ** ageYears });
      }
    }
  }
  return out;
}

export interface PopulationSummary {
  asOf: string;
  start: string;
  /** 깔때기 — 전 세계 판매 → 서비스 시장 → 플랫폼 탑재 → 커넥티드 활성 → 운행 중(대상 차량) */
  funnel: { soldWorldwide: number; soldServed: number; platform: number; connected: number; active: number };
  byCountry: Record<PopulationCountry, number>;
  byModel: Record<string, number>;
  /** 개시 후 연차별 판매분의 운행 대수 */
  byOpsYear: number[];
  assumptions: typeof POPULATION_ASSUMPTIONS;
  note: string;
}

export const POPULATION_NOTE = '대상 차량 수는 가정값으로 계산한 모집단 추정입니다(실제 판매·가입 수치 아님). 목록·상세·체험 분석은 가중 표본 차량을 씁니다.';

export function populationAt(start: string, today: string): PopulationSummary {
  const cs = cohorts(start, today);
  const round = (x: number) => Math.round(x);
  const sum = (f: (c: Cohort) => number, keep: (c: Cohort) => boolean = () => true) => round(cs.filter(keep).reduce((s, c) => s + f(c), 0));
  const served = sum((c) => c.sold);
  const worldwide = round((POPULATION_ASSUMPTIONS.annualSales / 12) * (served / Object.values(POPULATION_ASSUMPTIONS.servedMarketSales).reduce((a, b) => a + b, 0)) * 12);
  return {
    asOf: today,
    start,
    funnel: { soldWorldwide: Math.max(worldwide, served), soldServed: served, platform: sum((c) => c.platform), connected: sum((c) => c.connected), active: sum((c) => c.active) },
    byCountry: Object.fromEntries(POPULATION_COUNTRIES.map((k) => [k, sum((c) => c.active, (c) => c.country === k)])) as Record<PopulationCountry, number>,
    byModel: Object.fromEntries(POPULATION_ASSUMPTIONS.modelMix.map(([m]) => [m, sum((c) => c.active, (c) => c.vehicleModel === m)])),
    byOpsYear: Array.from({ length: OPS_YEARS }, (_, y) => sum((c) => c.active, (c) => opsYearOf(start, c.soldMonth) === y)),
    assumptions: POPULATION_ASSUMPTIONS,
    note: POPULATION_NOTE,
  };
}

// ---------------- 층화 가중 표본 ----------------

/** 시장별 트림 구성(가정) — 데이터셋 Feature 적용 범위(KR Premium·EU Ultimate·US Limited 등)와 맞춘다. 범위 밖 트림은 그 기능의 대상이 아니다 */
export const SAMPLE_TRIMS: Record<string, Partial<Record<PopulationCountry, [string, number][]>>> = {
  'NX4 PE': { KR: [['Premium', 50], ['Inspiration', 30], ['Modern', 20]], EU: [['Ultimate', 55], ['Premium', 45]], US: [['Limited', 50], ['SEL', 50]] },
  GN7: { KR: [['Calligraphy', 40], ['Premium', 35], ['Exclusive', 25]], EU: [['Calligraphy', 50], ['Premium', 50]], US: [['Calligraphy', 50], ['Limited', 50]] },
  NE: { KR: [['Long Range', 60], ['Standard', 40]], EU: [['Long Range', 60], ['Standard', 40]], US: [['Long Range', 60], ['Standard', 40]] },
};

const WMI: Record<PopulationCountry, string> = { KR: 'KMH', US: 'HMA', EU: 'TMA' };
const MODEL_CODE: Record<string, string> = { 'NX4 PE': 'NX4', GN7: 'GN7', NE: 'NE' };

/** 표본 VIN — 데모(KMH-NX4-0001)·합성(SYN-…)과 겹치지 않는다 */
export const sampleVin = (country: PopulationCountry, model: string, n: number) => `${WMI[country]}-${MODEL_CODE[model] ?? 'X'}-P${String(n).padStart(6, '0')}`;
export const isSampleVin = (vin: string) => /^[A-Z]{3}-[A-Z0-9]+-P\d{6}$/.test(vin);

/**
 * 층화 가중 표본 — 층 = 개시 연차 × 국가 × 차종. 표본 수는 층의 대상 대수에 비례(층마다 최소 minPerStratum),
 * 가중치 = 층 대수 ÷ 층 표본 수. 판매월은 층 안에서 월별 대수에 비례해 고른다. 말소일은 연 말소율로 정한다.
 * 결과의 가중 합계(말소 전, 판매월 ≤ 기준일)가 populationAt().funnel.connected와 맞는다.
 */
export function sampleVehicles(n: number, start: string, today: string, seed = 20211017, minPerStratum = 8): VehicleProfile[] {
  const r = trialPrng(seed);
  const cs = cohorts(start, today);
  const strata = new Map<string, Cohort[]>();
  for (const c of cs) {
    const key = `${opsYearOf(start, c.soldMonth)}|${c.country}|${c.vehicleModel}`;
    strata.set(key, [...(strata.get(key) ?? []), c]);
  }
  const total = cs.reduce((s, c) => s + c.connected, 0);
  const out: VehicleProfile[] = [];
  let serial = 0;
  for (const [key, members] of [...strata.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [, country, vehicleModel] = key.split('|') as [string, PopulationCountry, string];
    const size = members.reduce((s, c) => s + c.connected, 0);
    if (size <= 0) continue;
    const k = Math.max(minPerStratum, Math.round((n * size) / total));
    const weight = size / k;
    const pickMonth: [string, number][] = members.map((c) => [c.soldMonth, c.connected]);
    for (let i = 0; i < k; i++) {
      const soldMonth = weightedPick(r, pickMonth);
      const soldDay = `${soldMonth}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const traits = profileTraits(r, country, vehicleModel);
      const trims = SAMPLE_TRIMS[vehicleModel]?.[country];
      if (trims) traits.trim = weightedPick(r, trims);
      // 말소 — 지수 분포(연 말소율), 기준일 이후면 아직 운행 중
      const lifeYears = -Math.log(1 - r()) / -Math.log(1 - POPULATION_ASSUMPTIONS.annualAttrition);
      const retired = addDays(soldDay < start ? start : soldDay, Math.round(lifeYears * 365));
      out.push({
        vin: sampleVin(country, vehicleModel, ++serial),
        country,
        vehicleModel,
        ...traits,
        source: 'SYNTHETIC',
        weight: Math.round(weight * 100) / 100,
        soldMonth,
        retiredAt: retired <= today ? retired : null,
      });
    }
  }
  return out;
}

/** 표본 차량이 그날 운행 중인가 — 판매월이 지났고 말소 전 */
export const inService = (p: Pick<VehicleProfile, 'soldMonth' | 'retiredAt'>, ymd: string) => (!p.soldMonth || p.soldMonth <= ymd.slice(0, 7)) && (!p.retiredAt || p.retiredAt > ymd);

// ---------------- 신차 커넥티드 등록 (IF-06 Fleet 연계 모의) ----------------

export const VehicleProfileSchema = z
  .object({
    vin: z.string().min(3),
    country: z.string(),
    region: z.string(),
    vehicleModel: z.string(),
    trim: z.string(),
    ageBand: z.enum(AGE_BANDS),
    drivingStyle: z.enum(DRIVING_STYLES),
    adasUsage: z.enum(ADAS_USAGE),
    source: z.enum(['DEMO', 'SYNTHETIC']),
    weight: z.number().positive().optional(),
    soldMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    retiredAt: z.string().nullable().optional(),
  })
  .strict();

/** 한 번에 등록하는 상한 — 요청 본문 기본 한도(100 KB) 안. 재생은 판매월마다 나눠 보낸다 */
export const ONBOARD_MAX_PROFILES = 300;
export const ONBOARD_MAX_RECEIVERS = 50;
export const FleetOnboardBody = z
  .object({
    /** 새로 커넥티드 등록된 표본 차량(가명 성향 + 대표 대수) */
    profiles: VehicleProfileSchema.array().max(ONBOARD_MAX_PROFILES).default([]),
    /** 그중 실제 OTA를 받고 회신하는 수신 표본 — fleet: SAMPLE */
    receivers: VehicleSchema.array().max(ONBOARD_MAX_RECEIVERS).default([]),
  })
  .strict();
export type FleetOnboard = z.infer<typeof FleetOnboardBody>;

/** 데이터셋 표시 — meta.dataset. ops5y면 개시일을 담는다 */
export interface DatasetInfo {
  kind: 'demo' | 'ops5y';
  start: string | null;
}
