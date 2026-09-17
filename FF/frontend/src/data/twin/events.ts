/**
 * §11 — Event model + §14 Vehicle Simulator event stream.
 *
 * The demo has no backend, so this module is the "Mock Event Stream": every state
 * change in the twin layer goes through an event with the §11 envelope, the journal
 * is idempotent on `eventId`, and stale events (lower Policy/Twin version) are
 * refused so an out-of-order delivery can never roll a twin backwards (§15-4).
 */
import * as T from './types';
import { fnv, parsePolicySeq, secondsSince } from './engine';

export type { TwinEventSource } from './types';

export interface EventDef {
  source: T.TwinEventSource;
  severity: T.ReasonSeverity;
  desc: (e: Pick<T.TwinEvent, 'vin' | 'featureId' | 'policyVersion' | 'payload'>) => T.Localized;
}

const f = T.FEATURE_ID;

/** One definition per §11 event type — source, severity and a human line for timelines. */
export const EVENT_DEFS: Record<T.TwinEventType, EventDef> = {
  'vehicle.as-built.updated': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: () => ({ ko: 'EOL/정비 후 As-Built 스냅샷 갱신', en: 'As-built snapshot refreshed after EOL/service' }),
  },
  'ota.binary.install.requested': {
    source: 'OTA_SERVICE',
    severity: 'INFO',
    desc: () => ({ ko: 'One-Binary OTA 설치 요청', en: 'One-binary OTA install requested' }),
  },
  'ota.binary.install.completed': {
    source: 'OTA_SERVICE',
    severity: 'INFO',
    desc: (e) => ({
      ko: `One-Binary OTA 완료 → ${String(e.payload?.oneBinaryVersion ?? '')}`,
      en: `One-binary OTA completed → ${String(e.payload?.oneBinaryVersion ?? '')}`,
    }),
  },
  'policy.approved': {
    source: 'POLICY_ENGINE',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Policy ${e.policyVersion ?? ''} 승인 (2인 승인 완료)`,
      en: `Policy ${e.policyVersion ?? ''} approved (two-person approval complete)`,
    }),
  },
  'policy.desired.changed': {
    source: 'POLICY_ENGINE',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Desired 상태를 ${String(e.payload?.desired ?? '')} 로 변경`,
      en: `Desired state set to ${String(e.payload?.desired ?? '')}`,
    }),
  },
  'policy.delivery.started': {
    source: 'POLICY_ENGINE',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Policy ${e.policyVersion ?? ''} 전송 시작`,
      en: `Policy ${e.policyVersion ?? ''} delivery started`,
    }),
  },
  'vehicle.policy.received': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: (e) => ({
      ko: `차량이 Policy ${e.policyVersion ?? ''} 수신·서명 검증 완료`,
      en: `Vehicle received policy ${e.policyVersion ?? ''} with a valid signature`,
    }),
  },
  'vehicle.policy.rejected': {
    source: 'VEHICLE_AGENT',
    severity: 'PENDING',
    desc: (e) => ({
      ko: `차량이 Policy ${e.policyVersion ?? ''} 거부 — ${String(e.payload?.reasonCode ?? '')}`,
      en: `Vehicle rejected policy ${e.policyVersion ?? ''} — ${String(e.payload?.reasonCode ?? '')}`,
    }),
  },
  'vehicle.feature.reported': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Reported = ${String(e.payload?.reported ?? '')}`,
      en: `Reported = ${String(e.payload?.reported ?? '')}`,
    }),
  },
  'vehicle.feature.effective': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Effective = ${String(e.payload?.effective ?? '')} (${String(e.payload?.reasonCode ?? '')})`,
      en: `Effective = ${String(e.payload?.effective ?? '')} (${String(e.payload?.reasonCode ?? '')})`,
    }),
  },
  'vehicle.context.updated': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: (e) => ({
      ko: `차량 신호 갱신 — ${String(e.payload?.signal ?? 'context')}`,
      en: `Vehicle signals refreshed — ${String(e.payload?.signal ?? 'context')}`,
    }),
  },
  'vehicle.guard.blocked': {
    source: 'VEHICLE_AGENT',
    severity: 'PENDING',
    desc: (e) => ({
      ko: `Local Guard 차단 — ${String(e.payload?.reasonCode ?? '')}`,
      en: `Local guard blocked — ${String(e.payload?.reasonCode ?? '')}`,
    }),
  },
  'twin.reconciliation.changed': {
    source: 'TWIN_SERVICE',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Reconciliation = ${String(e.payload?.reconciliation ?? '')}`,
      en: `Reconciliation = ${String(e.payload?.reconciliation ?? '')}`,
    }),
  },
  'twin.stale.detected': {
    source: 'TWIN_SERVICE',
    severity: 'PENDING',
    desc: (e) => ({
      ko: `차량 상태 데이터 노후화 감지 — ${String(e.payload?.reasonCode ?? '')}`,
      en: `Vehicle state data staleness detected — ${String(e.payload?.reasonCode ?? '')}`,
    }),
  },
  'twin.drift.detected': {
    source: 'TWIN_SERVICE',
    severity: 'FAIL',
    desc: () => ({ ko: 'Critical Drift 감지 (Desired ≠ Effective)', en: 'Critical drift detected (Desired ≠ Effective)' }),
  },
  'rollout.threshold.exceeded': {
    source: 'TWIN_SERVICE',
    severity: 'FAIL',
    desc: (e) => ({
      ko: `수렴률이 임계치 미달 (${String(e.payload?.convergenceRate ?? '')})`,
      en: `Convergence rate below threshold (${String(e.payload?.convergenceRate ?? '')})`,
    }),
  },
  'rollout.paused': {
    source: 'OPERATOR',
    severity: 'PENDING',
    desc: (e) => ({
      ko: `Rollout 일시정지 — ${String(e.payload?.reason ?? '')}`,
      en: `Rollout paused — ${String(e.payload?.reason ?? '')}`,
    }),
  },
  'kill-switch.requested': {
    source: 'OPERATOR',
    severity: 'FAIL',
    desc: (e) => ({
      ko: `Kill-Switch 요청 — 대상 ${String(e.payload?.vinCount ?? 1)}대`,
      en: `Kill-switch requested for ${String(e.payload?.vinCount ?? 1)} vehicle(s)`,
    }),
  },
  'kill-switch.applied': {
    source: 'VEHICLE_AGENT',
    severity: 'FAIL',
    desc: () => ({ ko: 'Kill-Switch 적용 — Safe State 로 전환', en: 'Kill-switch applied — moving to the safe state' }),
  },
  'rollback.requested': {
    source: 'OPERATOR',
    severity: 'PENDING',
    desc: (e) => ({
      ko: `Rollback 요청 → Desired ${String(e.payload?.desired ?? 'OFF')}`,
      en: `Rollback requested → desired ${String(e.payload?.desired ?? 'OFF')}`,
    }),
  },
  'rollback.completed': {
    source: 'VEHICLE_AGENT',
    severity: 'INFO',
    desc: () => ({ ko: 'Rollback 완료 — 차량이 Safe State 로 수렴', en: 'Rollback completed — vehicles converged to the safe state' }),
  },
  'incident.created': {
    source: 'TWIN_SERVICE',
    severity: 'FAIL',
    desc: (e) => ({
      ko: `Incident 생성 — ${String(e.payload?.title ?? '')}`,
      en: `Incident created — ${String(e.payload?.title ?? '')}`,
    }),
  },
  'incident.closed': {
    source: 'OPERATOR',
    severity: 'INFO',
    desc: (e) => ({
      ko: `Incident 종료 — ${String(e.payload?.title ?? '')}`,
      en: `Incident closed — ${String(e.payload?.title ?? '')}`,
    }),
  },
};

