// 오류 안내 문구(출시 준비 RD-UX-01) — api/client.ts·api/errors.ts·design ErrorNote·AsyncView.
// 원칙: 무엇이 일어났는지 + 사용자가 할 다음 행동. 포트·서버 프로그램 이름·내부 코드 설명은 쓰지 않는다.
export const errors = {
  // 요청 자체가 닿지 않았다
  network: '서버에 연결할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.',
  offline: '인터넷 연결이 끊겼습니다. 연결되면 다시 시도하세요. 입력한 내용은 이 화면에 그대로 있습니다.',
  // 401 — 로그인 세션이 끝났다
  authTitle: '다시 로그인해야 합니다',
  auth: '로그인 세션이 끝났습니다. 다시 로그인하면 지금 화면으로 돌아옵니다 — 저장하지 않은 입력은 먼저 복사해 두세요.',
  relogin: '다시 로그인',
  // 409·412 — 다른 사람이 먼저 바꿨다
  conflictTitle: '다른 사람이 먼저 바꿨습니다',
  conflictHint: '최신 내용을 다시 불러온 뒤 확인하고 다시 저장하세요. 입력한 내용은 그대로 둡니다.',
  conflictFallback: '다른 사용자가 먼저 이 항목을 바꿨습니다.',
  reload: '최신 내용 다시 불러오기',
  reloaded: '최신 내용을 불러왔습니다. 입력한 내용을 확인한 뒤 다시 저장하세요.',
  // 400 VALIDATION·422 — 입력·조건 확인
  validationTitle: '입력한 내용을 확인하세요',
  validationHint: '표시된 칸을 고친 뒤 다시 저장하세요.',
  validationFallback: '입력한 내용이 조건에 맞지 않습니다.',
  // 429 — 요청이 너무 잦다
  rateLimitTitle: '요청이 너무 잦습니다',
  rateLimit: (sec: number | null) => (sec ? `요청이 너무 잦습니다. ${sec}초 뒤에 다시 시도하세요.` : '요청이 너무 잦습니다. 잠시 뒤에 다시 시도하세요.'),
  // 5xx — 서버 쪽 문제
  serverTitle: '서버에서 처리하지 못했습니다',
  server: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도하고, 반복되면 아래 문의 번호를 지원 담당자에게 알려 주세요.',
  correlation: '문의 번호',
  copyCorrelation: '문의 번호 복사',
  // 기타
  notFound: '찾는 항목이 없습니다. 이미 지워졌거나 주소가 바뀌었을 수 있습니다.',
  failed: (status: number) => `요청을 처리하지 못했습니다 (${status}). 잠시 후 다시 시도하세요.`,
  unknownApi: (name: string) => `알 수 없는 요청입니다: ${name}`,
  // 정적 데모(백엔드 없음)
  readOnlyDemo: '읽기 전용 데모입니다. 변경은 실제 설치 환경에서만 할 수 있습니다.',
  notInSnapshot: '데모에 포함되지 않은 데이터입니다.',
  // 세션 만료 띠(셸)
  sessionBanner: '로그인 세션이 끝났습니다. 입력한 내용은 이 화면에 남아 있습니다 — 복사해 둔 뒤 다시 로그인하세요.',
};
