// 차량 정책 캐시(P9) — 차량 시뮬레이터(vehicle-runtime.service)가 받아 둔 서명 정책을 쓰기 전에 다시 확인한다. 판정 규칙은 contracts rules/policy-cache.ts.
// FR-LPC-001-003 유효 기간 · 002-003 만료 → Safe Default · 002-004 위임 기록 · 003-001 사용 전 서명 재검증 · 003-002 해시 재계산 · 003-003 손상 제외·직전 캐시 대체
// FR-RTE-001-003 수신 파싱 · FR-RTE-002-004/005 로컬 실행 결과·평가 실패 기록. 차량 쪽 기록은 상태가 바뀔 때만 남긴다(같은 사유 반복 없음).
import { cacheStatus, chooseCache, PublicationPayload, SignatureSchema, validityProblem, type CacheChoice, type CacheStatus, type FlagResult, type Publication } from '@ff/contracts';
import type { PolicyCacheEntry, VehicleRuntimeState } from '../../d06-qsec/secure-deploy/publication.repo';

// @req FR-RTE-001-002
// @req FR-RTE-001-003
/** 수신 때 정책 게시본 파싱 — 필드별 형식(PublicationPayload)·유효 기간. 문제가 있으면 거부 사유 */
export function receiveProblem(p: Publication['payload'], now: number): 'MALFORMED' | 'EXPIRED' | null {
  if (!PublicationPayload.safeParse(p).success || !p.policy) return 'MALFORMED';
  return validityProblem(p, now);
}

/** 새 캐시 — 지금 캐시는 직전 캐시로 내려간다(직전의 직전은 버린다) */
export function cacheEntryOf(pub: Pick<Publication, 'payload' | 'signature' | 'publicationId'>, prev: VehicleRuntimeState['bundles'][string] | undefined): VehicleRuntimeState['bundles'][string] {
  const p = pub.payload;
  const previous = prev ? (({ previous: _drop, ...rest }) => rest)(prev) : null;
  return { publicationId: pub.publicationId, sequence: p.sequence, payloadHash: pub.signature.payloadHash, policy: p.policy!, validUntil: p.validUntil ?? null, payload: p, signature: pub.signature, previous };
}

// @req FR-LPC-003-001
// @req FR-LPC-003-002
/** 캐시 한 건 상태 — 신뢰 앵커 검증 뒤 서명 payload의 기한을 확인한다. 미검증 구형 캐시는 보존하되 재취득이 필요하다. */
export function entryStatus(e: PolicyCacheEntry | null | undefined, now: number, verify: (payload: unknown, sig: NonNullable<PolicyCacheEntry['signature']>) => string): CacheStatus | null {
  if (!e) return null;
  if (!e.payload || !e.signature) return 'UNVERIFIED';
  if (!SignatureSchema.safeParse(e.signature).success) return 'SIGNATURE_INVALID';
  const reason = verify(e.payload, e.signature);
  if (reason === 'SIGNATURE_VALID' && (!PublicationPayload.safeParse(e.payload).success || e.payload.kind !== 'POLICY' || !e.payload.policy)) return 'UNVERIFIED';
  return cacheStatus(e.payload, now, reason);
}

export interface CacheView extends CacheChoice {
  flagKey: string;
  featureId: string;
  publicationId: string;
  sequence: number;
  validUntil: string | null;
  status: CacheStatus | null;
  previous: CacheStatus | null;
  previousCache: { publicationId: string; status: CacheStatus | null } | null;
}

// @req FR-LPC-003-003
// @req FR-LPC-002-003
/** 평가에 쓸 캐시 고르기 — 고른 캐시의 정책(payload 안 정책이 서명된 값)과 화면용 상태 */
export function assessCache(flagKey: string, b: VehicleRuntimeState['bundles'][string], now: number, verify: Parameters<typeof entryStatus>[2]) {
  const status = entryStatus(b, now, verify);
  const prevStatus = entryStatus(b.previous, now, verify);
  const choice = chooseCache(status, prevStatus);
  const chosen = choice.use === 'CURRENT' ? b : choice.use === 'PREVIOUS' ? b.previous! : null;
  const view: CacheView = {
    ...choice,
    flagKey,
    featureId: b.policy.featureId,
    publicationId: b.publicationId,
    sequence: b.sequence,
    validUntil: b.payload?.validUntil ?? null,
    status,
    previous: prevStatus,
    previousCache: b.previous ? { publicationId: b.previous.publicationId, status: prevStatus } : null,
  };
  return { view, chosen, policy: chosen ? (chosen.payload?.policy ?? chosen.policy) : b.policy };
}

/** Safe Default 위임 결과 — 평가기를 돌리지 않는다(쓸 수 있는 캐시가 없다) */
export function delegatedResult(policy: VehicleRuntimeState['bundles'][string]['policy'], flagKey: string, detail: string): FlagResult {
  return {
    flagKey,
    value: policy.safeDefault,
    variant: policy.safeDefault ? 'on' : 'off',
    decision: 'SAFE_DEFAULT',
    reason: 'ERROR_SAFE_DEFAULT',
    policyId: policy.policyId,
    revision: policy.revision,
    trace: [{ step: 'DECIDE', result: 'UNKNOWN', detail }],
  };
}

// @req FR-SDM-002-002
/**
 * 차량 쪽 기록(FR-LPC-002-004·003-003·FR-RTE-002-005) — 캐시 판정이 바뀔 때만 한 줄(사유·Feature·Flag·시각). 바뀌었으면 true(저장 필요).
 * 정상으로 돌아오면 표시만 지운다(기록하지 않는다).
 */
export function noteCache(s: VehicleRuntimeState, v: CacheView, at: string, evalError?: string): boolean {
  const key = evalError ? `ERROR:${evalError}` : `${v.use}:${v.delegation ?? ''}:${v.excluded ?? ''}`;
  const notes = (s.cacheNotes ??= {});
  if (notes[v.flagKey] === key) return false;
  const first = notes[v.flagKey] === undefined;
  notes[v.flagKey] = key;
  const base = { at, publicationId: v.publicationId, kind: 'POLICY', featureId: v.featureId, flagKey: v.flagKey };
  if (evalError) s.log.push({ ...base, result: 'SAFE_DEFAULT', detail: 'EVALUATION_ERROR' });
  else if (v.use === 'SAFE_DEFAULT') s.log.push({ ...base, result: 'SAFE_DEFAULT', detail: v.delegation! });
  else if (v.excluded) s.log.push({ ...base, result: 'CACHE_EXCLUDED', detail: v.excluded });
  // 처음 본 정상 캐시는 표시만 남긴다(기록 없음) — 저장은 하지 않아도 된다
  else return !first;
  return true;
}
