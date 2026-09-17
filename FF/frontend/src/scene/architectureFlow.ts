/**
 * 레이어드 아키텍처 데이터 플로우 — pure model/layout for the "Fleet 평면도" tab.
 *
 * This module has **no React, no DOM, no `Math.random()`, no `Date.now()`**. Every
 * number, node, edge and coordinate is derived deterministically from a
 * `TwinStoreSnapshot`. `ArchitectureFlow.tsx` only renders what this module computes;
 * motion is pure CSS driven by the geometry + timing this module returns.
 *
 * Six stacked layers (top → bottom), matching the real control plane:
 *   1. Feature Catalog   — what a feature *is* (registry facts)
 *   2. Policy Engine      — what *should* happen (target rule, policy version, gate)
 *   3. Rollout Gate       — how far the change is allowed to spread (convergence)
 *   4. Connectivity/OTA   — how the decision *reaches* a vehicle
 *   5. Vehicle Edge       — what actually runs on the car (guard, ECU, kill-switch)
 *   6. Observability      — proof of what happened (reconciliation, incidents, audit)
 *
 * Edges only ever connect adjacent layers. Every edge carries a `kind` and a
 * deterministic `packetCount` derived from live fleet numbers, and is flagged
 * `blocked` (with a reason) when the underlying condition (rollout paused, guard
 * blocking, critical drift, kill-switch) is actually true in the snapshot.
 */
