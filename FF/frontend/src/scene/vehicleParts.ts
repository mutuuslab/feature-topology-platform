/**
 * §17.3 — 차량 디지털 트윈 3D 뷰의 순수 데이터 모델.
 *
 * `pages/twinLive.tsx` 1세대 구현(부품 10종 · 상태 파생 규칙)을 그대로 이식하되(의미 변경 없음),
 * 엔지니어링/관제실 스타일 장면(레이어·흐름·컷어웨이·카메라 투어)에 필요한 필드를 *추가*한다.
 * React 에 의존하지 않는 순수 함수/타입만 둔다 — 3D 컴포넌트(`vehicleGeometry.tsx`)와
 * 장면(`VehicleTwinScene.tsx`)이 이 모듈을 읽기만 한다.
 */
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';

/* ------------------------------------------------------------------ */
/* 부품 식별 · 상태 — 기존 twinLive.tsx 와 동일한 10종 / 6상태            */
/* ------------------------------------------------------------------ */

export type PartId = 'body' | 'battery' | 'heater' | 'bms' | 'vcu' | 'cgw' | 'hvac' | 'guard' | 'charge' | 'antenna';

/** 부품 상태는 배지(색 + 텍스트)와 3D 색이 같은 의미를 갖도록 1:1 로 맞춘다. */
export type PartState = 'ACTIVE' | 'PENDING' | 'BLOCKED' | 'MISSING' | 'OFFLINE' | 'OFF';

export const PART_STATE_LABEL: Record<PartState, string> = {
  ACTIVE: '정상·활성',
  PENDING: '대기·선행 필요',
  BLOCKED: 'Guard 차단',
  MISSING: '미장착',
  OFFLINE: '연결 끊김',
  OFF: '비활성',
};

/** styles.css 의 --pass/--pending/--fail/--info/--muted 와 동일한 값. */
export const PART_STATE_HEX: Record<PartState, string> = {
  ACTIVE: '#1F9D55',
  PENDING: '#D9822B',
  BLOCKED: '#D64545',
  MISSING: '#D64545',
  OFFLINE: '#3B82F6',
  OFF: '#8895A7',
};

export const PART_STATE_TOKEN: Record<PartState, string> = {
  ACTIVE: 'pass',
  PENDING: 'pending',
  BLOCKED: 'fail',
  MISSING: 'fail',
  OFFLINE: 'info',
  OFF: 'muted',
};

/* ------------------------------------------------------------------ */
/* 레이어 / 노드 / 흐름 — 관제실 스타일 장면을 위한 추가 필드              */
/* ------------------------------------------------------------------ */

/** Cloud → Vehicle Edge → ECU → Actuator/Sensor 로 이어지는 아키텍처 레이어. */
export type Layer = 'CLOUD' | 'VEHICLE_EDGE' | 'ECU' | 'ACTUATOR' | 'SENSOR';

export interface PartNode {
  /** 이 부품이 대표로 보여주는 7단계 상태 중 하나(§9). */
  kind: 'desired' | 'reported' | 'effective' | 'guard';
  state: string;
  policyVersion?: string;
  at?: string;
}

export interface PartFlow {
  /** Desired(정책)가 이 부품을 거쳐 아래로 흐르는가. */
  desiredDown: boolean;
  /** Reported(원격 측정)가 이 부품을 거쳐 위로(클라우드로) 흐르는가. */
  reportedUp: boolean;
  /** 이 부품 "다음"(하류) 구간이 차단되어 패킷이 통과하지 못하는가. */
  blocked: boolean;
  blockReason?: T.Localized;
}

export interface VehiclePart {
  id: PartId;
  label: string;
  /** 값의 출처(화면에서 원천을 숨기지 않는다). */
  source: string;
  value: string;
  state: PartState;
  note: string;
  layer: Layer;
  node: PartNode;
  reasonCode?: string;
  recommendation?: T.Localized;
  approvalRequired?: boolean;
  flow: PartFlow;
  /** 이 부품이 위치하는 3D 좌표(차체 기준). */
  anchor: [number, number, number];
}

