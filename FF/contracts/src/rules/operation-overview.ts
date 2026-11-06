// 홈 '차량 정책 수신 현황' 모델 — 차량이 보낸 값(회신)만으로 상태를 센다. 화면(전체 목록으로 거르기)과 서버 요약(GET /api/fleet/operation-summary)이 같은 함수를 쓴다.
// 요약은 거르지 않은 첫 화면만 — 건수·묶음·시각 분포는 전체 차량 기준으로 서버가 세고, 표는 첫 쪽만 싣는다(홈이 차량·회신 전체를 받지 않게).
import { operationAdoption, type AdoptionEvaluation, type OperationAdoption } from './operation-adoption';
export interface OperationVehicle { vin: string; country?: string; vehicleModel?: string; trim?: string }
export interface OperationFlag { flagKey: string; publicationId: string | null; sequence: number | null; local: { value: boolean; reason: string }; drift: boolean }
export interface OperationRuntime { vin: string; scope: string; quality: string; link: string; flags: OperationFlag[]; last: { at: string; detail: string } | null }
export interface OperationPolicy { policyId: string; revision: number; featureId: string; featureVersion: string; flagKey: string; status: string }
export interface OperationFeature { featureId: string; version: string; country: string; vehicleModel: string }
export interface OperationPublication { publicationId: string; kind: string; status: string; createdAt: string; payload: { targets: string[]; flagKey: string | null; featureId: string; policy: { policyId: string; revision: number } | null } }
export interface OperationReadback { vin: string; publicationId: string; at: string; metricType: string; observed: string; rejectReason?: string }
export interface OperationSync { at: string; request: { policyId?: string; revision?: number; mode?: string }; response: { outcome?: string } }
export interface OperationGroup { name: string; total: number; states: Record<OperationState, number> }
export interface OperationFilters { country: string; model: string; flag: string }
export interface OperationInput { runtime: OperationRuntime[]; vehicles: OperationVehicle[]; policies: OperationPolicy[]; features: OperationFeature[]; publications: OperationPublication[]; readbacks: OperationReadback[]; syncs: OperationSync[];
  /** 차량 평가 기록(OTel span을 차량으로 되짚은 것) — 'Feature 적용 현황'의 실제 사용 단계. 없으면 그 단계는 비운다 */
  evaluations?: AdoptionEvaluation[] }
export type OperationState = 'ON' | 'OFF' | 'SAFE' | 'UNKNOWN';
export const UNKNOWN_GROUP = '__unknown__';
export interface OperationEvent { phase: 'DEPLOY' | 'SYNC' | 'READBACK'; at: string; to: string; label: string; failed: boolean }
export interface OperationPreparationIssue { publicationId: string; policyId: string; revision: number; reason: 'SYNC_UNKNOWN' | 'SYNC_LATE' | 'TIME_UNKNOWN' }
const time = (value: string) => Date.parse(value);

/** Received values only. No inferred ON from deployed policies, catalogues or missing bundles. */
export function receivedState(row: OperationRuntime, flag: string): OperationState {
  const flags = flag ? row.flags.filter((f) => f.flagKey === flag) : row.flags;
  if (row.quality !== 'TRUSTED' || !flags.length) return 'UNKNOWN';
  if (flags.some((f) => f.local.reason === 'KILL_SWITCH')) return 'SAFE';
  return flags.some((f) => f.local.value === true) ? 'ON' : 'OFF';
}

