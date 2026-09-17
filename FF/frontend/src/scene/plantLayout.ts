/**
 * §17.2 — 공장 스케일(EOL·출하 Plant) Digital Twin 레이아웃 단일 원천(SoT).
 *
 * ## 좌표계
 * three.js Y-up. 바닥은 X-Z 평면이고 **X = 공장 길이(116 m), Z = 폭(60 m)**.
 * 차량 진행 방향은 **+X**:
 *   입고(VIN 등록) → 바이너리 플래싱 → 배터리 프리컨디셔닝 → 캘리브레이션/Twin 동기화
 *   → EOL 시험(수렴 확인) → 출하 야드 → 게이트.
 *
 * ## 이 파일의 원칙
 * 1. 좌표·치수·프리셋은 여기서만 정의한다. `PlantScene`/`PlantSchematic2D` 는 이 값을 읽기만 한다.
 * 2. **모션은 벽시계(`performance.now`)나 `Math.random()` 을 쓰지 않는다.** 컨베이어 · AMR · 로봇암 ·
 *    카메라 투어 전부 `snapshot.clock.simTimeMs`(시뮬레이션 시각)만으로 결정된다.
 *    → rate=0 이면 공장이 실제로 완전히 멈추고, `+5s` 스텝을 밀면 그만큼 진행된다.
 *    → `useFrame` 이 실행되지 않는 jsdom 에서도 같은 순수 함수로 위치를 계산해 검증할 수 있다.
 * 3. 셀 상태와 야드 색상은 **실제 Twin 판정 결과**(eligibility / reconciliation / health / rollout)에서 파생된다.
 *    화면에 보이는 공장 상태가 곧 Twin 데이터라는 것이 이 화면의 요점이다.
 * 4. 셀 ↔ 차량 배치도 판정 결과에서 나온다(`featuredVins`): 예를 들어 `REQUIRES_BINARY_OTA` 차량은
 *    FLASH 셀에, `CRITICAL_DRIFT`/`GUARDED` 차량은 EOL 시험 셀에 실제로 세워진다.
 *    나머지 스테이션은 VIN 없는 WIP(재공품) 바디로 채운다 — 없는 차량을 지어내지 않는다.
 */
import type { TwinStoreSnapshot } from '../data/twin/port';
import type { TwinVerdict } from '../data/twin/engine';
import type { Localized } from '../data/twin/types';
import * as T from '../data/twin/types';

/* ------------------------------------------------------------------ 바닥 */

export const PLANT = {
  minX: -58,
  maxX: 58,
  minZ: -30,
  maxZ: 30,
  width: 116,
  depth: 60,
} as const;

/** 10 px/m 기준 2D 도면 크기. */
export const SCHEMATIC_SCALE = 10;

/* ---------------------------------------------------------------- 셀 정의 */

export type PlantStage = 'INBOUND' | 'FLASH' | 'BATTERY' | 'CALIB' | 'EOL_TEST';

export interface PlantCell {
  id: string;
  short: string;
  stage: PlantStage;
  /** 셀 중심 X (m). */
  x: number;
  /** 스테이션 수. */
  stations: number;
  label: Localized;
  note: Localized;
}

