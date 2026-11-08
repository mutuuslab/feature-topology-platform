// 부하 시험 집계 — 백분위(최근접 순위)·예산 판정. run.ts와 시험(stats.test.ts)이 같이 쓴다.

/** 최근접 순위 백분위 — 정렬된 표본의 ceil(p/100·n)번째(1부터). 빈 표본은 0 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** 초당 처리 요청 수(벽시계 구간 기준) */
  rps: number;
}

export function summarize(latenciesMs: number[], wallMs: number): Summary {
  const s = [...latenciesMs].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { n: s.length, p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), p99: r(percentile(s, 99)), max: r(s.at(-1) ?? 0), rps: wallMs > 0 ? r((s.length * 1000) / wallMs) : 0 };
}

export interface BudgetFile {
  note?: string;
  /** 시나리오 id → full 데이터 기준 p95 예산(ms) */
  p95Ms: Record<string, number>;
  /** 이벤트 루프 한 번 막힘 최대(ms, full 기준) — 시나리오마다 */
  loopBlockMs?: Record<string, number>;
  /** 고치기 전 p95(ms, full) — 예산이 이 값보다 작아야 한다(넉넉한 예산이 고친 회귀를 덮지 않게, stats.test.ts) */
  beforeFixP95?: Record<string, number>;
  /** 부팅(마이그레이션·시드 확인·감사 체인 채우기)부터 /api/health까지(ms, full 기준) */
  bootMs?: number;
}

export interface Verdict {
  id: string;
  p95: number;
  budget: number | null;
  ok: boolean;
}

/** 예산 판정 — 예산이 없는 시나리오는 실패(예산 없는 측정을 남기지 않는다), scale은 profile 배수 */
export function judge(results: { id: string; summary: Summary }[], budgets: BudgetFile, scale: number): Verdict[] {
  return results.map(({ id, summary }) => {
    const b = budgets.p95Ms[id];
    if (b === undefined) return { id, p95: summary.p95, budget: null, ok: false };
    const limit = Math.round(b * scale * 10) / 10;
    return { id, p95: summary.p95, budget: limit, ok: summary.p95 <= limit };
  });
}
