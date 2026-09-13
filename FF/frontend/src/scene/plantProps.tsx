/**
 * §17.2 — 공장 장면용 설비 컴포넌트 라이브러리.
 *
 * RFTwin `scene/SceneProps*.tsx` 의 원칙을 따른다:
 *  - **모든 컴포넌트가 의미를 갖는다**: 제조 공정을 설명하거나, Twin 상태를 전달하거나,
 *    안전/물류 흐름을 지탱한다. 장식용 메시는 두지 않는다.
 *  - 공유 머티리얼(`MAT`)로 draw call 과 메모리를 억제한다.
 *  - 그림자·후처리 없음(헤드리스 swiftshader 에서도 돌아가야 한다). 낮은 segment 수.
 *  - 움직이는 부품(로봇암·AMR)은 `useFrame` 에서 읽는 시뮬레이션 시각만 쓴다.
 */
import { createContext, useContext, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Label } from './labels';
import { amrPose, PLANT_STATUS_HEX, type AmrRoute, type PlantStatus } from './plantLayout';

/* ------------------------------------------------------- 시뮬레이션 시각 */

/**
 * 장면 전체가 공유하는 "현재 시뮬레이션 시각" ref.
 * `PlantScene` 이 렌더마다 갱신하고, 움직이는 부품이 `useFrame` 에서 읽는다.
 * (FF 의 `useTwin()` 은 zustand 가 아니라 React context 라 `getState()` 가 없다.)
 */
export const SimClockContext = createContext<{ current: number }>({ current: 0 });
export const useSimClock = () => useContext(SimClockContext);

/* ------------------------------------------------------------ 공유 머티리얼 */

export const MAT = {
  floor: new THREE.MeshStandardMaterial({ color: '#2b3138', metalness: 0.05, roughness: 0.95 }),
  aisle: new THREE.MeshStandardMaterial({ color: '#333a42', metalness: 0.05, roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: '#787d84', metalness: 0.45, roughness: 0.45 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: '#4c4e51', metalness: 0.4, roughness: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: '#464a4f', metalness: 0.3, roughness: 0.8 }),
  cabinet: new THREE.MeshStandardMaterial({ color: '#a2a7ac', metalness: 0.2, roughness: 0.6 }),
  fenceMesh: new THREE.MeshStandardMaterial({
    color: '#8b929a',
    metalness: 0.55,
    roughness: 0.6,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  }),
  hazard: new THREE.MeshStandardMaterial({ color: '#b9901a', roughness: 0.85 }),
  belt: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.95 }),
  screen: new THREE.MeshStandardMaterial({ color: '#0a2a3a', emissive: '#1a6a8a', emissiveIntensity: 0.85 }),
  glass: new THREE.MeshStandardMaterial({
    color: '#9fc4d8',
    metalness: 0.1,
    roughness: 0.15,
    transparent: true,
    opacity: 0.32,
  }),
  body: new THREE.MeshStandardMaterial({ color: '#c8cdd4', metalness: 0.55, roughness: 0.35 }),
  wip: new THREE.MeshStandardMaterial({ color: '#8d949c', metalness: 0.35, roughness: 0.6 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#1e2124', roughness: 0.9 }),
  /** 상태 표시용 — 인스턴스별 색이 필요해 매번 만든다(개수 적음). */
};

export function statusMat(hex: string, emissive = 0.5, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: emissive,
    transparent: opacity < 1,
    opacity,
    metalness: 0.3,
    roughness: 0.5,
  });
}

/* ------------------------------------------------------------------ 차량 */