export const CELLS: PlantCell[] = [
  {
    id: 'CELL-VIN-REG',
    short: 'VIN REG',
    stage: 'INBOUND',
    x: -50,
    stations: 2,
    label: { ko: 'VIN 등록 / 입고 검수', en: 'VIN Registration' },
    note: { ko: 'As-Built 스냅샷 생성', en: 'As-Built snapshot' },
  },
  {
    id: 'CELL-FLASH',
    short: 'FLASH',
    stage: 'FLASH',
    x: -34,
    stations: 4,
    label: { ko: 'One-Binary 플래싱', en: 'One-Binary Flashing' },
    note: { ko: 'Binary OTA 대상 적재', en: 'Binary OTA queue' },
  },
  {
    id: 'CELL-BATTERY',
    short: 'BATTERY',
    stage: 'BATTERY',
    x: -16,
    stations: 4,
    label: { ko: '배터리 프리컨디셔닝 검증', en: 'Battery Preconditioning' },
    note: { ko: 'HW Capability / Variant Coding 확인', en: 'HW capability / variant' },
  },
  {
    id: 'CELL-CALIB',
    short: 'CALIB',
    stage: 'CALIB',
    x: 2,
    stations: 4,
    label: { ko: '캘리브레이션 / 차량 상태 동기화', en: 'Calibration & Vehicle State Sync' },
    note: { ko: '차량 상태 신선도(Stale) 점검', en: 'Vehicle state freshness' },
  },
  {
    id: 'CELL-EOL-TEST',
    short: 'EOL TEST',
    stage: 'EOL_TEST',
    x: 20,
    stations: 2,
    label: { ko: 'EOL 시험 / 수렴 확인', en: 'EOL Test & Convergence' },
    note: { ko: 'Desired·Reported·Effective 대조', en: 'Desired / Reported / Effective' },
  },
];

/** 스테이션 바닥 좌표. 컨베이어(z=0)를 사이에 두고 양쪽에 배치된다. */
export function stationPositions(cell: PlantCell): [number, number][] {
  if (cell.stations <= 2) {
    return ([
      [cell.x, -4.6],
      [cell.x, 4.6],
    ] as [number, number][]).slice(0, cell.stations);
  }
  return ([
    [cell.x - 4, -4.6],
    [cell.x + 4, -4.6],
    [cell.x - 4, 4.6],
    [cell.x + 4, 4.6],
  ] as [number, number][]).slice(0, cell.stations);
}

/* -------------------------------------------------------------- 컨베이어 */

/** 차량 스파인 컨베이어. 셀을 관통하며 +X 로 흐른다. */
export const CONVEYOR = { x1: -56, x2: 26, z: 0, y: 0.5, speed: 1.8, bodies: 6, spacing: 9 } as const;

export const CONVEYOR_ZONES: { id: string; x: number; label: Localized }[] = [
  { id: 'C-01', x: -50, label: { ko: '입고 이송', en: 'Inbound' } },
  { id: 'C-02', x: -34, label: { ko: '플래싱 이송', en: 'Flash' } },
  { id: 'C-03', x: -16, label: { ko: '배터리 이송', en: 'Battery' } },
  { id: 'C-04', x: 2, label: { ko: '캘리브레이션 이송', en: 'Calibration' } },
  { id: 'C-05', x: 20, label: { ko: 'EOL 이송', en: 'EOL' } },
];

/** 컨베이어 위 WIP 바디 i 의 X 좌표. 시뮬레이션 시각만으로 결정된다. */
export function conveyorBodyX(index: number, simTimeMs: number): number {
  const span = CONVEYOR.x2 - CONVEYOR.x1;
  const loop = CONVEYOR.bodies * CONVEYOR.spacing;
  const travelled = (simTimeMs / 1000) * CONVEYOR.speed + index * CONVEYOR.spacing;
  const m = ((travelled % loop) + loop) % loop;
  return CONVEYOR.x1 + (m / loop) * span;
}

/* -------------------------------------------------------------- 출하 야드 */

export const YARD = {
  /** 행 0..2 의 X 좌표(3행 × 10대 = 30 슬롯). 4행은 버퍼 행. */
  rows: [40, 46, 52] as const,
  perRow: 10,
  z0: -21.6,
  dz: 4.8,
  capacity: 30,
  /** 초과분(데모에서는 발생하지 않음)은 버퍼 행으로 보낸다. */
  overflowX: 32,
} as const;

export interface YardSlot {
  vin: string;
  verdict: TwinVerdict;
  x: number;
  z: number;
  row: number;
  col: number;
}

/**
 * 야드 슬롯 배정. VIN 정렬로 순서를 고정해 틱이 바뀌어도 차가 자리를 옮기지 않는다.
 */
