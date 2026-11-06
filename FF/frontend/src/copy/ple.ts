// ISO/IEC 26580 정합 화면 문구(docs/20-architecture/20-60) — Feature 등록 단계·자동 채움·변이 프로필·카탈로그·Bill-of-Features·제품 구성기·공유 자산.
// 화면에는 업무 이름을 쓴다 — 표준 번호는 화면 머리 코드(codes)와 안내 한 줄에만.

/** 등록 진행 단계(백엔드 REGISTRATION_STAGES와 같은 순서) */
export const regSteps = {
  label: '등록 진행 단계',
  stages: ['기준 기능 고르기', '자동 채움 확인', '제출', '검토', '정의 승인'] as const,
  hint: ['Feature DB에서 대표 행', '출처를 보고 고칠 칸만', 'PROPOSED 0.1.0', 'G1~G3·안전 분류', 'Feature 승인자'] as const,
  no: (n: number) => `${n}`,
  current: '지금 단계',
  done: '끝남',
};

export const autofill = {
  // ① 이름·설명으로 찾기
  intentTitle: '이름·설명으로 찾기',
  intentLabel: '만들 기능을 한 줄로 적으세요',
  intentHint: '기능명·별칭·사내 용어(SCC 같은 약칭)·설명 단어로 대표 기준 행 후보를 추천합니다',
  intentEmpty: '두 글자 이상 적으면 후보를 보여 줍니다',
  intentNone: '맞는 후보가 없습니다 — 아래 검색으로 찾거나 Feature DB에 추가를 요청하세요',
  intentPick: (refId: string) => `${refId} 대표로 고르기`,
  intentPicked: '고름',
  score: (n: number) => `점수 ${n}`,

  // ② 자동 채움 확인
  title: '자동으로 채운 항목',
  lead: (refId: string) => `대표 기준 행 ${refId}에서 채웠습니다. 출처를 보고 필요한 칸만 고치세요 — 고친 칸은 등록 이력에 남습니다.`,
  col: { field: '항목', value: '값', source: '출처', state: '상태', actor: '누가' },
  field: {
    name: '이름',
    description: '설명',
    asil: 'ASIL',
    tags: '분류 태그',
    regulations: '규제·표준',
    domain: '도메인',
    component: '컴포넌트',
    swLayer: 'SW 계층',
    tshirt: '규모(T-shirt)',
    controlPoints: '제어점 계획',
    scope: '적용 범위',
    owner: '담당',
    variability: 'Feature 프로필',
  } as Record<string, string>,
  sourceKind: { REF: '기준 행', GLOSSARY: '사내 용어', CATALOGUE: '카탈로그', RULE: '규칙' } as Record<string, string>,
  state: { base: '기준값', edited: '수정됨', info: '참고', applied: '적용됨', candidate: '후보' },
  loading: '자동 채움을 계산하는 중',
  staticNote: '공개 데모는 받아 둔 목록으로 계산합니다',
  // 범위
  scopeTitle: '적용 범위 후보',
  scopeHint: '지역·차종 유형과 같은 컴포넌트를 쓰는 등록 범위로 고른 후보입니다. 누르면 국가·차종·트림을 채웁니다.',
  scopeApply: (s: string) => `${s} 적용`,
  scopeCurrent: '지금 범위',
  // 관련
  relatedTitle: '관련 Feature 후보',
  relatedHint: '기준 행 선행·묶음·같은 컴포넌트로 찾은 후보입니다. 관계(필요·배타)는 Topology에서 확정합니다.',
  relatedKind: { REQUIRES: '선행 필요', REQUIRED_BY: '이 기능을 선행으로 씀', EXCLUDES: '함께 못 씀', BUNDLE: '같은 묶음', SAME_COMPONENT: '같은 컴포넌트' } as Record<string, string>,
  relatedTopology: 'Topology에서 관계 등록',
  // 중복
  dupTitle: '중복·유사 확인',
  dupKind: { SAME_SCOPE: '같은 범위 같은 기능', OTHER_SCOPE: '다른 범위 같은 기능', SIMILAR_NAME: '비슷한 이름' } as Record<string, string>,
  dupNone: '같은 범위에 같은 기능·비슷한 이름이 없습니다',
};

/** 26580 Feature 프로필(변이 프로필) */
export const profile = {
  title: 'Feature 프로필 (ISO/IEC 26580)',
  lead: '제품 라인에서 이 기능의 자리와 바뀌는 방식 — 기준 행에서 제안, 고칠 수 있습니다.',
  role: '카탈로그 위치',
  roleOpt: { PRIMARY: '주요 feature', SUB: '하위 feature' } as Record<string, string>,
  parent: '상위 feature (기준 행 ID)',
  parentHint: '하위 feature면 필수 — Feature DB의 다른 행',
  type: '선택 유형',
  typeOpt: { BOOLEAN: '켬/끔', ENUM: '여럿 중 하나', SET: '여럿 동시', INTEGER: '수치' } as Record<string, string>,
  variability: '변이성',
  variabilityOpt: { OPTIONAL: '선택', ALTERNATIVE: '대안(배타)', OR: '다중 선택', MANDATORY: '모든 제품 공통' } as Record<string, string>,
  mandatoryNote: '모든 제품에 공통인 특성은 26580에서 feature로 관리하지 않습니다 — 공통 기능이면 Feature 등록이 필요한지 확인하세요',
  binding: '결합 시점',
  bindingOpt: { BUILD: '빌드', CALIBRATION: '보정', RUNTIME_FLAG: '실행 중 Flag', OTA: 'OTA' } as Record<string, string>,
  vps: '변이점',
  vpsHint: '공유 자산의 어느 부분이 선택에 따라 바뀌는가 — 제어점에서 만듭니다',
  vpKind: { FLAG: 'Flag', PARAMETER: '보정 값', SIGNAL: '신호', DTC: '고장 코드', SW_COMPONENT: 'SW 컴포넌트', POLICY: '정책' } as Record<string, string>,
  parentWhy: '하위 feature는 상위 feature 기준 행을 적으세요',
};

