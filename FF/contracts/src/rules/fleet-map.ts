// 전세계 차량 지도 (D02-03 Fleet 현황) — 차량마다 위치·구독 상태·기능 활성 상태.
// 위치는 개인정보다(D5 결정 대기). 결정 전 잠정 기본값:
//   - 위치 원천은 데모 전용 모의 공급자 — 차량 국가·지역의 도시 주변 좌표를 VIN으로 결정적으로 만든다. 저장하지 않고 조회 때 계산한다.
//   - 지도 전체는 약 1 km 정밀도(0.01°)로 낮춰 보낸다. 한 대 상세만 정밀(0.0001°)이며 열람마다 감사한다.
//   - 위치 공유에 동의하지 않은 차량은 지역 대표점만 보인다.
//   - 열람은 사람 역할 전부(LOCATION_VIEW_ROLES, 사용자 결정 2026-10-17). 차량 신원은 열람하지 않는다.
import { ROLES, type Role } from '../enums';
import { grantState } from './trial';
import type { Entitlement } from '../schemas/policy';

/**
 * 위치 열람 역할 — 사람 역할 전부(사용자 결정 2026-10-17 "누구나 다 볼 수 있도록"). 차량(VEHICLE)은 열람하지 않는다.
 * 열람은 계속 감사하고(지도는 계정당 10분에 한 번, 상세는 매번), 지도 목록의 정밀도(약 1 km)도 그대로다.
 */
// access.ts의 HUMAN_ROLES를 쓰지 않는다 — access → routes → fleet-map 순환 import에서 아직 초기화 전이다. 같은 정의를 enums에서 직접 계산한다.
export const LOCATION_VIEW_ROLES: Role[] = [...ROLES.filter((r) => r !== 'VEHICLE' && r !== 'SYSTEM'), 'SYSTEM'];
/** 지도 목록 정밀도 — 0.01° ≈ 1.1 km */
export const MAP_PRECISION_DEG = 0.01;
/** 한 대 상세 정밀도 — 0.0001° ≈ 11 m */
export const DETAIL_PRECISION_DEG = 0.0001;
/** 같은 계정의 지도 열람은 이 간격 안에서 한 번만 감사에 남긴다(5초 갱신마다 쌓이지 않게) */
export const MAP_AUDIT_WINDOW_MS = 10 * 60_000;

export type LocationPrecision = 'COARSE' | 'PRECISE' | 'REGION';
export const LOCATION_PRECISION_LABEL: Record<LocationPrecision, string> = {
  COARSE: '약 1 km',
  PRECISE: '약 10 m',
  REGION: '지역 대표점(위치 공유 미동의)',
};
export const PRECISION_ACCURACY_M: Record<LocationPrecision, number> = { COARSE: 1100, PRECISE: 11, REGION: 50_000 };

export type SubscriptionState = 'PAID' | 'TRIAL' | 'OFFERED' | 'ENDED' | 'NONE';
export const SUBSCRIPTION_STATES: SubscriptionState[] = ['OFFERED', 'TRIAL', 'PAID', 'ENDED', 'NONE'];
export const SUBSCRIPTION_LABEL: Record<SubscriptionState, string> = {
  OFFERED: '체험 제안',
  TRIAL: '체험 중',
  PAID: '구독·구매',
  ENDED: '종료(만료·거절·회수)',
  NONE: '권한 없음',
};

export type ActivationState = 'ON' | 'OFF' | 'DISABLED' | 'UNKNOWN';
export const ACTIVATION_STATES: ActivationState[] = ['ON', 'OFF', 'DISABLED', 'UNKNOWN'];
export const ACTIVATION_LABEL: Record<ActivationState, string> = {
  ON: '활성',
  OFF: '비활성(미적용 포함)',
  DISABLED: '긴급 차단',
  UNKNOWN: '미확인(오프라인·판단 불일치)',
};

export type MapLens = 'subscription' | 'activation';