export interface EmitInput {
  type: T.TwinEventType;
  vin: string;
  at: string;
  simTick: number;
  correlationId: string;
  causationId?: string;
  policyVersion?: string | null;
  twinVersion?: number;
  payload?: Record<string, unknown>;
  /** Override the definition line when the caller knows more (e.g. guard reason). */
  desc?: T.Localized;
  severity?: T.ReasonSeverity;
  eventId?: string;
}

/**
 * Append-only, idempotent event journal. Acts as the demo's event bus: the store
 * reads it through `useSyncExternalStore`, so every screen sees the same order.
 */
export class TwinEventJournal {
  private seq = 0;
  private log: T.TwinEvent[] = [];
  private seen = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: T.TwinEvent[] = [];

  constructor(private readonly cap = 800) {}

  get size(): number {
    return this.log.length;
  }

  /** Monotonic counter for `eventId` + `useSyncExternalStore` snapshots. */
  get revision(): number {
    return this.seq;
  }

  emit(input: EmitInput): T.TwinEvent {
    const def = EVENT_DEFS[input.type];
    const event: T.TwinEvent = {
      eventId: input.eventId ?? `EVT-${String(++this.seq).padStart(6, '0')}`,
      eventType: input.type,
      occurredAt: input.at,
      simTick: input.simTick,
      correlationId: input.correlationId,
      causationId: input.causationId,
      source: def.source,
      vin: input.vin,
      featureId: input.type.startsWith('policy.') || input.type.startsWith('vehicle.') ? f : undefined,
      policyVersion: input.policyVersion,
      twinVersion: input.twinVersion,
      payload: input.payload,
      desc: input.desc ?? def.desc({ vin: input.vin, featureId: f, policyVersion: input.policyVersion, payload: input.payload }),
      severity: input.severity ?? def.severity,
    };
    this.ingest(event);
    return event;
  }

