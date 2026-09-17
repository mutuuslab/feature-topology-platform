/**
 * §17.5 — What-if 시뮬레이션 **재생 모델**.
 *
 * 기존 화면은 `runSimulation()` 의 결과 표만 즉시 그렸기 때문에 "실행"이라는
 * 느낌이 없었다. 그런데 엔진은 이미 실행 궤적을 갖고 있다:
 * `SimulationResult.eventLog` 는 `createdAt + i × 1000ms` 로 1초 간격이 찍힌
 * **실제 이벤트 시퀀스**다(engine.ts `buildEventLog`).
 *
 * 따라서 여기서는 이벤트를 위조하지 않고, **시뮬레이션 시계를 따라 이벤트를
 * 순서대로 공개(replay)** 한다. 시계가 멈추면 재생도 멈추고, Step 을 밀면
 * 경과한 sim 초만큼 이벤트가 드러난다. 국면(phase)은 인접한 같은 단계의
 * 이벤트를 묶어 만들기 때문에 시나리오(정상/Kill-Switch/오프라인/롤백/Drift)
 * 에 따라 실제로 달라진다.
 */
import type { TwinEventType, SimulationResult, ReasonSeverity, Localized } from '../data/twin/types';

export type PhaseGroup =
  | 'AS_BUILT'
  | 'SAFETY'
  | 'ELIGIBILITY'
  | 'POLICY'
  | 'DELIVERY'
  | 'VEHICLE'
  | 'EFFECTIVE'
  | 'RECONCILE';

export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PASS' | 'WARN' | 'FAIL';

export interface RunEvent {
  at: string;
  eventType: TwinEventType;
  desc: Localized;
  severity: ReasonSeverity;
}

export interface RunPhase {
  id: string;
  no: number;
  group: PhaseGroup;
  title: Localized;
  hint: Localized;
  events: RunEvent[];
  /** eventLog 안에서의 인덱스 범위 [from, to) — 재생 커서와 직접 비교한다. */
  from: number;
  to: number;
}

export interface RunFrame {
  started: boolean;
  /** 경과한 시뮬레이션 초 (1초 = 이벤트 1건). */
  elapsedSeconds: number;
  totalSeconds: number;
  /** 아직 드러나지 않은 이벤트 수. */
  pendingEvents: number;
  finished: boolean;
  revealed: RunEvent[];
  /** 진행 중이거나 마지막으로 완료된 국면 index. */
  phaseIndex: number;
  phaseStatus: PhaseStatus[];
  progress: number;
}

const GROUP_OF: Record<TwinEventType, PhaseGroup> = {
  'vehicle.as-built.updated': 'AS_BUILT',
  'ota.binary.install.requested': 'ELIGIBILITY',
  'ota.binary.install.completed': 'ELIGIBILITY',
  'policy.approved': 'POLICY',
  'policy.desired.changed': 'POLICY',
  'policy.delivery.started': 'DELIVERY',
  'vehicle.policy.received': 'DELIVERY',
  'vehicle.policy.rejected': 'DELIVERY',
  'twin.stale.detected': 'DELIVERY',
  'vehicle.feature.reported': 'VEHICLE',
  'vehicle.context.updated': 'VEHICLE',
  'vehicle.guard.blocked': 'VEHICLE',
  'vehicle.feature.effective': 'EFFECTIVE',
  'twin.drift.detected': 'EFFECTIVE',
  'twin.reconciliation.changed': 'RECONCILE',
  'rollout.threshold.exceeded': 'RECONCILE',
  'rollout.paused': 'SAFETY',
  'kill-switch.requested': 'SAFETY',
  'kill-switch.applied': 'SAFETY',
  'rollback.requested': 'SAFETY',
  'rollback.completed': 'SAFETY',
  'incident.created': 'SAFETY',
  'incident.closed': 'RECONCILE',
};

