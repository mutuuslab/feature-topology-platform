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
  // 페인트 — 클리어코트를 가진 2코트 금속 도장. 하이라이트의 모양은 환경맵이 만든다.
  shell: new THREE.MeshPhysicalMaterial({
    color: '#2c3444', metalness: 0.72, roughness: 0.26,
    clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.15,
  }),
  shellDark: new THREE.MeshPhysicalMaterial({
    color: '#171c26', metalness: 0.6, roughness: 0.34,
    clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 1,
  }),
  // 유리 — 어두운 관제실에서 실제 유리처럼 읽히려면 투명도보다 "반사"가 지배적이어야 한다.
  glass: new THREE.MeshPhysicalMaterial({
    color: '#0e1622', metalness: 0.16, roughness: 0.05,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.1,
    transparent: true, opacity: 0.62, side: THREE.DoubleSide,
  }),
  tyre: new THREE.MeshStandardMaterial({ color: '#0d0f13', roughness: 0.86, metalness: 0.05 }),
  rim: new THREE.MeshPhysicalMaterial({
    color: '#c9cfd8', metalness: 0.96, roughness: 0.2,
    clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.3,
  }),
  disc: new THREE.MeshStandardMaterial({ color: '#8d949f', metalness: 0.85, roughness: 0.32 }),
  caliper: new THREE.MeshStandardMaterial({ color: '#c1483f', metalness: 0.4, roughness: 0.45 }),
  trim: new THREE.MeshPhysicalMaterial({
    color: '#0f1218', metalness: 0.35, roughness: 0.46,
    clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.9,
  }),
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} material={MAT.floor} receiveShadow>
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
  // 차체 바깥쪽에 림·스포크를, 안쪽에 디스크·캘리퍼를 둔다(실차 배치).
  const out = position[0] >= 0 ? 1 : -1;
  const faceX = out * 0.1;
  const hubX = -out * 0.05;
  return (
    <group position={position}>
      {/* 트레드 — 원형 단면이라 정면/측면 어디에서 봐도 타이어로 읽힌다 */}
      <mesh material={MAT.tyre} rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[0.272, 0.1, 14, 36]} />
      </mesh>
      {/* 림 배럴 */}
      <mesh material={MAT.rim} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.16, 28]} />
      </mesh>
      {/* 5-스포크 — 휠 축(X) 둘레로 방사형 배치 */}
      {Array.from({ length: 5 }).map((_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh
            key={i}
            material={MAT.rim}
            position={[faceX, Math.cos(a) * 0.115, Math.sin(a) * 0.115]}
            rotation={[a, 0, 0]}
          >
            <boxGeometry args={[0.045, 0.21, 0.055]} />
          </mesh>
        );
      })}
      {/* 허브 캡 */}
      <mesh material={MAT.rim} position={[faceX, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.035, 18]} />
      </mesh>
      {/* 브레이크 디스크 · 캘리퍼 — 바퀴 안쪽이 비어 보이지 않게 하는 제동 질량 */}
      <mesh material={MAT.disc} position={[hubX, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.165, 0.165, 0.02, 26]} />
      </mesh>
      <mesh material={MAT.caliper} position={[hubX, 0.105, 0.01]}>
        <boxGeometry args={[0.05, 0.1, 0.075]} />
      </mesh>
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
  const shellOpacity = xray ? 0.18 : 1;
  const shellMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      color: '#2c3444', metalness: 0.72, roughness: 0.26,
      clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.15,
      transparent: xray, opacity: shellOpacity,
    }),
    [xray, shellOpacity],
  );
  const trimMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      color: '#141922', metalness: 0.5, roughness: 0.42,
      clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.85,
      transparent: xray, opacity: xray ? 0.16 : 1,
    }),
    [xray],
  );
  // X-ray 에서도 유리는 살아 있어야 차체와 구분된다 — 불투명도만 낮춘다.
  const glassMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      color: '#0e1622', metalness: 0.16, roughness: 0.05,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.1,
      transparent: true, opacity: xray ? 0.12 : 0.62, side: THREE.DoubleSide,
    }),
    [xray],
  );
  return (
    <group>
      {/* 하부 차체 */}
      <RoundedBox args={[2.0, 0.56, 4.4]} radius={0.14} smoothness={3} position={[0, 0.78, 0]} material={shellMat} castShadow />
      {/* 후드 — 앞쪽이 낮아지는 실루엣을 만든다 */}
      <RoundedBox args={[1.86, 0.2, 1.5]} radius={0.08} smoothness={3} position={[0, 1.09, 1.3]} material={shellMat} />
      {/* 테일게이트 */}
      <RoundedBox args={[1.86, 0.46, 0.9]} radius={0.1} smoothness={3} position={[0, 1.06, -1.86]} material={shellMat} />
      {/* 루프 패널 — 유리가 차체에 묻히지 않도록 그린하우스 위를 덮는다 */}
      <RoundedBox args={[1.74, 0.12, 2.18]} radius={0.05} smoothness={3} position={[0, 1.44, -0.15]} material={shellMat} />
      {/* 그린하우스(유리) — 유리 상자 자체가 차체 상부의 형상이 된다 */}
      <mesh position={[0, 1.2, -0.15]} material={glassMat}>
        <boxGeometry args={[1.78, 0.44, 2.2]} />
      </mesh>
      {/* A/B/C 필러 — 유리 상자만으로는 승용차 실루엣이 되지 않는다 */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[s * 0.87, 1.2, 0.98]} rotation={[0.34, 0, 0]} material={trimMat}>
            <boxGeometry args={[0.1, 0.5, 0.12]} />
          </mesh>
          <mesh position={[s * 0.89, 1.2, -0.15]} material={trimMat}>
            <boxGeometry args={[0.09, 0.5, 0.09]} />
          </mesh>
          <mesh position={[s * 0.87, 1.2, -1.26]} rotation={[-0.3, 0, 0]} material={trimMat}>
            <boxGeometry args={[0.11, 0.5, 0.16]} />
          </mesh>
        </group>
      ))}
      {/* 윈드실드 · 리어 헤더 */}
      <mesh position={[0, 1.41, 1.02]} material={trimMat}>
        <boxGeometry args={[1.74, 0.09, 0.12]} />
      </mesh>
      <mesh position={[0, 1.41, -1.3]} material={trimMat}>
        <boxGeometry args={[1.74, 0.09, 0.14]} />
      </mesh>
      <BodySeams />
      <Mirror side={1} />
      <Mirror side={-1} />
      {/* 휠 아치 — 펜더 라인. 바퀴가 차체에 박혀 보이지 않게 한다 */}
      {WHEEL_POS.map((p, i) => (
        <mesh
          key={`arch${i}`}
          material={trimMat}
          position={[p[0] > 0 ? 0.975 : -0.975, p[1], p[2]]}
          rotation={[0, Math.PI / 2, 0.32]}
        >
          <torusGeometry args={[0.42, 0.055, 8, 20, 2.5]} />
        </mesh>
      ))}
      {/* 사이드 실 · 전후 범퍼 하단 */}
      <RoundedBox args={[2.02, 0.14, 2.9]} radius={0.05} smoothness={2} position={[0, 0.53, 0]} material={trimMat} />
      <RoundedBox args={[1.78, 0.3, 0.24]} radius={0.06} smoothness={2} position={[0, 0.6, 2.22]} material={trimMat} />
      <RoundedBox args={[1.78, 0.3, 0.24]} radius={0.06} smoothness={2} position={[0, 0.6, -2.22]} material={trimMat} />
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