/** 도시 대표점 — [이름, 위도, 경도] */
type City = [string, number, number];
export const REGION_CITIES: Record<string, Record<string, City[]>> = {
  KR: {
    수도권: [['서울', 37.5665, 126.978], ['인천', 37.4563, 126.7052], ['수원', 37.2636, 127.0286]],
    영남: [['부산', 35.1796, 129.0756], ['대구', 35.8714, 128.6014], ['울산', 35.5384, 129.3114]],
    충청: [['대전', 36.3504, 127.3845], ['청주', 36.6424, 127.489]],
    호남: [['광주', 35.1595, 126.8526], ['전주', 35.8242, 127.148]],
    '강원·제주': [['강릉', 37.7519, 128.8761], ['제주', 33.4996, 126.5312]],
  },
  US: {
    West: [['Los Angeles', 34.0522, -118.2437], ['San Francisco', 37.7749, -122.4194], ['Seattle', 47.6062, -122.3321]],
    East: [['New York', 40.7128, -74.006], ['Boston', 42.3601, -71.0589], ['Washington', 38.9072, -77.0369]],
    South: [['Atlanta', 33.749, -84.388], ['Houston', 29.7604, -95.3698], ['Miami', 25.7617, -80.1918]],
    Midwest: [['Chicago', 41.8781, -87.6298], ['Detroit', 42.3314, -83.0458]],
  },
  EU: {
    DE: [['München', 48.1351, 11.582], ['Frankfurt', 50.1109, 8.6821], ['Berlin', 52.52, 13.405]],
    FR: [['Paris', 48.8566, 2.3522], ['Lyon', 45.764, 4.8357]],
    IT: [['Milano', 45.4642, 9.19], ['Roma', 41.9028, 12.4964]],
    ES: [['Madrid', 40.4168, -3.7038], ['Barcelona', 41.3874, 2.1686]],
    NL: [['Amsterdam', 52.3676, 4.9041], ['Rotterdam', 51.9244, 4.4777]],
  },
};

/** 32비트 FNV-1a — VIN에서 결정적 난수 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const unit = (vin: string, salt: string) => hash32(`${salt}:${vin}`) / 0x1_0000_0000;

const KM_PER_DEG = 111.32;
function offsetKm(lat: number, lng: number, northKm: number, eastKm: number): [number, number] {
  return [lat + northKm / KM_PER_DEG, lng + eastKm / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180))];
}

export const roundTo = (v: number, step: number) => Math.round(v / step) * step;
/** 정밀도를 낮춘다 — 소수 자릿수를 정밀도에 맞춰 잘라 부동소수 꼬리가 남지 않게 */
export function coarsen(lat: number, lng: number, step: number): [number, number] {
  const digits = Math.max(0, Math.round(-Math.log10(step)));
  return [Number(roundTo(lat, step).toFixed(digits)), Number(roundTo(lng, step).toFixed(digits))];
}

export function citiesOf(country: string, region: string): City[] {
  const byRegion = REGION_CITIES[country];
  if (!byRegion) return [];
  return byRegion[region] ?? Object.values(byRegion)[0] ?? [];
}

/** 합성 모집단은 도시 주변 넓게(교외 포함) 퍼뜨린다 */
export const SYNTHETIC_SPREAD_KM = 40;

/** 위치 공유 동의 — 모의값. 데모의 '통신 지연 차량'은 미동의로 두어 지역 대표점 표시를 보여 준다, 합성은 약 5% */
export function locationConsent(vin: string): boolean {
  if (vin === 'KMH-NX4-0003') return false;
  if (vin.startsWith('SYN-')) return unit(vin, 'consent') >= 0.05;
  return true;
}

export interface MockPosition {
  lat: number;
  lng: number;
  city: string;
  /** 진행 방향(도, 북=0) — 정지 차량은 주차 방향 */
  heading: number | null;
}

/**
 * 모의 위치 — 도시 대표점에서 VIN마다 2~(2+spreadKm) km 떨어진 기준점, 움직이는 차량은 기준점 둘레 반경 1.5~4.5 km 원을 12~20분에 한 바퀴 돈다.
 * tMs가 같으면 같은 위치(결정적)다. 국가·지역이 지도에 없으면 null.
 */
export function mockPosition(vin: string, country: string, region: string, tMs: number, moving: boolean, spreadKm = 12): MockPosition | null {
  const cities = citiesOf(country, region);
  if (!cities.length) return null;
  const [city, cLat, cLng] = cities[Math.floor(unit(vin, 'city') * cities.length) % cities.length];
  const a = unit(vin, 'angle') * 2 * Math.PI;
  // 제곱근 — 원판 안에 고르게 퍼지게(가운데로 몰리지 않게)
  const d = 2 + Math.sqrt(unit(vin, 'dist')) * spreadKm;
  const [bLat, bLng] = offsetKm(cLat, cLng, d * Math.cos(a), d * Math.sin(a));
  // 주차한 차도 방향이 있다 — VIN마다 정해진 주차 방향(지도 자동차가 모두 북쪽을 보지 않게)
  if (!moving) return { lat: bLat, lng: bLng, city, heading: Math.floor(unit(vin, 'park') * 360) };
  const r = 1.5 + unit(vin, 'radius') * 3;
  const periodMs = (12 + unit(vin, 'period') * 8) * 60_000;
  const th = unit(vin, 'phase') * 2 * Math.PI + ((tMs % periodMs) / periodMs) * 2 * Math.PI;
  const [lat, lng] = offsetKm(bLat, bLng, r * Math.cos(th), r * Math.sin(th));
  // 반시계 원운동의 접선 방향 — 북쪽 성분 −sinθ, 동쪽 성분 cosθ
  const heading = ((Math.atan2(Math.cos(th), -Math.sin(th)) * 180) / Math.PI + 360) % 360;
  return { lat, lng, city, heading: Math.round(heading) };
}

