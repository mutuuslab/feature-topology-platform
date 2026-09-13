/**
 * §17.2 — 공장 스케일(EOL·출하 Plant) 3D Digital Twin.
 *
 * RFTwin 의 `FactoryScene.tsx`(약 116 m × 60 m 로봇 공장)와 같은 스케일·문법으로,
 * Feature Platform 의 Twin 데이터를 **실제 공장 평면**에 투영한다.
 *
 *  - 5개 셀(VIN 등록 → 플래싱 → 배터리 → 캘리브레이션 → EOL 시험) + 관통 컨베이어
 *  - 3행 × 10대 = 30대 출하 야드(실제 VIN, 클릭 선택, 수렴 결과 색)
 *  - 6대 AMR(경로 왕복) · 로봇암 · 스택라이트 · HMI · 펜스 · 랙 · Andon · CCTV · 게이트
 *  - 카메라 프리셋 8종 + 8스톱 시네마틱 투어 + 라벨 LOD + FPS 미터 + 라벨 모드
 *  - WebGL 미지원/실패 시 `PlantSchematic2D`(의존성 없는 SVG 평면도)로 자동 강등
 *
 * 모든 모션은 `snapshot.clock.simTimeMs` 만 쓴다. rate=0 이면 공장이 정말로 멈추고,
 * `+5s` 를 밀면 그만큼 진행된다(같은 순수 함수가 jsdom 에서도 검증된다).
 */
import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { TwinStoreSnapshot } from '../data/twin/port';
import type { TwinVerdict } from '../data/twin/engine';
import { Label, LabelManager, type LabelsMode } from './labels';
import {
  AMR_ROUTES,
  CELLS,
  CONVEYOR,
  CONVEYOR_ZONES,
  GATE,
  PLANT,
  PLANT_STATUS_HEX,
  SCHEMATIC_SCALE,
  TOKEN_HEX,
  YARD,
  amrPose,
  cellReason,
  cellStatus,
  conveyorBodyX,
  stationAssignments,
  stationPositions,
  yardHex,
  yardSlots,
  type AmrRoute,
  type PlantCell,
  type PlantCounts,
  type PlantPreset,
  type PlantStatus,
} from './plantLayout';
import {
  AmrProp,
  AndonBoard,
  Cabinet,
  CctvProp,
  ChargingPad,
  ConveyorStruct,
  Fence,
  FloorMarking,
  Rack,
  SimClockContext,
  StationProp,
  VehicleMesh,
  ZoneSign,
  useSimClock,
} from './plantProps';

export type PlantLang = 'ko' | 'en';

/* ------------------------------------------------------------------ 조명 */

function Lights() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#cfe0f2', '#2a2f36', 0.55]} />
      <directionalLight position={[40, 70, 30]} intensity={0.8} />
      <directionalLight position={[-50, 44, -30]} intensity={0.3} />
      {CELLS.map((c) => (
        <pointLight key={c.id} position={[c.x, 9, 0]} intensity={90} distance={32} color="#dce8f4" />
      ))}
      <pointLight position={[46, 11, 0]} intensity={80} distance={48} color="#dce8f4" />
      <pointLight position={[31, 8, 0]} intensity={40} distance={22} color="#e8dfc8" />
    </>
  );
}

/* ------------------------------------------------------------------ 바닥 */

function Floor({ gridGeometry }: { gridGeometry: THREE.BufferGeometry }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PLANT.width, PLANT.depth]} />
        <meshStandardMaterial color="#2c3239" metalness={0.05} roughness={0.95} />
      </mesh>
      <lineSegments geometry={gridGeometry} position={[0, 0.008, 0]}>
        <lineBasicMaterial color="#39424c" transparent opacity={0.6} />
      </lineSegments>
      {/* 보행 통로(안전) */}
      <FloorMarking x={-30} z={11.6} w={104} d={2.0} hex="#3B82F6" opacity={0.12} />
      <FloorMarking x={-30} z={-11.6} w={104} d={2.0} hex="#3B82F6" opacity={0.12} />
      {/* 물류 통로 */}
      <FloorMarking x={-30} z={22} w={54} d={4.5} hex="#D9822B" opacity={0.09} />
      {/* 출하 대기 구역 */}
      <FloorMarking x={46} z={0} w={22} d={52} hex="#1F9D55" opacity={0.07} />
    </group>
  );
}

