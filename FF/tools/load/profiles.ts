// 부하 시험 데이터 크기(출시 준비 RD-P2-01). full은 한 고객 설치 몇 해 운영분을 가정한 크기, light는 기본 verify용 축소판.
// 예산(harness/perf-budgets.json)은 full 기준 p95이고, light는 budgetScale을 곱한 값과 비교한다. light는 기본 verify(CI 포함)에서 돌아
// 기계 잡음이 크다(바쁜 개발 PC에서 수 ms짜리 API도 p95가 수십 ms 흔들린다) — ×3으로 모든 API가 큰 데이터에서 돌고 큰 막힘이 없는지만 본다.
// 질의 계획 회귀(전체 훑기·N+1)는 시간과 무관한 backend/test/kernel/query-plans.spec.ts가 잡고, 수치 예산은 full(verify --full)이 본다.
export interface LoadProfile {
  /** Feature ID 수(버전은 시드 Feature의 버전 구성을 따라 복제 — 약 1.2배 행) */
  features: number;
  /** 차량(vehicle) 수 */
  vehicles: number;
  /** 감사 행 수(해시 체인 포함) */
  audit: number;
  /** 이벤트 행 수 */
  events: number;
  /** 알림 수(이벤트마다 하나가 아니라 일부 이벤트만) */
  notifications: number;
  /** 대기 중 전달함 행이 있는 차량 수(당겨받기 채널) */
  deliveries: number;
  /** 상태 보고 v2 행 수 */
  statusReports: number;
  /** 시나리오별 요청 수 / 동시 요청 수 */
  requests: number;
  concurrency: number;
  /** 예산 배수 — p95 예산 × budgetScale 을 넘으면 실패 */
  budgetScale: number;
}

export const PROFILES: Record<'light' | 'full', LoadProfile> = {
  light: { features: 200, vehicles: 5_000, audit: 50_000, events: 30_000, notifications: 5_000, deliveries: 500, statusReports: 5_000, requests: 40, concurrency: 4, budgetScale: 3 },
  full: { features: 2_000, vehicles: 100_000, audit: 1_000_000, events: 500_000, notifications: 100_000, deliveries: 10_000, statusReports: 200_000, requests: 200, concurrency: 8, budgetScale: 1 },
};

export type ProfileName = keyof typeof PROFILES;
