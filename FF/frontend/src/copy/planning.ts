// 담당자 웨이브 W4(2026-11-05) 문구 — 등록·구현 연결·상품 구성·고객 출시·체험 제안·정책 승인.
// 내부 코드(규칙·업무 절차·오류 코드)는 쓰지 않는다. 문장은 '…합니다/하세요'.

export const planning = {
  impl: {
    title: '구현 연결',
    lead: '기능 이름을 적고 SW는 기준정보에서 고릅니다. 제어기 P/N은 SW를 따릅니다. 검증 완료에 필요합니다.',
    fn: '기능 이름',
    sw: 'SW·Version (기준정보)',
    ecu: '제어기 P/N',
    pick: 'SW를 고르세요',
    add: '구현 행 추가',
    remove: (n: number) => `${n}번째 구현 행 빼기`,
    none: '아직 구현 연결이 없습니다 — "구현 행 추가"로 기능과 SW를 넣으세요.',
    toMaster: 'SW·Artifact 기준정보 보기',
    rowWhy: '구현 행마다 기능 이름과 SW를 모두 채우면 저장할 수 있습니다',
    loading: 'SW 기준정보를 불러오는 중',
    option: (swId: string, version: string, name: string, ecu: string) => `${swId} ${version} · ${name} (제어기 ${ecu})`,
  },
  required: {
    tag: '정의 승인 필수',
    reqHint: '요구사항 ID가 비어 있으면 G1~G3을 통과해도 정의 승인을 받을 수 없습니다. 쉼표로 여러 개 넣습니다.',
    legend: '"정의 승인 필수" 칸이 비어 있으면 정의 승인이 막힙니다.',
  },
  approval: {
    implMissingTitle: '구현 미입력 — 승인 뒤에는 새 Version으로만 입력할 수 있습니다',
    implMissing: (fields: string) => `${fields}이(가) 비어 있습니다. 정의 승인 뒤에는 이 Version을 고칠 수 없어, 검증 완료로 가려면 새 Version을 만들어 구현을 넣고 다시 정의 승인을 받아야 합니다.`,
    implMissingNext: '먼저 작성자·SW 통합 담당에게 초안의 구현 연결을 채우도록 요청하는 것이 빠릅니다. 그대로 승인할 수도 있습니다.',
    toDraft: '초안에서 구현 연결 넣기',
  },
  deadEnd: {
    title: '이 Version은 검증 완료로 갈 수 없습니다 — 구현 연결이 비어 있습니다',
    body: (fields: string) => `${fields}이(가) 비어 있습니다. 승인된 Version은 고칠 수 없으니 새 Version을 만들어 구현 연결을 넣고, 다시 정의 승인을 받아 진행하세요.`,
    cta: '새 Version 만들기',
    ctaWhy: '새 Version은 Feature 설계 담당이 가장 최신 Version에서 만듭니다',
    notLatest: '더 새 Version이 있습니다 — 가장 최신 Version에서 이어 가세요',
  },
  registered: {
    title: '등록했습니다 — 다음 할 일',
    steps: {
      requirements: '요구사항 ID 넣기 — 정의 승인 필수 칸입니다(초안 수정)',
      impl: '구현 연결 넣기 — 기능·SW·제어기. 정의 승인 전에 넣어야 새 Version 없이 검증 완료까지 갑니다(초안 수정)',
      gates: 'G1~G3 판정 받기 — 품질 검토 담당',
      approve: '정의 승인 받기 — 정의 승인 담당',
    },
    done: '완료',
  },
  policy: {
    notValidated: '먼저 분야별 검증을 실행해 배포 안전성 GO를 받아야 승인·반려할 수 있습니다',
    stale: '검증 이후 정책 내용이 바뀌었습니다 — 다시 검증해 GO를 받아야 승인·반려할 수 있습니다',
    notGo: '배포 안전성 판정이 GO가 아닙니다 — 정책을 고쳐 다시 검증하세요',
  },
  product: {
    lifecycle: { APPROVED: '구성 승인', RELEASED: '고객 출시' },
    sodCreator: '상품 작성자는 자기 상품을 승인할 수 없습니다 — 다른 상품 승인자가 승인합니다',
    sodRelease: '구성 승인을 한 사람은 고객 출시를 승인할 수 없습니다 — 다른 상품 승인자(상품 Owner)가 승인합니다',
    failConfirm: '구성 검증 FAIL인 채로 초안 등록 — 구성 승인 전에 보완합니다',
    failWhy: '구성 검증이 PASS여야 등록할 수 있습니다 — 빠진 Baseline을 더하거나 FAIL인 채 등록을 확인하세요',
    checking: '구성 검증 결과를 기다리는 중입니다',
    add: (id: string) => `${id} 추가`,
    toTrials: '이 상품으로 체험 제안',
    picked: (n: number) => `고른 Baseline ${n}개`,
  },
  trial: {
    product: '체험 상품',
    other: (id: string) => `${id} (출시 전)`,
    vehicleLabel: (vin: string, label: string) => `${vin} · ${label}`,
    scope: (scope: string, n: number) => `상품 범위 ${scope}의 차량 ${n}대 — 시뮬레이터·통계 표본 차량은 고객 체험에서 뺍니다`,
    none: (scope: string) => `상품 범위 ${scope}와 같은 고객 차량이 없습니다 — 범위 밖 차량을 펼치거나 다른 상품을 고르세요`,
    wide: (n: number) => `범위 밖 차량도 보기 (${n}대) — 켤 수 없는 차량은 제안하지 않고 건너뜁니다`,
    outTag: '범위 밖',
  },
  master: {
    linkHint: '구현 연결은 제안 상태 Feature의 "초안 수정 → 구현 연결"에서 이 목록의 SW·Version을 골라 넣습니다. 승인된 Version은 새 Version에서 넣습니다.',
    toProposed: '제안 상태 Feature 보기',
  },
};
