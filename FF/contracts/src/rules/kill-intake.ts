// 차단 요청 접수·비활성화 조건 확인(P11a, 결정 D1 (a)) — 화면·서버 공용.
// · 외부 시스템(API 키, FR-AGW-001-002)은 차단을 실행하지 않는다 — '차단 요청 접수'로 받아 사람의 차단 요청·2인 승인 대기열로 넘긴다.
// · 이상 상황(FR-SVS-002-001)은 비활성화 조건을 확인해 충족이면 '중단 필요' 알림과 접수 1건을 만들고, 미충족이면 사유를 기록한다. 자동 비활성화는 없다.
import { z } from 'zod';
import { RestoreRequestBody } from '../schemas/ops';
import { REASON_CATEGORIES } from '../schemas/safety';
import { KillScopeFilter } from './kill-scope';

export const KILL_INTAKE_SOURCES = ['EXTERNAL', 'ANOMALY'] as const;
export type KillIntakeSource = (typeof KILL_INTAKE_SOURCES)[number];
/** RECEIVED(접수·검토 대기) → CONVERTED(운영자가 차단 요청으로 옮김 — 이후는 2인 승인) | DISMISSED(사유와 함께 닫음) */
export const KILL_INTAKE_STATUSES = ['RECEIVED', 'CONVERTED', 'DISMISSED'] as const;
export type KillIntakeStatus = (typeof KILL_INTAKE_STATUSES)[number];
export const KILL_INTAKE_STATUS_LABEL: Record<KillIntakeStatus, string> = { RECEIVED: '접수 — 검토 대기', CONVERTED: '차단 요청으로 옮김', DISMISSED: '닫음' };
export const KILL_INTAKE_SOURCE_LABEL: Record<KillIntakeSource, string> = { EXTERNAL: '외부 시스템', ANOMALY: '이상 징후 조건 충족' };

/** 외부 시스템의 차단 요청 접수 본문 — 실행이 아니라 접수(사람 승인 대기열) */
export const KillIntakeBody = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: z.string().min(1).max(40),
    reasonCategory: z.enum(REASON_CATEGORIES).default('SAFETY'),
    reasonCode: z
      .string()
      .regex(/^[A-Z0-9_]{3,40}$/)
      .default('FIELD_FAULT'),
    reason: z.string().trim().min(2).max(500),
    vins: z.array(z.string().min(1)).max(500).optional(),
    scope: KillScopeFilter.optional(),
    /** 호출 시스템의 자기 번호(티켓·사건) — 상태 조회 때 함께 돌려준다 */
    externalRef: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type KillIntakeBody = z.infer<typeof KillIntakeBody>;
export const KillIntakeDismissBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type KillIntakeDismissBody = z.infer<typeof KillIntakeDismissBody>;