/* ------------------------------------------------------------------ */
/* 카메라 프리셋 — 6종(외관/배터리/E·E/HV 케이블/열관리/운전자)           */
/* ------------------------------------------------------------------ */

export type CameraPreset = 'exterior' | 'battery' | 'ee' | 'hv' | 'thermal' | 'driver';

export const CAMERA_PRESETS: Record<
  CameraPreset,
  { label: string; pos: [number, number, number]; target: [number, number, number]; hint: string }
> = {
  exterior: { label: '외관', pos: [6.4, 4.0, 7.4], target: [0, 0.85, 0], hint: '차량 전체 · Desired/Effective 색상 확인' },
  battery: { label: '배터리 팩', pos: [3.0, 2.1, 3.4], target: [0, 0.5, 0.3], hint: '배터리 팩 · 히터 · BMS (X-ray 필요)' },
  ee: { label: 'E·E 아키텍처', pos: [2.4, 3.4, 3.0], target: [0, 0.75, 0.2], hint: 'VCU · CGW · HVAC · Guard 노드' },
  hv: { label: 'HV 케이블', pos: [1.6, 1.3, 2.2], target: [0, 0.55, 0.2], hint: 'HV 정션박스 · 팩 ↔ BMS ↔ HVAC 케이블' },
  thermal: { label: '열관리', pos: [1.9, 1.0, -1.1], target: [0, 0.5, -0.6], hint: '히터 · 냉각 플레이트 · HVAC 컴프레서' },
  driver: { label: '운전자', pos: [0.35, 0.95, 0.55], target: [0, 0.85, -2.2], hint: '운전석 시점 · 계기판/HUD 관점' },
};

export const CAMERA_TOUR: CameraPreset[] = ['exterior', 'battery', 'ee', 'hv', 'thermal', 'driver'];
export const TOUR_DWELL_MS = 6000;

/* ------------------------------------------------------------------ */
/* 부품 상태 파생 — Twin 사실에서만 파생한다(의미 변경 금지)              */
/* ------------------------------------------------------------------ */

function featureState(des: T.DesiredState, rep: T.ReportedState, eff: T.EffectiveState, online: boolean, kill: boolean): PartState {
  if (kill) return 'BLOCKED';
  if (!online) return 'OFFLINE';
  if (eff === 'ON') return 'ACTIVE';
  if (eff === 'BLOCKED') return 'BLOCKED';
  if (eff === 'DEGRADED') return 'PENDING';
  if (des === 'ON') return rep === 'ON' ? 'PENDING' : 'PENDING';
  return 'OFF';
}

/** 각 부품이 정책(Desired)을 아래로 전달하는지 / 원격측정(Reported)을 위로 올리는지. */
function flowOf(desiredDown: boolean, reportedUp: boolean, blocked: boolean, blockReason?: T.Localized): PartFlow {
  return { desiredDown, reportedUp, blocked, blockReason };
}

const ANCHOR: Record<PartId, [number, number, number]> = {
  body: [0, 0.78, 0],
  battery: [0, 0.34, 0.1],
  heater: [0, 0.37, -1.05],
  bms: [0.5, 0.62, 0.45],
  vcu: [-0.5, 0.62, 0.45],
  cgw: [0.5, 0.62, -0.15],
  hvac: [-0.5, 0.62, -0.15],
  guard: [0, 1.02, 0.15],
  charge: [-1.02, 0.84, -1.3],
  antenna: [0, 1.66, -1.0],
};