import type { TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export type LayerId = 'catalog' | 'policy' | 'rollout' | 'connectivity' | 'vehicle' | 'observability';

export const LAYER_ORDER: LayerId[] = ['catalog', 'policy', 'rollout', 'connectivity', 'vehicle', 'observability'];

export const LAYER_INDEX: Record<LayerId, number> = LAYER_ORDER.reduce(
  (acc, id, i) => ({ ...acc, [id]: i }),
  {} as Record<LayerId, number>,
);

export const LAYER_TITLE: Record<LayerId, T.Localized> = {
  catalog: { ko: 'Feature Catalog · 피처 카탈로그', en: 'Feature Catalog' },
  policy: { ko: 'Policy Engine · 정책 엔진', en: 'Policy Engine' },
  rollout: { ko: 'Rollout Gate · 수렴 게이트', en: 'Rollout Gate' },
  connectivity: { ko: 'Connectivity / OTA · 커넥티비티', en: 'Connectivity / OTA' },
  vehicle: { ko: 'Vehicle Edge · 차량 에지', en: 'Vehicle Edge' },
  observability: { ko: 'Observability · 관측', en: 'Observability' },
};

export type Tone = 'pass' | 'pending' | 'fail' | 'info' | 'muted';

export interface ArchNode {
  id: string;
  layer: LayerId;
  title: T.Localized;
  metricValue: string;
  metricLabel: T.Localized;
  tone: Tone;
}

export interface ArchLayer {
  id: LayerId;
  index: number;
  title: T.Localized;
  nodes: ArchNode[];
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

export type EdgeKind = 'command' | 'report' | 'telemetry' | 'audit';
export type EdgeDirection = 'down' | 'up';

export interface ArchEdge {
  id: string;
  from: LayerId;
  to: LayerId;
  kind: EdgeKind;
  direction: EdgeDirection;
  label: T.Localized;
  packetCount: number;
  blocked: boolean;
  blockReason?: T.Localized;
  /** Layout geometry in an abstract 0..VIEW_W / 0..totalHeight coordinate space. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const EDGE_KIND_LABEL: Record<EdgeKind, T.Localized> = {
  command: { ko: 'Command (하향 · 정책/의도)', en: 'Command (down · policy/desired)' },
  report: { ko: 'Report (상향 · 보고 상태)', en: 'Report (up · reported/effective)' },
  telemetry: { ko: 'Telemetry (상향 · 원시 신호)', en: 'Telemetry (up)' },
  audit: { ko: 'Audit (하향 · 감사 기록)', en: 'Audit (down)' },
};

/* ------------------------------------------------------------------ */
/* Layout constants — pure geometry, no DOM                            */
/* ------------------------------------------------------------------ */

export const VIEW_W = 1080;
export const LAYER_H = 96;
export const LAYER_GAP = 72;

export function layerBand(index: number): { top: number; bottom: number; height: number } {
  const top = index * (LAYER_H + LAYER_GAP);
  return { top, bottom: top + LAYER_H, height: LAYER_H };
}

export function totalHeight(layerCount = LAYER_ORDER.length): number {
  return layerCount * (LAYER_H + LAYER_GAP) - LAYER_GAP;
}

/* ------------------------------------------------------------------ */
/* Small deterministic helpers                                         */
/* ------------------------------------------------------------------ */

export function killSwitchActiveCount(snapshot: TwinStoreSnapshot): number {
  return snapshot.twins.filter((t) => t.killSwitch?.active).length;
}

export function onlineTwinCount(snapshot: TwinStoreSnapshot): number {
  return snapshot.twins.filter((t) => t.link.online).length;
}

export function openIncidentCount(snapshot: TwinStoreSnapshot): number {
  return snapshot.incidents.filter((i) => i.status === 'OPEN' || i.status === 'MITIGATING').length;
}

function toneFor(value: number, kind: 'bad' | 'good' = 'bad'): Tone {
  if (value <= 0) return kind === 'bad' ? 'muted' : 'pass';
  return kind === 'bad' ? 'fail' : 'pass';
}

/* ------------------------------------------------------------------ */
/* Layers → nodes                                                      */
/* ------------------------------------------------------------------ */

export function buildLayers(snapshot: TwinStoreSnapshot): ArchLayer[] {
  const { stats, rollout, gate, convergence } = snapshot;
  const targetable = stats.eligibilityCounts.ELIGIBLE_POLICY_ONLY + stats.eligibilityCounts.REQUIRES_BINARY_OTA;
  const approved = gate.impactReviewed && gate.qualityGatePassed;
  const ks = killSwitchActiveCount(snapshot);
  const online = onlineTwinCount(snapshot);
  const openIncidents = openIncidentCount(snapshot);

  const layerDefs: Array<{ id: LayerId; nodes: ArchNode[] }> = [
    {
      id: 'catalog',
      nodes: [
        node('catalog', 'feature-def', { ko: 'Feature Definition', en: 'Feature Definition' }, T.FEATURE_ID, {
          ko: `${T.FEATURE_VERSION} · 대상 ${targetable}대`,
          en: `${T.FEATURE_VERSION} · target ${targetable}`,
        }, 'info'),
        node(
          'catalog',
          'variant-matrix',
          { ko: 'Variant Matrix', en: 'Variant Matrix' },
          String(stats.eligibilityCounts.INCOMPATIBLE_VARIANT),
          { ko: 'Variant 불일치', en: 'Variant mismatch' },
          toneFor(stats.eligibilityCounts.INCOMPATIBLE_VARIANT),
        ),
        node(
          'catalog',
          'entitlement',
          { ko: 'Entitlement', en: 'Entitlement' },
          String(stats.eligibilityCounts.MISSING_ENTITLEMENT),
          { ko: 'Entitlement 없음', en: 'Entitlement missing' },
          toneFor(stats.eligibilityCounts.MISSING_ENTITLEMENT),
        ),
        node(
          'catalog',
          'required-cap',
          { ko: 'Required Capability', en: 'Required Capability' },
          String(stats.eligibilityCounts.INCOMPATIBLE_HARDWARE),
          { ko: 'HW Capability 부족', en: 'HW capability missing' },
          toneFor(stats.eligibilityCounts.INCOMPATIBLE_HARDWARE),
        ),
      ],
    },
    {
      id: 'policy',
      nodes: [
        node(
          'policy',
          'target-rule',
          { ko: 'Target Rule', en: 'Target Rule' },
          String(rollout.activatedVins.length),
          { ko: '대상 VIN', en: 'Targeted VINs' },
          rollout.activatedVins.length > 0 ? 'info' : 'muted',
        ),
        node('policy', 'impact-analysis', { ko: 'Impact Analysis', en: 'Impact Analysis' }, String(stats.total), {
          ko: '분석 대상 전체',
          en: 'Total analyzed',
        }, 'info'),
        node(
          'policy',
          'policy-version',
          { ko: 'Policy Version', en: 'Policy Version' },
          rollout.policyVersion,
          { ko: rollout.active ? '활성' : '비활성', en: rollout.active ? 'Active' : 'Inactive' },
          rollout.active ? 'pass' : 'muted',
        ),
        node(
          'policy',
          'approval-gate',
          { ko: 'Approval Gate 2인 승인', en: 'Approval Gate (2-person)' },
          approved ? 'PASS' : 'WAIT',
          { ko: approved ? '승인 완료' : '승인 대기', en: approved ? 'Approved' : 'Pending approval' },
          approved ? 'pass' : 'pending',
        ),
      ],
    },
    {
      id: 'rollout',
      nodes: [
        node('rollout', 'stage', { ko: '단계 (Canary/Wave/Fleet)', en: 'Stage' }, rollout.scope, {
          ko: '현재 Rollout 단계',
          en: 'Current rollout stage',
        }, rollout.scope === 'NONE' ? 'muted' : 'info'),
        node(
          'rollout',
          'threshold',
          { ko: 'Threshold', en: 'Threshold' },
          `${Math.round(convergence.threshold * 100)}%`,
          { ko: '수렴 임계치', en: 'Convergence threshold' },
          'info',
        ),
        node(
          'rollout',
          'convergence-rate',
          { ko: 'Convergence Rate', en: 'Convergence Rate' },
          `${Math.round(convergence.convergenceRate * 100)}%`,
          { ko: '실시간 수렴률', en: 'Live convergence rate' },
          convergence.convergenceRate >= convergence.threshold ? 'pass' : 'pending',
        ),
        node(
          'rollout',
          'pause-resume',
          { ko: 'Pause / Resume', en: 'Pause / Resume' },
          rollout.paused ? 'PAUSED' : 'RUN',
          rollout.paused
            ? rollout.pausedReason ?? { ko: '일시정지', en: 'Paused' }
            : { ko: '진행 중', en: 'Running' },
          rollout.paused ? 'fail' : 'pass',
        ),
      ],
    },
    {
      id: 'connectivity',
      nodes: [
        node('connectivity', 'telematics', { ko: 'Telematics 경로', en: 'Telematics path' }, String(online), {
          ko: '온라인 차량',
          en: 'Vehicles online',
        }, online > 0 ? 'pass' : 'muted'),
        node(
          'connectivity',
          'policy-delivery',
          { ko: 'Policy Delivery', en: 'Policy Delivery' },
          String(stats.policyOnly),
          { ko: 'Policy-only 배포', en: 'Policy-only delivery' },
          stats.policyOnly > 0 ? 'info' : 'muted',
        ),
        node(
          'connectivity',
          'binary-ota',
          { ko: 'Binary OTA 경로', en: 'Binary OTA path' },
          String(stats.requiresBinaryOta),
          { ko: 'Binary OTA 선행 필요', en: 'Binary OTA required' },
          toneFor(stats.requiresBinaryOta),
        ),
      ],
    },
    {
      id: 'vehicle',
      nodes: [
        node('vehicle', 'twin-agent', { ko: 'Vehicle Agent', en: 'Vehicle Agent' }, String(stats.total), {
          ko: '활성 차량',
          en: 'Active vehicles',
        }, 'info'),
        node(
          'vehicle',
          'local-guard',
          { ko: 'Local Guard', en: 'Local Guard' },
          String(stats.guardBlocked),
          { ko: 'Guard 차단', en: 'Guard blocked' },
          toneFor(stats.guardBlocked),
        ),
        node(
          'vehicle',
          'ecu-actuator',
          { ko: 'ECU / Actuator', en: 'ECU / Actuator' },
          String(stats.reconciliationCounts.CONVERGED),
          { ko: '실행 반영', en: 'Applied' },
          stats.reconciliationCounts.CONVERGED > 0 ? 'pass' : 'muted',
        ),
        node(
          'vehicle',
          'kill-switch',
          { ko: 'Kill-Switch', en: 'Kill-Switch' },
          String(ks),
          { ko: 'Kill-Switch 발동', en: 'Kill-switch active' },
          toneFor(ks),
        ),
      ],
    },
    {
      id: 'observability',
      nodes: [
        node(
          'observability',
          'reconciliation-service',
          { ko: 'Reconciliation Service', en: 'Reconciliation Service' },
          String(stats.total),
          { ko: '판정 완료', en: 'Verdicts computed' },
          'info',
        ),
        node(
          'observability',
          'drift-stale',
          { ko: 'Drift / Stale 감지', en: 'Drift / Stale detection' },
          String(stats.drift + stats.stale),
          {
            ko: `Drift ${stats.drift} · Stale ${stats.stale} · Unknown ${stats.unknown}`,
            en: `Drift ${stats.drift} · Stale ${stats.stale} · Unknown ${stats.unknown}`,
          },
          toneFor(stats.drift + stats.stale),
        ),
        node('observability', 'incident', { ko: 'Incident', en: 'Incident' }, String(openIncidents), {
          ko: `오픈 인시던트 (전체 ${snapshot.incidents.length})`,
          en: `Open incidents (total ${snapshot.incidents.length})`,
        }, toneFor(openIncidents)),
        node('observability', 'audit', { ko: 'Audit', en: 'Audit' }, String(snapshot.events.length), {
          ko: '감사 이벤트 로그',
          en: 'Audit event log',
        }, 'info'),
      ],
    },
  ];

  return layerDefs.map((def, i) => ({ id: def.id, index: i, title: LAYER_TITLE[def.id], nodes: def.nodes }));
}

export interface NodeBox {
  node: ArchNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Evenly spaces a layer's nodes horizontally within the layer's band. Pure geometry. */
export function layoutNodes(layer: ArchLayer): NodeBox[] {
  const margin = 40;
  const gap = 20;
  const n = layer.nodes.length || 1;
  const w = (VIEW_W - margin * 2 - gap * (n - 1)) / n;
  const band = layerBand(layer.index);
  return layer.nodes.map((n2, i) => ({ node: n2, x: margin + i * (w + gap), y: band.top, w, h: LAYER_H }));
}

function node(
  layer: LayerId,
  key: string,
  title: T.Localized,
  metricValue: string,
  metricLabel: T.Localized,
  tone: Tone,
): ArchNode {
  return { id: `${layer}-${key}`, layer, title, metricValue, metricLabel, tone };
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

interface EdgeDef {
  id: string;
  from: LayerId;
  to: LayerId;
  kind: EdgeKind;
  label: T.Localized;
  packetCount: number;
  blocked: boolean;
  blockReason?: T.Localized;
}

export function buildEdges(snapshot: TwinStoreSnapshot): ArchEdge[] {
  const { stats, rollout, gate, convergence } = snapshot;
  const targetable = stats.eligibilityCounts.ELIGIBLE_POLICY_ONLY + stats.eligibilityCounts.REQUIRES_BINARY_OTA;
  const approved = gate.impactReviewed && gate.qualityGatePassed;
  const ks = killSwitchActiveCount(snapshot);
  const pausedReason = rollout.pausedReason ?? { ko: 'Rollout 일시정지', en: 'Rollout paused' };

  const defs: EdgeDef[] = [
    {
      id: 'e-catalog-policy',
      from: 'catalog',
      to: 'policy',
      kind: 'command',
      label: { ko: 'Target Rule 전달', en: 'Target rule delivered' },
      packetCount: targetable,
      blocked: false,
    },
    {
      id: 'e-policy-catalog',
      from: 'policy',
      to: 'catalog',
      kind: 'report',
      label: { ko: 'Eligibility 결과 회신', en: 'Eligibility results reported' },
      packetCount: stats.total,
      blocked: false,
    },
    {
      id: 'e-policy-rollout',
      from: 'policy',
      to: 'rollout',
      kind: 'command',
      label: { ko: '정책 브로드캐스트', en: 'Policy broadcast' },
      packetCount: rollout.activatedVins.length,
      blocked: rollout.paused,
      blockReason: rollout.paused ? pausedReason : undefined,
    },
    {
      id: 'e-policy-rollout-audit',
      from: 'policy',
      to: 'rollout',
      kind: 'audit',
      label: { ko: '2인 승인 감사 기록', en: '2-person approval audit trail' },
      packetCount: approved ? 1 : 0,
      blocked: !approved,
      blockReason: approved ? undefined : { ko: '승인 대기 (Impact Review / Quality Gate)', en: 'Awaiting approval' },
    },
    {
      id: 'e-rollout-policy',
      from: 'rollout',
      to: 'policy',
      kind: 'report',
      label: { ko: '수렴 결과 보고', en: 'Convergence result reported' },
      packetCount: convergence.counts.CONVERGED,
      blocked: false,
    },
    {
      id: 'e-rollout-connectivity',
      from: 'rollout',
      to: 'connectivity',
      kind: 'command',
      label: { ko: '배포 경로 지정', en: 'Delivery path assigned' },
      packetCount: stats.policyOnly + stats.requiresBinaryOta,
      blocked: rollout.paused,
      blockReason: rollout.paused ? pausedReason : undefined,
    },
    {
      id: 'e-connectivity-rollout',
      from: 'connectivity',
      to: 'rollout',
      kind: 'report',
      label: { ko: 'Policy Delivery 확인', en: 'Policy delivery confirmed' },
      packetCount: stats.policyOnly,
      blocked: false,
    },
    {
      id: 'e-connectivity-vehicle',
      from: 'connectivity',
      to: 'vehicle',
      kind: 'command',
      label: { ko: 'Binary OTA 전송', en: 'Binary OTA push' },
      packetCount: stats.requiresBinaryOta,
      blocked: rollout.paused,
      blockReason: rollout.paused ? pausedReason : undefined,
    },
    {
      id: 'e-vehicle-connectivity',
      from: 'vehicle',
      to: 'connectivity',
      kind: 'report',
      label: { ko: 'Reported State 회신', en: 'Reported state' },
      packetCount: Math.max(0, stats.total - stats.guardBlocked),
      blocked: false,
    },
    {
      id: 'e-vehicle-observability',
      from: 'vehicle',
      to: 'observability',
      kind: 'telemetry',
      label: { ko: '텔레메트리 스트림', en: 'Telemetry stream' },
      packetCount: stats.drift + stats.stale + stats.unknown,
      blocked: stats.drift > 0,
      blockReason: stats.drift > 0 ? E.reason('EFFECTIVE_DRIFT_DETECTED').label : undefined,
    },
    {
      id: 'e-observability-vehicle',
      from: 'observability',
      to: 'vehicle',
      kind: 'command',
      label: { ko: 'Kill-Switch 지시', en: 'Kill-switch directive' },
      packetCount: ks,
      blocked: ks > 0,
      blockReason: ks > 0 ? E.reason('KILL_SWITCH_ACTIVE').label : undefined,
    },
  ];

  // The Local Guard block is surfaced on the edge that is actively being blocked from
  // delivering: the connectivity → vehicle command edge (Binary OTA / policy push).
  const guardEdge = defs.find((d) => d.id === 'e-connectivity-vehicle');
  if (guardEdge && stats.guardBlocked > 0) {
    guardEdge.blocked = true;
    guardEdge.blockReason = E.reason('LOCAL_GUARD_BLOCKED').label;
  }

  return layoutEdges(defs);
}

/** Assigns deterministic X offsets to edges sharing the same layer pair, and Y endpoints from the layer bands. */
function layoutEdges(defs: EdgeDef[]): ArchEdge[] {
  const pairCounts = new Map<string, number>();
  const pairSeen = new Map<string, number>();
  for (const d of defs) {
    const key = pairKey(d.from, d.to);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const margin = 140;
  return defs.map((d) => {
    const key = pairKey(d.from, d.to);
    const count = pairCounts.get(key) ?? 1;
    const seenIdx = pairSeen.get(key) ?? 0;
    pairSeen.set(key, seenIdx + 1);
    const x = count === 1 ? VIEW_W / 2 : margin + (seenIdx * (VIEW_W - 2 * margin)) / (count - 1);

    const fromIdx = LAYER_INDEX[d.from];
    const toIdx = LAYER_INDEX[d.to];
    const direction: EdgeDirection = toIdx > fromIdx ? 'down' : 'up';
    const fromBand = layerBand(fromIdx);
    const toBand = layerBand(toIdx);
    const y1 = direction === 'down' ? fromBand.bottom : fromBand.top;
    const y2 = direction === 'down' ? toBand.top : toBand.bottom;

    return {
      id: d.id,
      from: d.from,
      to: d.to,
      kind: d.kind,
      direction,
      label: d.label,
      packetCount: d.packetCount,
      blocked: d.blocked,
      blockReason: d.blockReason,
      x1: x,
      y1,
      x2: x,
      y2,
    };
  });
}

function pairKey(a: LayerId, b: LayerId): string {
  const [x, y] = [LAYER_INDEX[a], LAYER_INDEX[b]].sort((m, n) => m - n);
  return `${x}-${y}`;
}

/* ------------------------------------------------------------------ */
/* Motion timing — pure functions of (rate, index)                     */
/* ------------------------------------------------------------------ */

/** Base packet travel time in ms at 1×. Halved (roughly) at 5×. Frozen visually via CSS when rate === 0. */
export function packetDurationMs(rate: 0 | 1 | 5): number {
  if (rate === 5) return 1300;
  return 3200;
}

/** Deterministic stagger so packets on different edges don't move in lockstep. Pure function of index. */
export function packetDelayMs(index: number, durationMs: number): number {
  return (index * 137) % durationMs;
}

/* ------------------------------------------------------------------ */
/* Cohort swimlanes (from convergence.waves)                           */
/* ------------------------------------------------------------------ */

export interface SwimlaneChip {
  vin: string;
  reconciliation: T.Reconciliation;
}

export interface Swimlane {
  wave: string;
  total: number;
  converged: number;
  rate: number;
  chips: SwimlaneChip[];
}

export function buildSwimlanes(snapshot: TwinStoreSnapshot): Swimlane[] {
  return snapshot.convergence.waves.map((w) => {
    const chips = snapshot.verdicts
      .filter((v) => v.twin.link.cohort === w.wave)
      .sort((a, b) => a.twin.vin.localeCompare(b.twin.vin))
      .slice(0, 8)
      .map((v) => ({ vin: v.twin.vin, reconciliation: v.reconciliation.result }));
    return { wave: w.wave, total: w.total, converged: w.converged, rate: w.rate, chips };
  });
}

/* ------------------------------------------------------------------ */
/* Reason-code breakdown                                               */
/* ------------------------------------------------------------------ */

export interface ReasonChip {
  code: T.ReasonCode;
  count: number;
  label: T.Localized;
  severity: T.ReasonSeverity;
}

export function buildReasonChips(snapshot: TwinStoreSnapshot): ReasonChip[] {
  return snapshot.stats.reasonCodeCounts.slice(0, 10).map((rc) => {
    const def = E.reason(rc.reasonCode);
    return { code: rc.reasonCode, count: rc.count, label: def.label, severity: def.severity };
  });
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export interface LegendItem {
  key: string;
  label: T.Localized;
  swatchClass: string;
}

export const LEGEND: LegendItem[] = [
  { key: 'command', label: EDGE_KIND_LABEL.command, swatchClass: 'arch-swatch-command' },
  { key: 'report', label: EDGE_KIND_LABEL.report, swatchClass: 'arch-swatch-report' },
  { key: 'telemetry', label: EDGE_KIND_LABEL.telemetry, swatchClass: 'arch-swatch-telemetry' },
  { key: 'audit', label: EDGE_KIND_LABEL.audit, swatchClass: 'arch-swatch-audit' },
  {
    key: 'blocked',
    label: { ko: '차단 (■ 정지 표시 동반)', en: 'Blocked (marked with ■ stop icon)' },
    swatchClass: 'arch-swatch-blocked',
  },
];

/* ------------------------------------------------------------------ */
/* Whole-model builder                                                 */
/* ------------------------------------------------------------------ */

export interface ArchitectureModel {
  layers: ArchLayer[];
  edges: ArchEdge[];
  swimlanes: Swimlane[];
  reasonChips: ReasonChip[];
  height: number;
}

export function buildArchitectureModel(snapshot: TwinStoreSnapshot): ArchitectureModel {
  return {
    layers: buildLayers(snapshot),
    edges: buildEdges(snapshot),
    swimlanes: buildSwimlanes(snapshot),
    reasonChips: buildReasonChips(snapshot),
    height: totalHeight(),
  };
}
