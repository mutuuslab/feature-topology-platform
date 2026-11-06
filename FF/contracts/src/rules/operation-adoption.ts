// 홈 'Feature 적용 현황' — Flag 하나를 골라 차량별 적용 상태·단계 깔때기(대상 → 게시본 전달 → 수신 → 적용 → 실제 사용)·회신 시각을 센다.
// 서버 요약(GET /api/fleet/operation-summary)·정적 스냅샷·브라우저 시연이 operationSummary 안에서 같은 함수를 부른다 — 숫자를 화면에서 새로 만들지 않는다.
// 상태 뜻은 차량 지도(활성 보기, rules/fleet-map activationState)와 같다. 적용(ON) 중 단계 배포 코호트 차량만 CANARY로 가른다.
import { activationState } from './fleet-map';
import type { OperationInput, OperationPublication } from './operation-overview';

export type AdoptionState = 'ON' | 'CANARY' | 'OFF' | 'DISABLED' | 'UNKNOWN';
/** 표시 순서 — 지도 점 배치(가운데부터)·범례·대체 표가 이 순서 */
export const ADOPTION_STATES: AdoptionState[] = ['ON', 'CANARY', 'DISABLED', 'UNKNOWN', 'OFF'];
/** 차량별 상태 문자열의 한 글자 */
export const ADOPTION_CODE: Record<AdoptionState, string> = { ON: 'O', CANARY: 'C', OFF: 'F', DISABLED: 'D', UNKNOWN: 'U' };
export const ADOPTION_BY_CODE: Record<string, AdoptionState> = { O: 'ON', C: 'CANARY', F: 'OFF', D: 'DISABLED', U: 'UNKNOWN' };
export type AdoptionStage = 'TARGET' | 'DELIVERED' | 'RECEIVED' | 'APPLIED' | 'USED';
/** 깔때기 단계 — 차량별 단계 문자열 '0'(대상 아님)~'5'(실제 사용)의 1~5 */
export const ADOPTION_STAGES: AdoptionStage[] = ['TARGET', 'DELIVERED', 'RECEIVED', 'APPLIED', 'USED'];
export type AdoptionWhy = 'KILL' | 'CANARY' | 'RECENT';
/** 요약에 싣는 Flag 수 — 자동 선택 1개 + 고를 수 있는 후보 */
export const ADOPTION_FLAG_LIMIT = 4;

/** 차량 평가 기록 — OTel feature_flag.evaluation span을 서버가 차량으로 되짚은 것(가명 subject → VIN). 원천이 없으면 요약에 '평가' 단계가 비어 있다 */
export interface AdoptionEvaluation { vin: string; flagKey: string; at: string; on: boolean }
/** OTel feature_flag.evaluation span → 차량 평가 기록. subject(가명)를 VIN으로 되짚는 표는 서버·스냅샷이 만든다(가명 함수는 서버 쪽) */
export function adoptionEvaluations(spans: readonly { name?: string; startTime?: string; attributes?: Record<string, unknown> }[], vinOf: ReadonlyMap<string, string>): AdoptionEvaluation[] {
  return spans.flatMap((s) => {
    const a = s.attributes ?? {};
    const vin = vinOf.get(String(a['feature_flag.context.id'] ?? ''));
    const flagKey = a['feature_flag.key'];
    if (s.name !== 'feature_flag.evaluation' || !vin || typeof flagKey !== 'string' || !s.startTime) return [];
    return [{ vin, flagKey, at: s.startTime, on: a['feature_flag.result.variant'] === 'on' }];
  });
}
export interface AdoptionMarker { at: number; kind: 'DEPLOY' | 'KILL' | 'RESTORE'; id: string }
export interface AdoptionFlag {
  flagKey: string;
  featureId: string;
  why: AdoptionWhy;
  policyId: string | null;
  revision: number | null;
  /** 단계 배포 비율(%) — 전체 배포면 null */
  stagePct: number | null;
  /** 단계별 차량 수(앞 단계를 지난 차량 중). 회신을 읽지 못하면 RECEIVED, 평가 기록이 없으면 USED가 null */
  funnel: Record<AdoptionStage, number | null>;
  states: Record<AdoptionState, number>;
  /** 차량 순서(OperationAdoption.vins)대로 상태 코드 한 글자 */
  state: string;
  /** 차량 순서대로 도달 단계 '0'~'5' */
  stage: string;
  /** 차량 순서대로 상태를 확인한 회신 시각 — t0부터 0.1초 단위 정수, 회신이 없으면 null */
  at: (number | null)[];
  /** 시간축 기준(첫 게시본·회신) ISO, 끝 ISO — 기록이 없으면 null */
  t0: string | null;
  t1: string | null;
  /** 시간축 위 사건(배포·차단·복원 게시본) — t0부터 0.1초 단위 */
  markers: AdoptionMarker[];
}
export interface OperationAdoption {
  vins: string[];
  /** 국가(묶음) 이름 — '' 는 미확인 */
  countries: string[];
  /** 차량 순서대로 countries 위치(36진 한 글자) */
  country: string;
  /** 평가 기록 원천을 받았는가 — 아니면(또는 그 Flag 표본이 없으면) USED 단계는 null */
  evaluations: boolean;
  flags: AdoptionFlag[];
}