export const PHASE_META: Record<PhaseGroup, { title: Localized; hint: Localized }> = {
  AS_BUILT: {
    title: { ko: '차량 · As-Built 로드', en: 'Vehicle · as-built load' },
    hint: { ko: 'EOL 스냅샷·HW capability·variant coding 을 가상차량에 적재', en: 'Load EOL snapshot, HW capability and variant coding into the virtual vehicle' },
  },
  SAFETY: {
    title: { ko: '안전 우선 처리', en: 'Safety-first handling' },
    hint: { ko: 'Kill-Switch / Rollback 은 Desired·Entitlement 보다 우선한다', en: 'Kill-switch and rollback outrank desired state and entitlement' },
  },
  ELIGIBILITY: {
    title: { ko: '자격 · 대상 판정', en: 'Eligibility and targeting' },
    hint: { ko: 'BMS SW / One-Binary / Variant / Entitlement 로 대상 선정', en: 'Target selection by BMS SW, one-binary, variant and entitlement' },
  },
  POLICY: {
    title: { ko: '정책 승인 · Desired 산출', en: 'Policy approval · desired computation' },
    hint: { ko: '2인 승인된 정책 버전으로 중앙 의도를 계산한다', en: 'Compute central intent from the two-person approved policy version' },
  },
  DELIVERY: {
    title: { ko: '정책 전달', en: 'Policy delivery' },
    hint: { ko: '네트워크 상태·오프라인 캐시 TTL·서명 검증', en: 'Network state, offline cache TTL and signature check' },
  },
  VEHICLE: {
    title: { ko: '차량 적용 · Local Guard', en: 'Vehicle apply · local guard' },
    hint: { ko: '차량 내부 가드가 로컬 조건으로 최종 차단 여부를 결정한다', en: 'The in-vehicle guard decides the final block from local conditions' },
  },
  EFFECTIVE: {
    title: { ko: 'Effective 확정', en: 'Effective confirmation' },
    hint: { ko: 'Desired ≠ Reported ≠ Effective 를 분리해 기록한다', en: 'Record desired, reported and effective as separate facts' },
  },
  RECONCILE: {
    title: { ko: '차량 상태 수렴 재계산', en: 'Vehicle state reconciliation' },
    hint: { ko: '수렴·대기·차단·Drift·Unknown 을 다시 판정한다', en: 'Re-judge converged, pending, guarded, drift and unknown' },
  },
};

/** 이벤트 시퀀스를 "인접한 같은 단계" 규칙으로 묶어 국면을 만든다. */
export function buildPhases(result: SimulationResult): RunPhase[] {
  const phases: RunPhase[] = [];
  result.eventLog.forEach((ev, i) => {
    const group = GROUP_OF[ev.eventType] ?? 'RECONCILE';
    const last = phases[phases.length - 1];
    if (last && last.group === group) {
      last.events.push(ev);
      last.to = i + 1;
      return;
    }
    phases.push({
      id: `${group}-${phases.length}`,
      no: phases.length + 1,
      group,
      title: PHASE_META[group].title,
      hint: PHASE_META[group].hint,
      events: [ev],
      from: i,
      to: i + 1,
    });
  });
  return phases;
}

function statusOf(events: RunEvent[], revealedCount: number): PhaseStatus {
  if (revealedCount <= 0) return 'PENDING';
  const shown = events.slice(0, revealedCount);
  if (shown.some((e) => e.severity === 'FAIL')) return 'FAIL';
  if (shown.some((e) => e.severity === 'PENDING')) return 'WARN';
  return revealedCount >= events.length ? 'PASS' : 'RUNNING';
}

/**
 * 시뮬레이션 시계만으로 재생 프레임을 계산한다 — 상태기계도 타이머도 없다.
 * rate 0 이면 시계가 멈추므로 프레임도 그대로 멈춘다.
 */
export function frameOf(
  startedAtMs: number | null,
  simTimeMs: number,
  result: SimulationResult,
  phases: RunPhase[] = buildPhases(result),
): RunFrame {
  const total = result.eventLog.length;
  const started = startedAtMs !== null;
  const elapsedSeconds = started ? Math.max(0, Math.floor((simTimeMs - (startedAtMs as number)) / 1000)) : 0;
  const cursor = Math.min(elapsedSeconds, total);

  const revealed = result.eventLog.slice(0, cursor);
  const phaseStatus: PhaseStatus[] = phases.map((p) => {
    const revealedInPhase = Math.max(0, Math.min(cursor, p.to) - p.from);
    return statusOf(p.events, revealedInPhase);
  });
  const running = phaseStatus.findIndex((s) => s === 'RUNNING');
  const lastDone = phaseStatus.reduce((acc, s, i) => (s === 'PENDING' ? acc : i), 0);

  return {
    started,
    elapsedSeconds,
    totalSeconds: total,
    pendingEvents: Math.max(0, total - cursor),
    finished: started && cursor >= total,
    revealed,
    phaseIndex: running >= 0 ? running : lastDone,
    phaseStatus,
    progress: total ? cursor / total : 0,
  };
}

/** 국면 하나의 한 줄 요약 — 실제 이벤트 severity 를 그대로 반영한다. */
export function phaseSummary(phase: RunPhase, status: PhaseStatus, lang: 'ko' | 'en'): string {
  const n = phase.events.length;
  const ko = `${phase.events.filter((e) => e.severity === 'FAIL').length} FAIL · ${phase.events.filter((e) => e.severity === 'PENDING').length} WARN / 이벤트 ${n}건`;
  const en = `${phase.events.filter((e) => e.severity === 'FAIL').length} FAIL · ${phase.events.filter((e) => e.severity === 'PENDING').length} WARN / ${n} events`;
  const base = lang === 'ko' ? ko : en;
  if (status === 'PENDING') return lang === 'ko' ? `대기 · 이벤트 ${n}건` : `pending · ${n} events`;
  if (status === 'RUNNING') return lang === 'ko' ? `진행 중 · ${base}` : `running · ${base}`;
  return base;
}