export function buildOperationModel(input: OperationInput, filters: OperationFilters) {
  const vehicleByVin = new Map(input.vehicles.map((v) => [v.vin, v]));
  const featureByVersion = new Map(input.features.map((f) => [`${f.featureId}@${f.version}`, f]));
  const allRows = input.runtime.map((runtime) => ({ runtime, vehicle: vehicleByVin.get(runtime.vin), state: receivedState(runtime, filters.flag) }));
  const matches = (value: string | undefined, filter: string) => !filter || (filter === UNKNOWN_GROUP ? !value : value === filter);
  const rows = allRows.filter(({ vehicle }) => matches(vehicle?.country, filters.country) && matches(vehicle?.vehicleModel, filters.model));
  const vins = new Set(rows.map((r) => r.runtime.vin));
  const flagFeatures = new Set(input.policies.filter((p) => p.flagKey === filters.flag).map((p) => p.featureId));
  const publications = input.publications.filter((p) => p.payload.targets.some((vin) => vins.has(vin)) && (!filters.flag || p.payload.flagKey === filters.flag || (!p.payload.flagKey && flagFeatures.has(p.payload.featureId))));
  const publicationById = new Map(input.publications.map((p) => [p.publicationId, p]));
  const publicationIds = new Set(publications.map((p) => p.publicationId));
  // ACK is transport acknowledgement, not an applied-value readback.
  const readbacks = input.readbacks.filter((r) => vins.has(r.vin) && publicationIds.has(r.publicationId) && r.metricType === 'READBACK');
  const latestReadback = new Map<string, OperationReadback>();
  for (const r of readbacks) if (Number.isFinite(time(r.at)) && (!latestReadback.has(r.vin) || time(latestReadback.get(r.vin)!.at) < time(r.at))) latestReadback.set(r.vin, r);
  const scopedPolicies = input.policies.filter((p) => {
    const feature = featureByVersion.get(`${p.featureId}@${p.featureVersion}`);
    return (!filters.flag || p.flagKey === filters.flag) && matches(feature?.country, filters.country) && matches(feature?.vehicleModel, filters.model);
  });
  const policyVersions = new Set(publications.flatMap((p) => p.payload.policy ? [`${p.payload.policy.policyId}@${p.payload.policy.revision}`] : []));
  const syncs = input.syncs.filter((s) => policyVersions.has(`${s.request?.policyId}@${s.request?.revision}`));
  // These are source-record checks, not a claim of vehicle delivery or current replica readiness.
  const preparationIssues: OperationPreparationIssue[] = publications.flatMap((p) => {
    const policy = p.payload.policy;
    if (!policy) return [];
    const successes = syncs.filter((s) => s.request.policyId === policy.policyId && s.request.revision === policy.revision && s.response.outcome === 'SYNCED');
    const valid = successes.map((s) => time(s.at)).filter(Number.isFinite);
    const reason = !successes.length ? 'SYNC_UNKNOWN' : !valid.length || !Number.isFinite(time(p.createdAt)) ? 'TIME_UNKNOWN' : Math.min(...valid) > time(p.createdAt) ? 'SYNC_LATE' : undefined;
    return reason ? [{ publicationId: p.publicationId, ...policy, reason }] : [];
  });
  const events: OperationEvent[] = [
    ...publications.map((p) => ({ phase: 'DEPLOY' as const, at: p.createdAt, to: `/deployments/${encodeURIComponent(p.publicationId)}`, label: p.publicationId, failed: ['DIVERGED', 'TIMEOUT'].includes(p.status) })),
    ...syncs.map((s) => ({ phase: 'SYNC' as const, at: s.at, to: `/policies/${encodeURIComponent(s.request.policyId!)}?tab=unleash`, label: `${s.request.policyId}@r${s.request.revision} ${s.response?.outcome ?? ''} (${s.request.mode ?? '?'})`, failed: s.response?.outcome !== 'SYNCED' })),
    ...readbacks.map((r) => ({ phase: 'READBACK' as const, at: r.at, to: `/fleet/vehicles/${encodeURIComponent(r.vin)}`, label: `${r.vin} ${r.rejectReason ?? r.metricType}`, failed: !!r.rejectReason || r.observed === 'REJECTED' })),
  ];
  const validEvents = events.filter((e) => Number.isFinite(time(e.at))).sort((a, b) => time(a.at) - time(b.at));
  const group = (key: 'country' | 'vehicleModel') => {
    const groups = new Map<string, OperationGroup>();
    for (const row of rows) {
      const name = row.vehicle?.[key] || UNKNOWN_GROUP;
      const current = groups.get(name) ?? { name, total: 0, states: { ON: 0, OFF: 0, SAFE: 0, UNKNOWN: 0 } };
      current.total++; current.states[row.state]++; groups.set(name, current);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  };
  const viewRows = rows.map((row) => ({ ...row, flags: row.runtime.flags.filter((f) => !filters.flag || f.flagKey === filters.flag), readback: latestReadback.get(row.runtime.vin) }));
  return {
    rows: viewRows,
    safe: rows.filter((r) => r.state === 'SAFE').length,
    attention: attentionOf(viewRows),
    replyGaps: replyGapsOf(publications, readbacks, vins),
    deployed: new Set(scopedPolicies.filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey)).size,
    approvals: scopedPolicies.filter((p) => p.status === 'VALIDATED').length,
    received: rows.filter((r) => r.state !== 'UNKNOWN').length,
    unknown: rows.filter((r) => r.state === 'UNKNOWN').length,
    rejected: readbacks.filter((r) => !!r.rejectReason || r.observed === 'REJECTED').length,
    countryGroups: group('country'), modelGroups: group('vehicleModel'), events: validEvents,
    invalidTimes: events.length - validEvents.length, publicationById, preparationIssues,
    countries: [...new Set(allRows.map((r) => r.vehicle?.country || UNKNOWN_GROUP))].sort(),
    models: [...new Set(allRows.map((r) => r.vehicle?.vehicleModel || UNKNOWN_GROUP))].sort(),
    flags: [...new Set([...input.runtime.flatMap((r) => r.flags.map((f) => f.flagKey)), ...input.policies.map((p) => p.flagKey)])].sort(),
  };
}