export function yardSlots(verdicts: TwinVerdict[]): YardSlot[] {
  const sorted = [...verdicts].sort((a, b) => a.twin.vin.localeCompare(b.twin.vin));
  const out: YardSlot[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = Math.floor(i / YARD.perRow);
    if (row > 3) break;
    out.push({
      vin: sorted[i].twin.vin,
      verdict: sorted[i],
      x: row < YARD.rows.length ? YARD.rows[row] : YARD.overflowX,
      z: YARD.z0 + (i % YARD.perRow) * YARD.dz,
      row,
      col: i % YARD.perRow,
    });
  }
  return out;
}

export const GATE = { x: 57, z: 0 } as const;

/* ------------------------------------------------------------- AMR 경로 */

export interface AmrRoute {
  id: string;
  label: Localized;
  /** m/s */
  speed: number;
  phaseMs: number;
  points: [number, number][];
}

export const AMR_ROUTES: AmrRoute[] = [
  {
    id: 'AMR-01',
    label: { ko: '자재 → 플래싱', en: 'Supermarket → Flash' },
    speed: 1.7,
    phaseMs: 0,
    points: [[-50, 22], [-44, 17], [-38, 10], [-34, 6]],
  },
  {
    id: 'AMR-02',
    label: { ko: '자재 → 배터리', en: 'Supermarket → Battery' },
    speed: 1.5,
    phaseMs: 5200,
    points: [[-50, 22], [-32, 18], [-20, 11], [-16, 6]],
  },
  {
    id: 'AMR-03',
    label: { ko: '배터리 → 캘리브레이션', en: 'Battery → Calibration' },
    speed: 1.6,
    phaseMs: 11800,
    points: [[-16, -10], [-8, -15], [0, -12], [2, -6]],
  },
  {
    id: 'AMR-04',
    label: { ko: '캘리브레이션 → EOL', en: 'Calibration → EOL' },
    speed: 1.8,
    phaseMs: 2600,
    points: [[6, 12], [12, 15], [16, 11], [20, 6]],
  },
  {
    id: 'AMR-05',
    label: { ko: 'EOL → 출하 야드', en: 'EOL → Outbound Yard' },
    speed: 2.0,
    phaseMs: 8400,
    points: [[24, 13], [32, 20], [38, 25], [46, 25]],
  },
  {
    id: 'AMR-06',
    label: { ko: '야드 → 게이트 순환', en: 'Yard → Gate loop' },
    speed: 1.4,
    phaseMs: 1500,
    points: [[55, 8], [56.3, 3], [56.3, -8], [55, -13]],
  },
];

function polylineLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

function pointAt(pts: [number, number][], d: number): { x: number; z: number; dir: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (d <= acc + seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (d - acc) / seg));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dir: Math.atan2(bz - az, bx - ax) };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  return { x: last[0], z: last[1], dir: 0 };
}

export interface AmrPose {
  x: number;
  z: number;
  /** 차체 yaw(rad). 진행 방향 기준. */
  yaw: number;
  /** 왕복 구간에서 복귀(역방향) 중이면 true. */
  returning: boolean;
}

/**
 * AMR 위치. 경로를 따라 왕복(ping-pong)한다. 순수 함수 — 시뮬레이션 시각만 쓴다.
 */
export function amrPose(route: AmrRoute, simTimeMs: number): AmrPose {
  const len = polylineLength(route.points);
  const cycleLen = len * 2;
  const travelled = ((simTimeMs + route.phaseMs) / 1000) * route.speed;
  const m = ((travelled % cycleLen) + cycleLen) % cycleLen;
  const forward = m <= len;
  const d = forward ? m : cycleLen - m;
  const p = pointAt(route.points, d);
  return { x: p.x, z: p.z, yaw: p.dir, returning: !forward };
}

/* ---------------------------------------------------------------- 카메라 */

export type PlantPresetId = 'overview' | 'inbound' | 'flash' | 'battery' | 'calib' | 'eol' | 'yard' | 'andon';

