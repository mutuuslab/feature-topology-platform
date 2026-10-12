// Variant 조건 관리(D02-01) · 기능 지원 조건 관리(D02-02) — Feature Version이 어느 차량 사양에 맞고(Variant: 국가·차종·트림·UPG-VC),
// 그 차량이 기능을 실행할 수 있는가(지원: 대상 ECU의 SW가 요구 Version 이상). 평가기(P0 이식)는 바꾸지 않고, 이 판정은
// Variant 매트릭스·정책 검증 참고(INFO)·배포 대상 설명에 쓴다. 문맥 품질이 불명이면 판정도 불명(null)이다.
import { semverCompare } from '../flags/p0';
import type { Vehicle } from '../schemas/policy';

export interface VariantFeature {
  featureId: string;
  version: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string[];
  swIds: string[];
  swVersions: string[];
  ecuPnos: string[];
}

export interface VariantRow {
  vin: string;
  label: string;
  quality: Vehicle['quality'];
  scope: boolean;
  /** Feature에 UPG-VC가 없으면 null(조건 없음) */
  upgVc: boolean | null;
  /** Variant 조건 충족 — 범위 + UPG-VC */
  variant: boolean;
  required: string | null;
  actual: string;
  /** 기능 지원 — 대상 ECU SW가 요구 Version 이상 (요구 없음·범위 밖이면 null) */
  supported: boolean | null;
  verdict: 'APPLICABLE' | 'NOT_SUPPORTED' | 'NOT_APPLICABLE' | 'UNKNOWN';
  reason: string;
}

/**
 * 요구 SW Version — 구현 연결의 첫 SW가 기능 앱 SW다(예: FEAT-00022 SW-CARE-SDIST-APP 1.2.1, 둘째는 SCC 어댑터 2.3.0).
 * 차량 문맥의 swVersion은 기능 앱 SW를 보고하므로 그것과 비교한다.
 */
export function requiredSw(f: Pick<VariantFeature, 'swVersions'>): string | null {
  return f.swVersions.find(Boolean) ?? null;
}

export function variantRow(f: VariantFeature, v: Vehicle): VariantRow {
  const scope = v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim;
  const upgVc = f.upgVc.length ? f.upgVc.includes(v.upgVc) : null;
  const variant = scope && upgVc !== false;
  const required = requiredSw(f);
  const cmp = required ? semverCompare(v.swVersion, required) : null;
  const supported = !variant || !required ? null : cmp === null ? null : cmp >= 0;
  const base = { vin: v.vin, label: v.label, quality: v.quality, scope, upgVc, variant, required, actual: v.swVersion, supported };
  if (v.quality !== 'TRUSTED') return { ...base, verdict: 'UNKNOWN', reason: `문맥 ${v.quality} — 판정 불명(Safe Default)` };
  if (!scope) return { ...base, verdict: 'NOT_APPLICABLE', reason: `범위 밖 (${v.country}/${v.vehicleModel}/${v.trim})` };
  if (upgVc === false) return { ...base, verdict: 'NOT_APPLICABLE', reason: `UPG-VC ${v.upgVc} 미포함` };
  if (supported === false) return { ...base, verdict: 'NOT_SUPPORTED', reason: `SW ${v.swVersion} < 요구 ${required}` };
  return { ...base, verdict: 'APPLICABLE', reason: required ? `SW ${v.swVersion} ≥ ${required}` : '지원 조건 없음' };
}

export function variantMatrix(f: VariantFeature, fleet: Vehicle[]) {
  const rows = fleet.map((v) => variantRow(f, v));
  const n = (k: VariantRow['verdict']) => rows.filter((r) => r.verdict === k).length;
  return { conditions: { scope: `${f.country}/${f.vehicleModel}/${f.trim}`, upgVc: f.upgVc, requiredSw: requiredSw(f), ecu: f.ecuPnos[0] ?? null, swId: f.swIds[0] ?? null }, summary: { applicable: n('APPLICABLE'), notSupported: n('NOT_SUPPORTED'), notApplicable: n('NOT_APPLICABLE'), unknown: n('UNKNOWN') }, rows };
}