/** 홈 Top 목록 상한 — 살펴볼 차량·회신 대기 정책(요약에는 이만큼만 싣는다) */
export const ATTENTION_TOP = 6;
export const REPLY_GAP_TOP = 5;
/** 살펴볼 차량의 종류 — 거부 회신 > 차단 수신 > 미확인(한 대는 앞 종류 하나로만 센다) */
export type OperationAttentionKind = 'REJECTED' | 'SAFE' | 'UNKNOWN';
const ATTENTION_ORDER: OperationAttentionKind[] = ['REJECTED', 'SAFE', 'UNKNOWN'];
export interface OperationAttentionVehicle { vin: string; country?: string; vehicleModel?: string; kind: OperationAttentionKind; reason: string; at: string | null }
export interface OperationAttention { counts: Record<OperationAttentionKind, number>; vehicles: OperationAttentionVehicle[] }
/** 회신 대기 — 게시본 대상 차량(지금 조건) 중 회신(READBACK)이 아직 없는 차량 수 */
export interface OperationReplyGap { publicationId: string; policyId: string; revision: number; flagKey: string | null; targets: number; replied: number; pending: number; createdAt: string }

const rejectedReadback = (r: OperationReadback | undefined) => !!r && (!!r.rejectReason || r.observed === 'REJECTED');

function attentionOf(rows: { runtime: OperationRuntime; vehicle?: OperationVehicle; state: OperationState; readback?: OperationReadback }[]): OperationAttention {
  const counts: Record<OperationAttentionKind, number> = { REJECTED: 0, SAFE: 0, UNKNOWN: 0 };
  const picked = rows.flatMap((row) => {
    const kind: OperationAttentionKind | null = rejectedReadback(row.readback) ? 'REJECTED' : row.state === 'SAFE' ? 'SAFE' : row.state === 'UNKNOWN' ? 'UNKNOWN' : null;
    if (!kind) return [];
    counts[kind]++;
    const reason = kind === 'REJECTED' ? row.readback!.rejectReason || 'REJECTED' : kind === 'SAFE' ? 'KILL_SWITCH' : row.runtime.quality !== 'TRUSTED' ? row.runtime.quality : 'NO_POLICY';
    const at = kind === 'REJECTED' ? row.readback!.at : row.runtime.last?.at ?? null;
    return [{ vin: row.runtime.vin, country: row.vehicle?.country, vehicleModel: row.vehicle?.vehicleModel, kind, reason, at }];
  });
  // 같은 종류 안에서는 연락이 없거나 오래된 차량부터(시각을 못 읽으면 맨 앞)
  const age = (at: string | null) => (at && Number.isFinite(time(at)) ? time(at) : -Infinity);
  picked.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || age(a.at) - age(b.at) || a.vin.localeCompare(b.vin));
  return { counts, vehicles: picked.slice(0, ATTENTION_TOP) };
}

