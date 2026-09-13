/**
 * §14 — deterministic Vehicle Simulator + Mock Twin Provider.
 *
 * Implements `DigitalTwinPort` entirely in memory so the whole closed loop
 * (Policy → 차량 수신 → Reported → Local Guard → Effective → Convergence →
 * Incident → Kill-Switch → 부분 복구) can be demonstrated without a backend.
 * Every mutation goes through the §11 event journal.
 */
import * as T from './types';
import type { DigitalTwinPort, AsBuiltSnapshot, DeploymentResult, RolloutState, TwinClock, TwinStoreSnapshot } from './port';
import { TwinEventJournal, isStaleEvent } from './events';
import * as E from './engine';
import { buildDemoFleet, buildDerivedTwin, withHealth } from './fleet';

const MINUTE = 60_000;
const TICK_SECONDS = 5;
const ALL = 'ALL';

export interface ProviderOptions {
  nowMs?: number;
  /** Simulation clock speed at start — 0 keeps the simulator paused. */
  rate?: 0 | 1 | 5;
}

interface PendingDelivery {
  vin: string;
  dueTick: number;
  policy: T.TwinPolicyRef;
}

export class MockTwinProvider implements DigitalTwinPort {
  readonly journal = new TwinEventJournal();

  private baseNowMs: number;
  private twins: T.Twin[] = [];
  private verdicts: E.TwinVerdict[] = [];
  private incidents: T.TwinIncident[] = [];
  private pending: PendingDelivery[] = [];
  private listeners = new Set<() => void>();
  private rev = 0;
  private snapshotCache: TwinStoreSnapshot | null = null;
  private incidentSeq = 0;

  private clock: TwinClock;

  rollout: RolloutState = {
    rolloutId: T.DEMO_ROLLOUT_ID,
    policyId: T.DEMO_POLICY.policyId,
    policyVersion: T.DEMO_POLICY.policyVersion,
    featureId: T.FEATURE_ID,
    active: false,
    paused: false,
    scope: 'NONE',
    activatedVins: [],
    binaryOtaVins: [],
  };

  gate: T.ImpactGate = { impactReviewed: false, qualityGatePassed: false };

  constructor(opts: ProviderOptions = {}) {
    this.baseNowMs = opts.nowMs ?? Date.now();
    this.clock = {
      simTimeMs: this.baseNowMs,
      simTick: 0,
      rate: opts.rate ?? 0,
      startedAtMs: this.baseNowMs,
      running: (opts.rate ?? 0) > 0,
    };
    this.rebuild(this.baseNowMs);
    this.publish();
  }

  /* ---------------------------------------------------------------- */
  /* DigitalTwinPort                                                   */
  /* ---------------------------------------------------------------- */

  listTwins(filters?: T.TwinFilters): T.Twin[] {
    const verdicts = filters ? E.applyFilters(this.verdicts, filters) : this.verdicts;
    return verdicts.map((v) => v.twin);
  }

  getTwin(vin: string): T.Twin | null {
    return this.twins.find((t) => t.vin === vin) ?? null;
  }

  /** Deep link to an unknown VIN stays usable and deterministically labelled. */
  ensureTwin(vin: string): T.Twin {
    const found = this.getTwin(vin);
    if (found) return found;
    const twin = buildDerivedTwin(vin, this.now());
    this.twins = [...this.twins, twin];
    this.reevaluate();
    return twin;
  }

  queryTargetFacts(rule: T.TargetRule): T.TwinImpactResult {
    return E.runImpactAnalysis(this.verdicts, rule, this.now(), this.gate);
  }

  ingestAsBuilt(snapshot: AsBuiltSnapshot): boolean {
    const twin = this.getTwin(snapshot.vin);
    if (!twin) return false;
    const event = this.journal.emit({
      type: 'vehicle.as-built.updated',
      vin: snapshot.vin,
      at: E.isoAt(this.now()),
      simTick: this.clock.simTick,
      correlationId: T.DEMO_ROLLOUT_ID,
      twinVersion: twin.twinVersion + 1,
      payload: { eolSnapshotId: snapshot.eolSnapshotId },
    });
    if (!event) return false;
    this.replace(snapshot.vin, (t) =>
      withHealth(
        {
          ...t,
          twinVersion: t.twinVersion + 1,
          asBuilt: {
            eolSnapshotId: snapshot.eolSnapshotId,
            hardwareCapabilities: snapshot.hardwareCapabilities,
            variantCodingVersion: snapshot.variantCodingVersion,
            recordedAt: snapshot.recordedAt,
          },
        },
        this.now(),
      ),
    );
    return true;
  }