interface AdoptionPolicy { policyId: string; revision: number; featureId: string; flagKey: string; status: string; deployedAt?: string | null; stageBasisPoints?: number | null; rollout?: { mode?: string; basisPoints?: number } | null }
interface AdoptionRuntime { vin: string; link: string; quality: string; kills?: string[]; flags: { flagKey: string; publicationId: string | null; local: { value: boolean; reason: string }; drift: boolean }[] }
type Pub = OperationPublication & { payload: OperationPublication['payload'] & { kill?: { featureIds?: string[] } | null } };

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);
const FULL = 10_000;
/** 단계 배포 비율(만분율) — 정책 단계(stageBasisPoints)가 우선, 없으면 코호트 배포 비율. 100%면 null */
function stageBp(p: AdoptionPolicy): number | null {
  const bp = p.stageBasisPoints ?? (p.rollout?.mode === 'COHORT' ? p.rollout.basisPoints ?? null : null);
  return bp !== null && bp !== undefined && bp < FULL ? bp : null;
}
const killFeatures = (p: Pub) => (p.payload.kill?.featureIds?.length ? p.payload.kill.featureIds : [p.payload.featureId]);

/** 고를 Flag — 긴급 차단 중인 Feature의 Flag → 단계 배포 중 → 최근 배포 순, 배포(DEPLOYED) 정책이 있는 Flag만 */
export function adoptionCandidates(input: OperationInput): { flagKey: string; why: AdoptionWhy; policy: AdoptionPolicy }[] {
  const deployed = (input.policies as AdoptionPolicy[]).filter((p) => p.status === 'DEPLOYED' && p.flagKey);
  const latest = new Map<string, AdoptionPolicy>();
  for (const p of deployed) {
    const cur = latest.get(p.flagKey);
    if (!cur || (ms(p.deployedAt) || 0) > (ms(cur.deployedAt) || 0) || ((ms(p.deployedAt) || 0) === (ms(cur.deployedAt) || 0) && p.revision > cur.revision)) latest.set(p.flagKey, p);
  }
  const runtime = input.runtime as unknown as AdoptionRuntime[];
  const killed = new Set(runtime.flatMap((r) => r.kills ?? []));
  for (const r of runtime) for (const f of r.flags) if (f.local.reason === 'KILL_SWITCH') { const p = latest.get(f.flagKey); if (p) killed.add(p.featureId); }
  const rank: Record<AdoptionWhy, number> = { KILL: 0, CANARY: 1, RECENT: 2 };
  return [...latest.values()]
    .map((policy) => ({ flagKey: policy.flagKey, policy, why: (killed.has(policy.featureId) ? 'KILL' : stageBp(policy) !== null ? 'CANARY' : 'RECENT') as AdoptionWhy }))
    .sort((a, b) => rank[a.why] - rank[b.why] || (ms(b.policy.deployedAt) || 0) - (ms(a.policy.deployedAt) || 0) || a.flagKey.localeCompare(b.flagKey));
}

