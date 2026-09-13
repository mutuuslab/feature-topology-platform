/**
 * §17.3 — 차량 디지털 트윈 절차적 지오메트리(엔지니어링/관제실 스타일).
 *
 * `scene/plantProps.tsx` 와 동일한 원칙을 따른다:
 *  - 장식용 메시를 두지 않는다 — 모든 형상은 서브시스템을 설명하거나 흐름/상태를 전달한다.
 *  - 공유 머티리얼로 draw call 을 억제하고, 상태색은 `PART_STATE_HEX` 에서만 파생한다.
 *  - 모션은 오직 `useSimClock()`(부모가 매 프레임 `clock.simTimeMs` 로 갱신하는 ref) 로만
 *    구동한다 — `Math.random()` / `Date.now()` 를 쓰지 않으므로 rate=0 이면 전부 멈춘다.
 *  - 라벨은 `scene/labels.tsx` 의 스프라이트 매니저를 쓴다. `<Html>` 은 차단 사유 콜아웃
 *    등 꼭 필요한 곳에서만 최소로 쓴다.
 */
import { createContext, useContext, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { Label } from './labels';
import {
  PART_STATE_HEX,
  flowPhase,
  type FlowEdge,
  type PartId,
  type PartState,
  type VehiclePart,
} from './vehicleParts';

const BRAND = '#0B5FFF';
const FAIL = '#D64545';
const CLOUD_HEX = '#3B82F6';

/* ------------------------------------------------------------------ */
/* 시뮬레이션 시각 — TwinClock 에서만 파생, 벽시계/난수 금지               */
/* ------------------------------------------------------------------ */

/** 장면 전체가 공유하는 "현재 시뮬레이션 시각(ms) + 틱" ref. rate=0 이면 갱신이 멈춘다. */
export const SimClockContext = createContext<{ current: number; tick: number; rate: 0 | 1 | 5 }>({
  current: 0,
  tick: 0,
  rate: 1,
});
export const useSimClock = () => useContext(SimClockContext);

export function isPulseState(state: PartState): boolean {
  return state === 'BLOCKED' || state === 'MISSING' || state === 'PENDING';
}

/** 주의: 1틱당 위상 증가량. `simTimeMs` 의 함수로 만들면 배속에 따라 주기가 공명해 정지한다. */
const PULSE_RAD_PER_TICK = 1.5;

/** 상태색을 따르는 공유 머티리얼 — 매 프레임 emissiveIntensity 만 갱신한다(재생성 없음). */
function usePulseMaterial(color: string, pulse: boolean, selected: boolean, opacity = 1) {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.16,
        metalness: 0.32,
        roughness: 0.42,
        transparent: opacity < 1,
        opacity,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, opacity],
  );
  const clock = useSimClock();
  useFrame(() => {
    // 위상은 틱에서 파생한다 — 배속(1×/5×)과 무관하게 매 틱 전진하고 rate=0 이면 멈춘다.
    const t = Math.abs(Math.sin(clock.tick * PULSE_RAD_PER_TICK));
    mat.emissiveIntensity = pulse ? 0.3 + t * 1.1 : selected ? 0.75 : 0.16;
  });
  return mat;
}

/* ------------------------------------------------------------------ */
/* 공유 머티리얼 — 관제실 톤(다크 슬레이트)                                */
/* ------------------------------------------------------------------ */