export function buildVehicleParts(twin: T.Twin | undefined, verdict: E.TwinVerdict | undefined, kill: boolean): VehiclePart[] {
  if (!twin) return [];
  const inst = twin.featureInstances[T.FEATURE_ID];
  const des = inst?.desired.state ?? 'OFF';
  const rep = inst?.reported.state ?? 'UNKNOWN';
  const eff = inst?.effective.state ?? 'UNKNOWN';
  const loc = T.FEATURE_REQUIREMENTS;
  const hasHeater = twin.asBuilt.hardwareCapabilities.includes(loc.hardwareCapabilities[0]);
  const bmsOk = E.cmpSemver(twin.asDeployed.bmsSoftwareVersion, loc.minimumBmsSoftware) >= 0;
  const obOk = E.cmpSemver(twin.asDeployed.oneBinaryVersion, loc.minimumOneBinary) >= 0;
  const feature = featureState(des, rep, eff, twin.link.online, kill);
  const guard = verdict?.guard;
  const conn = twin.context.ChargingConnectorState;
  const effReason = inst ? E.reason(inst.effective.reasonCode) : undefined;
  const online = twin.link.online;

  const offlineReason = online ? undefined : E.reason('VEHICLE_AGENT_OFFLINE').desc;
  const killReason = kill ? E.reason('KILL_SWITCH_ACTIVE').desc : undefined;
  const guardBlockedReason = guard && !guard.passed ? guard.reason.desc : undefined;
  const heaterMissingReason = !hasHeater ? E.reason('HARDWARE_CAPABILITY_MISSING').desc : undefined;

  return [
    {
      id: 'body',
      label: '차체 · 트림',
      source: 'As-Designed (identity)',
      value: `${twin.identity.trim} · MY${twin.identity.modelYear} · ${twin.identity.region}`,
      state: 'ACTIVE',
      note: `${twin.identity.vehicleModel} / ${twin.identity.vehicleConfigId} · ${twin.identity.upgVc}`,
      layer: 'VEHICLE_EDGE',
      node: { kind: 'effective', state: 'ACTIVE', at: twin.link.snapshotAt },
      flow: flowOf(false, false, false),
      anchor: ANCHOR.body,
    },
    {
      id: 'battery',
      label: '배터리 팩 (Feature 호스트)',
      source: 'Feature Instance Desired/Reported/Effective',
      value: `D ${des} → R ${rep} → E ${eff}`,
      state: feature,
      note: effReason ? `${effReason.label.ko}: ${effReason.desc.ko}` : '정책 도달 대기',
      layer: 'ACTUATOR',
      node: { kind: 'effective', state: eff, policyVersion: inst?.policy.policyVersion, at: inst?.effective.evaluatedAt },
      reasonCode: inst?.effective.reasonCode,
      recommendation: effReason?.recommendation,
      approvalRequired: effReason?.incident,
      flow: flowOf(true, true, kill, killReason),
      anchor: ANCHOR.battery,
    },
    {
      id: 'heater',
      label: '배터리 히터 (요구 HW)',
      source: 'As-Built (EOL 스냅샷)',
      value: hasHeater ? '장착' : '미장착',
      state: hasHeater ? (feature === 'ACTIVE' ? 'ACTIVE' : 'PENDING') : 'MISSING',
      note: hasHeater
        ? `${twin.asBuilt.eolSnapshotId} · HW ${twin.asBuilt.hardwareCapabilities.length}종`
        : `요구 Capability ${loc.hardwareCapabilities[0]} 없음 → 활성화 불가`,
      layer: 'ACTUATOR',
      node: { kind: 'reported', state: hasHeater ? 'PRESENT' : 'MISSING', at: twin.asBuilt.recordedAt },
      reasonCode: hasHeater ? undefined : 'HARDWARE_CAPABILITY_MISSING',
      recommendation: heaterMissingReason ? E.reason('HARDWARE_CAPABILITY_MISSING').recommendation : undefined,
      flow: flowOf(true, false, !hasHeater, heaterMissingReason),
      anchor: ANCHOR.heater,
    },
    {
      id: 'bms',
      label: 'BMS (요구 SW 3.2.0 이상)',
      source: 'As-Deployed (ecuSoftware)',
      value: `BMS ${twin.asDeployed.bmsSoftwareVersion}`,
      state: bmsOk ? 'ACTIVE' : 'PENDING',
      note: bmsOk ? '요구 SW 충족' : `${loc.minimumBmsSoftware} 이상 필요 → Binary OTA 선행`,
      layer: 'ECU',
      node: { kind: 'reported', state: `BMS ${twin.asDeployed.bmsSoftwareVersion}`, at: inst?.reported.reportedAt ?? undefined },
      reasonCode: bmsOk ? undefined : 'BMS_SOFTWARE_BELOW_MINIMUM',
      recommendation: bmsOk ? undefined : E.reason('BMS_SOFTWARE_BELOW_MINIMUM').recommendation,
      flow: flowOf(true, true, false),
      anchor: ANCHOR.bms,
    },
    {
      id: 'vcu',
      label: 'VCU (차량 제어)',
      source: 'As-Deployed (ecuSoftware)',
      value: `VCU ${twin.asDeployed.ecuSoftware.VCU ?? '–'} · One-Binary ${twin.asDeployed.oneBinaryVersion}`,
      state: obOk ? 'ACTIVE' : 'PENDING',
      note: obOk ? 'One-Binary 최소 버전 충족' : `One-Binary ${loc.minimumOneBinary} 이상 필요`,
      layer: 'ECU',
      node: { kind: 'reported', state: `VCU ${twin.asDeployed.ecuSoftware.VCU ?? '–'}`, at: inst?.reported.reportedAt ?? undefined },
      reasonCode: obOk ? undefined : 'ONE_BINARY_BELOW_MINIMUM',
      recommendation: obOk ? undefined : E.reason('ONE_BINARY_BELOW_MINIMUM').recommendation,
      flow: flowOf(true, true, kill, killReason),
      anchor: ANCHOR.vcu,
    },
    {
      id: 'cgw',
      label: 'CGW (통신 게이트웨이)',
      source: 'link + As-Deployed',
      value: `${online ? 'ONLINE' : 'OFFLINE'} · ${twin.link.vehicleAgentVersion}`,
      state: online ? 'ACTIVE' : 'OFFLINE',
      note: `마지막 수신 ${twin.link.lastSeenAt?.slice(11, 19) ?? '--:--:--'}Z · 스냅샷 ${twin.link.snapshotAt?.slice(11, 19) ?? '--:--:--'}Z`,
      layer: 'VEHICLE_EDGE',
      node: { kind: 'reported', state: online ? 'ONLINE' : 'OFFLINE', at: twin.link.lastSeenAt },
      reasonCode: online ? undefined : 'VEHICLE_AGENT_OFFLINE',
      recommendation: online ? undefined : E.reason('VEHICLE_AGENT_OFFLINE').recommendation,
      flow: flowOf(true, true, !online, offlineReason),
      anchor: ANCHOR.cgw,
    },
    {
      id: 'hvac',
      label: 'HVAC (열관리)',
      source: 'As-Deployed (ecuSoftware)',
      value: `HVAC ${twin.asDeployed.ecuSoftware.HVAC ?? '–'}`,
      state: 'ACTIVE',
      note: 'Feature Topology 상 의존 ECU (정의는 Topology 참조)',
      layer: 'ECU',
      node: { kind: 'effective', state: 'ACTIVE', at: twin.link.snapshotAt },
      flow: flowOf(false, false, false),
      anchor: ANCHOR.hvac,
    },
    {
      id: 'guard',
      label: 'Local Guard (차량 로컬 판정)',
      source: 'Reported.guardResult',
      value: guard ? `Guard ${guard.passed ? 'PASS' : 'BLOCK'} · ${guard.reasonCode}` : 'UNKNOWN',
      state: guard ? (guard.passed ? 'ACTIVE' : 'BLOCKED') : 'PENDING',
      note: guard ? guard.reason.desc.ko : '차량 보고 없음',
      layer: 'ECU',
      node: { kind: 'guard', state: guard ? (guard.passed ? 'PASS' : 'BLOCK') : 'UNKNOWN', at: guard?.evaluatedAt },
      reasonCode: guard?.reasonCode,
      recommendation: guard?.reason.recommendation,
      approvalRequired: guard ? !guard.passed : undefined,
      flow: flowOf(true, false, !!(guard && !guard.passed) && !kill, kill ? undefined : guardBlockedReason),
      anchor: ANCHOR.guard,
    },
    {
      id: 'charge',
      label: '충전 커넥터',
      source: 'Vehicle Signal (VSS)',
      value: `${conn?.value ?? '–'} · ${conn?.quality ?? 'NO_DATA'}`,
      state: conn && conn.quality === 'GOOD' ? 'ACTIVE' : 'PENDING',
      note: `관측 ${conn?.observedAt?.slice(11, 19) ?? '--:--:--'}Z · TTL ${conn?.ttlSeconds ?? '-'}s`,
      layer: 'SENSOR',
      node: { kind: 'reported', state: String(conn?.value ?? '–'), at: conn?.observedAt },
      reasonCode: conn && conn.quality === 'GOOD' ? undefined : 'SIGNAL_QUALITY_BAD',
      flow: flowOf(false, true, false),
      anchor: ANCHOR.charge,
    },
    {
      id: 'antenna',
      label: '커넥티비티 · 정책 수신',
      source: 'PolicyRef + link',
      value: `${inst?.policy.policyVersion ?? '–'} · ${inst?.policy.signatureStatus ?? 'MISSING'}`,
      state: online ? 'ACTIVE' : 'OFFLINE',
      note: `마지막 동기화 ${inst?.policy.lastSyncedAt?.slice(11, 19) ?? '--:--:--'}Z · 서명 검증 ${inst?.policy.signatureStatus ?? '–'}`,
      layer: 'CLOUD',
      node: { kind: 'desired', state: inst?.policy.signatureStatus ?? 'MISSING', policyVersion: inst?.policy.policyVersion, at: inst?.policy.lastSyncedAt },
      reasonCode: online ? undefined : 'VEHICLE_AGENT_OFFLINE',
      flow: flowOf(true, true, !online, offlineReason),
      anchor: ANCHOR.antenna,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 흐름 에지 — Desired(하강) / Reported(상승) 경로 + 차단 지점            */
/* ------------------------------------------------------------------ */

export interface FlowEdge {
  id: string;
  from: PartId;
  to: PartId;
  kind: 'command' | 'report';
  blocked: boolean;
  blockReason?: T.Localized;
}

/**
 * Cloud → 안테나 → CGW → VCU → Guard → BMS → 배터리/히터 (Desired 하강, `command`)
 * 배터리 → BMS → VCU → CGW → 안테나 → Cloud (Reported 상승, `report`).
 *
 * 각 에지의 차단 여부는 "차단이 실제로 발생하는 부품"의 `flow.blocked` 를 그대로 읽는다
 * (오프라인 = 안테나/CGW, Kill-Switch = VCU, Guard 차단 = Guard, HW 미장착 = 히터) —
 * 부품별 파생 로직과 이중 구현을 피하고, 패킷은 그 지점에서 더 나아가지 않는다.
 */
export function flowEdges(parts: VehiclePart[]): FlowEdge[] {
  const byId = new Map(parts.map((p) => [p.id, p]));

  const edge = (id: string, from: PartId, to: PartId, kind: 'command' | 'report', gate?: VehiclePart): FlowEdge => ({
    id,
    from,
    to,
    kind,
    blocked: !!gate?.flow.blocked,
    blockReason: gate?.flow.blockReason,
  });

  return [
    // Desired(정책) 하강 경로.
    edge('cmd:antenna->cgw', 'antenna', 'cgw', 'command', byId.get('antenna')),
    edge('cmd:cgw->vcu', 'cgw', 'vcu', 'command'),
    edge('cmd:vcu->guard', 'vcu', 'guard', 'command', byId.get('vcu')),
    edge('cmd:guard->bms', 'guard', 'bms', 'command', byId.get('guard')),
    edge('cmd:bms->battery', 'bms', 'battery', 'command'),
    edge('cmd:bms->heater', 'bms', 'heater', 'command', byId.get('heater')),
    // Reported(원격측정) 상승 경로.
    edge('rpt:battery->bms', 'battery', 'bms', 'report'),
    edge('rpt:bms->vcu', 'bms', 'vcu', 'report'),
    edge('rpt:vcu->cgw', 'vcu', 'cgw', 'report'),
    edge('rpt:cgw->antenna', 'cgw', 'antenna', 'report', byId.get('cgw')),
  ].filter((e) => byId.has(e.from) && byId.has(e.to));
}

/* ------------------------------------------------------------------ */
/* 흐름 패킷 위상 — **시뮬레이션 틱**에서만 파생                          */
/* ------------------------------------------------------------------ */

/**
 * 한 틱이 흐름 경로에서 차지하는 비율. 1틱 = 경로의 7%.
 * 설계 의도: 패킷 위상을 `simTimeMs` 의 함수로 만들면, 배속이 올라갈 때
 * "틱당 경과 초 × 계수" 가 정수에 가까워지면서 매 틱 같은 위치로 돌아와
 * **패킷이 정지한 것처럼 보인다**(예: 5× → 5 s × 0.4/s = 2.0 ≡ 0 mod 1).
 * 틱 단위 위상은 배속과 무관하게 틱당 일정하게 전진하고, rate 0 이면
 * 틱이 멈추므로 화면도 함께 멈춘다 — 모든 모션은 여전히 시뮬레이터 시계에서만 온다.
 */
export const FLOW_PHASE_PER_TICK = 0.07;

/** `index` 는 에지마다 위상을 어긋나게 해 패킷이 한 줄로 서지 않게 한다. */
export function flowPhase(tick: number, index: number, moving = true): number {
  const start = (index * 0.33) % 1;
  if (!moving) return start;
  const t = (tick * FLOW_PHASE_PER_TICK + start) % 1;
  return t < 0 ? t + 1 : t;
}

/* ------------------------------------------------------------------ */
/* 신호 이력(스파크라인) — 정지 상태에서도 형태를 보이도록 결정적으로 시드 */
/* ------------------------------------------------------------------ */

export function signalSeries(twin: T.Twin | undefined, key: T.SignalKey, window: number): number[] {
  if (!twin) return new Array(window).fill(0);
  const raw = twin.context[key]?.value;
  const base = typeof raw === 'number' ? raw : raw === 'CONNECTED' ? 1 : 0.4;
  const h = E.fnv(`${twin.vin}:${key}`);
  return Array.from({ length: window }, (_, i) => {
    const wig = Math.sin((h % 97) / 9 + i / 5) * (Math.abs(base) > 5 ? 2.2 : 0.06) + Math.cos(i / 3 + (h % 31) / 7) * 0.5;
    return Number((base + wig).toFixed(2));
  });
}

export function ageSeries(twin: T.Twin | undefined, nowMs: number, window: number): number[] {
  if (!twin) return new Array(window).fill(0);
  const at = Date.parse(twin.context.BatterySoc?.observedAt ?? '');
  const age = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 1000) : 0;
  const h = E.fnv(`${twin.vin}:age`);
  return Array.from({ length: window }, (_, i) => Math.max(0, Number((age + Math.sin((h % 53) / 5 + i / 4) * 4).toFixed(1))));
}