export interface PlantPreset {
  id: PlantPresetId;
  label: Localized;
  pos: [number, number, number];
  target: [number, number, number];
}

export const PLANT_PRESETS: PlantPreset[] = [
  { id: 'overview', label: { ko: '전체 조망', en: 'Overview' }, pos: [4, 46, 66], target: [0, 0, 2] },
  { id: 'inbound', label: { ko: 'VIN 등록', en: 'VIN Reg' }, pos: [-50, 21, 25], target: [-50, 1.6, 0] },
  { id: 'flash', label: { ko: '플래싱', en: 'Flash' }, pos: [-34, 19, 24], target: [-34, 1.6, 0] },
  { id: 'battery', label: { ko: '배터리', en: 'Battery' }, pos: [-16, 19, 24], target: [-16, 1.6, 0] },
  { id: 'calib', label: { ko: '캘리브레이션', en: 'Calibration' }, pos: [2, 19, 24], target: [2, 1.6, 0] },
  { id: 'eol', label: { ko: 'EOL 시험', en: 'EOL Test' }, pos: [20, 17, 22], target: [20, 1.6, 0] },
  { id: 'yard', label: { ko: '출하 야드', en: 'Outbound Yard' }, pos: [70, 27, 34], target: [46, 1.6, 0] },
  { id: 'andon', label: { ko: 'Andon / Control', en: 'Andon' }, pos: [31, 14, 17], target: [31, 4.5, 0] },
];

export function presetById(id: PlantPresetId): PlantPreset {
  return PLANT_PRESETS.find((p) => p.id === id) ?? PLANT_PRESETS[0];
}

/** 시네마틱 투어 순서. RFTwin 과 동일한 8 스톱 / 7 초 체류. */
export const PLANT_TOUR: PlantPresetId[] = [
  'overview',
  'inbound',
  'flash',
  'battery',
  'calib',
  'eol',
  'yard',
  'andon',
];
export const TOUR_DWELL_MS = 7000;

/** 선택 차량 추적 프리셋(동적 계산). */
export function followPreset(vin: string, pos: [number, number]): PlantPreset {
  return {
    id: 'overview',
    label: { ko: `추적 ${vin}`, en: `Follow ${vin}` },
    pos: [pos[0] + 2, 9, pos[1] + 12],
    target: [pos[0], 1.2, pos[1]],
  };
}

/* ------------------------------------------------------------ 상태 색상 */

export type PlantStatus =
  | 'RUNNING'
  | 'IDLE'
  | 'WAITING'
  | 'WARNING'
  | 'BLOCKED'
  | 'ERROR'
  | 'SAFETY'
  | 'OFFLINE';

/** WebGL 은 CSS 변수를 못 쓰므로 리터럴 hex 로 둔다(styles.css 토큰과 동일 값). */
export const PLANT_STATUS_HEX: Record<PlantStatus, string> = {
  RUNNING: '#1F9D55',
  IDLE: '#8895A7',
  WAITING: '#3B82F6',
  WARNING: '#D9822B',
  BLOCKED: '#E07030',
  ERROR: '#D64545',
  SAFETY: '#B91C1C',
  OFFLINE: '#8895A7',
};

export const PLANT_STATUS_LABEL: Record<PlantStatus, Localized> = {
  RUNNING: { ko: '가동', en: 'Running' },
  IDLE: { ko: '대기', en: 'Idle' },
  WAITING: { ko: '작업 대기', en: 'Waiting' },
  WARNING: { ko: '경고', en: 'Warning' },
  BLOCKED: { ko: '정지 (배포 중단)', en: 'Blocked' },
  ERROR: { ko: '이상', en: 'Error' },
  SAFETY: { ko: '안전 정지 (Kill-Switch)', en: 'Safety stop' },
  OFFLINE: { ko: '통신 없음', en: 'Offline' },
};

/** `toneColor()` 는 CSS `var()` 를 돌려주므로 3D 용 리터럴 표를 따로 둔다. */
export const TOKEN_HEX: Record<string, string> = {
  pass: '#1F9D55',
  pending: '#D9822B',
  fail: '#D64545',
  info: '#3B82F6',
  muted: '#8895A7',
};