export const MAT = {
  shell: new THREE.MeshStandardMaterial({ color: '#232a36', metalness: 0.55, roughness: 0.32 }),
  shellDark: new THREE.MeshStandardMaterial({ color: '#171c26', metalness: 0.5, roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: '#8fb4d6', metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.3 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: '#c3c9d2', metalness: 0.8, roughness: 0.25 }),
  underbody: new THREE.MeshStandardMaterial({ color: '#12151b', metalness: 0.35, roughness: 0.55 }),
  frame: new THREE.MeshStandardMaterial({ color: '#2b323f', metalness: 0.4, roughness: 0.5 }),
  coolingPlate: new THREE.MeshStandardMaterial({ color: '#3a5670', metalness: 0.65, roughness: 0.28 }),
  cable: new THREE.MeshStandardMaterial({ color: '#c9532b', metalness: 0.5, roughness: 0.35 }),
  coolant: new THREE.MeshStandardMaterial({ color: '#2fb7c9', metalness: 0.2, roughness: 0.3, emissive: '#0e5560', emissiveIntensity: 0.4 }),
  floor: new THREE.MeshStandardMaterial({ color: '#0c0e13', metalness: 0.1, roughness: 0.95 }),
  cloud: new THREE.MeshStandardMaterial({ color: CLOUD_HEX, emissive: CLOUD_HEX, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.5 }),
};

/* ------------------------------------------------------------------ */
/* 바닥 · 배경 — 다크 관제실 + 은은한 그리드                              */
/* ------------------------------------------------------------------ */

export function SceneFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} material={MAT.floor}>
        <planeGeometry args={[30, 30]} />
      </mesh>
      <gridHelper args={[30, 30, '#233047', '#161c27']} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 차체 — 절차적 SUV 셸(그린하우스/도어 실선/미러/루프 핀/라이트바/휠)     */
/* ------------------------------------------------------------------ */

const WHEEL_POS: Array<[number, number, number]> = [
  [1.02, 0.37, 1.5],
  [-1.02, 0.37, 1.5],
  [1.02, 0.37, -1.5],
  [-1.02, 0.37, -1.5],
];

function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={MAT.tyre}>
        <cylinderGeometry args={[0.37, 0.37, 0.26, 22]} />
      </mesh>
      <mesh material={MAT.rim} position={[0, 0, 0.01]}>
        <cylinderGeometry args={[0.22, 0.22, 0.28, 12]} />
      </mesh>
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} material={MAT.rim} rotation={[0, 0, (i / 5) * Math.PI * 2]} position={[0, 0, 0.14]}>
          <boxGeometry args={[0.04, 0.34, 0.03]} />
        </mesh>
      ))}
    </group>
  );
}

/** 도어/패널 이음선 — 실루엣만으로는 "차"로 안 보이는 문제를 해결한다. */
function BodySeams() {
  const seam = (pts: Array<[number, number, number]>) => (
    <Line points={pts} color="#0a0e15" lineWidth={1.1} transparent opacity={0.85} />
  );
  return (
    <group>
      {seam([
        [-1.0, 0.62, 0.35],
        [1.0, 0.62, 0.35],
      ])}
      {seam([
        [-1.0, 0.62, -1.55],
        [1.0, 0.62, -1.55],
      ])}
      {seam([
        [0.2, 1.06, -2.2],
        [0.2, 1.06, 1.55],
      ])}
      {seam([
        [-1.001, 0.5, -2.15],
        [-1.001, 0.5, 2.15],
      ])}
      {seam([
        [1.001, 0.5, -2.15],
        [1.001, 0.5, 2.15],
      ])}
    </group>
  );
}

function Mirror({ side }: { side: 1 | -1 }) {
  return (
    <group position={[side * 1.02, 1.02, 0.95]}>
      <mesh material={MAT.shellDark}>
        <boxGeometry args={[0.14, 0.1, 0.22]} />
      </mesh>
    </group>
  );
}

