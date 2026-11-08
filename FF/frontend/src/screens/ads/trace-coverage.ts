import type { AdsTraceVerdict } from '@ff/contracts';

/** Presentation groups only. Original audit verdicts and evidence remain unchanged. */
export const TRACE_COVERAGE_GROUPS = [
  { key: 'IMPLEMENTED', tone: 'ok' },
  { key: 'REVIEW', tone: 'warn' },
  { key: 'UNJUDGED', tone: 'unknown' },
] as const;
export type TraceCoverageGroup = typeof TRACE_COVERAGE_GROUPS[number]['key'];
export const coverageGroup: Record<AdsTraceVerdict, TraceCoverageGroup | 'OUT_OF_SCOPE'> = {
  IMPLEMENTED: 'IMPLEMENTED', PARTIAL: 'REVIEW', NOT_IMPLEMENTED: 'REVIEW', SOURCE_CHANGED: 'REVIEW',
  NO_EVIDENCE: 'UNJUDGED', UNJUDGED: 'UNJUDGED', OUT_OF_SCOPE: 'OUT_OF_SCOPE',
};
export function traceCoverage(verdicts: readonly AdsTraceVerdict[]) {
  const counts: Record<TraceCoverageGroup, number> = { IMPLEMENTED: 0, REVIEW: 0, UNJUDGED: 0 };
  let excluded = 0;
  for (const verdict of verdicts) {
    const group = coverageGroup[verdict];
    if (group === 'OUT_OF_SCOPE') excluded++; else counts[group]++;
  }
  return { counts, excluded, total: verdicts.length - excluded };
}
