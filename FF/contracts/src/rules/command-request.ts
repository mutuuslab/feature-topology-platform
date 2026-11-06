// 명령 요청 종류의 화면 말 — 게이트·시장 판정 문장에 영문 값(deactivate)이 그대로 나오지 않게(차단 시연 검토, 2026-11-06)
export const COMMAND_REQUEST_KO: Record<string, string> = { activate: '활성화', deactivate: '차단(비활성화)', restore: '복원' };
export const requestKo = (req: string) => COMMAND_REQUEST_KO[req] ?? req;