export function CarShell({ xray }: { xray: boolean }) {
  const shellOpacity = xray ? 0.2 : 1;
  const shellMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#232a36', metalness: 0.55, roughness: 0.32, transparent: xray, opacity: shellOpacity }),
    [xray, shellOpacity],
  );
  const cabinMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1b212b', metalness: 0.55, roughness: 0.3, transparent: xray, opacity: shellOpacity }),
    [xray, shellOpacity],
  );
  return (
    <group>
      {/* 하부 차체 */}
      <RoundedBox args={[2.0, 0.56, 4.4]} radius={0.14} smoothness={2} position={[0, 0.78, 0]} material={shellMat} />
      {/* 캐빈/루프 */}
      <RoundedBox args={[1.84, 0.5, 2.3]} radius={0.12} smoothness={2} position={[0, 1.22, -0.15]} material={cabinMat} />
      {/* 그린하우스(유리) */}
      <mesh position={[0, 1.28, -0.15]} material={MAT.glass}>
        <boxGeometry args={[1.7, 0.34, 2.1]} />
      </mesh>
      <BodySeams />
      <Mirror side={1} />
      <Mirror side={-1} />
      {/* 루프 핀(샤크핀 안테나 하우징) */}
      <mesh position={[0, 1.54, -1.0]} material={MAT.shellDark}>
        <coneGeometry args={[0.05, 0.1, 8]} />
      </mesh>
      {/* 전/후 라이트바 */}
      <mesh position={[0, 0.82, 2.19]}>
        <boxGeometry args={[1.6, 0.1, 0.03]} />
        <meshStandardMaterial color="#eef4ff" emissive="#eef4ff" emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, 0.82, -2.19]}>
        <boxGeometry args={[1.6, 0.1, 0.03]} />
        <meshStandardMaterial color="#e14b4b" emissive="#e14b4b" emissiveIntensity={0.7} />
      </mesh>
      {/* 휠 4 */}
      {WHEEL_POS.map((p, i) => (
        <Wheel key={i} position={p} />
      ))}
      {/* 언더바디 */}
      <mesh position={[0, 0.2, 0.05]} material={MAT.underbody}>
        <boxGeometry args={[1.9, 0.05, 3.7]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 선택 하이라이트 · 클릭 핸들러 — 공용                                   */
/* ------------------------------------------------------------------ */

function SelectHalo({ size, radius }: { size?: [number, number, number]; radius?: number }) {
  return (
    <mesh>
      {size ? (
        <boxGeometry args={[size[0] + 0.07, size[1] + 0.07, size[2] + 0.07]} />
      ) : (
        <sphereGeometry args={[(radius ?? 0.2) + 0.06, 16, 12]} />
      )}
      <meshBasicMaterial color={BRAND} wireframe transparent opacity={0.6} />
    </mesh>
  );
}

interface NodeProps {
  part: VehiclePart;
  selected: boolean;
  onSelect: (id: PartId) => void;
  dim: boolean;
  explode: [number, number, number];
}

/* ------------------------------------------------------------------ */
/* 배터리 팩 — 7모듈 + 냉각 플레이트 + 팩 프레임 + 플로어 팬               */
/* ------------------------------------------------------------------ */

export function BatteryPackNode({ part, selected, onSelect, dim, explode }: NodeProps) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  const modules = 7;
  return (
    <group position={pos}>
      {/* 플로어 팬 + 팩 프레임 */}
      <mesh material={MAT.underbody} position={[0, -0.1, 0]}>
        <boxGeometry args={[1.62, 0.04, 3.0]} />
      </mesh>
      <mesh material={MAT.frame} position={[0, -0.05, 0]}>
        <boxGeometry args={[1.55, 0.06, 2.95]} />
      </mesh>
      {/* 냉각 플레이트 */}
      <mesh material={MAT.coolingPlate} position={[0, -0.01, 0]}>
        <boxGeometry args={[1.48, 0.02, 2.88]} />
      </mesh>
      {/* 셀 모듈 7개 */}
      {Array.from({ length: modules }).map((_, i) => {
        const z = -1.22 + (i * 2.44) / (modules - 1);
        return (
          <mesh
            key={i}
            position={[0, 0.1, z]}
            material={mat}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(part.id);
            }}
            onPointerOver={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <boxGeometry args={[1.32, 0.18, 0.3]} />
          </mesh>
        );
      })}
      {selected && <SelectHalo size={[1.6, 0.3, 3.0]} />}
      <Label text={part.label} position={[0, 0.3, 1.65]} tier={1} color={color} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 히터 패드 · ECU 박스(BMS/VCU/CGW/HVAC) · Guard 노드 · 충전 포트        */
/* ------------------------------------------------------------------ */

export function HeaterPadNode({ part, selected, onSelect, dim, explode }: NodeProps) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  return (
    <group position={pos}>
      <mesh
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
      >
        <boxGeometry args={[0.9, 0.1, 0.68]} />
      </mesh>
      {/* 지그재그 히터 트레이스 */}
      <Line
        points={[
          [-0.4, 0.06, -0.28],
          [0.4, 0.06, -0.14],
          [-0.4, 0.06, 0],
          [0.4, 0.06, 0.14],
          [-0.4, 0.06, 0.28],
        ]}
        color="#ffb37a"
        lineWidth={1}
        transparent
        opacity={0.7}
      />
      {selected && <SelectHalo size={[0.9, 0.1, 0.68]} />}
      <Label text={part.label} position={[0, 0.22, 0]} tier={2} color={color} />
    </group>
  );
}

