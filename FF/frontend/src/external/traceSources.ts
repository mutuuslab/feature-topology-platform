// 외부 창의 플랫폼 추적 원천 — Feature 목록·Flag 원장·요구 ID 색인. 추적 패널과 Trackers 표가 같은 캐시를 쓴다.
import { useQuery } from '@tanstack/react-query';
import type { FeatureFlagRow } from '@ff/contracts';
import { call } from '../api/client';
import { externalDemo as T } from '../copy/external-demo';
import { featureKey, featureTarget, validFlagRows, type ExternalFeature } from './trace';

export type RequirementIndex = { features: ExternalFeature[]; failed: string[] };

export function useTraceSources(role: string, needsRequirements: boolean) {
  const featuresQuery = useQuery<ExternalFeature[], Error>({
    queryKey: ['externalFeatures'],
    queryFn: async ({ signal }) => {
      const body = await call<{ items: ExternalFeature[] }>('listFeatures', { signal });
      if (!Array.isArray(body?.items) || !body.items.every((feature) => featureTarget(feature.featureId, feature.version))) throw new Error(T.malformedFeatures);
      return body.items;
    },
    staleTime: 60_000,
  });
  const flagsQuery = useQuery<FeatureFlagRow[], Error>({
    queryKey: ['externalFlags'],
    queryFn: async ({ signal }) => {
      const rows = await call<FeatureFlagRow[]>('featureFlags', { signal });
      if (!validFlagRows(rows)) throw new Error(T.malformedFlags);
      return rows;
    },
    staleTime: 30_000,
  });
  const index = useQuery<RequirementIndex, Error>({
    queryKey: ['externalRequirements', role, (featuresQuery.data ?? []).map(featureKey)],
    enabled: needsRequirements && featuresQuery.isSuccess,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const summaries = featuresQuery.data ?? [];
      const features: ExternalFeature[] = [];
      const failed: string[] = [];
      let cursor = 0;
      // 목록 API는 요구 ID를 생략한다. 실제 상세만 읽고, 창을 닫으면 중지하며, 동시 요청은 네 개로 제한한다.
      await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, async () => {
        while (cursor < summaries.length) {
          const summary = summaries[cursor++];
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            const body = await call<{ feature: ExternalFeature }>('featureDetail', { params: { id: summary.featureId, ver: summary.version }, role, signal });
            const feature = body?.feature;
            if (!feature || featureKey(feature) !== featureKey(summary) || !Array.isArray(feature.requirementIds) || !feature.requirementIds.every((id) => typeof id === 'string')) throw new Error(T.confirm);
            features.push({ ...summary, requirementIds: feature.requirementIds });
          } catch (error) {
            if (signal.aborted) throw error;
            failed.push(featureKey(summary));
          }
        }
      }));
      const byKey = new Map(features.map((feature) => [featureKey(feature), feature]));
      return { features: summaries.flatMap((summary) => byKey.has(featureKey(summary)) ? [byKey.get(featureKey(summary))!] : []), failed };
    },
  });
  return { featuresQuery, flagsQuery, index };
}