/** 야드 차량 색 = 수렴(Reconciliation) 결과 색. */
export function yardHex(verdict: TwinVerdict): string {
  return TOKEN_HEX[T.RECONCILIATION_TOKEN[verdict.reconciliation.result]] ?? TOKEN_HEX.muted;
}

/* --------------------------------------------------------- 판정 → 집계 */

export interface PlantCounts {
  total: number;
  eligible: number;
  binaryOta: number;
  hwMismatch: number;
  variantMismatch: number;
  noEntitlement: number;
  stale: number;
  blocked: number;
  unknown: number;
  converged: number;
  pending: number;
  guarded: number;
  rejected: number;
  drift: number;
  healthy: number;
  degraded: number;
  paused: boolean;
  killActive: number;
}

export function plantCounts(snap: TwinStoreSnapshot, killActive = 0): PlantCounts {
  const c: PlantCounts = {
    total: 0,
    eligible: 0,
    binaryOta: 0,
    hwMismatch: 0,
    variantMismatch: 0,
    noEntitlement: 0,
    stale: 0,
    blocked: 0,
    unknown: 0,
    converged: 0,
    pending: 0,
    guarded: 0,
    rejected: 0,
    drift: 0,
    healthy: 0,
    degraded: 0,
    paused: false,
    killActive,
  };
  for (const v of snap.verdicts ?? []) {
    c.total++;
    switch (v.eligibility?.eligibility) {
      case 'ELIGIBLE_POLICY_ONLY':
        c.eligible++;
        break;
      case 'REQUIRES_BINARY_OTA':
        c.binaryOta++;
        break;
      case 'INCOMPATIBLE_HARDWARE':
        c.hwMismatch++;
        break;
      case 'INCOMPATIBLE_VARIANT':
        c.variantMismatch++;
        break;
      case 'MISSING_ENTITLEMENT':
        c.noEntitlement++;
        break;
      case 'STALE_TWIN':
        c.stale++;
        break;
      case 'BLOCKED_BY_SAFETY_RULE':
        c.blocked++;
        break;
      default:
        c.unknown++;
    }
    switch (v.reconciliation?.result) {
      case 'CONVERGED':
        c.converged++;
        break;
      case 'PENDING':
        c.pending++;
        break;
      case 'GUARDED':
        c.guarded++;
        break;
      case 'REJECTED':
        c.rejected++;
        break;
      case 'CRITICAL_DRIFT':
        c.drift++;
        break;
      default:
        break;
    }
    if (v.health === 'HEALTHY') c.healthy++;
    else if (v.health === 'DEGRADED') c.degraded++;
  }
  c.paused = !!snap.rollout?.paused;
  return c;
}

/** 셀 상태는 실제 판정 집계에서 파생된다. */
export function cellStatus(c: PlantCounts, cell: PlantCell): PlantStatus {
  switch (cell.stage) {
    case 'INBOUND':
      return c.total > 0 ? 'RUNNING' : 'IDLE';
    case 'FLASH':
      if (c.paused && c.binaryOta > 0) return 'BLOCKED';
      return c.binaryOta > 0 ? 'RUNNING' : 'IDLE';
    case 'BATTERY':
      return c.hwMismatch + c.variantMismatch > 0 ? 'WARNING' : 'RUNNING';
    case 'CALIB':
      return c.stale > 0 ? 'WARNING' : 'RUNNING';
    case 'EOL_TEST':
      if (c.killActive > 0) return 'SAFETY';
      if (c.drift > 0 || c.rejected > 0) return 'ERROR';
      return c.blocked + c.guarded > 0 ? 'WARNING' : 'RUNNING';
    default:
      return 'IDLE';
  }
}

