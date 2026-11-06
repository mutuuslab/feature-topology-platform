// 검토함 Data Lake·Closed loop 대기열 내용 문구(TL-UI13) — 검토함 화면만 읽는다(첫 화면 묶음의 copy/inbox에 두지 않는다).
export const inboxLake = {
  model: (title: string, ver: string, n: number) => `${title} ${ver} · 승인 ${n}/2`,
  modelTitle: { ANOMALY: '이상 탐지 ②', DEPLOY_RISK: '배포 위험 ③', TRIAL_PROPENSITY: '체험 전환 ④', CANARY_RULE: '배포 신호 검정 ①' } as Record<string, string>,
  already: '이미 이 판에 결정을 남겼습니다(2인 승인)',
  finding: (name: string, ver: string, axis: string, overdue: boolean) => `${name} ${ver} · ${axis} 축${overdue ? ' · 기한 지남' : ''}`,
  axis: { OPERATION: '동작', PROBLEM: '문제', IMPROVEMENT: '개선', RISK: '위험' } as Record<string, string>,
  canary: { HOLD_STALE: '지표 지연 — 확대 보류', ABORT: '중단 기준 초과 — 확대 중단' } as Record<string, string>,
};