  ingestDeploymentResult(result: DeploymentResult): boolean {
    const twin = this.getTwin(result.vin);
    if (!twin) return false;
    const at = result.at || E.isoAt(this.now());
    this.journal.emit({
      type: 'ota.binary.install.completed',
      vin: result.vin,
      at,
      simTick: this.clock.simTick,
      correlationId: T.DEMO_ROLLOUT_ID,
      twinVersion: twin.twinVersion + 1,
      payload: { oneBinaryVersion: result.oneBinaryVersion, bmsSoftwareVersion: result.bmsSoftwareVersion },
    });
    const next = E.applyDeployment(twin, {
      oneBinaryVersion: result.oneBinaryVersion,
      bmsSoftwareVersion: result.bmsSoftwareVersion,
    }, at);
    this.replace(result.vin, () => withHealth(next, this.now()));
    return true;
  }

  ingestVehicleReport(event: T.TwinEvent): boolean {
    const twin = this.getTwin(event.vin);
    if (!twin) return false;
    // Idempotency (§11): same eventId twice, or an older Policy/Twin version,
    // must not move the twin backwards.
    if (isStaleEvent(event, twin)) return false;
    if (!this.journal.ingest(event)) return false;
    this.applyEvent(event);
    return true;
  }

  reconcile(vin: string, featureId: string): T.ReconciliationResult | null {
    if (featureId !== T.FEATURE_ID) return null;
    return this.verdicts.find((v) => v.twin.vin === vin)?.reconciliation ?? null;
  }

  runSimulation(request: T.SimulationInputs): T.SimulationResult {
    return E.runSimulation(request, this.now());
  }

