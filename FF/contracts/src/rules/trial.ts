// 체험권 (D01-05 사용 권한) · 체험 전환 분석 (D05-06 사업 지표) · 구매 전환 (D05-04 과금 연계) — 2026-10-13 사용자 결정:
//   기간형 체험: 제안(OFFERED, 제안 유효기간 14일) → 수락(ACTIVE, 수락일부터 30일 기능 ON) → 만료(EXPIRED) / 거절(DECLINED) / 구매 전환(CONVERTED)
//   분석은 국가·지역·차종·트림·연령대·주행 성향·ADAS 사용 빈도별 수락률·전환율. 운전자 정보는 가명 구간값만, 5대 미만 집단은 가린다.
//   통계용 합성 모집단은 결정적으로 만들고 화면에 '합성 데이터'로 표시한다.
import type { Entitlement } from '../schemas/policy';

export const TRIAL_DAYS = 30;
export const OFFER_DAYS = 14;
/** 만료 사전 고지 — 만료일 N일 전부터 (FFG-LCY-010: F2 이상은 고지·확인 뒤에만 상업 비활성화를 적용한다) */
export const TRIAL_NOTICE_DAYS = 3;
/** 5대 미만 집단은 통계에서 가린다 (재식별 방지) */
export const K_ANONYMITY = 5;

export const SEGMENT_DIMENSIONS = ['country', 'region', 'vehicleModel', 'trim', 'ageBand', 'drivingStyle', 'adasUsage'] as const;
export type SegmentDimension = (typeof SEGMENT_DIMENSIONS)[number];

/** 차량에 붙는 가명 성향 — 개인 식별 정보 없음 */
export interface VehicleProfile {
  vin: string;
  country: string;
  region: string;
  vehicleModel: string;
  trim: string;
  ageBand: '20대' | '30대' | '40대' | '50대' | '60대+';
  drivingStyle: '도심' | '고속도로' | '장거리' | '혼합';
  adasUsage: '낮음' | '보통' | '높음';
  source: 'DEMO' | 'SYNTHETIC';
}

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

export type TrialState = 'OFFERED' | 'ACTIVE' | 'DECLINED' | 'EXPIRED' | 'CONVERTED' | 'REVOKED';

/** 오늘 기준 상태 — 저장된 상태가 ACTIVE·OFFERED여도 기간이 지났으면 EXPIRED. 기능 ON은 유효한 체험·구독·구매만 */
export function grantState(g: Entitlement, today: string): { state: TrialState; effective: boolean; daysLeft: number | null } {
  const within = g.validFrom <= today && today <= g.validTo;
  const left = within ? daysBetween(today, g.validTo) + 1 : null;
  if (g.status === 'ACTIVE') return within ? { state: 'ACTIVE', effective: true, daysLeft: left } : { state: today < g.validFrom ? 'ACTIVE' : 'EXPIRED', effective: false, daysLeft: null };
  if (g.status === 'OFFERED') return within ? { state: 'OFFERED', effective: false, daysLeft: left } : { state: 'EXPIRED', effective: false, daysLeft: null };
  return { state: g.status as TrialState, effective: false, daysLeft: null };
}

/**
 * 만료 sweep이 이 체험권에 할 일 — 순수 함수(하루 1회 sweep·시험이 같이 쓴다).
 *   NOTICE: 수락된 체험(저장 상태 ACTIVE)이 만료 N일 전 안에 들었고, 지금 만료일에 대한 고지가 아직 없다(연장되면 다시 고지)
 *   EXPIRE: 저장 상태가 ACTIVE인데 기간이 지났다 — 저장 상태를 EXPIRED로 확정한다(CONVERTED·DECLINED·REVOKED는 대상 아님)
 */
export function trialSweepPlan(g: Entitlement, today: string, noticeDays = TRIAL_NOTICE_DAYS): 'NOTICE' | 'EXPIRE' | null {
  if (g.kind !== '체험' || g.status !== 'ACTIVE' || !g.acceptedAt) return null;
  if (today > g.validTo) return 'EXPIRE';
  if (today >= addDays(g.validTo, -noticeDays) && g.noticeFor !== g.validTo) return 'NOTICE';
  return null;
}

/** 만료 이벤트에 실을 고지 — 지금 만료일에 대해 낸 고지만 인정한다(연장 전 고지는 무효) */
export const noticeOf = (g: Entitlement) => (g.noticeFor === g.validTo && g.noticeId ? { noticeId: g.noticeId, noticeAt: g.noticeAt } : { noticeId: null, noticeAt: null });

export interface FunnelGroup {
  key: string;
  offered: number;
  accepted: number;
  active: number;
  converted: number;
  declined: number;
  expired: number;
  pending: number;
  acceptRate: number | null;
  conversionRate: number | null;
  /** 제안 → 구매 */
  overallRate: number | null;
  medianDaysToConvert: number | null;
  suppressed: boolean;
}