export function EcuBoxNode({ part, selected, onSelect, dim, explode, withFan = false }: NodeProps & { withFan?: boolean }) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  return (
    <group position={pos}>
      <mesh
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[0.42, 0.2, 0.32]} />
      </mesh>
      {withFan && (
        <mesh position={[0, 0.16, 0]} material={MAT.rim}>
          <cylinderGeometry args={[0.09, 0.09, 0.04, 14]} />
        </mesh>
      )}
      {selected && <SelectHalo size={[0.42, 0.2, 0.32]} />}
      <Label text={part.label} position={[0, 0.24, 0]} tier={1} color={color} />
    </group>
  );
}

export function GuardNode({ part, selected, onSelect, dim, explode }: NodeProps) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  return (
    <group position={pos}>
      <mesh
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
      >
        <octahedronGeometry args={[0.17, 0]} />
      </mesh>
      {selected && <SelectHalo radius={0.17} />}
      <Label text={part.label} position={[0, 0.3, 0]} tier={0} color={color} priority={9} />
    </group>
  );
}

export function ChargePortNode({ part, selected, onSelect, dim, explode }: NodeProps) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  return (
    <group position={pos} rotation={[0, 0, Math.PI / 2]}>
      <mesh
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
      >
        <cylinderGeometry args={[0.1, 0.1, 0.24, 18]} />
      </mesh>
      {selected && <SelectHalo radius={0.1} />}
      <Label text={part.label} position={[-0.35, 0.22, 0]} tier={2} color={color} />
    </group>
  );
}

export function AntennaNode({ part, selected, onSelect, dim, explode }: NodeProps) {
  const color = PART_STATE_HEX[part.state];
  const mat = usePulseMaterial(color, isPulseState(part.state), selected, dim ? 0.25 : 1);
  const pos: [number, number, number] = [part.anchor[0] + explode[0], part.anchor[1] + explode[1], part.anchor[2] + explode[2]];
  return (
    <group position={pos}>
      <mesh
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
      >
        <cylinderGeometry args={[0.035, 0.035, 0.4, 10]} />
      </mesh>
      {selected && <SelectHalo radius={0.035} />}
      <Label text={part.label} position={[0, 0.32, 0]} tier={1} color={color} />
    </group>
  );
}

