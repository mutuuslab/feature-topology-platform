/**
 * §17.4 — 차량 Twin 3D 실 자산(glTF/HDRI) 명세 — 순수 데이터.
 *
 * 여기 값은 전부 **자산을 실제로 내려받아 측정한 값**이다(추정/제안 아님):
 *  - 지오메트리/노드/재질 수, bbox, 휠 지름, 휠베이스, 피벗의 회전축과 열림 부호.
 *  - 화면(`CarModel.tsx`)은 이 상수만 참조한다 — 씬 파일에 좌표를 하드코딩하지 않는다.
 *
 * 라이선스 표기를 위해 `file`(배포 경로) · `author` · `license` · `sourceUrl` 을 함께 갖는다.
 * CC BY 4.0 자산은 저작자 표시가 의무이므로 HUD 와 문서(§17.4)에서 동일한 값을 노출한다.
 */

export interface AssetSource {
  id: string;
  name: string;
  /** 배포 경로(public 기준). */
  file: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

/** 차체 glTF — Khronos glTF Sample Assets `CarConcept` (CC BY 4.0). */
export const CAR_CONCEPT: AssetSource = {
  id: 'khronos-car-concept',
  name: 'Car Concept',
  file: '/models/CarConcept/CarConcept.gltf',
  author: 'Eric Chadwick (Darmstadt Graphics Group GmbH)',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept',
};

/** 스튜디오 HDRI — Poly Haven `studio_small_09` (CC0). */
export const STUDIO_HDRI: AssetSource = {
  id: 'polyhaven-studio-small-09',
  name: 'Studio Small 09',
  file: '/env/studio_small_09_1k.hdr',
  author: 'Sergej Majboroda',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl: 'https://polyhaven.com/a/studio_small_09',
};

/** `CarConcept.gltf` + `.data.bin` + 텍스처 14장 = 10,025,560 bytes 를 파싱해 측정한 값. */
export const CAR_CONCEPT_SURVEY = {
  bytes: 10_025_560,
  nodes: 101,
  meshes: 97,
  materials: 29,
  images: 14,
  textures: 15,
  vertices: 162_766,
  triangles: 213_347,
  /** 실측 world bbox(mm 단위 반올림) — 길이 · 높이 · 폭. */
  lengthM: 4.357,
  heightM: 1.308,
  widthM: 2.716,
  wheelbaseM: 2.8,
  wheelRadiusM: 0.384,
  /** three.js GLTFLoader 가 그대로 지원하는 확장(디코더 wasm 불필요). */
  extensions: [
    'KHR_materials_clearcoat',
    'KHR_materials_emissive_strength',
    'KHR_materials_iridescence',
    'KHR_materials_transmission',
    'KHR_materials_variants',
    'KHR_texture_transform',
  ],
  /** glTF 에 정의된 도장 Variant 3종. three 는 KHR_materials_variants 를 적용하지 않아 기본(Carmine)으로 렌더된다. */
  paintVariants: ['Carmine Candy', 'Pearly Swirly', 'Torched Graphite'],
  /** 배포 등급 — 디코더가 필요 없어 로컬 wasm 을 동봉하지 않는다. */
  grade: 'glTF-JPG (지오메트리 미압축 · 텍스처 JPEG)',
  /** GPU 상주 추정: 텍스처 14장 + 정점 162,766(위치/노멀/탄젠트/UV2) 기준. */
  vramMB: 48.8,
} as const;

/**
 * 모델 배치 변환 — 자산 원점을 "차체 기준 좌표계"(바퀴 접지면 y=0, 차체 중심 x=z=0)에 맞춘다.
 * 값은 world bbox 실측치에서 그대로 유도했다: min y −0.1593 · center x −0.0052 · center z 0.2385.
 */
export const MODEL_TRANSFORM = {
  position: [0.0052, 0.1593, -0.2385] as [number, number, number],
  scale: 1,
} as const;

/** 차체 패널 노드 접두사 — X-ray 에서 이 접두사를 가진 메시의 도장/트림만 투명해진다. */
export const PANEL_PREFIX = 'Body';

/** X-ray 시 차체 패널 불투명도. */
export const XRAY_PANEL_OPACITY = 0.22;

export interface Articulation {
  key: 'doorL' | 'doorR' | 'hood' | 'rear';
  /** glTF 노드 이름 — `GLTFLoader` 가 이름을 보존하므로 씬에서 그대로 찾을 수 있다. */
  node: string;
  /** 피벗 노드의 **로컬** 회전축(실측). */
  axis: 'x' | 'y' | 'z';
  /** 열린 상태 각도(도). 부호가 열림 방향이다(실측으로 확정). */
  openDeg: number;
  label: string;
  /** 열림 방향 근거 — 문서/툴팁에 그대로 노출한다. */
  note: string;
}

/**
 * 관절 4종. 축과 부호는 자산을 로드해 피벗의 world 변환을 계산한 뒤
 * 40° 회전 시 패널이 차체 밖으로 벌어지는지로 검증했다(§17.4 표).
 */
export const ARTICULATIONS: Articulation[] = [
  {
    key: 'doorL',
    node: 'BodyDoorLColor1',
    axis: 'z',
    openDeg: -58,
    label: '운전석 도어',
    note: '힌지 world (1.089, 0.643, 0.998) = 도어 앞모서리 · 축 = 로컬 Z(월드 up)',
  },
  {
    key: 'doorR',
    node: 'BodyDoorRColor1',
    axis: 'z',
    openDeg: 58,
    label: '동승석 도어',
    note: '힌지 world (−1.087, 0.643, 0.998) · 좌우 부호 반대(미러)',
  },
  {
    key: 'hood',
    node: 'BodyHood',
    axis: 'x',
    openDeg: 32,
    label: '프런트 후드',
    note: '힌지 world (0, 0.176, 2.379) = 전방 · 로컬 X(+) 회전 시 후드 뒤끝이 0.877 → 1.445 m 로 상승',
  },
  {
    key: 'rear',
    node: 'BodyRearPanelsColor1',
    axis: 'x',
    openDeg: -30,
    label: '리어 클램셸',
    note: '힌지 world (0, 0.423, −1.929) = 후방 하단 · 로컬 X(−) 회전 시 상단이 1.143 → 1.872 m 로 상승',
  },
];

/** 바퀴 4개의 피벗 노드 — 4개 모두 로컬 X 가 액슬이다(월드 기울기 0.000). */
export const WHEEL_NODES = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'] as const;

/** 바퀴 회전축(로컬 X). */
export const WHEEL_AXIS: 'x' = 'x';

/**
 * 가상 주행 회전량 — 시뮬레이터 시각 1초당 회전각.
 * 420°/s × 0.384 m 반지름 → 차속 약 10 km/h 상당. rate=0 이면 증가하지 않아 바퀴가 멈춘다.
 */
export const WHEEL_DEG_PER_SIM_SECOND = 420;

/** 바퀴 회전각(도) — 오직 시뮬레이터 시각의 함수다(벽시계/난수 금지). */
export function wheelSpinDeg(simTimeMs: number): number {
  return ((simTimeMs / 1000) * WHEEL_DEG_PER_SIM_SECOND) % 360;
}

/** HUD·문서에서 쓰는 자산 요약 문장(중복 표기 방지를 위해 한 곳에서 만든다). */
export const CAR_CONCEPT_SPEC_LINE =
  `정점 ${CAR_CONCEPT_SURVEY.vertices.toLocaleString('en-US')} · ` +
  `삼각형 ${CAR_CONCEPT_SURVEY.triangles.toLocaleString('en-US')} · ` +
  `메시 ${CAR_CONCEPT_SURVEY.meshes} · 재질 ${CAR_CONCEPT_SURVEY.materials} · ` +
  `길이 ${CAR_CONCEPT_SURVEY.lengthM} m`;