/** 차량 1대. 길이축은 +X (야드 정렬·컨베이어 진행 방향과 동일). */
export function VehicleMesh({
  length = 4.4,
  width = 1.95,
  height = 1.42,
  color = '#c8cdd4',
  wip = false,
  simple = false,
}: {
  length?: number;
  width?: number;
  height?: number;
  color?: string;
  wip?: boolean;
  /** 야드·컨베이어처럼 수십 대가 동시에 보이는 곳에서 쓴다(바퀴·범퍼·유리 하이라이트 생략). */
  simple?: boolean;
}) {
  const shell = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        metalness: wip ? 0.35 : 0.55,
        roughness: 0.35,
      }),
    [color, wip],
  );
  const half = width / 2 - 0.16;
  const wheelY = 0.34;
  return (
    <group>
      {/* 하부 바디 */}
      <mesh material={shell} position={[0, 0.72, 0]}>
        <boxGeometry args={[length, 0.66, width]} />
      </mesh>
      {/* 상부 캐빈 */}
      <mesh material={MAT.glass} position={[-0.16, 1.24, 0]}>
        <boxGeometry args={[length * 0.46, 0.46, width * 0.86]} />
      </mesh>
      {/* 루프 */}
      <mesh material={shell} position={[-0.16, 1.48, 0]}>
        <boxGeometry args={[length * 0.5, 0.06, width * 0.88]} />
      </mesh>
      {!simple && (
        <>
          {/* 전면/후면 범퍼 */}
          <mesh material={MAT.darkSteel} position={[length / 2 - 0.06, 0.56, 0]}>
            <boxGeometry args={[0.12, 0.22, width * 0.94]} />
          </mesh>
          <mesh material={MAT.darkSteel} position={[-length / 2 + 0.06, 0.56, 0]}>
            <boxGeometry args={[0.12, 0.22, width * 0.94]} />
          </mesh>
          {/* 바퀴 4 */}
          {[
            [length * 0.31, half],
            [length * 0.31, -half],
            [-length * 0.31, half],
            [-length * 0.31, -half],
          ].map(([wx, wz], i) => (
            <mesh key={i} material={MAT.tyre} position={[wx, wheelY, wz]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.34, 0.34, 0.24, 14]} />
            </mesh>
          ))}
          {/* 앞유리 하이라이트 — 진행 방향(+X)을 읽게 해 준다 */}
          <mesh position={[length * 0.2, 1.22, 0]} rotation-y={Math.PI / 2}>
            <planeGeometry args={[width * 0.7, 0.4]} />
            <meshBasicMaterial color="#dfe9f2" transparent opacity={0.28} />
          </mesh>
        </>
      )}
    </group>
  );
}

/* --------------------------------------------------------------- 스테이션 */

/** EOL 스테이션: 플랫폼 + 리프트 + HMI + 스택라이트. */
export function StationProp({
  id,
  x,
  z,
  status,
  withRobot = false,
}: {
  id: string;
  x: number;
  z: number;
  status: PlantStatus;
  withRobot?: boolean;
}) {
  const hex = PLANT_STATUS_HEX[status];
  const facing = z < 0 ? 1 : -1;
  return (
    <group position={[x, 0, z]}>
      {/* 스테이션 바닥 마킹 */}
      <mesh position={[0, 0.015, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[5.4, 3.4]} />
        <meshBasicMaterial color={hex} transparent opacity={0.1} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.5, 2.6, 32]} />
        <meshBasicMaterial color={hex} transparent opacity={0.42} />
      </mesh>
      {/* 리프트/스키드 */}
      <mesh material={MAT.steel} position={[0, 0.24, 0]}>
        <boxGeometry args={[3.2, 0.5, 2.4]} />
      </mesh>
      <mesh material={MAT.hazard} position={[0, 0.05, 0]}>
        <boxGeometry args={[3.4, 0.06, 2.6]} />
      </mesh>
      {/* HMI 기둥 — 차량 바깥쪽 */}
      <group position={[2.0, 0, facing * 2.1]}>
        <mesh material={MAT.darkSteel} position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 1.2, 8]} />
        </mesh>
        <mesh material={MAT.screen} position={[0, 1.36, 0]} rotation-y={-facing * Math.PI * 0.22}>
          <boxGeometry args={[0.7, 0.46, 0.06]} />
        </mesh>
      </group>
      {/* 스택라이트 */}
      <StackLight x={-2.0} z={facing * 2.1} status={status} />
      {withRobot && <RobotArm x={-1.7} z={-facing * 2.0} phaseMs={x * 90} active={status === 'RUNNING'} />}
      <Label text={id} position={[0, 2.5, facing * 2.6]} size={0.85} tier={1} />
    </group>
  );
}