export interface KillIntake {
  intakeId: string;
  source: KillIntakeSource;
  status: KillIntakeStatus;
  featureId: string;
  featureVersion: string;
  reasonCategory: (typeof REASON_CATEGORIES)[number];
  reasonCode: string;
  reason: string;
  vins: string[];
  scope: KillScopeFilter | null;
  externalRef: string | null;
  anomalyId: string | null;
  checkId: string | null;
  receivedBy: string;
  receivedAt: string;
  killId: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

// ─── 비활성화 조건 확인(FR-SVS-002-001) ───
export type DeactivationConditionId = 'ADVICE_KILL' | 'REMOTE_ALLOWED' | 'VEHICLES' | 'NO_OPEN_KILL';
export const DEACTIVATION_CONDITION_LABEL: Record<DeactivationConditionId, string> = {
  ADVICE_KILL: '이상 판정이 긴급 차단 권고',
  REMOTE_ALLOWED: '원격 비활성화 가능 등급(DC4·법규 의무 아님)',
  VEHICLES: '영향 차량 있음',
  NO_OPEN_KILL: '진행 중 차단·접수 없음',
};
export interface DeactivationCondition {
  id: DeactivationConditionId;
  ok: boolean;
  detail: string;
}
export interface DeactivationCheckInput {
  advice: string;
  severity: string;
  registry: { deact_class: string; gsr_mandatory: boolean } | null;
  vehicles: number;
  openKill: string | null;
  openIntake: string | null;
}

/** 조건 넷이 모두 참이면 충족 — '중단 필요' 알림과 접수. 아니면 미충족 사유(거짓인 조건) */
export function deactivationCheck(i: DeactivationCheckInput): { met: boolean; conditions: DeactivationCondition[]; unmet: string[] } {
  const conditions: DeactivationCondition[] = [
    { id: 'ADVICE_KILL', ok: i.advice === 'KILL', detail: `권고 ${i.advice} · 심각도 ${i.severity}` },
    {
      id: 'REMOTE_ALLOWED',
      ok: !!i.registry && i.registry.deact_class !== 'DC4' && !i.registry.gsr_mandatory,
      detail: i.registry ? `${i.registry.deact_class}${i.registry.gsr_mandatory ? ' · 법규 의무' : ''}` : 'Registry 등록 없음',
    },
    { id: 'VEHICLES', ok: i.vehicles > 0, detail: `${i.vehicles}대` },
    { id: 'NO_OPEN_KILL', ok: !i.openKill && !i.openIntake, detail: i.openKill ?? i.openIntake ?? '없음' },
  ];
  const unmet = conditions.filter((c) => !c.ok).map((c) => `${DEACTIVATION_CONDITION_LABEL[c.id]} — ${c.detail}`);
  return { met: !unmet.length, conditions, unmet };
}

// ─── 사건 범위 종료 차단·선택 해제(ADS-BE02) ───
/** 선택 해제 — 복원 요청 본문 + 해제할 사건. 차단의 사건과 다르면 거부(다른 사건 차단은 해제할 수 없다) */
export const RescindBody = RestoreRequestBody.extend({ incidentId: z.string().trim().min(3).max(60) }).strict();
export type RescindBody = z.infer<typeof RescindBody>;

export interface InhibitRow {
  id: number;
  vin: string;
  featureId: string;
  incidentId: string;
  killId: string;
  setAt: string;
  releasedAt: string | null;
}
/** 사건별 차단 집합(사건 → Feature → 차량 수, 설정·해제 시각)과 차량별 남은 사건 */
export function inhibitSummary(rows: readonly InhibitRow[]) {
  const by = new Map<string, { incidentId: string; featureId: string; killId: string; active: number; released: number; setAt: string; releasedAt: string | null }>();
  for (const r of rows) {
    const key = `${r.incidentId}/${r.featureId}`;
    const g = by.get(key) ?? { incidentId: r.incidentId, featureId: r.featureId, killId: r.killId, active: 0, released: 0, setAt: r.setAt, releasedAt: null };
    if (r.releasedAt) (g.released += 1), (g.releasedAt = !g.releasedAt || r.releasedAt > g.releasedAt ? r.releasedAt : g.releasedAt);
    else g.active += 1;
    if (r.setAt < g.setAt) g.setAt = r.setAt;
    by.set(key, g);
  }
  const held = new Map<string, Set<string>>();
  for (const r of rows) if (!r.releasedAt) held.set(r.vin, (held.get(r.vin) ?? new Set()).add(r.incidentId));
  return {
    incidents: [...by.values()].sort((a, b) => a.setAt.localeCompare(b.setAt) || a.incidentId.localeCompare(b.incidentId)),
    vehicles: [...held.entries()].map(([vin, s]) => ({ vin, incidents: [...s].sort() })).sort((a, b) => a.vin.localeCompare(b.vin)),
  };
}

// ─── 영향 차량 산정(ADS-BE21) ───
export const IMPACT_CLASSES = ['CANDIDATE', 'CONFIG_UNKNOWN', 'NO_CONTACT'] as const;
export type ImpactClass = (typeof IMPACT_CLASSES)[number];
export const IMPACT_CLASS_LABEL: Record<ImpactClass, string> = { CANDIDATE: '영향 후보', CONFIG_UNKNOWN: '구성 미확인', NO_CONTACT: '통신 미수신' };
/** 차량 분류 — 연결 이력 없음 → 통신 미수신, 문맥 신뢰 아님·구성 보고가 기준 시각보다 오래됨 → 구성 미확인, 그 밖은 후보 */
export function classifyImpact(vins: readonly string[], facts: (vin: string) => { lastContactAt: string | null; quality: string }, configAsOf: string): Record<ImpactClass, string[]> {
  const out: Record<ImpactClass, string[]> = { CANDIDATE: [], CONFIG_UNKNOWN: [], NO_CONTACT: [] };
  for (const vin of vins) {
    const f = facts(vin);
    if (!f.lastContactAt) out.NO_CONTACT.push(vin);
    else if (f.quality !== 'TRUSTED' || Date.parse(f.lastContactAt) < Date.parse(configAsOf)) out.CONFIG_UNKNOWN.push(vin);
    else out.CANDIDATE.push(vin);
  }
  return out;
}
/** 식별 정확도 — 첫(고정) 후보 산정 중 확정 영향군에 든 비율. 확정 영향군이 없으면 판단 불가 */
export function impactAccuracy(candidates: readonly string[] | null, confirmed: readonly string[] | null) {
  if (!confirmed || !candidates) return { status: 'UNKNOWN' as const, value: null, candidates: candidates?.length ?? 0, confirmed: confirmed?.length ?? 0, matched: 0 };
  const c = new Set(confirmed);
  const matched = candidates.filter((v) => c.has(v)).length;
  return { status: 'KNOWN' as const, value: candidates.length ? matched / candidates.length : null, candidates: candidates.length, confirmed: confirmed.length, matched };
}
export const ImpactReevaluateBody = z.object({ configAsOf: z.string().datetime(), reason: z.string().trim().min(2).max(500) }).strict();
export type ImpactReevaluateBody = z.infer<typeof ImpactReevaluateBody>;
/** 확정 영향군 — 분석 근거 필수. calcId에 후보 산정 ID를 그대로 주면(후보 복사) 거부 */
export const ImpactConfirmBody = z
  .object({ vins: z.array(z.string().min(1)).min(1).max(5000), analysisRef: z.string().trim().min(2).max(120), calcId: z.string().trim().max(60).optional(), reason: z.string().trim().max(500).optional() })
  .strict();
export type ImpactConfirmBody = z.infer<typeof ImpactConfirmBody>;