  /** Returns false when the event was already applied (§18 — duplicate idempotency). */
  ingest(event: T.TwinEvent): boolean {
    if (this.seen.has(event.eventId)) return false;
    this.seen.add(event.eventId);
    this.log.push(event);
    if (this.log.length > this.cap) {
      const dropped = this.log.splice(0, this.log.length - this.cap);
      dropped.forEach((d) => this.seen.delete(d.eventId));
    }
    this.snapshot = this.log.slice().reverse();
    this.listeners.forEach((l) => l());
    return true;
  }

  /** Newest first — the shape every timeline wants. */
  all(): T.TwinEvent[] {
    return this.snapshot;
  }

  forVin(vin: string): T.TwinEvent[] {
    return this.snapshot.filter((e) => e.vin === vin);
  }

  byType(type: T.TwinEventType): T.TwinEvent[] {
    return this.snapshot.filter((e) => e.eventType === type);
  }

  timeline(vin: string, limit = 12): T.TwinEvent[] {
    return this.forVin(vin).slice(0, limit);
  }

  sinceTick(tick: number): T.TwinEvent[] {
    return this.snapshot.filter((e) => e.simTick > tick);
  }

  clear(): void {
    this.log = [];
    this.seen.clear();
    this.snapshot = [];
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ */
/* Idempotency + version monotonicity for out-of-order delivery (§11)  */
/* ------------------------------------------------------------------ */

/**
 * True when an event would move a twin backwards: an older Policy version or a
 * Twin version that the twin already has. Such events must not be applied.
 */
export function isStaleEvent(event: T.TwinEvent, twin: T.Twin): boolean {
  if (typeof event.twinVersion === 'number' && event.twinVersion <= twin.twinVersion) return true;
  if (event.policyVersion) {
    const inst = twin.featureInstances[T.FEATURE_ID];
    if (inst && parsePolicySeq(event.policyVersion) < inst.policy.cachedVersionSeq) return true;
  }
  return false;
}

/** Deterministic event id for scripted/replayed demo scenarios. */
export function scriptedEventId(vin: string, type: T.TwinEventType, at: string): string {
  return `EVT-${(fnv(`${vin}|${type}|${at}`) % 900000).toString().padStart(6, '0')}`;
}

/** Age of the newest event for a VIN, for the "데이터 기준시각" labels. */
export function eventAgeSeconds(journal: TwinEventJournal, vin: string, nowMs: number): number | null {
  const last = journal.forVin(vin)[0];
  return last ? secondsSince(last.occurredAt, nowMs) : null;
}