/** HUD/사인에 붙일 한 줄 근거. 색만으로 의미를 전달하지 않기 위한 장치다. */
export function cellReason(c: PlantCounts, cell: PlantCell): Localized {
  switch (cell.stage) {
    case 'INBOUND':
      return { ko: `차량 ${c.total}대 등록`, en: `${c.total} vehicles registered` };
    case 'FLASH':
      return { ko: `Binary OTA 대상 ${c.binaryOta}대`, en: `${c.binaryOta} awaiting binary OTA` };
    case 'BATTERY':
      return {
        ko: `HW ${c.hwMismatch} · Variant ${c.variantMismatch}`,
        en: `HW ${c.hwMismatch} · Variant ${c.variantMismatch}`,
      };
    case 'CALIB':
      return { ko: `상태 지연 ${c.stale}대`, en: `${c.stale} vehicles with stale state` };
    case 'EOL_TEST':
      return {
        ko: c.killActive > 0
          ? `Kill-Switch ${c.killActive}건 · 안전 정지`
          : `Drift ${c.drift} · Rejected ${c.rejected} · Guarded ${c.guarded}`,
        en: c.killActive > 0
          ? `${c.killActive} kill-switch · safety stop`
          : `Drift ${c.drift} · Rejected ${c.rejected} · Guarded ${c.guarded}`,
      };
    default:
      return { ko: '', en: '' };
  }
}

/* --------------------------------------------------- 셀 ↔ 차량 배치 ── */

/**
 * 셀에 실제로 세울 차량. 판정 사유가 그 셀의 공정과 일치하는 VIN 을 VIN 순으로 고른다.
 * 스테이션보다 차량이 적으면 남는 자리는 VIN 없는 WIP 바디가 채운다.
 */
export function featuredVins(verdicts: TwinVerdict[], cell: PlantCell): TwinVerdict[] {
  const matches = (v: TwinVerdict): boolean => {
    switch (cell.stage) {
      case 'FLASH':
        return v.eligibility?.eligibility === 'REQUIRES_BINARY_OTA';
      case 'BATTERY':
        return (
          v.eligibility?.eligibility === 'INCOMPATIBLE_HARDWARE' ||
          v.eligibility?.eligibility === 'INCOMPATIBLE_VARIANT'
        );
      case 'CALIB':
        return v.eligibility?.eligibility === 'STALE_TWIN' || v.eligibility?.eligibility === 'UNKNOWN';
      case 'EOL_TEST':
        return (
          v.reconciliation?.result === 'CRITICAL_DRIFT' ||
          v.reconciliation?.result === 'REJECTED' ||
          v.reconciliation?.result === 'GUARDED'
        );
      default:
        return v.eligibility?.eligibility === 'ELIGIBLE_POLICY_ONLY';
    }
  };
  return [...verdicts]
    .sort((a, b) => a.twin.vin.localeCompare(b.twin.vin))
    .filter(matches)
    .slice(0, cell.stations);
}

/** 셀별 배치(스테이션 수만큼). `verdict === null` 이면 WIP 바디. */
export function stationAssignments(
  verdicts: TwinVerdict[],
  cell: PlantCell,
): { id: string; pos: [number, number]; verdict: TwinVerdict | null }[] {
  const featured = featuredVins(verdicts, cell);
  return stationPositions(cell).map((pos, i) => ({
    id: `${cell.short}-S${i + 1}`,
    pos,
    verdict: featured[i] ?? null,
  }));
}

/** HUD 범례용 색 목록. */
export const RECONCILIATION_LEGEND: { token: string; label: Localized }[] = [
  { token: 'pass', label: { ko: '수렴 (Converged)', en: 'Converged' } },
  { token: 'pending', label: { ko: '대기 (Pending)', en: 'Pending' } },
  { token: 'info', label: { ko: 'Guard 차단 (Guarded)', en: 'Guarded' } },
  { token: 'fail', label: { ko: '이탈/거부 (Drift·Rejected)', en: 'Drift / Rejected' } },
  { token: 'muted', label: { ko: '판단 불가 (Unknown)', en: 'Unknown' } },
];
