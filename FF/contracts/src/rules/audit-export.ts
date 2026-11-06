// 감사·이력 조회 보강(기능명세서 B4) — 기간 조건, 변경 전후 값(필드 단위), 내보내기 파일(CSV·JSON, 행마다 체인 해시 + 파일 SHA-256 + 서명).
// 민감 값(금액·벤치마크·단가)은 감사에 남길 때부터 가리고(Feature DB maskMoney), 전후 비교·내보내기에서도 같은 키를 다시 가린다 —
// 감사 조회는 역할 제한이 없으므로 화면·파일 어디에도 값이 나가지 않는다.
import { z } from 'zod';
import { REF_MONEY_FIELDS } from '../schemas/refdb';

// ─── 기간 조건 ───────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * 기간 조건 — from·to는 날짜(YYYY-MM-DD) 또는 UTC 시각. 날짜 to는 그날 끝까지(다음 날 0시 미만).
 * 돌려주는 값은 비교용 ISO 문자열(from 이상, to 미만). 읽을 수 없으면 error.
 */
export function periodBounds(from?: string | null, to?: string | null): { from?: string; to?: string; error?: string } {
  const out: { from?: string; to?: string; error?: string } = {};
  const norm = (v: string, end: boolean): string | null => {
    if (DAY.test(v)) {
      const d = new Date(`${v}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
      if (end) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString();
    }
    if (ISO.test(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  };
  if (from) {
    const f = norm(from.trim(), false);
    if (!f) return { error: `기간 시작을 읽을 수 없습니다: ${from} (YYYY-MM-DD)` };
    out.from = f;
  }
  if (to) {
    const t = norm(to.trim(), true);
    if (!t) return { error: `기간 끝을 읽을 수 없습니다: ${to} (YYYY-MM-DD)` };
    out.to = t;
  }
  if (out.from && out.to && out.from >= out.to) return { error: '기간 시작이 끝보다 늦습니다' };
  return out;
}

// ─── 민감 값 가림 ─────────────────────────────────────────────

/** 가린 값 자리 — 바뀌었다는 사실만 남긴다 */
export const SENSITIVE_MASK = '(가림)';
/** 감사에 남길 때 이미 가린 자리(Feature DB 벤치마크) — 같은 뜻으로 본다 */
export const LEGACY_MONEY_MASK = '(벤치마크 값 — 감사에는 남기지 않음)';

/** 감사 기록에서 가리는 키 — Feature DB 금액 필드 + 산정 금액·단가 */
export const SENSITIVE_AUDIT_KEYS: readonly string[] = [...REF_MONEY_FIELDS, 'amount', 'amountKrw', 'unitPrice', 'unitCost', 'price', 'priceKrw', 'totalCost', 'directCost', 'laborRate', 'fxRate'];
const MONEY_WORD = /(amount|price|cost|krw|eur|usd|benchmark|premium)$/i;

/** 키가 민감한가 — 목록에 있거나 금액·단가를 뜻하는 이름으로 끝난다 */
export const isSensitiveKey = (k: string) => SENSITIVE_AUDIT_KEYS.includes(k) || MONEY_WORD.test(k);
/** 값이 이미 가려졌는가 */
export const isMasked = (v: unknown) => v === SENSITIVE_MASK || v === LEGACY_MONEY_MASK;

/** 민감 키의 값을 가린다(중첩 객체·배열 안까지). 빈 값(null·'')은 숨길 것이 없어 그대로 */
export function maskSensitive<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => maskSensitive(x)) as T;
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = isSensitiveKey(k) && x !== null && x !== undefined && x !== '' && !isMasked(x) ? SENSITIVE_MASK : maskSensitive(x);
  return out as T;
}

// ─── 변경 전후 값 ─────────────────────────────────────────────

export interface FieldChange {
  /** 점 경로(rollout.basisPoints) — 배열은 통째로 비교 */
  field: string;
  before: unknown;
  after: unknown;
  /** 민감 값이라 가렸다 */
  masked: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 변경 전후 값 — 바뀐 필드마다 한 줄. 정책 수정 감사·Feature 변경 이벤트·감사 화면 비교가 함께 쓴다.
 * 민감 키는 값 대신 가림 자리(바뀐 사실은 남는다).
 * @req FR-EVT-001-004, FR-AUD-001-002
 */
export function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  const out: FieldChange[] = [];
  const walk = (b: unknown, a: unknown, path: string, sensitive: boolean) => {
    if (isObj(b) && isObj(a)) {
      for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) walk(b[k], a[k], path ? `${path}.${k}` : k, sensitive || isSensitiveKey(k));
      return;
    }
    if (same(b, a)) return;
    const masked = sensitive || isMasked(b) || isMasked(a);
    out.push({ field: path || '(값)', before: masked && b != null && b !== '' ? SENSITIVE_MASK : (b ?? null), after: masked && a != null && a !== '' ? SENSITIVE_MASK : (a ?? null), masked });
  };
  walk(isObj(before) ? before : before ?? {}, isObj(after) ? after : after ?? {}, '', false);
  return out;
}

// ─── 내보내기 ────────────────────────────────────────────────

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export const ExportFormat = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormat>;
/** 한 파일에 담는 최대 행 — 넘으면 기간을 나눠 받게 한다 */
export const EXPORT_MAX_ROWS = 50_000;

/** 내보내기 파일의 무결성 — 행 수·내용 SHA-256(CSV는 머리글 이후 데이터 줄, JSON은 rows의 정규 JSON)·내보내기 키 서명 */
export interface ExportIntegrity {
  rows: number;
  sha256: string;
  /** 감사 체인 — 첫 행의 앞 해시와 마지막 행 해시(감사 내보내기만). 체인 검증 화면의 끝과 대조한다 */
  chainFrom: string | null;
  chainTo: string | null;
  signature: { keyId: string; alg: string; payloadHash: string; signature: string };
}

export interface ExportEnvelope<T> {
  kind: 'audit' | 'validations';
  generatedAt: string;
  generatedBy: string;
  period: { from: string | null; to: string | null };
  filters: Record<string, string>;
  integrity: ExportIntegrity;
  rows: T[];
}

/** 서명 대상 — 파일 내용 해시와 범위(서명이 다른 기간·종류의 파일에 옮겨 붙지 않게) */
export const exportSignedPayload = (e: { kind: string; generatedAt: string; period: { from: string | null; to: string | null }; rows: number; sha256: string }) => ({
  kind: e.kind,
  generatedAt: e.generatedAt,
  period: e.period,
  rows: e.rows,
  sha256: e.sha256,
});

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. 수식으로 읽히는 앞 글자(= + - @)는 작은따옴표를 붙인다 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 데이터 부분(머리글 + 행) — 줄 끝은 CRLF(RFC 4180) */
export function csvBody(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** CSV 파일 — 앞에 # 줄로 범위·해시·서명(데이터 부분의 SHA-256), 그 뒤 데이터 부분 */
export function csvFile(meta: { kind: string; generatedAt: string; generatedBy: string; period: { from: string | null; to: string | null }; integrity: ExportIntegrity }, body: string): string {
  const i = meta.integrity;
  const head = [
    `# Feature Flag Platform ${meta.kind === 'audit' ? '감사 이력' : '검증 이력'} 내보내기`,
    `# generatedAt=${meta.generatedAt} generatedBy=${meta.generatedBy}`,
    `# period=${meta.period.from ?? ''}..${meta.period.to ?? ''} rows=${i.rows}`,
    `# sha256=${i.sha256} (아래 데이터 줄 전체)`,
    ...(i.chainTo ? [`# chain=${i.chainFrom ?? ''}..${i.chainTo}`] : []),
    `# signature=${i.signature.alg}:${i.signature.keyId}:${i.signature.signature}`,
  ];
  return head.join('\r\n') + '\r\n' + body;
}

/** 감사 내보내기 열 */
export const AUDIT_EXPORT_COLUMNS = ['id', 'at', 'actorId', 'actorRole', 'action', 'target', 'result', 'reason', 'before', 'after', 'changes', 'prevHash', 'hash'];
/** 검증 이력 내보내기 열 */
export const VALIDATION_EXPORT_COLUMNS = ['runId', 'at', 'by', 'policyId', 'policyRevision', 'contentHash', 'decision', 'reasons', 'results'];

// ─── 정책 운영 현황(감사 집계) ─────────────────────────────────

/** 정책별 행위 집계 — 조회·수정·승인·배포 횟수와 최종 행위 일시 */
export interface PolicyActivityStat {
  policyId: string;
  views: number;
  updates: number;
  approvals: number;
  deploys: number;
  lastAt: string | null;
  lastAction: string | null;
}

/** 감사 행위 → 집계 칸 */
export const POLICY_ACTIVITY_ACTIONS: Record<'views' | 'updates' | 'approvals' | 'deploys', string[]> = {
  views: ['POLICY_VIEW'],
  updates: ['POLICY_CREATE', 'POLICY_UPDATE', 'POLICY_RESTORE'],
  approvals: ['POLICY_APPROVE', 'POLICY_REJECT'],
  deploys: ['POLICY_DEPLOY', 'ROLLOUT_STAGE'],
};