  getTimeline(vin: string): T.TwinEvent[] {
    return this.journal.forVin(vin);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /* ---------------------------------------------------------------- */
  /* Snapshot (useSyncExternalStore)                                   */
  /* ---------------------------------------------------------------- */

  getSnapshot(): TwinStoreSnapshot {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        twins: this.twins,
        verdicts: this.verdicts,
        stats: E.computeFleetStats(this.verdicts, this.now()),
        convergence: this.convergence(),
        incidents: this.incidents,
        clock: this.clock,
        rollout: this.rollout,
        gate: this.gate,
        events: this.journal.all(),
        revision: this.rev,
      };
    }
    return this.snapshotCache;
  }

  get revision(): number {
    return this.rev;
  }

  private publish(): void {
    this.rev++;
    this.snapshotCache = null;
    this.listeners.forEach((l) => l());
  }

  /* ---------------------------------------------------------------- */
  /* Clock / simulator (§14 시간 제어)                                  */
  /* ---------------------------------------------------------------- */

  get clockState(): TwinClock {
    return this.clock;
  }

  setRate(rate: 0 | 1 | 5): void {
    this.clock = { ...this.clock, rate, running: rate > 0, startedAtMs: this.clock.startedAtMs };
    this.publish();
  }

  /** Advance the simulation clock by `realDeltaMs` of wall time. */
  tick(realDeltaMs: number): void {
    if (this.clock.rate === 0) return;
    const advance = Math.max(0, realDeltaMs) * this.clock.rate;
    if (advance <= 0) return;
    this.advanceTo(this.clock.simTimeMs + advance);
  }

  /** Single deterministic step — used by the "Step" button and by tests. */
  step(seconds = TICK_SECONDS): void {
    this.advanceTo(this.clock.simTimeMs + seconds * 1000);
  }

  private advanceTo(nextMs: number): void {
    this.clock = { ...this.clock, simTimeMs: nextMs, simTick: this.clock.simTick + 1 };
    this.simulateTelemetry();
    this.flushDeliveries();
    this.reevaluate();
  }

  private now(): number {
    return this.clock.simTimeMs;
  }

  /** Fresh signals for online, non-faulted vehicles; offline vehicles stay frozen. */
  private simulateTelemetry(): void {
    const at = E.isoAt(this.now());
    let touched = 0;
    for (const twin of this.twins) {
      if (!twin.link.online) continue;
      if (this.hasOpenFaultFor(twin.vin, 'BATTERY_TEMP_STALE')) continue;
      const context: T.TwinContext = { ...twin.context };
      let refreshed = 0;
      (Object.keys(context) as T.SignalKey[]).forEach((key) => {
        const sample = context[key];
        if (!sample || sample.quality !== 'GOOD') return;
        context[key] = { ...sample, observedAt: at };
        refreshed++;
      });
      if (!refreshed) continue;
      this.replace(twin.vin, (t) => ({ ...t, link: { ...t.link, lastSeenAt: at }, context }), false);
      touched++;
    }
    if (touched) {
      this.journal.emit({
        type: 'vehicle.context.updated',
        vin: `VIN-DEMO-* (${touched})`,
        at,
        simTick: this.clock.simTick,
        correlationId: T.DEMO_ROLLOUT_ID,
        payload: { signal: 'context', vehicles: touched },
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Policy delivery → Reported → Effective (§13 6단계)                  */
  /* ---------------------------------------------------------------- */

  /**
   * §13 5단계 — 대상을 Cohort 로 나눠 Policy-only 와 Binary OTA 를 분리한다.
   * 값은 모두 합성 데이터이며 실제 판매/사업 효과가 아니다.
   */
  activatePolicy(scope: 'CANARY' | 'WAVE' | 'FLEET' = 'WAVE'): RolloutState {
    const impact = E.runImpactAnalysis(this.verdicts, T.DEMO_TARGET_RULE, this.now(), this.gate);
    const eligible = impact.buckets.find((b) => b.eligibility === 'ELIGIBLE_POLICY_ONLY')?.vins ?? [];
    const ota = impact.buckets.find((b) => b.eligibility === 'REQUIRES_BINARY_OTA')?.vins ?? [];
    const limit = scope === 'CANARY' ? Math.min(3, eligible.length) : scope === 'WAVE' ? Math.ceil(eligible.length / 3) : eligible.length;
    // 이미 ON 인 차량(사전 수렴)보다 아직 전환되지 않은 차량을 우선 대상으로 삼는다.
    const needsActivation = (vin: string) => this.getTwin(vin)?.featureInstances[T.FEATURE_ID]?.desired.state !== 'ON';
    const targets = eligible.filter(needsActivation).concat(eligible.filter((v) => !needsActivation(v))).slice(0, limit);

    const at = E.isoAt(this.now());
    this.journal.emit({
      type: 'policy.approved',
      vin: ALL,
      at,
      simTick: this.clock.simTick,
      correlationId: T.DEMO_ROLLOUT_ID,
      policyVersion: T.DEMO_POLICY.policyVersion,
      payload: { scope, approval: 'TWO_PERSON' },
    });

    const ref = T.policyRef(T.DEMO_POLICY, at);
    targets.forEach((vin) => {
      const twin = this.getTwin(vin);
      if (!twin) return;
      this.replace(vin, (t) => E.applyDesiredChange(t, 'ON', at));
      this.journal.emit({
        type: 'policy.desired.changed',
        vin,
        at,
        simTick: this.clock.simTick,
        correlationId: T.DEMO_ROLLOUT_ID,
        policyVersion: T.DEMO_POLICY.policyVersion,
        payload: { desired: 'ON', scope },
      });
      this.journal.emit({
        type: 'policy.delivery.started',
        vin,
        at,
        simTick: this.clock.simTick,
        correlationId: T.DEMO_ROLLOUT_ID,
        policyVersion: T.DEMO_POLICY.policyVersion,
      });
      // 차량별 수신 지연 — 결정적 (VIN hash 기반).
      this.pending.push({ vin, dueTick: this.clock.simTick + (E.fnv(vin) % 3) + 1, policy: ref });
    });

    // 수신되지 않은 오프라인 차량은 PENDING 으로 남는다 (§9 row 2/4).
    this.rollout = {
      ...this.rollout,
      active: true,
      scope,
      paused: false,
      pausedReason: undefined,
      activatedAt: at,
      activatedVins: targets,
      binaryOtaVins: ota,
    };
    this.reevaluate();
    return this.rollout;
  }

  /** §13 7단계 — 신규 Rollout 중단. */
  pauseRollout(reason: T.Localized): void {
    if (!this.rollout.active) return;
    this.rollout = { ...this.rollout, paused: true, pausedReason: reason };
    this.journal.emit({
      type: 'rollout.paused',
      vin: ALL,
      at: E.isoAt(this.now()),
      simTick: this.clock.simTick,
      correlationId: T.DEMO_ROLLOUT_ID,
      payload: { reason: reason.en },
    });
    this.publish();
  }

  resumeRollout(): void {
    this.rollout = { ...this.rollout, paused: false, pausedReason: undefined };
    this.publish();
  }

  /** §13 7단계 — Policy Rollback: Desired OFF 로 내리고 차량 응답을 기다린다. */
  rollback(vins?: string[]): string[] {
    const targets = vins ?? this.rollout.activatedVins;
    const at = E.isoAt(this.now());
    this.journal.emit({
      type: 'rollback.requested',
      vin: ALL,
      at,
      simTick: this.clock.simTick,
      correlationId: T.DEMO_ROLLOUT_ID,
      policyVersion: T.DEMO_POLICY.policyVersion,
      payload: { desired: 'OFF', vehicles: targets.length },
    });
    targets.forEach((vin) => {
      const twin = this.getTwin(vin);
      if (!twin) return;
      this.replace(vin, (t) => E.applyDesiredChange(t, 'OFF', at));
      const offline = !twin.link.online;
      if (!offline) {
        // 정상 차량은 즉시 OFF 로 수렴한다.
        this.replace(vin, (t) => E.applyVehicleReport(t, { reported: 'OFF', effective: 'OFF', guardResult: 'PASS', reasonCode: 'ROLLBACK_APPLIED' }, at));
        this.journal.emit({
          type: 'vehicle.feature.effective',
          vin,
          at,
          simTick: this.clock.simTick,
          correlationId: T.DEMO_ROLLOUT_ID,
          payload: { effective: 'OFF', reasonCode: 'ROLLBACK_APPLIED' },
        });
      }
      // 오프라인 차량은 Desired OFF 를 받지 못해 Effective ON 이 남는다 → Critical Drift.
      this.reevaluate();
    });
    this.journal.emit({ type: 'rollback.completed', vin: ALL, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID });
    this.rollout = { ...this.rollout, active: false, scope: 'NONE', activatedVins: [] };
    // Rollout 종료를 스냅샷에 반영한다 (마지막 reevaluate 이후 변경분).
    this.publish();
    return targets;
  }

  /* ---------------------------------------------------------------- */
  /* Kill-Switch (§15-5 우선순위)                                       */
  /* ---------------------------------------------------------------- */

  killSwitch(vins: string[] | typeof ALL, reason: T.Localized, incidentId?: string): string[] {
    const targets = vins === ALL ? this.twins.map((t) => t.vin) : vins;
    const at = E.isoAt(this.now());
    this.journal.emit({
      type: 'kill-switch.requested',
      vin: ALL,
      at,
      simTick: this.clock.simTick,
      correlationId: incidentId ?? T.DEMO_ROLLOUT_ID,
      payload: { vinCount: targets.length, reason: reason.en },
    });
    const ks: T.KillSwitchState = {
      active: true,
      requestedBy: 'operator-7',
      requestedAt: at,
      reason,
      featureId: T.FEATURE_ID,
      policyVersion: T.DEMO_POLICY.policyVersion,
      safeState: 'OFF',
      affectedVins: targets.length,
    };
    targets.forEach((vin) => {
      // 운영자 조치이므로 플랫폼도 ON 요청을 철회한다 — 차량 확인 후 수렴한다.
      this.replace(vin, (t) => E.applyDesiredChange(t, 'OFF', at));
      this.replace(vin, (t) => E.applyKillSwitch(t, ks, at));
      this.journal.emit({
        type: 'kill-switch.applied',
        vin,
        at,
        simTick: this.clock.simTick,
        correlationId: incidentId ?? T.DEMO_ROLLOUT_ID,
        payload: { effective: 'OFF' },
      });
    });
    this.rollout = { ...this.rollout, paused: true, pausedReason: reason };
    this.reevaluate();
    return targets;
  }

  releaseKillSwitch(): void {
    const at = E.isoAt(this.now());
    this.twins.forEach((twin) => {
      if (!twin.killSwitch?.active) return;
      const next = E.applyKillSwitch(twin, undefined, at);
      this.replace(twin.vin, () => withHealth(next, this.now()));
    });
    this.reevaluate();
  }

  /* ---------------------------------------------------------------- */
  /* Faults + closed loop (§12.5)                                      */
  /* ---------------------------------------------------------------- */

  injectFault(fault: T.FaultType, vins?: string[]): T.TwinIncident {
    const activated = this.rollout.activatedVins;
    const healthy = activated.find((vin) => {
      const v = this.verdicts.find((x) => x.twin.vin === vin);
      return v && v.health === 'HEALTHY';
    });
    const targets = vins ?? [healthy ?? activated[0] ?? 'VIN-DEMO-001'];
    const at = E.isoAt(this.now());
    const def = T.FAULTS.find((f) => f.id === fault)!;

    targets.forEach((vin) => {
      const twin = this.getTwin(vin);
      if (!twin) return;
      switch (fault) {
        case 'BATTERY_TEMP_STALE':
          this.replace(vin, (t) => E.applyContextStale(t, at, 'BatteryTemperature', 900));
          this.journal.emit({ type: 'twin.stale.detected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, payload: { reasonCode: 'BATTERY_TEMP_SIGNAL_STALE' } });
          break;
        case 'VEHICLE_AGENT_OFFLINE':
          this.replace(vin, (t) => E.applyOffline(t, at, true));
          this.journal.emit({ type: 'twin.stale.detected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, payload: { reasonCode: 'VEHICLE_AGENT_OFFLINE' } });
          break;
        case 'POLICY_SIGNATURE_INVALID': {
          const bad: T.TwinPolicyRef = { ...T.policyRef(T.DEMO_POLICY, at), signatureStatus: 'INVALID' };
          this.replace(vin, (t) => E.applyPolicyDelivery(t, bad, at));
          this.journal.emit({ type: 'vehicle.policy.rejected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, policyVersion: T.DEMO_POLICY.policyVersion, payload: { reasonCode: 'POLICY_SIGNATURE_INVALID' } });
          break;
        }
        case 'LOW_POLICY_VERSION': {
          const old: T.TwinPolicyRef = T.policyRef(T.REVOKED_POLICY, at);
          this.replace(vin, (t) => E.applyPolicyDelivery(t, old, at));
          this.journal.emit({ type: 'vehicle.policy.rejected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, policyVersion: old.policyVersion, payload: { reasonCode: 'POLICY_VERSION_OUTDATED' } });
          break;
        }
        case 'LOCAL_GUARD_FAIL':
          this.replace(vin, (t) => E.applyContextStale(t, at, 'BatterySoc', 900));
          this.replace(vin, (t) => E.applyVehicleReport(t, { reported: 'ON', effective: 'BLOCKED', guardResult: 'BLOCK', guardReason: 'SOC_BELOW_THRESHOLD', reasonCode: 'SOC_BELOW_THRESHOLD' }, at));
          this.journal.emit({ type: 'vehicle.guard.blocked', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, payload: { reasonCode: 'SOC_BELOW_THRESHOLD' } });
          break;
        case 'EFFECTIVE_DRIFT':
          this.replace(vin, (t) => E.applyDesiredChange(t, 'OFF', at));
          this.replace(vin, (t) => E.applyVehicleReport(t, { reported: 'ON', effective: 'ON', guardResult: 'PASS', reasonCode: 'EFFECTIVE_DRIFT_DETECTED' }, at));
          this.journal.emit({ type: 'twin.drift.detected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, payload: { reasonCode: 'EFFECTIVE_DRIFT_DETECTED' } });
          break;
        case 'ABNORMAL_DTC':
          this.replace(vin, (t) => E.applyDtc(t, at, 'P0A7F-00'));
          this.journal.emit({ type: 'twin.drift.detected', vin, at, simTick: this.clock.simTick, correlationId: T.DEMO_ROLLOUT_ID, payload: { reasonCode: 'ABNORMAL_DTC' } });
          break;
        default:
          break;
      }
    });

    this.reevaluate();
    // 영향 범위 = 결함이 주입된 차량 + 자동 일시정지로 함께 멈춘 현재 Wave
    const blast = new Set<string>(targets);
    if (this.rollout.active) this.rollout.activatedVins.forEach((vin) => blast.add(vin));
    const affected = [...blast];
    const paused = this.rollout.active;
    const severity: T.TwinIncident['severity'] = fault === 'EFFECTIVE_DRIFT' || fault === 'ABNORMAL_DTC' ? 'SEV-1' : 'SEV-2';
    const incident: T.TwinIncident = {
      incidentId: `INC-${String(++this.incidentSeq).padStart(4, '0')}`,
      fault,
      severity,
      status: 'OPEN',
      openedAt: at,
      featureId: T.FEATURE_ID,
      policyVersion: T.DEMO_POLICY.policyVersion,
      affectedVins: affected,
      rolloutId: T.DEMO_ROLLOUT_ID,
      rolloutPaused: paused,
      killSwitch: this.getTwin(targets[0])?.killSwitch ?? {
        active: false,
        reason: { ko: '해당 없음', en: 'None' },
        requestedBy: '',
        requestedAt: at,
        safeState: 'OFF',
        featureId: T.FEATURE_ID,
        policyVersion: T.DEMO_POLICY.policyVersion,
        affectedVins: 0,
      },
      reasonCode: this.verdicts.find((v) => v.twin.vin === targets[0])?.verdictReason.code ?? 'CAUSE_ANALYSIS_REQUIRED',
      rootCause: def.desc,
      evidence: [],
      steps: E.closedLoopProgress(5),
      detectedBy: fault === 'ABNORMAL_DTC' ? 'TELEMETRY' : 'TWIN_RECONCILIATION',
    };
    this.incidents = [incident, ...this.incidents];
    this.journal.emit({
      type: 'incident.created',
      vin: targets[0]!,
      at,
      simTick: this.clock.simTick,
      correlationId: incident.incidentId,
      payload: { title: def.label.en, severity },
    });
    // 자동 Pause 가 실제로 걸리면 6단계까지 완료된 상태로 시작한다 (§12.5).
    this.incidents = this.incidents.map((i) =>
      i.incidentId === incident.incidentId ? { ...i, steps: E.closedLoopProgress(this.rollout.active ? 6 : 5) } : i,
    );
    this.pauseRollout({ ko: `${def.label.ko} — 자동 일시정지`, en: `${def.label.en} — auto paused` });
    // Rollout 이 비활성이면 pauseRollout 이 발행하지 않으므로 Incident 생성분을 여기서 확정한다.
    this.publish();
    return this.incidentById(incident.incidentId)!;
  }

  /**
   * Closed-loop 진행 단계 갱신. `current` 는 0-based ACTIVE 단계 index.
   */
  advanceClosedLoop(incidentId: string, current: number, detail?: T.Localized): void {
    this.incidents = this.incidents.map((inc) =>
      inc.incidentId === incidentId
        ? { ...inc, status: current >= 10 ? 'RECOVERING' : 'MITIGATING', steps: E.closedLoopProgress(current).map((s) => (s.id === current + 1 ? { ...s, detail: detail ?? s.detail } : s)) }
        : inc,
    );
    this.publish();
  }

  closeIncident(incidentId: string): T.TwinIncident | null {
    const inc = this.incidentById(incidentId);
    if (!inc) return null;
    const at = E.isoAt(this.now());
    this.incidents = this.incidents.map((i) =>
      i.incidentId === incidentId
        ? {
            ...i,
            status: 'CLOSED',
            closedAt: at,
            rolloutPaused: false,
            steps: E.closedLoopProgress(12),
            evidence: [
              { id: `EVD-${incidentId}-1`, label: { ko: 'Reconciliation 스냅샷', en: 'Reconciliation snapshot' }, kind: 'GUARD', capturedAt: at },
              { id: `EVD-${incidentId}-2`, label: { ko: 'Kill-Switch 실행 기록', en: 'Kill-switch execution record' }, kind: 'SAFETY', capturedAt: at },
              { id: `EVD-${incidentId}-3`, label: { ko: '복구 후 수렴 검증', en: 'Post-recovery convergence check' }, kind: 'ROLLBACK', capturedAt: at },
            ],
          }
        : i,
    );
    this.journal.emit({ type: 'incident.closed', vin: inc.affectedVins[0] ?? ALL, at, simTick: this.clock.simTick, correlationId: incidentId, payload: { title: inc.fault } });
    // Incident 상태 변경도 구독자에게 전달해야 화면이 갱신된다.
    this.publish();
    return this.incidentById(incidentId);
  }

  /** §13 7단계 — 정상 Cohort 만 부분 복구한다. */
  recoverCohort(incidentId: string, vins: string[]): void {
    const at = E.isoAt(this.now());
    vins.forEach((vin) => {
      const twin = this.getTwin(vin);
      if (!twin) return;
      this.replace(vin, (t) => E.applyOffline(t, at, false));
      this.replace(vin, (t) => E.applyContextRecovered(t, at, 'BatteryTemperature'));
      this.replace(vin, (t) => E.applyContextRecovered(t, at, 'BatterySoc'));
      this.replace(vin, (t) => E.applyKillSwitch(t, undefined, at));
      this.replace(vin, (t) => E.applyDesiredChange(t, 'ON', at));
      this.replace(vin, (t) => E.applyVehicleReport(t, { reported: 'ON', guardResult: 'PASS' }, at));
      this.reevaluate();
      this.replace(vin, (t) => E.applyVehicleReport(t, { effective: 'ON', reasonCode: 'LOCAL_GUARD_PASSED' }, at));
      this.journal.emit({ type: 'vehicle.feature.effective', vin, at, simTick: this.clock.simTick, correlationId: incidentId, payload: { effective: 'ON', reasonCode: 'LOCAL_GUARD_PASSED' } });
    });
    this.journal.emit({ type: 'rollback.completed', vin: ALL, at, simTick: this.clock.simTick, correlationId: incidentId, payload: { scope: 'PARTIAL_RECOVERY', vehicles: vins.length } });
    this.reevaluate();
    this.advanceClosedLoop(incidentId, 10, { ko: `${vins.length}대 부분 복구 완료`, en: `${vins.length} vehicle(s) partially recovered` });
  }

  incidentById(id: string): T.TwinIncident | null {
    return this.incidents.find((i) => i.incidentId === id) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Gate (§12.2 Production 배포 차단)                                  */
  /* ---------------------------------------------------------------- */

  setGate(gate: Partial<T.ImpactGate>): void {
    this.gate = { ...this.gate, ...gate };
    this.publish();
  }

  resetAll(): void {
    this.clock = { ...this.clock, simTimeMs: this.baseNowMs, simTick: 0, rate: 0, running: false };
    this.incidents = [];
    this.pending = [];
    this.incidentSeq = 0;
    this.rollout = {
      rolloutId: T.DEMO_ROLLOUT_ID,
      policyId: T.DEMO_POLICY.policyId,
      policyVersion: T.DEMO_POLICY.policyVersion,
      featureId: T.FEATURE_ID,
      active: false,
      paused: false,
      scope: 'NONE',
      activatedVins: [],
      binaryOtaVins: [],
    };
    this.gate = { impactReviewed: false, qualityGatePassed: false };
    this.journal.clear();
    this.rebuild(this.now());
    this.publish();
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private rebuild(nowMs: number): void {
    this.twins = buildDemoFleet(nowMs);
    this.reevaluate();
    this.publish();
  }

  private replace(vin: string, update: (t: T.Twin) => T.Twin, evaluate = true): void {
    let changed = false;
    this.twins = this.twins.map((t) => {
      if (t.vin !== vin) return t;
      changed = true;
      return update(t);
    });
    if (changed && evaluate) this.reevaluate();
  }

  private reevaluate(): void {
    this.verdicts = this.twins.map((t) => E.evaluateTwin(t, { nowMs: this.now() }));
    this.snapshotCache = null;
    this.listeners.forEach((l) => l());
    this.rev++;
  }

  private flushDeliveries(): void {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.dueTick <= this.clock.simTick);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.dueTick > this.clock.simTick);
    due.forEach((p) => this.deliver(p));
  }

  /** §9 — 차량이 Policy 를 받아 Reported/Effective 까지 도달하는 흐름. */
  private deliver(p: PendingDelivery): void {
    const twin = this.getTwin(p.vin);
    if (!twin) return;
    const at = E.isoAt(this.now());
    const correlationId = T.DEMO_ROLLOUT_ID;
    if (!twin.link.online) {
      // 재접속 전까지는 PENDING 으로 남고 다시 예약한다.
      this.pending.push({ ...p, dueTick: this.clock.simTick + 4 });
      return;
    }
    this.journal.emit({ type: 'vehicle.policy.received', vin: p.vin, at, simTick: this.clock.simTick, correlationId, policyVersion: p.policy.policyVersion });

    // Kill-Switch 가 활성이면 수신 후에도 실행되지 않는다 (§15-5).
    if (twin.killSwitch?.active) {
      this.replace(p.vin, (t) => E.applyVehicleReport(t, { reported: 'OFF', effective: 'OFF', guardResult: 'BLOCK', guardReason: 'KILL_SWITCH_ACTIVE', reasonCode: 'KILL_SWITCH_ACTIVE' }, at));
      this.journal.emit({ type: 'vehicle.guard.blocked', vin: p.vin, at, simTick: this.clock.simTick, correlationId, payload: { reasonCode: 'KILL_SWITCH_ACTIVE' } });
      return;
    }

    this.replace(p.vin, (t) => E.applyPolicyDelivery(t, p.policy, at));
    const reported = this.getTwin(p.vin)!;
    if (reported.featureInstances[T.FEATURE_ID]!.reported.state === 'REJECTED') {
      this.journal.emit({ type: 'vehicle.policy.rejected', vin: p.vin, at, simTick: this.clock.simTick, correlationId, policyVersion: p.policy.policyVersion, payload: { reasonCode: this.verdicts.find((v) => v.twin.vin === p.vin)?.reconciliation.reasonCode } });
      this.reevaluate();
      return;
    }
    this.journal.emit({ type: 'vehicle.feature.reported', vin: p.vin, at, simTick: this.clock.simTick, correlationId, payload: { reported: 'ON' } });

    const guard = E.evaluateLocalGuard(this.getTwin(p.vin)!, { nowMs: this.now(), incomingPolicySeq: E.parsePolicySeq(p.policy.policyVersion) });
    if (!guard.passed) {
      this.replace(p.vin, (t) => E.applyVehicleReport(t, { reported: 'ON', effective: 'BLOCKED', guardResult: 'BLOCK', guardReason: guard.reasonCode, reasonCode: guard.reasonCode }, at));
      this.journal.emit({ type: 'vehicle.guard.blocked', vin: p.vin, at, simTick: this.clock.simTick, correlationId, payload: { reasonCode: guard.reasonCode } });
      return;
    }
    this.replace(p.vin, (t) => E.applyVehicleReport(t, { reported: 'ON', effective: 'ON', guardResult: 'PASS', reasonCode: 'LOCAL_GUARD_PASSED' }, at));
    this.journal.emit({ type: 'vehicle.feature.effective', vin: p.vin, at, simTick: this.clock.simTick, correlationId, payload: { effective: 'ON', reasonCode: 'LOCAL_GUARD_PASSED' } });
    const recon = this.verdicts.find((v) => v.twin.vin === p.vin)?.reconciliation.result;
    this.journal.emit({ type: 'twin.reconciliation.changed', vin: p.vin, at, simTick: this.clock.simTick, correlationId, payload: { reconciliation: recon } });
  }

  private applyEvent(event: T.TwinEvent): void {
    const at = event.occurredAt;
    switch (event.eventType) {
      case 'policy.desired.changed':
        this.replace(event.vin, (t) => E.applyDesiredChange(t, (event.payload?.desired as T.DesiredState) ?? 'ON', at));
        break;
      case 'vehicle.policy.received':
        this.replace(event.vin, (t) => E.applyPolicyDelivery(t, T.policyRef(T.DEMO_POLICY, at), at));
        break;
      case 'vehicle.feature.reported':
        this.replace(event.vin, (t) => E.applyVehicleReport(t, { reported: (event.payload?.reported as T.ReportedState) ?? 'ON' }, at));
        break;
      case 'vehicle.feature.effective':
        this.replace(event.vin, (t) => E.applyEffectiveState(t, (event.payload?.effective as T.EffectiveState) ?? 'ON', (event.payload?.reasonCode as T.ReasonCode) ?? 'LOCAL_GUARD_PASSED', at));
        break;
      default:
        this.reevaluate();
    }
  }

  private hasOpenFaultFor(vin: string, fault: T.FaultType): boolean {
    return this.incidents.some((i) => i.fault === fault && i.status !== 'CLOSED' && i.affectedVins.includes(vin));
  }

  private convergence(): T.RolloutConvergence {
    const inScope = this.verdicts.filter((v) => T.DEMO_TARGET_RULE.region.includes(v.twin.identity.region));
    return E.computeConvergence(inScope, this.now(), this.rollout.paused, this.rollout.pausedReason);
  }
}
