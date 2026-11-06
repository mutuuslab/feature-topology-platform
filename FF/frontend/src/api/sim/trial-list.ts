// 시연 엔진 — 체험권 차량 목록(GET /api/trials)의 성향 필터·검색·다음 쪽. 서버 EntitlementService.trials와 같은 규칙의 순수 함수.
// 정적 스냅샷은 상품·출처·상태별 첫 쪽(50건)만 받아 두므로, 성향·검색어·다음 쪽은 전체 표(출처 ALL을 200건씩 받아 이은 것)에서 이 규칙으로 계산한다.
// 서버와 같은 결과인지는 backend/test/d01/sim-trial-list.spec.ts가 실제 컨트롤러와 대조한다. 엔진·화면 상태를 읽지 않는다.
import { asSourceFilter, SEGMENT_DIMENSIONS, sourceMatches, TRIAL_PAGE_SIZE, TRIAL_TABLE_PAGE, type SegmentDimension } from '@ff/contracts';

// 전체 표 질의(trialTableQuery)·쪽 크기는 @ff/contracts — tools/snapshot-api.ts가 같은 함수로 받아 둔다
export { TRIAL_TABLE_PAGE, trialTableQuery } from '@ff/contracts';

export interface TrialRow {
  grantId: string;
  vin: string;
  source: string;
  state: string;
  offeredAt?: string | null;
  validFrom: string;
  profile: Partial<Record<SegmentDimension, string>> | null;
  [k: string]: unknown;
}

/** 이 질의가 전체 표를 써야 하는가 — 성향·검색어·2쪽 이후(첫 쪽은 상태별 스냅샷이 있다) */
export const needsTrialTable = (q: Record<string, string | undefined>) => SEGMENT_DIMENSIONS.some((d) => !!q[d]) || !!q.q?.trim() || Number(q.page ?? 1) > 1;

/** 전체 표(출처 ALL) + 질의 → 서버 trials 응답과 같은 모양 */
export function trialListOf(rows: readonly TrialRow[], today: string, q: Record<string, string | undefined>) {
  const source = asSourceFilter(q.source ?? 'ALL');
  const needle = q.q?.trim().toLowerCase();
  const segment = Object.fromEntries(SEGMENT_DIMENSIONS.filter((d) => q[d]).map((d) => [d, q[d]!]));
  const scoped = rows.filter(
    (r) =>
      sourceMatches(source, r.source as never) &&
      (!needle || r.vin.toLowerCase().includes(needle) || r.grantId.toLowerCase().includes(needle)) &&
      Object.entries(segment).every(([k, v]) => r.profile?.[k as SegmentDimension] === v),
  );
  // 상태별 개수는 상태 필터 전 — 화면의 상태 선택지에 개수를 붙인다
  const byState: Record<string, number> = {};
  for (const r of scoped) byState[r.state] = (byState[r.state] ?? 0) + 1;
  const filtered = q.state ? scoped.filter((r) => r.state === q.state) : [...scoped];
  // 등록 차량(운영·시연)이 먼저, 합성 모집단은 뒤, 그다음 최근 제안 순
  const rank = (s: string) => (s === 'SYNTHETIC' ? 1 : 0);
  filtered.sort((a, b) => rank(a.source) - rank(b.source) || (b.offeredAt ?? b.validFrom).localeCompare(a.offeredAt ?? a.validFrom) || a.grantId.localeCompare(b.grantId));
  const pageSize = Math.min(Math.max(q.pageSize ? Number(q.pageSize) : TRIAL_PAGE_SIZE, 1), TRIAL_TABLE_PAGE);
  const page = Math.max(q.page ? Number(q.page) : 1, 1);
  return { today, total: filtered.length, page, pageSize, byState, items: filtered.slice((page - 1) * pageSize, page * pageSize) };
}