export function operationAdoption(input: OperationInput, readbacks: boolean, limit = ADOPTION_FLAG_LIMIT): OperationAdoption {
  const runtime = input.runtime as unknown as AdoptionRuntime[];
  const vins = runtime.map((r) => r.vin);
  const vehicle = new Map(input.vehicles.map((v) => [v.vin, v as typeof v & { canary?: boolean }]));
  const countryNames = [...new Set(vins.map((vin) => vehicle.get(vin)?.country ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  // 한 글자(36진) — 묶음이 36개를 넘으면 뒤쪽은 마지막 칸(미확인 자리)에 모은다
  const countryCode = vins.map((vin) => Math.min(35, countryNames.indexOf(vehicle.get(vin)?.country ?? '')).toString(36)).join('');
  const pubs = input.publications as Pub[];
  const rbs = readbacks ? input.readbacks.filter((r) => r.metricType === 'READBACK' && Number.isFinite(ms(r.at))) : [];
  const evals = input.evaluations;
  const flags = adoptionCandidates(input).slice(0, limit).map(({ flagKey, why, policy }): AdoptionFlag => {
    const fid = policy.featureId;
    const flagFeatures = new Set((input.policies as AdoptionPolicy[]).filter((p) => p.flagKey === flagKey).map((p) => p.featureId));
    const own = pubs.filter((p) => p.kind === 'POLICY' && (p.payload.flagKey === flagKey || (!p.payload.flagKey && flagFeatures.has(p.payload.featureId))));
    const ownIds = new Set(own.map((p) => p.publicationId));
    const kills = pubs.filter((p) => (p.kind === 'KILL' || p.kind === 'RESTORE') && killFeatures(p).includes(fid));
    const killIds = new Set(kills.filter((p) => p.kind === 'KILL').map((p) => p.publicationId));
    const targets = new Set(own.flatMap((p) => p.payload.targets));
    const firstReply = new Map<string, number>();
    const lastKill = new Map<string, number>();
    for (const r of rbs) {
      const t = ms(r.at);
      if (ownIds.has(r.publicationId) && !(r.rejectReason || r.observed === 'REJECTED')) firstReply.set(r.vin, Math.min(firstReply.get(r.vin) ?? Infinity, t));
      if (killIds.has(r.publicationId)) lastKill.set(r.vin, Math.max(lastKill.get(r.vin) ?? -Infinity, t));
    }
    // 평가 표본에 이 Flag 기록이 하나도 없으면 '0대 사용'이 아니라 모르는 것 — 그 단계는 null
    const sampled = !!evals?.some((e) => e.flagKey === flagKey);
    // 실제 사용 = 차량 소프트웨어가 이 Flag를 평가한 기록(결과 값과 상관없이 — 기본값 폴백도 코드 경로에 닿은 것)
    const used = new Set((evals ?? []).filter((e) => e.flagKey === flagKey).map((e) => e.vin));
    const bp = stageBp(policy);
    const states: Record<AdoptionState, number> = { ON: 0, CANARY: 0, OFF: 0, DISABLED: 0, UNKNOWN: 0 };
    const reached = [0, 0, 0, 0, 0, 0];
    const times: number[] = [...own, ...kills].map((p) => ms(p.createdAt)).filter(Number.isFinite);
    const raw: (number | null)[] = [];
    let state = '';
    let stage = '';
    for (const r of runtime) {
      const base = (r.kills ?? []).includes(fid) ? 'DISABLED' : activationState({ link: r.link === 'OFFLINE' ? 'OFFLINE' : 'ONLINE', kills: r.kills ?? [], flags: r.flags }, flagKey);
      const s: AdoptionState = base === 'ON' && bp !== null && vehicle.get(r.vin)?.canary ? 'CANARY' : base;
      states[s]++;
      state += ADOPTION_CODE[s];
      // 단계 — 앞 단계를 지난 차량만 다음 단계로 센다(깔때기가 늘지 않게)
      let k = 0;
      if (targets.has(r.vin)) {
        k = 1;
        const held = r.flags.some((f) => f.flagKey === flagKey && !!f.publicationId && ownIds.has(f.publicationId));
        if (held || firstReply.has(r.vin)) {
          k = 2;
          if (!readbacks || firstReply.has(r.vin)) {
            k = 3;
            if (s === 'ON' || s === 'CANARY') {
              k = 4;
              if (used.has(r.vin)) k = 5;
            }
          }
        }
      }
      stage += k;
      for (let j = 1; j <= k; j++) reached[j]++;
      const at = s === 'DISABLED' ? lastKill.get(r.vin) : firstReply.get(r.vin);
      raw.push(at !== undefined && Number.isFinite(at) ? at : null);
      if (at !== undefined && Number.isFinite(at)) times.push(at);
    }
    const funnel: Record<AdoptionStage, number | null> = { TARGET: reached[1], DELIVERED: reached[2], RECEIVED: readbacks ? reached[3] : null, APPLIED: reached[4], USED: sampled ? reached[5] : null };
    const t0 = times.length ? Math.min(...times) : NaN;
    const t1 = times.length ? Math.max(...times) : NaN;
    const off = (t: number) => Math.round((t - t0) / 100);
    const markers: AdoptionMarker[] = [...own.map((p) => ({ p, kind: 'DEPLOY' as const })), ...kills.map((p) => ({ p, kind: p.kind === 'KILL' ? ('KILL' as const) : ('RESTORE' as const) }))]
      .filter(({ p }) => Number.isFinite(ms(p.createdAt)))
      .map(({ p, kind }) => ({ at: off(ms(p.createdAt)), kind, id: p.publicationId }))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return {
      flagKey, featureId: fid, why, policyId: policy.policyId, revision: policy.revision, stagePct: bp === null ? null : bp / 100,
      funnel, states, state, stage,
      at: raw.map((t) => (t === null || !Number.isFinite(t0) ? null : off(t))),
      t0: Number.isFinite(t0) ? new Date(t0).toISOString() : null, t1: Number.isFinite(t1) ? new Date(t1).toISOString() : null,
      markers,
    };
  });
  return { vins, countries: countryNames, country: countryCode, evaluations: !!evals, flags };
}