/* -------------------------------------------------------------------- 셀 */

function CellBlock({
  cell,
  counts,
  verdicts,
  selectedVin,
  lang,
  onSelectVin,
  onOpenVehicle,
}: {
  cell: PlantCell;
  counts: PlantCounts;
  verdicts: TwinVerdict[];
  selectedVin: string;
  lang: PlantLang;
  onSelectVin: (vin: string) => void;
  onOpenVehicle: (vin: string) => void;
}) {
  const status = cellStatus(counts, cell);
  const hex = PLANT_STATUS_HEX[status];
  const reason = lang === 'en' ? cellReason(counts, cell).en : cellReason(counts, cell).ko;
  const half = cell.stations <= 2 ? 5.6 : 7;
  const assignments = useMemo(() => stationAssignments(verdicts, cell), [verdicts, cell]);
  const withRobot = cell.stage === 'FLASH' || cell.stage === 'EOL_TEST';

  return (
    <group>
      {/* 셀 영역 + 상태 밴드 */}
      <FloorMarking x={cell.x} z={0} w={half * 2} d={17} hex={hex} opacity={0.09} />
      {[8.6, -8.6].map((z) => (
        <mesh key={z} position={[cell.x, 0.014, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[half * 2, 0.4]} />
          <meshBasicMaterial color={hex} transparent opacity={0.75} />
        </mesh>
      ))}

      {/* 안전 펜스 */}
      <Fence x1={cell.x - half} x2={cell.x + half} z={9.4} height={2.4} />
      <Fence x1={cell.x - half} x2={cell.x + half} z={-9.4} height={2.4} />

      {assignments.map((a) => (
        <group key={a.id}>
          <StationProp id={a.id} x={a.pos[0]} z={a.pos[1]} status={status} withRobot={withRobot} />
          {/* 스테이션 위 차량: 판정 사유가 그 공정과 맞는 실제 VIN, 아니면 VIN 없는 WIP */}
          <group
            position={[a.pos[0], 0.5, a.pos[1]]}
            onClick={(e) => {
              if (!a.verdict) return;
              e.stopPropagation();
              if (e.delta > 4) return;
              onSelectVin(a.verdict.twin.vin);
            }}
            onDoubleClick={(e) => {
              if (!a.verdict) return;
              e.stopPropagation();
              onOpenVehicle(a.verdict.twin.vin);
            }}
          >
            <VehicleMesh
              simple
              length={4.2}
              width={1.9}
              color={a.verdict ? yardHex(a.verdict) : '#8d949c'}
              wip={!a.verdict}
            />
            {a.verdict && (
              <Label
                text={`${a.verdict.twin.vin.replace('VIN-DEMO-', '#')} ${a.verdict.reconciliation.result}`}
                position={[0, 2.6, 0]}
                size={0.75}
                tier={1}
                priority={a.verdict.twin.vin === selectedVin ? 9 : 5}
                color={a.verdict.twin.vin === selectedVin ? '#FFD166' : '#c9d3e4'}
              />
            )}
            {a.verdict?.twin.killSwitch?.active && (
              <mesh position={[0, 3.1, 0]}>
                <boxGeometry args={[0.9, 0.34, 0.06]} />
                <meshStandardMaterial color="#B91C1C" emissive="#B91C1C" emissiveIntensity={0.9} />
              </mesh>
            )}
          </group>
        </group>
      ))}

      <ZoneSign x={cell.x} z={11.4} text={`${cell.short} · ${status}`} sub={reason} hex={hex} />

      {/* 셀 제어반(상태 램프 포함) + 소모품 랙 */}
      <Cabinet x={cell.x - half + 1.5} z={-10.8} w={1.8} h={2.0} status={status} />
      <Rack x={cell.x + half - 1.6} z={-11.6} bays={3} />
    </group>
  );
}

/* -------------------------------------------------------------- 컨베이어 */

function ConveyorBodies() {
  const clock = useSimClock();
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      child.position.x = conveyorBodyX(i, clock.current);
    });
  });
  const initial = Array.from({ length: CONVEYOR.bodies }, (_, i) => conveyorBodyX(i, 0));
  // 단순화 바디의 최저점(로컬 0.39)이 벨트 상판(0.56)에 닿도록 내린다.
  const onBeltY = CONVEYOR.y + 0.06 - 0.39;
  return (
    <group ref={group}>
      {initial.map((x, i) => (
        <group key={i} position={[x, onBeltY, 0]}>
          <VehicleMesh simple length={4.2} width={1.9} color="#8d949c" wip />
        </group>
      ))}
    </group>
  );
}