/** 등록 현황(/master/define)·홈 진입점 */
export const registrations = {
  title: '진행 중인 등록',
  newFeature: '새 Feature 등록',
  hint: '정의 승인 전 Feature — 등록 단계·G1~G3·승인 전에 채울 칸',
  allOpen: '출시 전 전체',
  key: (n: number) => `정의 승인 전 등록 ${n}건`,
  mine: '내 등록',
  col: { feature: 'Feature', ref: '대표 기준 행', stage: '단계', gates: 'G1·G2·G3', missing: '승인 전 채울 칸', autofill: '자동 채움' },
  autofillCount: (a: number, e: number) => `그대로 ${a} · 고침 ${e}`,
  none: '없음',
  more: (n: number) => `외 ${n}건`,
  open: '모두 보기',
};

/** 26580 하위 메뉴 */
export const pleNav = {
  label: '제품 라인 (ISO/IEC 26580)',
  catalogue: 'Feature 카탈로그',
  bof: 'Bill-of-Features',
  configurator: '제품 구성기',
  assets: '공유 자산 추적',
};

export const catalogue = {
  title: 'Feature 카탈로그',
  lead: '제품 라인 전체의 feature — 주요·하위 feature, 실현한 Feature, 기준 행 제약.',
  key: (primary: number, sub: number) => `주요 feature ${primary}개 · 하위 feature ${sub}개`,
  kpi: { domains: '도메인', primary: '주요 feature', sub: '하위 feature', realizations: '실현 Feature', constraints: '제약', vps: '변이점' },
  search: '기능 찾기',
  realizations: (n: number) => `실현 ${n}`,
  vps: (n: number) => `변이점 ${n}`,
  requires: '선행',
  excludes: '배타',
  sub: '하위',
  expandAll: '모두 펼치기',
  collapseAll: '모두 접기',
};

export const bof = {
  title: 'Bill-of-Features',
  lead: '상품마다 고른 feature와 제약 판정 — 상품 승인은 기존 구성 규칙으로 합니다.',
  key: (fail: number) => (fail ? `카탈로그·구성 위반이 있는 상품 ${fail}개` : '모든 상품이 제약을 지킵니다'),
  portfolio: '상품 × 주요 feature',
  portfolioHint: '칸 = 상품이 그 feature를 고름',
  col: { product: '상품', scope: '범위', type: '유형', result: '판정', features: 'feature', issues: '위반·경고' },
  detail: (id: string) => `${id} 선택 feature`,
  selCol: { feature: 'Feature', ref: '카탈로그 feature', role: '위치', variability: '변이성', lifecycle: 'Lifecycle' },
  issues: '위반·경고',
  issuesNone: '위반·경고가 없습니다',
  origin: { CATALOGUE: '카탈로그 제약', COMPOSITION: '구성 규칙' } as Record<string, string>,
  pick: '상품 고르기',
  check: '구성 점검',
  checkTitle: '구성 점검 (저장 없음)',
  checkHint: '범위와 확정 Baseline을 골라 카탈로그 제약·구성 규칙을 바로 판정합니다',
  checkRun: '점검',
  checkCol: { country: '국가', vehicleModel: '차종', trim: '트림', type: '유형' },
  baselines: '확정 Baseline (쉼표로 구분)',
  checkWhy: '상품 작성자·승인자만 점검할 수 있습니다',
  pass: '통과',
  fail: '위반',
  openConfigurator: '제품 구성기로',
};

export const configurator = {
  title: '제품 구성기',
  lead: '상품을 고르면 SW·제어기·Flag 켬/끔·정책 결과를 미리 봅니다(저장 없음).',
  key: (on: number, off: number) => `켜는 Flag ${on}개 · 끄는 Flag ${off}개`,
  product: '상품',
  sw: 'SW 컴포넌트',
  swCol: { sw: 'SW ID', versions: '버전', ecu: '제어기', features: 'Feature' },
  flags: 'Flag 값',
  flagCol: { flag: 'Flag 키', feature: 'Feature', value: '값', source: '근거' },
  flagSource: { POLICY: '정책', VARIATION_POINT: '변이점' } as Record<string, string>,
  on: '켬',
  off: '끔',
  policies: '정책',
  vps: '변이점 행사 결과',
  vpCol: { feature: 'Feature', vp: '변이점', asset: '자산', resolved: '결과' },
};

export const assets = {
  title: '공유 자산 추적',
  lead: '자산마다 쓰는 Feature와 상품 — 같이 쓰는 자산은 바꿀 때 영향이 넓습니다.',
  key: (shared: number) => `여러 Feature가 같이 쓰는 자산 ${shared}개`,
  kind: { SW_COMPONENT: 'SW 컴포넌트', ECU: '제어기', FLAG: 'Flag', POLICY: '정책' } as Record<string, string>,
  all: '전체',
  col: { kind: '종류', asset: '자산', features: 'Feature', products: '상품' },
  more: (n: number) => `외 ${n}`,
};

/** 홈·작업공간 진입점 */
export const homeEntry = {
  register: '새 Feature 등록',
  inProgress: (n: number) => `등록 진행 중 ${n}건`,
  registrationsTitle: '등록 진행 중',
  registrationsHint: '내가 등록한 Feature부터 — 정의 승인까지 남은 단계',
};
