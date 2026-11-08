// 전시용 가상 차량은 원본 시연 사양·권한·품질 상태를 보존해 늘린다. 실차/실제 위치로 표시하지 않는다.
import type { Entitlement, Vehicle, VehicleProfile } from '@ff/contracts';
import { showcaseScale } from './showcase-scale';

export function showcaseVehicleCount(env: Record<string, string | undefined>, baseline: number): number {
  if (env.FF_SHOWCASE !== '1' || env.FF_ENV === 'production' || env.FF_SEED === 'none') return baseline;
  const n = Number(env.FF_SHOWCASE_VEHICLES ?? 480) * showcaseScale(env);
  if (!Number.isInteger(n) || n < baseline || n > 1200) throw new Error(`FF_SHOWCASE_VEHICLES는 ${baseline}~1200 정수여야 합니다.`);
  return n;
}

export function expandShowcaseFleet(base: { fleet: Vehicle[]; profiles: VehicleProfile[]; grants: Entitlement[] }, count: number) {
  if (!base.fleet.length || count <= base.fleet.length) return base;
  const fleet = [...base.fleet], profiles = [...base.profiles], grants = [...base.grants];
  const used = new Set(fleet.map((v) => v.vin));
  let grantSeq = 90_000_000;
  for (let i = 0; fleet.length < count; i++) {
    const vin = `SHOWCASE-${String(i + 1).padStart(4, '0')}`;
    if (used.has(vin)) continue;
    const original = base.fleet[i % base.fleet.length];
    const profile = base.profiles.find((p) => p.vin === original.vin);
    if (!profile) throw new Error('전시용 차량의 기준 성향을 찾지 못했습니다.');
    used.add(vin);
    fleet.push({ ...original, vin, label: `가상 차량 ${String(i + 1).padStart(3, '0')} · ${original.vehicleModel} ${original.trim}`, fleet: 'DEMO', gleo: false });
    profiles.push({ ...profile, vin, source: 'DEMO' });
    const originals = base.grants.filter((e) => e.vin === original.vin);
    const ids = new Map(originals.map((e) => [e.grantId, `ENT-S${grantSeq++}`]));
    for (const e of originals) grants.push({ ...e, grantId: ids.get(e.grantId)!, vin, source: 'DEMO', fromTrial: e.fromTrial ? ids.get(e.fromTrial) ?? null : null, note: `가상 전시 데이터${e.note ? ` · ${e.note}` : ''}` });
  }
  return { fleet, profiles, grants };
}
