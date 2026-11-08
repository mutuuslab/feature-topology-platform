// 기본 대상 고르기 — 출시 준비 RD-OPS-02(빈 DB 첫 실행).
// 예전에는 화면마다 데모 데이터의 ID(FEAT-00022·ego-01 등)를 기본값으로 박아 두어, 데모 데이터가 없는 고객 설치에서
// 없는 Feature·차량을 조회하고 그 ID를 화면에 보였다. 이제는 그 예시 ID가 실제로 있을 때만 쓰고(데모·공개 사이트는 그대로),
// 없으면 실제 목록의 첫 항목, 목록이 비었으면 null(화면은 빈 상태 안내)이다. undefined = 아직 목록을 받는 중.
import { useState } from 'react';
import { useApi } from '../api/hooks';

export function pickDefault<T>(items: readonly T[] | undefined, preferred: (t: T) => boolean): T | null | undefined {
  if (!items) return undefined;
  return items.find(preferred) ?? items[0] ?? null;
}

export interface FeatureRef {
  featureId: string;
  version: string;
}

/** 기본 Feature — 예시(prefer)가 목록에 있으면 그 판 그대로, 없으면 첫 Feature의 최신 판 */
export function useDefaultFeature(prefer: FeatureRef, enabled = true): FeatureRef | null | undefined {
  const q = useApi<{ items: FeatureRef[] }>('listFeatures', { query: { latestOnly: true } }, { enabled });
  if (!enabled) return undefined;
  // 목록을 못 받으면(오류) 판단할 수 없다 — 예전처럼 예시를 그대로 조회하고, 그 조회의 오류 안내가 사정을 말한다
  if (q.isError || (q.data && !Array.isArray(q.data.items))) return prefer;
  const hit = pickDefault(q.data?.items, (f) => f.featureId === prefer.featureId);
  if (!hit) return hit;
  return hit.featureId === prefer.featureId ? prefer : { featureId: hit.featureId, version: hit.version };
}

/** 차량 고르기 — 사용자가 고르기 전에는 예시 VIN(있으면)·첫 차량. none = 차량이 하나도 없다(빈 설치) */
export function useVehiclePick(preferVin: string, initial: string | null = null) {
  const vehicles = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  const [picked, setVin] = useState<string | null>(initial);
  const fallback = pickDefault(vehicles.data ? (Array.isArray(vehicles.data.items) ? vehicles.data.items : [{ vin: preferVin, label: '' }]) : undefined, (v) => v.vin === preferVin);
  return { vin: picked ?? fallback?.vin ?? (vehicles.isError ? preferVin : ''), setVin, none: !picked && fallback === null, vehicles };
}