function replyGapsOf(publications: OperationPublication[], readbacks: OperationReadback[], vins: ReadonlySet<string>): OperationReplyGap[] {
  const replied = new Map<string, Set<string>>();
  for (const r of readbacks) (replied.get(r.publicationId) ?? replied.set(r.publicationId, new Set()).get(r.publicationId)!).add(r.vin);
  return publications
    .flatMap((p) => {
      if (!p.payload.policy) return [];
      const targets = new Set(p.payload.targets.filter((vin) => vins.has(vin)));
      const got = [...(replied.get(p.publicationId) ?? [])].filter((vin) => targets.has(vin)).length;
      return targets.size - got > 0 ? [{ publicationId: p.publicationId, policyId: p.payload.policy.policyId, revision: p.payload.policy.revision, flagKey: p.payload.flagKey, targets: targets.size, replied: got, pending: targets.size - got, createdAt: p.createdAt }] : [];
    })
    .sort((a, b) => b.pending - a.pending || (time(a.createdAt) || 0) - (time(b.createdAt) || 0) || a.publicationId.localeCompare(b.publicationId))
    .slice(0, REPLY_GAP_TOP);
}

/** 시각 분포의 점 — 같은 단계·같은 분의 사건을 하나로 묶는다(실패가 있으면 그 사건을 대표로) */
export interface OperationTimelinePoint { phase: OperationEvent['phase']; time: number; count: number; failed: boolean; first: OperationEvent }
export type OperationReady = Record<OperationEvent['phase'], boolean>;

export function timelinePoints(events: readonly OperationEvent[], ready: OperationReady): OperationTimelinePoint[] {
  const groups = new Map<string, { phase: OperationEvent['phase']; time: number; events: OperationEvent[] }>();
  for (const event of events) {
    if (!ready[event.phase]) continue;
    const time = Date.parse(event.at), key = `${event.phase}:${Math.floor(time / 60_000)}`;
    const group = groups.get(key) ?? { phase: event.phase, time, events: [] };
    group.events.push(event); groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ phase: g.phase, time: g.time, count: g.events.length, failed: g.events.some((e) => e.failed), first: g.events.find((e) => e.failed) ?? g.events[0] }));
}

/** 최근 사건 — 읽을 수 있는 단계만, 최근 것부터 */
export const recentEvents = (events: readonly OperationEvent[], ready: OperationReady, n = 6) => events.filter((e) => ready[e.phase]).slice(-n).reverse();

/** 표 한 쪽 — 홈 첫 화면·'더 보기' 단위 */
export const OPERATION_PAGE = 12;

