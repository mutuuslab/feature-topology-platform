// ADS 상태 화면 문구 — 6축(차량 화면)·판정·고객에게 보이는 상태·배포 상세 수렴·Fleet 축별 분포·주문 추적(설계 harness/ads/ux.json ADS-UI01·UI06·ORC-UI01·UI03).
// 상태 용어는 copy/ads.ts(바꾸지 않고 쓰기만), 이 파일은 화면 낱말·핵심 메시지 문장만. '모름'은 판단 불가·미확인 두 낱말만.

export const vehicleTabs = {
  state: '상태(6축)',
  verdicts: '판정',
  customer: '고객에게 보이는 상태',
  records: '정책 게시본·수신 기록',
  requests: '차량 발신 요청',
} as const;

/** 차량 화면 '상태(6축)' 탭 */
export const axesTab = {
  key: {
    unconfirmed: (n: number, rel: string) => `현재 상태 미확인 기능 ${n}개 — 마지막 차량 보고 ${rel}`,
    noReport: '보고 이력 없음',
    clean: (n: number) => `기능 ${n}개 모두 기준 시간 안 차량 보고`,
    loading: '차량 보고를 읽는 중',
  },
  lead: '정책 의도와 차량이 보고한 실제 상태를 축별로 나눠 봅니다.',
  caption: (name: string) => `${name} — 6축 상태`,
  empty: { title: '이 차량에 배포·권한이 있는 Feature가 없습니다', body: '권한이나 배포가 생기면 축별 상태가 보입니다.' },
  error: '상태를 불러오지 못했습니다 — 지난 값을 현재처럼 보이지 않도록 표를 비웁니다.',
  noPublication: '이 차량 대상 게시본 없음',
  otaNotLinked: 'OTA 연동 전',
  unconfirmedAt: (rel: string) => `마지막 보고 ${rel}`,
  basisAssumed: '기준 시간은 가정값',
  orderLink: '주문 추적',
  history: '차량 보고 이력 열기',
  simulated: '가상 데이터',
  ddtOwner: (o: string) => `제어 책임 ${o}`,
  lastStage: (stage: string, reason: string, rel: string) => `마지막 보고: ${stage}${reason ? ` · ${reason}` : ''} · ${rel}`,
} as const;

/** 차량 화면 '판정' 탭 */
export const verdictsTab = {
  key: {
    verdict: (action: string, verdict: string, reason: string, rel: string) => `${action} ${verdict}${reason ? ` — ${reason}` : ''}, 차량 보고 ${rel}`,
    stale: (action: string, rel: string) => `${action} 판정 미확인 — 마지막 보고 ${rel}`,
    none: '이 차량이 보고한 판정이 없습니다',
    unreported: (n: number) => `판정 미확인 기능 ${n}개 — 차량 판정 보고 이력 없음`,
  },
  allActions: '모든 행위',
  unreportedReason: '판정 보고 이력 없음',
  lead: '차량이 행위마다 보고한 판정과 사유를 봅니다.',
  head: '차량이 보고한 판정 — 플랫폼 허가가 아닙니다',
  example: '예시 판정 — 차량 연결 전',
  caption: (name: string) => `${name} — 행위별 판정`,
  col: { action: '행위', verdict: '판정', observed: '마지막 관측', source: '출처' },
  combo: '상태 조합',
  empty: { title: '이 차량이 보고한 판정이 없습니다', body: '판정은 차량이 행위를 시도하거나 주기 보고할 때 생깁니다.' },
  error: '판정을 불러오지 못했습니다 — 지난 판정을 현재처럼 보이지 않습니다.',
  history: '판정 이력 열기',
} as const;

/** 차량 화면 '고객에게 보이는 상태' 탭(고객 앱 화면이 아닌 미리보기) */
export const customerTab = {
  key: (line: string) => `고객 화면: ${line}`,
  lead: '고객 앱이 받을 상태를 미리 봅니다 — 고객 앱 화면이 아닙니다.',
  preview: '미리보기',
  q: { canUse: '쓸 수 있나', when: '언제 쓸 수 있나', price: '얼마·무엇을 얻나', support: '문제 생기면 누가 해결하나' },
  basis: '근거',
  lastConfirmed: '마지막 확인',
  changes: (n: number) => `지난 확인 이후 바뀐 점 ${n}개`,
  noChanges: '지난 확인 이후 바뀐 점 없음',
  laterNone: '국가 이동·소유권 이전: 해당 정보 없음',
  operatorOnly: '운영자만 보임',
  op: {
    renewal: '갱신·해지',
    renewalNone: '해당 정보 없음 · 갱신·해지 연동 전',
    market: '국가 이동',
    marketNone: '해당 정보 없음 · 국가 이동 연동 전',
    ownership: '소유권 이전',
    ownershipNone: '해당 정보 없음 · 소유권 이전 연동 전',
    install: '설치 기록',
    installNone: '설치 상태 연동 전',
    kill: '원격 종료 근거',
    raw: '고객 상태 원문(API 응답) 보기',
  },
  empty: { title: '고객에게 보일 기능이 없습니다', body: '권한이나 배포가 생기면 고객 상태가 보입니다.' },
} as const;