function Conveyor({ lang }: { lang: PlantLang }) {
  return (
    <group>
      <ConveyorStruct x1={CONVEYOR.x1} x2={CONVEYOR.x2} z={CONVEYOR.z} y={CONVEYOR.y} />
      {CONVEYOR_ZONES.map((z) => (
        <Label
          key={z.id}
          text={`${z.id} ${z.label[lang]}`}
          position={[z.x, CONVEYOR.y + 1.5, 1.9]}
          size={0.8}
          tier={1}
        />
      ))}
      <ConveyorBodies />
    </group>
  );
}

/* ------------------------------------------------------------------ 야드 */

function Yard({
  verdicts,
  selectedVin,
  onSelectVin,
  onOpenVehicle,
}: {
  verdicts: TwinVerdict[];
  selectedVin: string;
  onSelectVin: (vin: string) => void;
  onOpenVehicle: (vin: string) => void;
}) {
  const slots = useMemo(() => yardSlots(verdicts), [verdicts]);
  const selected = slots.find((s) => s.vin === selectedVin);
  return (
    <group>
      {slots.map((s) => {
        const hex = yardHex(s.verdict);
        const sel = s.vin === selectedVin;
        const ks = !!s.verdict.twin.killSwitch?.active;
        return (
          <group key={s.vin} position={[s.x, 0, s.z]}>
            <mesh position={[0, 0.013, 0]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[5.4, 2.6]} />
              <meshBasicMaterial color={hex} transparent opacity={sel ? 0.42 : 0.2} />
            </mesh>
            <group
              onClick={(e) => {
                e.stopPropagation();
                if (e.delta > 4) return;
                onSelectVin(s.vin);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenVehicle(s.vin);
              }}
            >
              <VehicleMesh simple length={4.4} width={1.95} color={hex} />
              {ks && (
                <mesh position={[0, 2.05, 0]}>
                  <boxGeometry args={[0.8, 0.3, 0.06]} />
                  <meshStandardMaterial color="#B91C1C" emissive="#B91C1C" emissiveIntensity={1} />
                </mesh>
              )}
            </group>
            <Label
              text={s.vin.replace('VIN-DEMO-', '#')}
              position={[0, 2.45, 0]}
              size={0.72}
              tier={sel ? 0 : 2}
              priority={sel ? 10 : 2}
              color={sel ? '#FFD166' : '#b9c4d4'}
            />
          </group>
        );
      })}
      {selected && (
        <mesh position={[selected.x, 0.04, selected.z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[3.1, 3.45, 40]} />
          <meshBasicMaterial color="#FFD166" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      <ZoneSign x={46} z={-25} text="OUTBOUND YARD" sub={`${slots.length} / ${YARD.capacity} VIN`} hex="#1F9D55" />
    </group>
  );
}

/* ----------------------------------------------------------- 물류/설비 */

function Logistics() {
  return (
    <group>
      {/* 출하 게이트 */}
      <group position={[GATE.x, 0, GATE.z]}>
        {[3.2, -3.2].map((z) => (
          <mesh key={z} position={[0, 3, z]}>
            <boxGeometry args={[1.0, 6, 1.0]} />
            <meshStandardMaterial color="#4c4e51" metalness={0.4} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 6.2, 0]}>
          <boxGeometry args={[1.0, 0.6, 7.4]} />
          <meshStandardMaterial color="#b9901a" roughness={0.85} />
        </mesh>
        <Label text="OUTBOUND GATE" position={[0, 7.4, 0]} size={1.2} tier={0} priority={7} />
      </group>

      {/* 자재 supermarket — 셀 동선을 침범하지 않도록 서쪽 벽면을 따라 세운다. */}
      {[-24, -16, -8, 8].map((z) => (
        <Rack key={z} x={-56.6} z={z} yaw={Math.PI / 2} bays={4} />
      ))}
      <ZoneSign x={-52} z={-27} text="SUPERMARKET" sub="자재 공급 / 키팅" hex="#3B82F6" />

      {/* AMR 충전소 */}
      <ChargingPad x={-46} z={26} />
      <ChargingPad x={-42} z={26} />

      {/* 품질/안전 검사 부스 */}
      <Cabinet x={30} z={-8} w={2.4} h={2.4} />
      <Cabinet x={30} z={-4} w={2.4} h={2.4} />

      {/* CCTV */}
      <CctvProp x={-56} z={-28} yaw={0.6} />
      <CctvProp x={-56} z={28} yaw={-0.6} />
      <CctvProp x={56} z={-28} yaw={-0.6} />
      <CctvProp x={56} z={28} yaw={0.6} />
    </group>
  );
}

/* -------------------------------------------------------------- 카메라 */

function CameraRig({ preset }: { preset: PlantPreset }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update?: () => void }
    | undefined;
  const wantPos = useRef(new THREE.Vector3(preset.pos[0], preset.pos[1], preset.pos[2]));
  const wantTarget = useRef(new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]));
  const armed = useRef(true);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    wantPos.current.set(preset.pos[0], preset.pos[1], preset.pos[2]);
    wantTarget.current.set(preset.target[0], preset.target[1], preset.target[2]);
    armed.current = true;
    (globalThis as unknown as Record<string, unknown>).__plantPreset = preset.id;
  }, [preset]);

  useFrame((_, dt) => {
    if (!camera) return;
    if (armed.current) {
      const k = Math.min(1, dt * 3.2);
      camera.position.lerp(wantPos.current, k);
      target.lerp(wantTarget.current, k);
      if (controls?.target) {
        controls.target.copy(target);
        controls.update?.();
      } else {
        camera.lookAt(target);
      }
      if (camera.position.distanceTo(wantPos.current) < 0.12) armed.current = false;
    }
    (globalThis as unknown as Record<string, unknown>).__plantCamera = {
      x: Number(camera.position.x.toFixed(2)),
      y: Number(camera.position.y.toFixed(2)),
      z: Number(camera.position.z.toFixed(2)),
    };
  });
  return null;
}

