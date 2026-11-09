import { localAppHref } from '../../file-routing';
// Unleash 평가·서명 게시본·차량 수신은 독립 근거다. 현재 정책 개정과 서명 검증이 일치하는 상세만 수신 시각/VIN으로 사용한다.
import { useQuery } from '@tanstack/react-query';
import type { FeatureFlagRow } from '@ff/contracts';
import { call, type ApiError } from '../../api/client';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function flagPublicationEvidence(row: FeatureFlagRow, value: unknown) {
  if (!row.policy || !row.publication || !record(value) || !record(value.publication) || value.verification?.valid !== true) return null;
  const p = value.publication;
  const payload = p.payload;
  if (!record(payload) || p.kind !== 'POLICY' || p.publicationId !== row.publication.publicationId || payload.publicationId !== p.publicationId ||
    payload.featureId !== row.featureId || payload.featureVersion !== row.version || payload.flagKey !== row.flagKey ||
    payload.policy?.policyId !== row.policy.policyId || payload.policy?.revision !== row.policy.revision ||
    !Number.isInteger(p.confirmed) || p.confirmed < 0 || !Number.isInteger(p.denominator) || p.denominator < p.confirmed ||
    !['SIGNED', 'DISPATCHED', 'CONFIRMED', 'PARTIAL', 'DIVERGED', 'TIMEOUT'].includes(p.status) ||
    !Array.isArray(payload.targets) || !Array.isArray(value.readbacks)) return null;
  const readbacks = value.readbacks.filter((r: unknown): r is { publicationId: string; vin: string; at: string; observed?: string; rejectReason?: string } =>
    record(r) && r.publicationId === p.publicationId && typeof r.vin === 'string' && payload.targets.includes(r.vin) && time(r.at));
  const latest = readbacks.reduce<(typeof readbacks)[number] | null>((last, r) => !last || Date.parse(r.at) > Date.parse(last.at) ? r : last, null);
  return { publicationId: p.publicationId as string, status: p.status as string, confirmed: p.confirmed as number, denominator: p.denominator as number,
    createdAt: time(p.createdAt) ? p.createdAt : null, latest: latest ? { vin: latest.vin, at: latest.at, rejected: latest.observed === 'REJECTED' || !!latest.rejectReason } : null };
}
export function useFlagPublication(row: FeatureFlagRow) {
  const params = { id: row.publication?.publicationId ?? '' };
  const query = useQuery<unknown, ApiError>({ queryKey: ['publicationDetail', params, {}], enabled: !!row.publication && !!row.policy,
    queryFn: ({ signal }) => call('publicationDetail', { params, signal }), retry: false });
  return { ...query, evidence: query.isSuccess ? flagPublicationEvidence(row, query.data) : null };
}
export const flagPublicationPath = (id: string) => localAppHref('/deployments/' + encodeURIComponent(id));
export const flagReceiptVehiclePath = (vin: string) => localAppHref('/fleet/vehicles/' + encodeURIComponent(vin));
