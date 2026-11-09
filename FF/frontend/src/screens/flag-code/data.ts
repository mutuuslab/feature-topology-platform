// Flag 코드 연결 화면 공용 조회(20-97 §4.2) — 정적 설치 스냅샷과 맞추기 위해 질의 조합을 최소로 두고(전체 대사·전체 목록),
// 상태·패키지·저장소 필터는 화면에서 건다. 목록 응답은 배열 또는 { items } 모두 받는다.
import type {
  FlagCoverageDetail,
  FlagCoverageResponse,
  FlagCoverageRow,
  FlagCoverageStatus,
  FlagEvaluationSeries,
  FlagEvaluationStat,
  FlagGateWaiver,
  FlagPullRequest,
  FlagReleaseGate,
  FlagRepository,
  FlagScanRun,
  FlagUnresolvedCall,
} from '@ff/contracts';
import { useApi } from '../../api/hooks';

/** 배열 또는 { items } — 백엔드 목록 관례가 경로마다 달라도 같은 모양으로 */
export function listOf<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[];
  const o = d as { items?: unknown; rows?: unknown } | null | undefined;
  if (o && Array.isArray(o.items)) return o.items as T[];
  if (o && Array.isArray(o.rows)) return o.rows as T[];
  return [];
}

/** 대사 응답인지 — 다른 모양(시험의 공용 응답 등)이면 화면이 깨지지 않게 null */
export function coverageOf(d: unknown): FlagCoverageResponse | null {
  const o = d as FlagCoverageResponse | null;
  return o && Array.isArray(o.rows) && o.summary && typeof o.summary.codeRequired === 'number' ? o : null;
}

const isRow = (x: unknown): x is FlagCoverageRow => !!x && typeof (x as FlagCoverageRow).flagKey === 'string' && typeof (x as FlagCoverageRow).status === 'string' && !!(x as FlagCoverageRow).lanes;

/** Flag 상세(계약 FlagCoverageDetail) — 대사 행에 서명 스캔 이력·PR·해제가 붙는다. 대사 행만 와도 그린다 */
export interface FlagDetailView {
  row: FlagCoverageRow;
  history: FlagCoverageDetail['history'];
  pullRequests: FlagPullRequest[];
  waivers: FlagGateWaiver[];
}
export function detailOf(d: unknown): FlagDetailView | null {
  const o = d as Record<string, unknown> | null;
  if (!o) return null;
  const row = isRow(o) ? o : isRow(o.row) ? o.row : isRow(o.coverage) ? o.coverage : null;
  if (!row) return null;
  return { row, history: listOf<FlagCoverageDetail['history'][number]>(o.history), pullRequests: listOf<FlagPullRequest>(o.pullRequests), waivers: listOf<FlagGateWaiver>(o.waivers) };
}

export const gateOf = (d: unknown): FlagReleaseGate | null => (d && typeof (d as FlagReleaseGate).pass === 'boolean' && Array.isArray((d as FlagReleaseGate).blockers) ? (d as FlagReleaseGate) : null);

export const seriesOf = (d: unknown): FlagEvaluationSeries | null => (d && Array.isArray((d as FlagEvaluationSeries).buckets) ? (d as FlagEvaluationSeries) : null);

/** 스캔 상세(계약 FlagScanDetail) — 실행 기록·서명 검증 결과·동적 키 위치(manifest) */
export function scanDetailOf(d: unknown): { run: FlagScanRun | null; unresolved: FlagUnresolvedCall[]; verified: boolean | null; provenance: string | null; local: boolean; sourceFiles: { path: string; content: string; sha256: string }[] } {
  const o = (d ?? {}) as Record<string, any>;
  const run: FlagScanRun | null = o.scan && typeof o.scan.scanId === 'string' ? o.scan : typeof o.scanId === 'string' ? (o as FlagScanRun) : o.run && typeof o.run.scanId === 'string' ? o.run : null;
  const unresolved = listOf<FlagUnresolvedCall>(o.manifest?.unresolved ?? o.unresolved ?? o.result?.manifest?.unresolved);
  return { run, unresolved, verified: typeof o.verified === 'boolean' ? o.verified : null, provenance: typeof o.provenance === 'string' ? o.provenance : null, local: o.simulationSource === 'LOCAL_SIMULATION', sourceFiles: Array.isArray(o.sourceFiles) ? o.sourceFiles : [] };
}

// ── 조회 훅 — 쿼리 키·정적 스냅샷 파일은 이 질의 그대로다 ─────────────
export const useCoverage = () => useApi<unknown>('flagCoverage');
/** Feature Version 탭 — 그 Version의 Lifecycle·해제로 판정한 행(출시 관문과 같은 판정). 정적 설치는 같은 키 순서로 Version마다 저장한다 */
export const useVersionCoverage = (featureId: string, version: string) => useApi<unknown>('flagCoverage', { query: { featureId, version } });
export const useCoverageDetail = (flagKey: string) => useApi<unknown>('flagCoverageDetail', { params: { flagKey } }, { enabled: !!flagKey });
export const useRepositories = () => useApi<unknown>('flagRepositories');
export const useScans = () => useApi<unknown>('flagScans');
export const usePullRequests = () => useApi<unknown>('flagPullRequests');
export const useWaivers = () => useApi<unknown>('flagGateWaivers');
export const useEvaluations = (window: string) => useApi<unknown>('flagEvaluations', { query: { window } });
/** 시계열은 24h·7d만(1h 창은 24h로) — 정적 설치 스냅샷과 같은 두 조합 */
export const useSeries = (flagKey: string | null, window: '24h' | '7d' = '24h') => useApi<unknown>('flagEvaluationSeries', { params: { flagKey: flagKey ?? '' }, query: { window } }, { enabled: !!flagKey });
export const useReleaseGate = (id: string, ver: string) => useApi<unknown>('flagReleaseGate', { params: { id, ver } });

