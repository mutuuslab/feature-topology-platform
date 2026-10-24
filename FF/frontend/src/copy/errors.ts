// 오류 안내 문구(출시 준비 RD-UX-01) — 무엇이 일어났는지 + 다음 행동. 포트·서버 프로그램 이름은 쓰지 않는다.
// 첫 화면 묶음(예산 310 KiB)에 들어가므로 짧게 — 다음 행동 문구는 copy/error-actions.ts(필요할 때만 읽음).
export const errors = {
  network: '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.',
  authTitle: '다시 로그인해야 합니다',
  auth: '로그인 세션이 끝났습니다. 다시 로그인하세요.',
  conflictTitle: '다른 사람이 먼저 바꿨습니다',
  conflictFallback: '다른 사용자가 먼저 바꿨습니다.',
  validationTitle: '입력을 확인하세요',
  validationFallback: '입력이 조건에 맞지 않습니다.',
  rateLimitTitle: '요청이 너무 잦습니다',
  rateLimit: (sec: number | null) => `요청이 너무 잦습니다. ${sec ? `${sec}초` : '잠시'} 뒤에 다시 시도하세요.`,
  serverTitle: '서버에서 처리하지 못했습니다',
  server: '잠시 후 다시 시도하세요. 반복되면 문의 번호로 문의하세요.',
  notFound: '찾는 항목이 없습니다.',
  failed: (status: number) => `요청을 처리하지 못했습니다(${status}).`,
  unknownApi: (name: string) => `알 수 없는 요청: ${name}`,
  readOnlyDemo: '읽기 전용 데모입니다.',
  notInSnapshot: '데모에 없는 데이터입니다.',
};
