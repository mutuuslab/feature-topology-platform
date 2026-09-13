/**
 * §17.4 — 실 차체 자산 렌더러.
 *
 * `public/models/CarConcept/` (Khronos glTF Sample Assets, CC BY 4.0) 를 로드해
 *  - 바퀴 접지면이 y=0, 차체 중심이 x=z=0 이 되도록 정규화하고(§17.4 측정치),
 *  - X-ray 토글 시 **차체 패널만** 반투명으로 바꿔 내부 부품 마커를 보이게 하고,
 *  - 관절(도어 · 후드 · 리어 클램셸)과 바퀴 회전을 시뮬레이터 시계로만 구동한다.
 *
 * 규칙(§17.3 과 동일): `Math.random()` / `Date.now()` / `useFrame` 의 경과시간은
 * **관절 이징에만** 쓰고, 회전량 자체는 `clock.simTimeMs` 에서만 파생한다 →
 * `rate = 0` 이면 바퀴가 완전히 멈춘다.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useSimClock } from './vehicleGeometry';
import {
  ARTICULATIONS,
  CAR_CONCEPT,
  MODEL_TRANSFORM,
  PANEL_PREFIX,
  WHEEL_AXIS,
  WHEEL_NODES,
  XRAY_PANEL_OPACITY,
  wheelSpinDeg,
  type Articulation,
} from './vehicleAsset';

export type ArticulationKey = Articulation['key'];

/** 관절 열림 상태 — 값이 바뀌면 해당 패널이 이징되어 열리거나 닫힌다. */
export type JointState = Record<ArticulationKey, boolean>;

export const JOINTS_CLOSED: JointState = { doorL: false, doorR: false, hood: false, rear: false };

type EditableMaterial = THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean };

interface PanelMaterial {
  material: EditableMaterial;
  /** 차체 패널(외판)인가 — X-ray 대상. */
  panel: boolean;
  /** 원래 값 — X-ray 를 끄면 이 값으로 되돌린다. */
  base: { opacity: number; transparent: boolean; depthWrite: boolean };
}

interface Joint {
  key: ArticulationKey;
  node: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
  openDeg: number;
}

interface Wheel {
  node: THREE.Object3D;
  base: THREE.Quaternion;
}

interface Prepared {
  scene: THREE.Object3D;
  materials: PanelMaterial[];
  joints: Joint[];
  wheels: Wheel[];
}

/** 실측된 피벗의 **로컬** 회전축 — 자산마다 값이 다르고, 부호가 열림 방향을 만든다(§17.4 표). */
const AXIS_VECTORS: Record<Articulation['axis'], THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * 로드한 씬을 "이 화면 전용"으로 복제한다.
 *  - `useGLTF` 는 URL 로 캐시하므로 원본을 직접 만지면 다른 화면까지 오염된다 → 씬을 복제한다.
 *  - 재질은 (원본 uuid × 패널 여부) 로 1회만 복제해 재질 수를 늘리지 않는다(X-ray 대상 분리 목적).
 *  - 관절/바퀴 피벗은 이름으로 찾아 기준 회전(quaternion)을 보관한다 — 피벗은 원본 자산 실측값(§17.4).
 */
export function prepareScene(source: THREE.Object3D): Prepared {
  const scene = source.clone(true);
  const pool = new Map<string, EditableMaterial>();
  const materials: PanelMaterial[] = [];
  const joints: Joint[] = [];
  const wheels: Wheel[] = [];

  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const panel = node.name.startsWith(PANEL_PREFIX);
      const assign = (origin: THREE.Material): THREE.Material => {
        const key = `${origin.uuid}|${panel ? 'panel' : 'solid'}`;
        const cached = pool.get(key);
        if (cached) return cached;
        const material = origin.clone() as EditableMaterial;
        pool.set(key, material);
        materials.push({
          material,
          panel,
          base: { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite },
        });
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(assign) : assign(mesh.material);
    }

    const spec = ARTICULATIONS.find((a) => a.node === node.name);
    if (spec) {
      joints.push({ key: spec.key, node, base: node.quaternion.clone(), axis: AXIS_VECTORS[spec.axis], openDeg: spec.openDeg });
    }
    if ((WHEEL_NODES as readonly string[]).includes(node.name)) {
      wheels.push({ node, base: node.quaternion.clone() });
    }
  });

  return { scene, materials, joints, wheels };
}

export default function CarModel({ xray, joints }: { xray: boolean; joints: JointState }) {
  const gltf = useGLTF(CAR_CONCEPT.file) as unknown as { scene: THREE.Object3D };
  const prepared = useMemo(() => prepareScene(gltf.scene), [gltf.scene]);
  const clock = useSimClock();
  const scratch = useMemo(() => new THREE.Quaternion(), []);
  const progress = useRef<Record<ArticulationKey, number>>({ doorL: 0, doorR: 0, hood: 0, rear: 0 });

  // X-ray — 차체 패널만 투명하게. 원본 재질은 그대로 두므로 토글은 되돌릴 수 있다.
  useEffect(() => {
    for (const entry of prepared.materials) {
      const seeThrough = xray && entry.panel;
      entry.material.transparent = seeThrough ? true : entry.base.transparent;
      entry.material.opacity = seeThrough ? XRAY_PANEL_OPACITY : entry.base.opacity;
      entry.material.depthWrite = seeThrough ? false : entry.base.depthWrite;
      entry.material.needsUpdate = true;
    }
  }, [xray, prepared]);

  useFrame((_, delta) => {
    const ease = Math.min(1, delta * 4.5);
    for (const joint of prepared.joints) {
      const want = joints[joint.key] ? 1 : 0;
      const now = progress.current[joint.key] + (want - progress.current[joint.key]) * ease;
      progress.current[joint.key] = now;
      joint.node.quaternion.copy(joint.base).multiply(scratch.setFromAxisAngle(joint.axis, THREE.MathUtils.degToRad(joint.openDeg * now)));
    }
    scratch.setFromAxisAngle(AXIS_VECTORS[WHEEL_AXIS], THREE.MathUtils.degToRad(wheelSpinDeg(clock.current)));
    for (const wheel of prepared.wheels) wheel.node.quaternion.copy(wheel.base).multiply(scratch);
  });

  return <primitive object={prepared.scene} position={MODEL_TRANSFORM.position} scale={MODEL_TRANSFORM.scale} />;
}

/** 씬 마운트 전에 자산 다운로드를 시작한다(10 MB — 첫 프레임 대기 최소화). */
// 테스트 대역에는 `preload` 가 없을 수 있으므로 선택적 호출로 둔다.
useGLTF.preload?.(CAR_CONCEPT.file);