export interface OperationSummaryRow { runtime: OperationRuntime; vehicle?: OperationVehicle; state: OperationState; flags: OperationFlag[]; readback?: OperationReadback }
/** 서버 요약 — 거르지 않은 첫 화면에 필요한 것만. 숫자는 전체 차량·회신 기준 */
export interface OperationSummary {
  generatedAt: string;
  /** 회신(차량 응답)을 읽을 수 있는 역할로 센 요약인가 — 아니면 회신 관련 값은 비어 있다 */
  readbacks: boolean;
  total: number; received: number; unknown: number; deployed: number; approvals: number; rejected: number;
  /** 차단(긴급 차단 사유) 수신 차량 — 옛 요약에는 없다 */
  safe?: number;
  /** 살펴볼 차량(상한 ATTENTION_TOP)과 종류별 전체 수 — 옛 요약에는 없다 */
  attention?: OperationAttention;
  /** 회신 대기 정책(상한 REPLY_GAP_TOP). 회신을 읽을 수 없으면 빈 목록 — 옛 요약에는 없다 */
  replyGaps?: OperationReplyGap[];
  countryGroups: OperationGroup[]; modelGroups: OperationGroup[];
  points: OperationTimelinePoint[]; recent: OperationEvent[]; invalidTimes: number; preparationIssues: OperationPreparationIssue[];
  rows: OperationSummaryRow[];
  /** 표의 Flag·회신이 가리키는 게시본의 정책 판(정책 없는 게시본은 null) */
  publications: { publicationId: string; policy: { policyId: string; revision: number } | null }[];
  countries: string[]; models: string[]; flags: string[];
  /** 'Feature 적용 현황' — 고를 Flag별 차량 상태·단계·회신 시각(rules/operation-adoption). 옛 요약에는 없다 */
  adoption?: OperationAdoption;
}

const flagOf = (f: OperationFlag): OperationFlag => ({ flagKey: f.flagKey, publicationId: f.publicationId, sequence: f.sequence, local: { value: f.local.value, reason: f.local.reason }, drift: f.drift });

export function operationSummary(input: OperationInput, generatedAt: string, readbacks: boolean): OperationSummary {
  const data = buildOperationModel(readbacks ? input : { ...input, readbacks: [] }, { country: '', model: '', flag: '' });
  // 화면과 같은 기준 — 게시본·연동 기록은 늘 있고, 회신은 역할이 읽을 수 있을 때만
  const ready: OperationReady = { DEPLOY: true, SYNC: true, READBACK: readbacks };
  const rows = data.rows.slice(0, OPERATION_PAGE);
  const ids = new Set(rows.flatMap((r) => [...r.flags.map((f) => f.publicationId), r.readback?.publicationId]).filter((id): id is string => !!id));
  return {
    generatedAt, readbacks,
    total: data.rows.length, received: data.received, unknown: data.unknown, deployed: data.deployed, approvals: data.approvals, rejected: readbacks ? data.rejected : 0,
    safe: data.safe, attention: data.attention, replyGaps: readbacks ? data.replyGaps : [],
    countryGroups: data.countryGroups, modelGroups: data.modelGroups,
    points: timelinePoints(data.events, ready), recent: recentEvents(data.events, ready), invalidTimes: data.invalidTimes,
    // 준비 점검·게시본은 정책 판(번호·개정)만 — 게시본에 실린 정책 본문 전체를 싣지 않는다
    preparationIssues: data.preparationIssues.map((i) => ({ publicationId: i.publicationId, policyId: i.policyId, revision: i.revision, reason: i.reason })),
    // 서버 응답의 다른 칸(서버 판단·Feature 상태 등)은 표에 쓰지 않는다 — 표에 보이는 칸만 싣는다
    rows: rows.map((r) => ({
      runtime: { vin: r.runtime.vin, scope: r.runtime.scope, quality: r.runtime.quality, link: r.runtime.link, flags: r.runtime.flags.map(flagOf), last: r.runtime.last && { at: r.runtime.last.at, detail: r.runtime.last.detail } },
      vehicle: r.vehicle && { vin: r.vehicle.vin, country: r.vehicle.country, vehicleModel: r.vehicle.vehicleModel, trim: r.vehicle.trim },
      state: r.state, flags: r.flags.map(flagOf),
      readback: r.readback && { vin: r.readback.vin, publicationId: r.readback.publicationId, at: r.readback.at, metricType: r.readback.metricType, observed: r.readback.observed, rejectReason: r.readback.rejectReason },
    })),
    publications: [...ids].flatMap((id) => { const p = data.publicationById.get(id)?.payload.policy; return p === undefined ? [] : [{ publicationId: id, policy: p && { policyId: p.policyId, revision: p.revision } }]; }),
    countries: data.countries, models: data.models, flags: data.flags,
    adoption: operationAdoption(input, readbacks),
  };
}
