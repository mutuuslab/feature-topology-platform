/**
 * §17.4 — jsdom 테스트용 glTF 씬 스텁.
 *
 * 실 자산(`public/models/CarConcept/CarConcept.gltf`, 10 MB)은 테스트에서 로드하지 않는다.
 * `CarModel` 이 실제로 요구하는 계약만 갖춘다:
 *  - 씬: `clone()` · `traverse(fn)`
 *  - 메시: `isMesh` · `name` · `material`(+`clone()`)
 *  - 피벗: `name` · `quaternion.clone()`
 * 관절/바퀴 피벗 이름은 실 자산의 노드 이름과 같아야 한다(그래야 배선 검증이 의미를 갖는다).
 */
import { ARTICULATIONS, WHEEL_NODES } from '../scene/vehicleAsset';

const STUB_PIVOT_NAMES = [...ARTICULATIONS.map((a) => a.node), ...WHEEL_NODES];

function stubMaterial(): Record<string, unknown> {
  const material: Record<string, unknown> = {
    uuid: 'stub-material',
    opacity: 1,
    transparent: false,
    depthWrite: true,
    needsUpdate: false,
  };
  material.clone = () => stubMaterial();
  return material;
}

const panelMesh = { isMesh: true, name: 'BodyPanelsColor2', material: stubMaterial(), castShadow: false, receiveShadow: false };
const interiorMesh = { isMesh: true, name: 'InteriorSeatsColor1', material: stubMaterial(), castShadow: false, receiveShadow: false };

/** `useGLTF(url).scene` 이 돌려주는 객체. */
export const GLTF_STUB_SCENE = {
  clone: () => GLTF_STUB_SCENE,
  traverse(fn: (node: unknown) => void) {
    fn(panelMesh);
    fn(interiorMesh);
    for (const name of STUB_PIVOT_NAMES) fn({ name, isMesh: false, quaternion: { clone: () => ({}) } });
  },
};

/** drei `useGLTF` 대역 — 호출 대역 + `preload`(모듈 로드 시 호출된다). */
export function useGltfStub() {
  return Object.assign(() => ({ scene: GLTF_STUB_SCENE }), { preload: () => {} });
}