/** 쓰기 뒤 다시 읽을 조회 */
export const FLAG_CODE_INVALIDATE = ['flagCoverage', 'flagCoverageDetail', 'flagReleaseGate', 'flagScans', 'flagScanDetail', 'flagRepositories', 'flagPullRequests', 'flagGateWaivers', 'featureFlags', 'audit', 'events'];

// ── 화면 계산 ───────────────────────────────────────────
export const SEVERITY_RANK = { BLOCKER: 0, WARNING: 1, INFO: 2, OK: 3 } as const;
/** 대사판 열 순서 — 정상을 뺀 상태 */
export const BOARD_STATUSES: FlagCoverageStatus[] = ['NO_CODE', 'CALL_DELETED', 'UNREGISTERED_KEY', 'DYNAMIC_KEY', 'UNLEASH_MISMATCH', 'REMOVAL_DUE', 'STALE', 'PR_OPEN'];

export const repoName = (repos: FlagRepository[], repoId: string) => repos.find((r) => r.repoId === repoId)?.displayName ?? repoId;
/** 긴 소스 경로 → 마지막 두 마디(…/feat-00022/flag-guards.ts) — 전체 경로는 title로 */
export const shortPath = (path: string) => {
  const parts = path.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
};
export const shortCommit = (c: string | null | undefined) => (c ? c.slice(0, 8) : '—');

/** 저장소 주소 + 커밋 → 커밋 링크(GitHub·GitLab 같은 꼴) */
export function commitUrl(repository: string | undefined, commit: string | null | undefined): string | null {
  if (!repository || !commit) return null;
  return repository.includes('gitlab') ? `${repository}/-/commit/${commit}` : `${repository}/commit/${commit}`;
}

/** 대사 행의 주 어긋남 — 주 상태와 같은 것 */
export const primaryFinding = (r: FlagCoverageRow) => r.findings.find((f) => f.status === r.status) ?? r.findings[0] ?? null;

/** 행이 쓰는 저장소 — 사용처, 없으면 같은 패키지를 연결한 저장소 */
export function reposForRow(r: FlagCoverageRow, repos: FlagRepository[]): FlagRepository[] {
  const used = new Set(r.code.usages.map((u) => u.repoId));
  const byUse = repos.filter((x) => used.has(x.repoId));
  if (byUse.length) return byUse;
  return repos.filter((x) => !r.package || x.packages.some((p) => p.name === r.package));
}

const DAY = 86_400_000;
/** 기준 시각에서 지난 날 수(내림) — 음수면 남은 날 */
export const daysSince = (iso: string | null | undefined, now = Date.now()) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);

/** 평가 행(원천별) → Flag별 합계 */
export interface FlagEvalTotal {
  flagKey: string;
  evaluations: number;
  enabled: number;
  disabled: number;
  variants: { name: string; count: number }[];
  fallbacks: { reason: string; count: number }[];
  fallbackTotal: number;
  errors: number;
  vehicles: number;
  lastEvaluatedAt: string | null;
  sources: string[];
}
export function totalsByFlag(stats: FlagEvaluationStat[]): FlagEvalTotal[] {
  const by = new Map<string, FlagEvalTotal>();
  for (const s of stats) {
    const t = by.get(s.flagKey) ?? { flagKey: s.flagKey, evaluations: 0, enabled: 0, disabled: 0, variants: [], fallbacks: [], fallbackTotal: 0, errors: 0, vehicles: 0, lastEvaluatedAt: null, sources: [] };
    t.evaluations += s.evaluations;
    t.enabled += s.enabled;
    t.disabled += s.disabled;
    t.errors += s.errors;
    t.vehicles = Math.max(t.vehicles, s.vehicles);
    t.sources.push(s.source);
    for (const v of s.variants) {
      const hit = t.variants.find((x) => x.name === v.name);
      if (hit) hit.count += v.count;
      else t.variants.push({ ...v });
    }
    for (const f of s.fallbacks) {
      const hit = t.fallbacks.find((x) => x.reason === f.reason);
      if (hit) hit.count += f.count;
      else t.fallbacks.push({ ...f });
      t.fallbackTotal += f.count;
    }
    if (s.lastEvaluatedAt && (!t.lastEvaluatedAt || s.lastEvaluatedAt > t.lastEvaluatedAt)) t.lastEvaluatedAt = s.lastEvaluatedAt;
    by.set(s.flagKey, t);
  }
  return [...by.values()];
}

/** 폴백 급증 — 서명 오류가 있거나 폴백이 평가의 1%를 넘는다 */
export const FALLBACK_SPIKE_RATIO = 0.01;
export const isSpike = (t: FlagEvalTotal) => t.fallbacks.some((f) => f.reason === 'SIGNATURE_INVALID' && f.count > 0) || (t.evaluations > 0 && t.fallbackTotal / t.evaluations > FALLBACK_SPIKE_RATIO);
