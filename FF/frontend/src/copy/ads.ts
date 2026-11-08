import { localizedCopy } from '../locale/runtime';
// ADS·UNECE·Orca 화면 문구 — 상태 용어(ADS-UI13)는 이 파일 한 곳에서만 정한다. 화면은 import { ads } from '../../copy/ads'.
// '모름'은 두 낱말만(판단 불가·미확인), 검토 전은 미판정, 어긋남은 구성 불일치. '차단'·'보류'는 단독으로 쓰지 않는다.

/** 상태 용어집 — stateModel(harness/ads/design.json)과 같은 글자 */
export const terms = /* @__PURE__ */ localizedCopy('ads.terms', {
  policyOn: '정책 ON(의도)',
  available: 'Available',
  active: 'Active',
  remoteTermination: '원격 종료 요청',
  emergencyKill: '긴급 차단',
  received: '수신',
  accepted: '수락',
  deferred: '전달 보류',
  applied: '적용',
  inTransition: '전환 중',
  mrc: 'MRC',
  terminationConfirmed: '종료 확인(차량 보고)',
  inactive: '비활성(Inactive)',
  recoveryPending: '복구 검증 대기',
  terminationInhibit: '종료 차단',
  inhibitRelease: '종료 차단 해제',
  terminationCase: '종료 사건',
  adsIncident: 'ADS 사건',
  serviceCase: '지원 건',
  expansionHold: '확대 보류',
  installHold: '설치 보류',
  qualityHold: '품질 보류',
  exposureHold: '노출 보류',
  readyConfirmed: '사용 준비 확인',
  usageConfirmed: '실사용 확인',
  undecidable: '판단 불가',
  unconfirmed: '미확인',
  unjudged: '미판정',
  configMismatch: '구성 불일치',
  assumed: '가정값',
  vehicleReported: '차량 보고',
} as const);

/** 6축 — 축 이름·값·판단 주체 */
export const axes = /* @__PURE__ */ localizedCopy('ads.axes', {
  ENTITLEMENT: { name: '상품 권리', owner: '플랫폼', values: { NONE: '없음', TRIAL: '체험', PURCHASED: '구매', EXPIRED: '만료', TRANSFER_REVIEW: '이전 심사', NOT_LINKED: '해당 없음 · 연동 전' } },
  INSTALL: { name: '구성과 설치', owner: 'OTA·플랫폼', values: { NOT_INSTALLED: '미설치', INSTALLING: '설치 중', COMPATIBLE: '호환', PARTIAL_FAILURE: '부분 실패', RECOVERY_NEEDED: '복구 필요', NOT_LINKED: '미확인 · OTA 연동 전' } },
  DELIVERY: { name: '정책 의도·전달', owner: '플랫폼·CCS', values: { APPROVED: '승인', PUBLISHED: '발행', RECEIVED: '수신', ACCEPTED: '수락', DEFERRED: '전달 보류', APPLIED: '적용', REJECTED: '거부' } },
  ELIGIBILITY: { name: '활성 적격', owner: '차량', values: { ALLOW: '허용', ODD_OUT: 'ODD 밖', FORBIDDEN: '금지', CONDITION_MISSING: '조건 부족', UNKNOWN: '판단 불가' } },
  RUNTIME: { name: '실제 실행', owner: '차량', values: { INACTIVE: '비활성(Inactive)', AVAILABLE: 'Available', ACTIVE: 'Active', IN_TRANSITION: '전환 중', MRC: 'MRC', TERMINATED: '종료 확인(차량 보고)', RECOVERY_PENDING: '복구 검증 대기' } },
  FRESHNESS: { name: '관측 신선도', owner: '플랫폼', values: { FRESH: '최신 확인', DELAYED: '지연', OFFLINE: '오프라인', UNOBSERVED: '미확인' } },
} as const);

/** 공용 부품 문구 */
export const ui = /* @__PURE__ */ localizedCopy('ads.ui', {
  unknown: { UNDECIDABLE: '판단 불가', UNCONFIRMED: '미확인' },
  freshness: {
    FRESH: '최신 확인',
    DELAYED: '지연',
    OFFLINE: '오프라인',
    UNOBSERVED: '미확인',
    basis: (min: number) => `기준 ${min}분`,
    never: '보고 이력 없음',
    ago: (rel: string) => `마지막 보고 ${rel}`,
    gap: (hours: number, at: string) => `미확인 기간 ${hours}시간 · ${at} 재연결`,
  },
  stage: { sum: (n: number) => `합 ${n}`, mismatch: '구간 합이 분모와 다릅니다' },
  vehicleReported: '차량 보고',
  scrollTable: (caption: string) => `${caption} 표 — 가로 스크롤`,
  owner: '판단 주체',
  axis: '축',
  value: '현재 값',
  observed: '마지막 관측',
  thenReported: (v: string) => `그때 보고: ${v}`,
  blocked: '할 수 없는 이유',
  simulated: '개념 시연 — 가상 데이터',
  assumed: '가정값',
  operatorOnly: '운영자만 보임',
  digest: '서명 대상 digest',
  copy: '복사',
  timeline: { vehicleAt: '차량 시각', serverAt: '서버 수신 시각', stage: '단계', owner: '제어 책임', note: '근거', noOwner: '제어 책임 없음' },
  changeKind: { POLICY: '정책', CONFIG: '설정', SW: 'SW', MODEL: '모델', ODD: 'ODD', UNKNOWN: '변경 종류 판단 불가' },
  bulk: {
    title: '일괄 명령 미리보기',
    targets: '대상',
    excluded: '제외',
    undecidable: (n: number) => `대상 판단 불가 ${n}대`,
    excludeUnknown: '판단 불가 차량을 제외하고 진행',
    scope: '해제 범위',
    risk: '위험',
    digest: '서명 대상 digest',
    serverDiff: '서버가 다시 센 대상이 미리보기와 다릅니다',
    sameAsServer: '서버 재계산과 같습니다',
    awaitServer: '서버 재계산은 서명 직전에 합니다',
    noDigest: '서명 대상 digest는 서버 대상 검증 뒤 표시',
    unit: (n: number) => `${n.toLocaleString('ko-KR')}대`,
  },
} as const);

export const ads = { terms, axes, ui } as const;