/** Feature Platform(클라우드) — 어떤 `PartId` 에도 대응하지 않는 순수 시각 노드. */
export function CloudNode({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={MAT.cloud}>
        <icosahedronGeometry args={[0.26, 0]} />
      </mesh>
      <Html center distanceFactor={12} position={[0, 0.5, 0]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
        <span className="veh-cloud-tag">Feature Platform · Policy</span>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* HV 정션박스 · 케이블 · 냉각 루프 — 컷어웨이에서만 의미 있는 배관/배선   */
/* ------------------------------------------------------------------ */

function TubeBetween({ a, b, radius, material, sag = 0.1 }: { a: [number, number, number]; b: [number, number, number]; radius: number; material: THREE.Material; sag?: number }) {
  const geo = useMemo(() => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const mid = start.clone().lerp(end, 0.5);
    mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    return new THREE.TubeGeometry(curve, 16, radius, 8, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a[0], a[1], a[2], b[0], b[1], b[2], radius, sag]);
  return <mesh geometry={geo} material={material} />;
}

export function HvJunctionBox({ battery, bms, hvac, dim }: { battery: [number, number, number]; bms: [number, number, number]; hvac: [number, number, number]; dim: boolean }) {
  const junction: [number, number, number] = [0.15, 0.5, 0.25];
  return (
    <group>
      <mesh position={junction} material={MAT.frame}>
        <boxGeometry args={[0.22, 0.14, 0.2]} />
      </mesh>
      <TubeBetween a={battery} b={junction} radius={0.025} material={MAT.cable} />
      <TubeBetween a={junction} b={bms} radius={0.02} material={MAT.cable} />
      <TubeBetween a={junction} b={hvac} radius={0.02} material={MAT.cable} />
      {!dim && <Label text="HV Junction" position={[junction[0], junction[1] + 0.16, junction[2]]} tier={2} color="#ffb37a" />}
    </group>
  );
}

export function CoolantLoop({ battery, heater, hvac }: { battery: [number, number, number]; heater: [number, number, number]; hvac: [number, number, number] }) {
  return (
    <group>
      <TubeBetween a={battery} b={heater} radius={0.018} material={MAT.coolant} sag={-0.04} />
      <TubeBetween a={heater} b={hvac} radius={0.018} material={MAT.coolant} sag={-0.02} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 데이터 흐름 — Desired(하강)/Reported(상승) 패킷 + 차단 지점             */
/* ------------------------------------------------------------------ */

function FlowPacket({ from, to, index, color, moving }: { from: THREE.Vector3; to: THREE.Vector3; index: number; color: string; moving: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const clock = useSimClock();
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.lerpVectors(from, to, flowPhase(clock.tick, index, moving));
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.05, 10, 10]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/** 하나의 `FlowEdge` — 라인 + 이동 패킷(정상) 또는 차단 마커 + 사유 콜아웃(차단). */
export function FlowEdgeView({
  edge,
  from,
  to,
  flowing,
  dim,
  showCallout,
  lang = 'ko',
}: {
  edge: FlowEdge;
  from: [number, number, number];
  to: [number, number, number];
  flowing: boolean;
  dim: boolean;
  showCallout: boolean;
  lang?: 'ko' | 'en';
}) {
  const color = edge.blocked ? FAIL : edge.kind === 'command' ? '#3B82F6' : '#33C27A';
  const opacity = dim ? 0.12 : edge.blocked ? 0.9 : 0.55;
  const a = useMemo(() => new THREE.Vector3(...from), [from[0], from[1], from[2]]);
  const b = useMemo(() => new THREE.Vector3(...to), [to[0], to[1], to[2]]);
  // 차단된 구간은 중간까지만 그려 "패킷이 통과하지 못함"을 시각화한다.
  const bStop = edge.blocked ? a.clone().lerp(b, 0.55) : b;
  return (
    <group>
      <Line
        points={[from, [bStop.x, bStop.y, bStop.z]]}
        color={color}
        lineWidth={edge.blocked ? 2 : 1.2}
        transparent
        opacity={opacity}
        dashed={edge.blocked}
        dashSize={0.08}
        gapSize={0.06}
      />
      {!edge.blocked && !dim && [0, 1, 2].map((i) => <FlowPacket key={i} from={a} to={b} index={i} color={color} moving={flowing} />)}
      {edge.blocked && !dim && (
        <mesh position={[bStop.x, bStop.y, bStop.z]}>
          <octahedronGeometry args={[0.06, 0]} />
          <meshBasicMaterial color={FAIL} />
        </mesh>
      )}
      {edge.blocked && !dim && showCallout && edge.blockReason && (
        <Html center distanceFactor={10} position={[bStop.x, bStop.y + 0.22, bStop.z]} zIndexRange={[9, 0]} style={{ pointerEvents: 'none' }}>
          <span className="veh-block-callout">⛔ {lang === 'en' ? edge.blockReason.en : edge.blockReason.ko}</span>
        </Html>
      )}
    </group>
  );
}