const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function tally(key: string, rows: { grant: Entitlement }[], today: string): FunnelGroup {
  const g: FunnelGroup = { key, offered: 0, accepted: 0, active: 0, converted: 0, declined: 0, expired: 0, pending: 0, acceptRate: null, conversionRate: null, overallRate: null, medianDaysToConvert: null, suppressed: false };
  const toConvert: number[] = [];
  for (const { grant } of rows) {
    const s = grantState(grant, today).state;
    g.offered++;
    if (grant.acceptedAt) g.accepted++;
    if (s === 'ACTIVE') g.active++;
    if (s === 'CONVERTED') {
      g.converted++;
      if (grant.acceptedAt && grant.convertedAt) toConvert.push(daysBetween(grant.acceptedAt, grant.convertedAt));
    }
    if (s === 'DECLINED') g.declined++;
    if (s === 'EXPIRED') g.expired++;
    if (s === 'OFFERED') g.pending++;
  }
  g.acceptRate = rate(g.accepted, g.offered);
  g.conversionRate = rate(g.converted, g.accepted);
  g.overallRate = rate(g.converted, g.offered);
  g.medianDaysToConvert = median(toConvert);
  return g;
}

/** 체험 전환 깔때기 — 성향 차원별. 작은 집단은 숫자를 지운다(가림) */
export function trialFunnel(rows: { grant: Entitlement; profile: VehicleProfile | undefined }[], groupBy: SegmentDimension | null, today: string, k = K_ANONYMITY) {
  const trials = rows.filter((r) => r.grant.kind === '체험');
  const total = tally('전체', trials, today);
  if (!groupBy) return { total, groups: [] as FunnelGroup[] };
  const by = new Map<string, typeof trials>();
  for (const r of trials) {
    const key = r.profile?.[groupBy] ?? '미상';
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  const groups = [...by.entries()]
    .map(([key, rs]) => tally(key, rs, today))
    .map((g) => (g.offered < k ? { ...g, accepted: 0, active: 0, converted: 0, declined: 0, expired: 0, pending: 0, acceptRate: null, conversionRate: null, overallRate: null, medianDaysToConvert: null, suppressed: true } : g))
    .sort((a, b) => b.offered - a.offered);
  return { total, groups };
}

/** 주별 추이 — 제안·수락·구매 (주 시작일 월요일) */
export function trialTrend(grants: Entitlement[], today: string, weeks = 12) {
  const monday = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    return addDays(ymd, -((d.getUTCDay() + 6) % 7));
  };
  const last = monday(today);
  const keys = Array.from({ length: weeks }, (_, i) => addDays(last, -7 * (weeks - 1 - i)));
  const out = keys.map((week) => ({ week, offered: 0, accepted: 0, converted: 0 }));
  const at = (ymd: string | null | undefined) => (ymd ? out.find((w) => w.week === monday(ymd)) : undefined);
  for (const g of grants.filter((x) => x.kind === '체험')) {
    const o = at(g.offeredAt);
    if (o) o.offered++;
    const a = at(g.acceptedAt);
    if (a) a.accepted++;
    const c = at(g.convertedAt);
    if (c) c.converted++;
  }
  return out;
}

// ---------------- 합성 모집단 (결정적) ----------------

/** mulberry32 — 같은 seed면 같은 모집단 */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items.at(-1)![0];
}

/** 목록 필터 선택지 — 가명 구간값 */
export const AGE_BANDS = ['20대', '30대', '40대', '50대', '60대+'] as const;
export const DRIVING_STYLES = ['도심', '고속도로', '장거리', '혼합'] as const;
export const ADAS_USAGE = ['낮음', '보통', '높음'] as const;
export const TRIAL_COUNTRIES = ['KR', 'US', 'EU'] as const;
export const regionsOf = (country: string) => (REGIONS[country] ?? []).map(([r]) => r);

const REGIONS: Record<string, [string, number][]> = {
  KR: [['수도권', 45], ['영남', 25], ['충청', 12], ['호남', 10], ['강원·제주', 8]],
  US: [['West', 30], ['East', 30], ['South', 25], ['Midwest', 15]],
  EU: [['DE', 35], ['FR', 22], ['IT', 15], ['ES', 15], ['NL', 13]],
};
const MODELS: [string, number][] = [['NX4 PE', 50], ['GN7', 25], ['NE', 25]];
const TRIMS: Record<string, [string, number][]> = {
  'NX4 PE': [['Premium', 55], ['Inspiration', 30], ['Modern', 15]],
  GN7: [['Calligraphy', 45], ['Exclusive', 55]],
  NE: [['Long Range', 60], ['Standard', 40]],
};

/**
 * 합성 체험권 모집단 — 성향에 따라 수락·구매 확률이 다르다(예: 고속도로·장거리 주행, ADAS 사용이 높을수록 전방 안전거리 기능을 더 받아들임).
 * 날짜는 anchor(오늘) 기준 지난 180일. VIN은 SYN-국가-번호.
 */