function FpsMeter({ node }: { node?: { current: HTMLElement | null } }) {
  const acc = useRef(0);
  const frames = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    frames.current += 1;
    if (acc.current >= 0.5) {
      const fps = Math.round(frames.current / acc.current);
      if (node?.current) node.current.textContent = `${fps} fps`;
      acc.current = 0;
      frames.current = 0;
    }
  });
  return null;
}

/* -------------------------------------------------------------- 경계 */

class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/* ---------------------------------------------------------- 3D 장면 */

export interface PlantSceneProps {
  snapshot: TwinStoreSnapshot;
  counts: PlantCounts;
  selectedVin: string;
  preset: PlantPreset;
  labels: LabelsMode;
  lang?: PlantLang;
  onSelectVin: (vin: string) => void;
  onOpenVehicle: (vin: string) => void;
  onSceneFail?: () => void;
  fpsNode?: { current: HTMLElement | null };
}

export function PlantScene({
  snapshot,
  counts,
  selectedVin,
  preset,
  labels,
  lang = 'ko',
  onSelectVin,
  onOpenVehicle,
  onSceneFail,
  fpsNode,
}: PlantSceneProps) {
  const verdicts = snapshot.verdicts ?? [];
  const clock = useRef(0);
  clock.current = snapshot.clock?.simTimeMs ?? 0;
  const cellRows = CELLS.map((c) => ({ id: c.short, status: cellStatus(counts, c) }));

  const gridGeometry = useMemo(() => {
    const pts: number[] = [];
    for (let x = PLANT.minX; x <= PLANT.maxX; x += 10) pts.push(x, 0, PLANT.minZ, x, 0, PLANT.maxZ);
    for (let z = PLANT.minZ; z <= PLANT.maxZ; z += 10) pts.push(PLANT.minX, 0, z, PLANT.maxX, 0, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  return (
    <SimClockContext.Provider value={clock}>
      <Canvas
        data-testid="plant-canvas"
        camera={{ position: preset.pos, fov: 45, near: 0.5, far: 460 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={() => {
          (globalThis as unknown as Record<string, unknown>).__plantSceneCreated = true;
        }}
      >
        <SceneBoundary onFail={() => onSceneFail?.()}>
          <color attach="background" args={['#151a20']} />
          <fog attach="fog" args={['#151a20', 130, 320]} />
          <Lights />
          <Floor gridGeometry={gridGeometry} />
          <Conveyor lang={lang} />
          <Yard
            verdicts={verdicts}
            selectedVin={selectedVin}
            onSelectVin={onSelectVin}
            onOpenVehicle={onOpenVehicle}
          />
          {CELLS.map((c) => (
            <CellBlock
              key={c.id}
              cell={c}
              counts={counts}
              verdicts={verdicts}
              selectedVin={selectedVin}
              lang={lang}
              onSelectVin={onSelectVin}
              onOpenVehicle={onOpenVehicle}
            />
          ))}
          <Logistics />
          {AMR_ROUTES.map((r) => (
            <AmrProp key={r.id} route={r} />
          ))}
          <AndonBoard x={31} z={0} yaw={-Math.PI / 2} rows={cellRows} />
          <CameraRig preset={preset} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={5}
            maxDistance={260}
            maxPolarAngle={Math.PI / 2.06}
            target={preset.target}
          />
          <LabelManager mode={labels} />
          <FpsMeter node={fpsNode} />
        </SceneBoundary>
      </Canvas>
    </SimClockContext.Provider>
  );
}

/* ----------------------------------------------- 2D 강등 평면도(SVG) */

const S = SCHEMATIC_SCALE;
const VB = {
  x: PLANT.minX * S,
  y: PLANT.minZ * S,
  w: PLANT.width * S,
  h: PLANT.depth * S,
};

function CellRect({ cell, status }: { cell: PlantCell; status: PlantStatus }) {
  const half = (cell.stations <= 2 ? 5.6 : 7) * S;
  const hex = PLANT_STATUS_HEX[status];
  return (
    <g>
      <rect
        x={cell.x * S - half}
        y={-9 * S}
        width={half * 2}
        height={18 * S}
        fill={hex}
        fillOpacity={0.1}
        stroke={hex}
        strokeWidth={2}
      />
      <text x={cell.x * S} y={-9.8 * S} textAnchor="middle" fontSize={17} fill={hex} fontWeight={700}>
        {cell.short}
      </text>
      <text x={cell.x * S} y={10.9 * S} textAnchor="middle" fontSize={13} fill="#8895A7">
        {status}
      </text>
      {stationPositions(cell).map((p, i) => (
        <circle key={i} cx={p[0] * S} cy={p[1] * S} r={7} fill="none" stroke={hex} strokeWidth={2} />
      ))}
    </g>
  );
}

/**
 * WebGL 을 못 쓰는 환경(jsdom · 구형 브라우저 · 컨텍스트 유실)에서 쓰는 평면도.
 * 3D 와 **같은 레이아웃 SoT**(`plantLayout`)를 읽으므로 두 표현이 어긋나지 않는다.
 */
export function PlantSchematic2D({
  snapshot,
  counts,
  selectedVin,
  onSelectVin,
  onOpenVehicle,
}: {
  snapshot: TwinStoreSnapshot;
  counts: PlantCounts;
  selectedVin: string;
  onSelectVin: (vin: string) => void;
  onOpenVehicle: (vin: string) => void;
}) {
  const slots = useMemo(() => yardSlots(snapshot.verdicts ?? []), [snapshot.verdicts]);
  const simTimeMs = snapshot.clock?.simTimeMs ?? 0;
  return (
    <div className="plant-schematic" data-testid="plant-schematic">
      <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} role="img" aria-label="공장 평면도 (2D 강등 모드)">
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="#151a20" />
        {Array.from({ length: 13 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={(-60 + i * 10) * S}
            y1={VB.y}
            x2={(-60 + i * 10) * S}
            y2={VB.y + VB.h}
            stroke="#242a31"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={VB.x}
            y1={(-30 + i * 10) * S}
            x2={VB.x + VB.w}
            y2={(-30 + i * 10) * S}
            stroke="#242a31"
            strokeWidth={1}
          />
        ))}

        {/* 컨베이어 + WIP 바디 */}
        <rect
          x={CONVEYOR.x1 * S}
          y={CONVEYOR.z * S - 1.3 * S}
          width={(CONVEYOR.x2 - CONVEYOR.x1) * S}
          height={2.6 * S}
          fill="#2a2d31"
          stroke="#4c4e51"
          strokeWidth={1.5}
        />
        {Array.from({ length: CONVEYOR.bodies }).map((_, i) => (
          <rect
            key={`wip${i}`}
            x={conveyorBodyX(i, simTimeMs) * S - 2.1 * S}
            y={CONVEYOR.z * S - 0.9 * S}
            width={4.2 * S}
            height={1.8 * S}
            fill="#8d949c"
            fillOpacity={0.55}
          />
        ))}

        {CELLS.map((c) => (
          <CellRect key={c.id} cell={c} status={cellStatus(counts, c)} />
        ))}

        {/* 출하 야드 — 실제 VIN 30대(클릭 선택) */}
        <text x={46 * S} y={-24 * S} textAnchor="middle" fontSize={17} fill="#1F9D55" fontWeight={700}>
          OUTBOUND YARD ({slots.length})
        </text>
        {slots.map((s) => {
          const hex = yardHex(s.verdict);
          const sel = s.vin === selectedVin;
          return (
            <g
              key={s.vin}
              role="button"
              tabIndex={0}
              aria-label={`야드 ${s.vin}`}
              onClick={() => onSelectVin(s.vin)}
              onDoubleClick={() => onOpenVehicle(s.vin)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectVin(s.vin);
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={s.x * S - 2.2 * S}
                y={s.z * S - 0.98 * S}
                width={4.4 * S}
                height={1.96 * S}
                rx={4}
                fill={hex}
                fillOpacity={sel ? 0.9 : 0.55}
                stroke={sel ? '#FFD166' : hex}
                strokeWidth={sel ? 3 : 1.5}
              />
              {(sel || s.verdict.twin.killSwitch?.active) && (
                <text
                  x={s.x * S}
                  y={s.z * S + 6}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#0b0f14"
                  fontWeight={700}
                >
                  {s.verdict.twin.killSwitch?.active ? 'KS' : s.vin.replace('VIN-DEMO-', '#')}
                </text>
              )}
            </g>
          );
        })}

        {/* AMR — 3D 와 동일한 경로 함수 */}
        {AMR_ROUTES.map((r: AmrRoute) => {
          const pose = amrPose(r, simTimeMs);
          return (
            <g key={r.id}>
              <circle
                cx={pose.x * S}
                cy={pose.z * S}
                r={1.5 * S}
                fill="#b9901a"
                stroke="#f0c14b"
                strokeWidth={1.5}
              />
              <text x={pose.x * S} y={pose.z * S - 2.4 * S} textAnchor="middle" fontSize={11} fill="#d6b46a">
                {r.id}
              </text>
            </g>
          );
        })}

        {/* 게이트 */}
        <line x1={GATE.x * S} y1={-6 * S} x2={GATE.x * S} y2={6 * S} stroke="#b9901a" strokeWidth={6} />
        <text x={GATE.x * S} y={-8 * S} textAnchor="middle" fontSize={15} fill="#b9901a" fontWeight={700}>
          GATE
        </text>
      </svg>
      <p className="small muted plant-schematic-note">
        2D 강등 모드 — WebGL 을 쓸 수 없어 같은 레이아웃 SoT 로 그린 평면도입니다. 야드의 차량을 클릭하면 VIN 이
        선택됩니다.
      </p>
    </div>
  );
}

export const PLANT_LEGEND = TOKEN_HEX;
