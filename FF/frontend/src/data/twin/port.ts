/**
 * §16 — DigitalTwinPort.
 *
 * Every screen talks to the twin layer through this boundary only, so the demo's
 * in-memory provider can later be swapped for Eclipse Ditto / AWS IoT Device
 * Shadow / KUKSA without touching a single component.
 */
import * as T from './types';
import type { TwinVerdict } from './engine';
import type { TwinEventJournal } from './events';

export interface TwinClock {
  /** Simulation time — deliberately separate from wall clock (§14). */
  simTimeMs: number;
  /** Monotonic tick counter; every event carries it. */
  simTick: number;
  /** 0 = paused, 1 = real time, 5 = 5× . */
  rate: 0 | 1 | 5;
  startedAtMs: number;
  running: boolean;
}

export interface RolloutState {
  rolloutId: string;
  policyVersion: string;
  policyId: string;
  featureId: string;
  active: boolean;
  paused: boolean;
  pausedReason?: T.Localized;
  /** Canary/전체 구분 — §13 5단계. */
  scope: 'NONE' | 'CANARY' | 'WAVE' | 'FLEET';
  activatedAt?: string;
  activatedVins: string[];
  binaryOtaVins: string[];
}

export interface TwinStoreSnapshot {
  twins: T.Twin[];
  verdicts: TwinVerdict[];
  stats: T.TwinFleetStats;
  convergence: T.RolloutConvergence;
  incidents: T.TwinIncident[];
  clock: TwinClock;
  rollout: RolloutState;
  gate: T.ImpactGate;
  events: T.TwinEvent[];
  /** Bumped on every mutation so `useSyncExternalStore` can diff cheaply. */
  revision: number;
}

export interface AsBuiltSnapshot {
  vin: string;
  eolSnapshotId: string;
  hardwareCapabilities: string[];
  variantCodingVersion: string;
  recordedAt: string;
}

export interface DeploymentResult {
  vin: string;
  oneBinaryVersion: string;
  bmsSoftwareVersion: string;
  installationStatus: T.InstallStatus;
  at: string;
}

/**
 * §16 contract. Names mirror the REST endpoints of §10 so the same call sites
 * work against a real backend later.
 */
export interface DigitalTwinPort {
  listTwins(filters?: T.TwinFilters): T.Twin[];
  getTwin(vin: string): T.Twin | null;
  queryTargetFacts(rule: T.TargetRule): T.TwinImpactResult;
  ingestAsBuilt(snapshot: AsBuiltSnapshot): boolean;
  ingestDeploymentResult(result: DeploymentResult): boolean;
  ingestVehicleReport(event: T.TwinEvent): boolean;
  reconcile(vin: string, featureId: string): T.ReconciliationResult | null;
  runSimulation(request: T.SimulationInputs): T.SimulationResult;
  getTimeline(vin: string): T.TwinEvent[];
  subscribe(listener: () => void): () => void;
  /** Journal is part of the contract so timelines/audit stay provider-owned. */
  journal: TwinEventJournal;
}