/** 지역 대표점 — 그 지역 첫 도시를 0.1°로 */
export function regionPoint(country: string, region: string): { lat: number; lng: number; city: string } | null {
  const c = citiesOf(country, region)[0];
  if (!c) return null;
  const [lat, lng] = coarsen(c[1], c[2], 0.1);
  return { lat, lng, city: c[0] };
}

/** 차량 한 대의 구독 상태 — 권한 여러 개면 구독·구매 > 체험 중 > 제안 > 종료 > 없음. catalogId를 주면 그 상품 권한만 */
export function subscriptionState(grants: Entitlement[], today: string, catalogId?: string): SubscriptionState {
  const gs = catalogId ? grants.filter((g) => g.catalogId === catalogId) : grants;
  let best: SubscriptionState = 'NONE';
  const rank: Record<SubscriptionState, number> = { NONE: 0, ENDED: 1, OFFERED: 2, TRIAL: 3, PAID: 4 };
  for (const g of gs) {
    const s = grantState(g, today);
    const v: SubscriptionState =
      g.kind !== '체험' ? (s.effective ? 'PAID' : 'ENDED') : s.state === 'ACTIVE' && s.effective ? 'TRIAL' : s.state === 'OFFERED' ? 'OFFERED' : 'ENDED';
    if (rank[v] > rank[best]) best = v;
  }
  return best;
}

export interface RuntimeFlagView {
  flagKey: string;
  local: { value: boolean; reason: string };
  drift: boolean;
}

/**
 * 기능 활성 상태 — flagKey를 주면 그 플래그, 아니면 차량 전체.
 * 차단이 하나라도 걸려 있으면 DISABLED, 오프라인·판단 불일치는 UNKNOWN(차량 상태를 단정하지 않는다), 켜진 플래그가 있으면 ON.
 * 게시본이 없는 차량(배포 대상 밖)은 그 기능이 실리지 않았으므로 OFF다.
 */
export function activationState(v: { link: 'ONLINE' | 'OFFLINE'; kills: string[]; flags: RuntimeFlagView[] }, flagKey?: string): ActivationState {
  const flags = flagKey ? v.flags.filter((f) => f.flagKey === flagKey) : v.flags;
  if (flags.some((f) => f.local.reason === 'KILL_SWITCH') || (!flagKey && v.kills.length > 0)) return 'DISABLED';
  if (v.link === 'OFFLINE' || flags.some((f) => f.drift)) return 'UNKNOWN';
  return flags.some((f) => f.local.value) ? 'ON' : 'OFF';
}

export interface FleetMapPosition {
  lat: number;
  lng: number;
  precision: LocationPrecision;
  accuracyM: number;
  city: string;
  heading: number | null;
}

export interface FleetMapVehicle {
  vin: string;
  label: string | null;
  source: 'DEMO' | 'SYNTHETIC';
  country: string;
  region: string;
  vehicleModel: string;
  trim: string;
  position: FleetMapPosition | null;
  moving: boolean;
  /** 마지막 위치가 지금 위치가 아님(오프라인) */
  stale: boolean;
  link: 'ONLINE' | 'OFFLINE' | null;
  subscription: SubscriptionState;
  /** 런타임이 없는 합성 차량은 null */
  activation: ActivationState | null;
  kills: string[];
}

export interface FleetMapSummaryRow {
  country: string;
  total: number;
  located: number;
  subscription: Record<SubscriptionState, number>;
  activation: Record<ActivationState, number>;
}

export function summarize(vs: FleetMapVehicle[]): FleetMapSummaryRow[] {
  const m = new Map<string, FleetMapSummaryRow>();
  for (const v of vs) {
    let row = m.get(v.country);
    if (!row) {
      row = { country: v.country, total: 0, located: 0, subscription: { PAID: 0, TRIAL: 0, OFFERED: 0, ENDED: 0, NONE: 0 }, activation: { ON: 0, OFF: 0, DISABLED: 0, UNKNOWN: 0 } };
      m.set(v.country, row);
    }
    row.total++;
    if (v.position) row.located++;
    row.subscription[v.subscription]++;
    if (v.activation) row.activation[v.activation]++;
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
}

export const MAP_PRIVACY_NOTE =
  '위치는 데모용 모의 좌표입니다. 지도에는 약 1 km로 낮춘 위치만 보이고, 한 대의 정밀 위치는 상세에서만 열리며 열람이 감사에 남습니다. 위치는 저장하지 않습니다. 개인정보 처리 기준(D5)이 정해지면 정밀도·보존·열람 역할을 그 기준으로 바꿉니다.';
