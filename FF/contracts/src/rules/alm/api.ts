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

/** 산출물 게이트 적용 방식(80-50 §5.5) — enforce: 막음 · warn: 보이기만 · off. 기본은 codeBeamer 실제 연결이면 enforce, 아니면 warn */
export const WP_GATE_MODES = ['enforce', 'warn', 'off'] as const;
export type WpGateMode = (typeof WP_GATE_MODES)[number];
export function wpGateMode(env: Record<string, string | undefined>): WpGateMode {
  const v = (env.FF_ALM_WP_GATE ?? '').trim();
  if ((WP_GATE_MODES as readonly string[]).includes(v)) return v as WpGateMode;
  return env.IF_MODE_01 === 'live' ? 'enforce' : 'warn';
}

/** 승인 뒤 바뀐 산출물의 게이트 재판정 요청(80-50 §5.6) */
export interface RejudgeRow {
  rejudgeId: number;
  featureId: string;
  version: string;
  gate: string;
  itemKey: string;
  itemTitle: string;
  fromVersion: number;
  toVersion: number;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  /** 이미 출시된 버전의 산출물이 바뀜 — 긴급 차단 여부는 사람이 판단 */
  released: boolean;
  resolvedBy: string | null;
}

/** 의심(suspect) 관계 풀기 — 아래 항목에 영향 없음 사유(담당자) */
export const ClearSuspectBody = z.object({ from: z.string().regex(/^CB-\d+$/), to: z.string().regex(/^CB-\d+$/), reason: z.string().trim().min(2).max(500) }).strict();
export type ClearSuspectBody = z.infer<typeof ClearSuspectBody>;

/** 재판정 요청 닫기 — 영향 없음(출시 버전처럼 다시 판정할 수 없을 때, 사유 필수) */
export const CloseRejudgeBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type CloseRejudgeBody = z.infer<typeof CloseRejudgeBody>;

/** JIRA 앱 자격(OAuth2 client credentials, 80-50 §4.7) */
export const AppTokenBody = z.object({ grant_type: z.literal('client_credentials'), client_id: z.string().min(1).max(200), client_secret: z.string().min(1).max(500) }).strict();
export type AppTokenBody = z.infer<typeof AppTokenBody>;