/** 배포 상세 — 수렴 7구간 */
export const convergence = {
  unknown: '차량 적용 상태를 확인하지 못했습니다 — 다시 시도해 주세요',
  key: (n: number, total: number) => `적용 확인 안 된 차량 ${n}대 — 대상 ${total}대 중`,
  keyAll: (total: number) => `대상 ${total}대 모두 적용 확인`,
  lead: '게시본이 차량에 닿고 적용됐는지 단계별로 나눠 셉니다.',
  killTitle: (name: string) => `긴급 차단 게시본 · ${name}`,
  panel: '차량별 적용 단계',
  caption: '차량별 적용 단계(배타, 합 = 대상 차량)',
  bins: { APPLIED: '적용 확인', ACCEPTED: '수락(실행 대기)', DEFERRED: '전달 보류', RECEIVED_ONLY: '수신만 됨', NOT_RECEIVED: '미수신', REJECTED: '로컬 거부', UNCONFIRMED: '미확인' } as Record<string, string>,
  cumulative: (received: number, accepted: number) => `누적: 수신 ${received} · 수락 ${accepted}`,
  filter: '구간 거르기',
  all: '전체',
  vehicles: '구간별 차량',
  col: { vehicle: '차량', bin: '구간', last: '마지막 보고', reason: '사유' },
  basis: (min: number) => `수신 뒤 기준 시간 ${min}분 안 결과 보고가 없으면 미확인`,
  stage: { RECEIVED: '수신', ACCEPTED: '수락', DEFERRED: '전달 보류', APPLIED: '적용', REJECTED: '거부' } as Record<string, string>,
  empty: '대상 차량 0대 — 회신을 셀 대상이 없습니다',
} as const;

/** Fleet 실시간 — Feature 선택 + 축별 분포, 기존 행렬은 '정책 값 대조' 탭 */
export const fleetAxes = {
  tabs: { axes: '6축 분포', match: '정책 값 대조' },
  key: (n: number, name: string, min: number) => `실제 상태 미확인 차량 ${n}대 — ${name}, 기준 ${min}분 넘음`,
  keyNone: '축별 상태를 볼 Feature가 없습니다',
  lead: 'Feature를 고르면 차량들의 축별 상태 분포를 봅니다.',
  pick: 'Feature 선택',
  axisCaption: (axis: string, total: number) => `${axis} — 차량 ${total}대`,
  reasons: '활성화 판정 사유 분포(차량 보고)',
  reasonCaption: (total: number) => `활성화 판정 사유 — 차량 ${total}대(배타)`,
  allow: '허용',
  none: '없음',
  noPublication: '게시본 없음',
  ads: 'ADS',
} as const;

/** 주문 추적('/entitlements' 탭) */
export const orders = {
  tab: '주문 추적',
  key: (n: number, hours: number) => `기한 넘긴 사용 준비 미확인 주문 ${n}건 — 결제 후 ${hours}시간(가정값) 기준`,
  lead: '주문부터 차량의 사용 준비 확인까지 단계와 경과 시간을 봅니다.',
  caption: '주문 구간(배타, 합 = 주문 수)',
  bins: { READY: '사용 준비 확인', UNCONFIRMED: '미확인', OFFLINE: '오프라인', PARTIAL: '부분 실패', CANCELLED: '취소', REFUNDED: '환불' } as Record<string, string>,
  summary: {
    overdue: '기한 넘김',
    eq: (n: number) => `${n} =`,
    parts: (u: number, o: number, p: number) => `미확인 ${u} · 오프라인 ${o} · 부분 실패 ${p}`,
    ready: (r: number, total: number) => `${r}건 / 주문 ${total}건`,
    rateLater: '확인율은 지표 계약 뒤 표시',
  },
  stages: { ORDER: '주문', ENTITLEMENT: '권리', POLICY: '정책 적용', READY: '사용 준비 확인', USAGE: '실사용 확인(선택)' } as Record<string, string>,
  stageHint: { POLICY: '차량 적용 회신', READY: '차량 준비 보고' } as Record<string, string>,
  stageState: { CONFIRMED: '확인', FAILED: '실패 보고', UNCONFIRMED: '미확인' } as Record<string, string>,
  overdue: (h: number) => `기한 초과 ${h}시간`,
  elapsed: (rel: string) => `경과 ${rel}`,
  justPaid: '주문 성공 · 활성 미확인',
  preOrder: '주문 전 보고 — 준비로 세지 않음',
  col: { order: '주문', vehicle: '차량', product: '상품', stages: '단계', bin: '구간', refund: '환불 경과' },
  refund: (h: number) => `요청 → 완료 ${h}시간`,
  refundOpen: '환불 진행 중',
  filter: '구간 거르기',
  all: '전체',
  action: '기한 초과 주문 처리(재전송·환불 검토)',
  blocked: '결제 연동이 모의 단계라 실제 환불은 실행하지 않습니다 — 처리 기록만 남깁니다.',
  timeline: (id: string) => `${id} 단계 기록`,
  event: { PAID: '주문(결제)', ENTITLEMENT: '권리', POLICY: '정책 전달', READY_REPORT: '차량 준비 보고', USAGE: '실사용 확인', REFUND_REQUESTED: '환불 요청', REFUND_COMPLETED: '환불 완료' } as Record<string, string>,
  policyStage: { RECEIVED: '수신 — 적용 회신 아님', ACCEPTED: '수락 — 적용 회신 아님', DEFERRED: '전달 보류', APPLIED: '적용', REJECTED: '거부' } as Record<string, string>,
  readyOk: { OK: '준비됨', NOT_READY: '준비 안 됨' } as Record<string, string>,
  empty: { title: '추적할 주문이 없습니다', body: '결제 연동 이벤트가 들어오면 주문별 단계가 보입니다.' },
  error: '주문 추적을 불러오지 못했습니다',
  noPerm: '환불·재전송 기록은 운영자 역할이 할 수 있습니다.',
  open: '단계 기록 열기',
} as const;

/** 축 값 표기 보조 */
export const axisWords = {
  delivery: { PUBLISHED: '발행' } as Record<string, string>,
} as const;

export const adsState = { vehicleTabs, axesTab, verdictsTab, customerTab, convergence, fleetAxes, orders, axisWords } as const;