/** 3단 스택라이트: 가동=녹, 경고/대기=황, 정지·이상=적. */
export function StackLight({ x, z, status }: { x: number; z: number; status: PlantStatus }) {
  const on =
    status === 'RUNNING' ? 0 : status === 'IDLE' || status === 'WAITING' ? 1 : status === 'WARNING' || status === 'BLOCKED' ? 1 : 2;
  const cols = ['#12b012', '#f0b429', '#e04b4b'];
  return (
    <group position={[x, 0, z]}>
      <mesh material={MAT.darkSteel} position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 1.7, 8]} />
      </mesh>
      {cols.map((c, i) => (
        <mesh key={c} position={[0, 1.78 + i * 0.24, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.22, 12]} />
          <meshStandardMaterial
            color={on === i ? c : '#3a3f45'}
            emissive={on === i ? c : '#000000'}
            emissiveIntensity={on === i ? 1.1 : 0}
            roughness={0.4}
          />
        </mesh>
      ))}
      <mesh material={MAT.steel} position={[0, 1.62, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.3, 8]} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- 로봇암 */

/** 2축 로봇암. 관절 각도는 시뮬레이션 시각의 사인파 — rate=0 이면 멈춘다. */
export function RobotArm({
  x,
  z,
  yaw = 0,
  phaseMs = 0,
  active = true,
}: {
  x: number;
  z: number;
  yaw?: number;
  phaseMs?: number;
  active?: boolean;
}) {
  const clock = useSimClock();
  const j1 = useRef<THREE.Group>(null);
  const j2 = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!active) return;
    const t = clock.current / 1000;
    if (j1.current) j1.current.rotation.y = Math.sin(t * 0.9 + phaseMs / 700) * 0.75;
    if (j2.current) j2.current.rotation.z = -0.45 + Math.sin(t * 1.3 + phaseMs / 500) * 0.4;
  });
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh material={MAT.frame} position={[0, 0.18, 0]}>
        <boxGeometry args={[1.1, 0.36, 1.1]} />
      </mesh>
      <mesh material={MAT.hazard} position={[0, 0.38, 0]}>
        <boxGeometry args={[1.2, 0.05, 1.2]} />
      </mesh>
      <mesh material={MAT.steel} position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.34, 0.4, 0.52, 12]} />
      </mesh>
      <group ref={j1} position={[0, 0.9, 0]}>
        <mesh material={MAT.steel} position={[0, 0.3, 0]}>
          <boxGeometry args={[0.3, 1.0, 0.34]} />
        </mesh>
        <group ref={j2} position={[0, 0.82, 0]}>
          <mesh material={MAT.cabinet} position={[0.5, 0, 0]}>
            <boxGeometry args={[1.15, 0.24, 0.28]} />
          </mesh>
          <mesh material={MAT.darkSteel} position={[1.06, 0, 0]}>
            <boxGeometry args={[0.24, 0.2, 0.22]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* -------------------------------------------------------------- 컨베이어 */

/** 컨베이어 구조물 1구간. 상판 + 측면 프레임 + 다리. */
export function ConveyorStruct({
  x1,
  x2,
  z = 0,
  y = 0.5,
}: {
  x1: number;
  x2: number;
  z?: number;
  y?: number;
}) {
  const len = x2 - x1;
  const mid = (x1 + x2) / 2;
  const legs = Math.max(2, Math.round(len / 6));
  return (
    <group position={[mid, 0, z]}>
      <mesh material={MAT.belt} position={[0, y, 0]}>
        <boxGeometry args={[len, 0.12, 2.6]} />
      </mesh>
      <mesh material={MAT.steel} position={[0, y - 0.11, 1.32]}>
        <boxGeometry args={[len, 0.22, 0.12]} />
      </mesh>
      <mesh material={MAT.steel} position={[0, y - 0.11, -1.32]}>
        <boxGeometry args={[len, 0.22, 0.12]} />
      </mesh>
      {Array.from({ length: legs + 1 }).map((_, i) => {
        const lx = -len / 2 + (len / legs) * i;
        return (
          <group key={i} position={[lx, 0, 0]}>
            <mesh material={MAT.frame} position={[0, y / 2, 1.15]}>
              <boxGeometry args={[0.12, y, 0.12]} />
            </mesh>
            <mesh material={MAT.frame} position={[0, y / 2, -1.15]}>
              <boxGeometry args={[0.12, y, 0.12]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* --------------------------------------------------------------- AMR */

/** AMR 1대. `amrPose()` 로 계산한 위치로 부드럽게 따라간다. */
export function AmrProp({ route, status = 'RUNNING' }: { route: AmrRoute; status?: PlantStatus }) {
  const clock = useSimClock();
  const g = useRef<THREE.Group>(null);
  const start = amrPose(route, 0);
  const hex = PLANT_STATUS_HEX[status];

  useFrame(() => {
    const g0 = g.current;
    if (!g0) return;
    const pose = amrPose(route, clock.current);
    const k = 0.3;
    g0.position.x += (pose.x - g0.position.x) * k;
    g0.position.z += (pose.z - g0.position.z) * k;
    let d = pose.yaw - g0.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g0.rotation.y += d * k;
  });

  return (
    <group ref={g} position={[start.x, 0, start.z]} rotation-y={start.yaw}>
      <mesh material={MAT.darkSteel} position={[0, 0.22, 0]}>
        <boxGeometry args={[1.5, 0.3, 1.0]} />
      </mesh>
      <mesh material={MAT.hazard} position={[0, 0.42, 0]}>
        <boxGeometry args={[1.35, 0.16, 0.9]} />
      </mesh>
      {/* 상부 적재함 */}
      <mesh material={MAT.cabinet} position={[-0.15, 0.66, 0]}>
        <boxGeometry args={[0.9, 0.34, 0.78]} />
      </mesh>
      {/* 전방 센서 + 상태등 */}
      <mesh position={[0.74, 0.42, 0]}>
        <boxGeometry args={[0.1, 0.2, 0.6]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 10]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={1} />
      </mesh>
      {/* 바퀴 */}
      {[
        [0.42, 0.52],
        [0.42, -0.52],
        [-0.42, 0.52],
        [-0.42, -0.52],
      ].map(([wx, wz], i) => (
        <mesh key={i} material={MAT.tyre} position={[wx, 0.1, wz]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.1, 0.1, 0.12, 10]} />
        </mesh>
      ))}
      <Label text={route.id} position={[0, 1.15, 0]} size={0.7} tier={0} priority={5} />
    </group>
  );
}

/* ------------------------------------------------------- 구조물/안전/표지 */

export function Fence({ x1, x2, z, height = 2.2 }: { x1: number; x2: number; z: number; height?: number }) {
  const len = x2 - x1;
  const posts = Math.max(2, Math.round(len / 3.6));
  return (
    <group position={[(x1 + x2) / 2, 0, z]}>
      <mesh material={MAT.fenceMesh} position={[0, height / 2, 0]}>
        <planeGeometry args={[len, height]} />
      </mesh>
      {Array.from({ length: posts + 1 }).map((_, i) => (
        <mesh
          key={i}
          material={MAT.frame}
          position={[-len / 2 + (len / posts) * i, height / 2, 0]}
        >
          <boxGeometry args={[0.1, height, 0.1]} />
        </mesh>
      ))}
      <mesh material={MAT.hazard} position={[0, height, 0]}>
        <boxGeometry args={[len, 0.1, 0.12]} />
      </mesh>
    </group>
  );
}

/** 자재 랙(수직 다단). supermarket 물류를 표현한다. */
export function Rack({ x, z, yaw = 0, bays = 3 }: { x: number; z: number; yaw?: number; bays?: number }) {
  const w = 1.4 * bays;
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      {[0, 1].map((side) => (
        <mesh key={side} material={MAT.frame} position={[0, 1.2, side ? 0.55 : -0.55]}>
          <boxGeometry args={[w, 2.4, 0.09]} />
        </mesh>
      ))}
      {[0.55, 1.35, 2.15].map((y) => (
        <mesh key={y} material={MAT.steel} position={[0, y, 0]}>
          <boxGeometry args={[w, 0.07, 1.2]} />
        </mesh>
      ))}
      {Array.from({ length: bays }).map((_, i) => {
        const bx = -w / 2 + 0.7 + i * 1.4;
        return (
          <mesh key={i} material={MAT.cabinet} position={[bx, 0.9, 0]}>
            <boxGeometry args={[1.1, 0.62, 1.0]} />
          </mesh>
        );
      })}
    </group>
  );
}

export function Cabinet({
  x,
  z,
  yaw = 0,
  w = 1.6,
  h = 1.9,
  d = 0.9,
  status,
}: {
  x: number;
  z: number;
  yaw?: number;
  w?: number;
  h?: number;
  d?: number;
  status?: PlantStatus;
}) {
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh material={MAT.cabinet} position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh material={MAT.screen} position={[0, h * 0.66, d / 2 + 0.01]}>
        <planeGeometry args={[w * 0.5, h * 0.26]} />
      </mesh>
      {status && (
        <mesh position={[w * 0.38, h - 0.14, d / 2 + 0.02]}>
          <boxGeometry args={[0.14, 0.14, 0.04]} />
          <meshStandardMaterial
            color={PLANT_STATUS_HEX[status]}
            emissive={PLANT_STATUS_HEX[status]}
            emissiveIntensity={1}
          />
        </mesh>
      )}
    </group>
  );
}

/** 존 사인: 바닥 위 기둥 + 스프라이트 라벨. */
export function ZoneSign({
  x,
  z,
  text,
  sub,
  hex = '#8895A7',
}: {
  x: number;
  z: number;
  text: string;
  sub?: string;
  hex?: string;
}) {
  return (
    <group position={[x, 0, z]}>
      <mesh material={MAT.darkSteel} position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 3.2, 8]} />
      </mesh>
      <mesh position={[0, 3.2, 0]}>
        <boxGeometry args={[3.2, 0.1, 0.1]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.35} />
      </mesh>
      <Label text={text} position={[0, 3.7, 0]} size={1.5} tier={0} priority={6} color="#dfe9f2" />
      {sub && <Label text={sub} position={[0, 3.25, 0]} size={0.8} tier={1} priority={4} color={hex} />}
    </group>
  );
}

/** Andon 보드: 셀별 상태 램프 5개. 색만이 아니라 셀 이름을 함께 표시한다. */
export function AndonBoard({
  x,
  z,
  yaw = 0,
  rows,
}: {
  x: number;
  z: number;
  yaw?: number;
  rows: { id: string; status: PlantStatus }[];
}) {
  const h = 1.1 + rows.length * 0.34;
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh material={MAT.frame} position={[0, h / 2 + 0.6, 0]}>
        <boxGeometry args={[3.4, h, 0.24]} />
      </mesh>
      <mesh material={MAT.darkSteel} position={[0, 0.3, 0]}>
        <boxGeometry args={[0.3, 0.6, 0.3]} />
      </mesh>
      {rows.map((r, i) => {
        const hex = PLANT_STATUS_HEX[r.status];
        const y = h + 0.28 - i * 0.34;
        return (
          <group key={r.id} position={[0, y, 0.15]}>
            <mesh position={[-1.26, 0, 0]}>
              <boxGeometry args={[0.26, 0.26, 0.05]} />
              <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.95} />
            </mesh>
            <Label text={r.id} position={[-0.34, 0, 0.06]} size={0.4} tier={0} priority={7} />
          </group>
        );
      })}
      <Label text="ANDON" position={[0, h + 0.72, 0.1]} size={0.7} tier={0} priority={7} color="#dfe9f2" />
    </group>
  );
}

export function CctvProp({ x, y = 5.4, z, yaw = 0 }: { x: number; y?: number; z: number; yaw?: number }) {
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh material={MAT.darkSteel} position={[0, y / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.09, y, 8]} />
      </mesh>
      <mesh material={MAT.darkSteel} position={[0.2, y, 0]} rotation-z={-0.5}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
      </mesh>
      <mesh position={[0.42, y - 0.06, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color="#101418" emissive="#2b3a44" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** 바닥 마킹(보행 통로·대기 라인·위험 구역). */
export function FloorMarking({
  x,
  z,
  w,
  d,
  hex,
  opacity = 0.16,
  y = 0.012,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  hex: string;
  opacity?: number;
  y?: number;
}) {
  return (
    <mesh position={[x, y, z]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial color={hex} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 충전 패드(AMR 홈). */
export function ChargingPad({ x, z, yaw = 0 }: { x: number; z: number; yaw?: number }) {
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh material={MAT.hazard} position={[0, 0.03, 0]}>
        <boxGeometry args={[2.0, 0.06, 2.0]} />
      </mesh>
      <mesh material={MAT.frame} position={[0, 0.4, -0.85]}>
        <boxGeometry args={[1.6, 0.8, 0.2]} />
      </mesh>
      <mesh material={MAT.screen} position={[0, 0.55, -0.74]}>
        <planeGeometry args={[0.7, 0.34]} />
      </mesh>
      <Label text="AMR CHARGER" position={[0, 1.1, 0]} size={0.7} tier={1} />
    </group>
  );
}
