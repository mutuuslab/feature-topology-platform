// 차단 요청 접수·비활성화 조건 확인(P11a, 결정 D1 (a)) — 화면·서버 공용.
// · 외부 시스템(API 키, FR-AGW-001-002)은 차단을 실행하지 않는다 — '차단 요청 접수'로 받아 사람의 차단 요청·2인 승인 대기열로 넘긴다.
// · 이상 상황(FR-SVS-002-001)은 비활성화 조건을 확인해 충족이면 '중단 필요' 알림과 접수 1건을 만들고, 미충족이면 사유를 기록한다. 자동 비활성화는 없다.
import { z } from 'zod';
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
