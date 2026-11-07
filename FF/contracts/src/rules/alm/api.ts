// JIRA·codeBeamer 연계(80-50) API 본문 — 대사 실행·산출물·재판정·JIRA 앱. 경로 표는 routes.ts.
import { z } from 'zod';

/** 대사 종류(80-50 §4.5) — 증분(최근 변경) · 전체(모든 Epic·하위 이슈 기대값 비교) */
export const RECONCILE_KINDS = ['INCREMENTAL', 'FULL'] as const;
export type ReconcileKind = (typeof RECONCILE_KINDS)[number];
export const RECONCILE_KIND_LABEL: Record<ReconcileKind, string> = { INCREMENTAL: '증분 대사', FULL: '전체 대사' };

export const RunReconcileBody = z.object({ system: z.enum(['JIRA', 'CODEBEAMER']).default('JIRA'), kind: z.enum(RECONCILE_KINDS) }).strict();
export type RunReconcileBody = z.infer<typeof RunReconcileBody>;

/** 대사 실행 기록 한 줄 */
export interface ReconcileRunRow {
  runId: number;
  system: 'JIRA' | 'CODEBEAMER' | 'GITLAB';
  kind: ReconcileKind;
  startedAt: string;
  finishedAt: string | null;
  scanned: number;
  applied: number;
  conflicts: number;
  errors: number;
  notes: string[];
}