export function syntheticTrials(n: number, anchor: string, seed = 20261013, catalogId = 'CAT-00019') {
  const r = prng(seed);
  const profiles: VehicleProfile[] = [];
  const grants: Entitlement[] = [];
  for (let i = 1; i <= n; i++) {
    const country = pick(r, [['KR', 50], ['US', 30], ['EU', 20]]);
    const vehicleModel = pick(r, MODELS);
    const p: VehicleProfile = {
      vin: `SYN-${country}-${String(i).padStart(5, '0')}`,
      country,
      region: pick(r, REGIONS[country]),
      vehicleModel,
      trim: pick(r, TRIMS[vehicleModel]),
      ageBand: pick(r, [['20대', 15], ['30대', 25], ['40대', 28], ['50대', 20], ['60대+', 12]]),
      drivingStyle: pick(r, [['도심', 35], ['고속도로', 30], ['장거리', 20], ['혼합', 15]]),
      adasUsage: pick(r, [['낮음', 30], ['보통', 45], ['높음', 25]]),
      source: 'SYNTHETIC',
    };
    profiles.push(p);
    const style = { 도심: -0.08, 고속도로: 0.15, 장거리: 0.12, 혼합: 0 }[p.drivingStyle];
    const adas = { 낮음: -0.12, 보통: 0, 높음: 0.15 }[p.adasUsage];
    const age = { '20대': 0.05, '30대': 0.02, '40대': 0, '50대': -0.03, '60대+': -0.1 }[p.ageBand];
    const ctry = { KR: 0.03, US: 0, EU: -0.05 }[country as 'KR' | 'US' | 'EU'];
    const pAccept = Math.min(0.9, Math.max(0.05, 0.35 + style + adas + age + ctry));
    const pConvert = Math.min(0.8, Math.max(0.03, 0.22 + (p.adasUsage === '높음' ? 0.12 : 0) + (p.drivingStyle === '장거리' ? 0.08 : 0) + (p.ageBand === '40대' || p.ageBand === '50대' ? 0.05 : 0) + (p.ageBand === '20대' ? -0.06 : 0) + (country === 'US' ? 0.04 : 0)));
    const offeredAt = addDays(anchor, -Math.floor(r() * 180));
    const base = { grantId: `ENT-S${String(i).padStart(5, '0')}`, vin: p.vin, catalogId, kind: '체험' as const, usesLeft: null, offeredAt, source: 'SYNTHETIC' as const };
    if (r() < pAccept) {
      const acceptedAt = addDays(offeredAt, Math.floor(r() * 10));
      if (acceptedAt > anchor) {
        grants.push({ ...base, validFrom: offeredAt, validTo: addDays(offeredAt, OFFER_DAYS - 1), status: 'OFFERED', acceptedAt: null, trialDays: null, convertedAt: null, convertedPlan: null } as Entitlement);
        continue;
      }
      const validTo = addDays(acceptedAt, TRIAL_DAYS - 1);
      const g = { ...base, validFrom: acceptedAt, validTo, acceptedAt, trialDays: TRIAL_DAYS };
      if (r() < pConvert) {
        const convertedAt = addDays(acceptedAt, 5 + Math.floor(r() * 36));
        if (convertedAt <= anchor) {
          grants.push({ ...g, status: 'CONVERTED', convertedAt, convertedPlan: r() < 0.7 ? '구독' : '구매' } as Entitlement);
          continue;
        }
      }
      grants.push({ ...g, status: 'ACTIVE', convertedAt: null, convertedPlan: null } as Entitlement); // 기간이 지났으면 grantState가 EXPIRED로 본다
    } else {
      const expires = addDays(offeredAt, OFFER_DAYS - 1);
      const status = expires < anchor ? (r() < 0.6 ? 'DECLINED' : 'OFFERED') : 'OFFERED';
      grants.push({ ...base, validFrom: offeredAt, validTo: expires, status, acceptedAt: null, trialDays: null, convertedAt: null, convertedPlan: null } as Entitlement);
    }
  }
  return { profiles, grants };
}

// ---------------- 화면·정적 스냅샷 공용 질의 (같은 질의 → 같은 스냅샷 파일) ----------------

export type TrialSource = 'ALL' | 'DEMO' | 'SYNTHETIC';
export const TRIAL_STATES = ['ACTIVE', 'OFFERED', 'CONVERTED', 'DECLINED', 'EXPIRED'] as const;
export const TRIAL_PAGE_SIZE = 50;

export interface TrialListFilter {
  catalogId: string;
  source: TrialSource;
  state?: string;
  segment?: Partial<Record<SegmentDimension, string>>;
  q?: string;
  page?: number;
}

/** 체험권 차량 목록 질의 — 키 순서 고정 */
export function trialListQuery(f: TrialListFilter): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = { catalogId: f.catalogId, source: f.source, state: f.state || undefined };
  for (const d of SEGMENT_DIMENSIONS) out[d] = f.segment?.[d] || undefined;
  out.q = f.q?.trim() || undefined;
  out.page = f.page && f.page > 1 ? f.page : undefined;
  out.pageSize = TRIAL_PAGE_SIZE;
  return out;
}

/** 체험 전환 분석 질의 */
export function trialAnalyticsQuery(f: { catalogId: string; source: TrialSource; groupBy?: SegmentDimension | '' }): Record<string, string | undefined> {
  return { catalogId: f.catalogId, source: f.source, groupBy: f.groupBy || undefined };
}
