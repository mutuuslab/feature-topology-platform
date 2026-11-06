// 감사·이력 조회 보강(기능명세서 B4) — 기간 조건, 변경 전후 값(필드 단위), 내보내기 파일(CSV·JSON, 행마다 체인 해시 + 파일 SHA-256 + 서명).
// 민감 값(금액·벤치마크·단가)은 감사에 남길 때부터 가리고(Feature DB maskMoney), 전후 비교·내보내기에서도 같은 키를 다시 가린다 —
// 감사 조회는 역할 제한이 없으므로 화면·파일 어디에도 값이 나가지 않는다.
import { z } from 'zod';
import { REF_MONEY_FIELDS } from '../schemas/refdb';
import { canonicalJson } from './canonical';

// ─── 기간 조건 ───────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/** 기간 조건의 날짜가 뜻하는 시간대 — 화면이 시각을 한국 시간(UTC+9)으로 보여 준다(frontend when·localTime). 날짜를 UTC로 읽으면
 *  화면에 '11-06 08:30'으로 보이는 기록이 11-06 조건에서 빠지고 '11-07 08:30'이 들어갔다(하네스 리뷰) */
export const PERIOD_DAY_UTC_OFFSET_MINUTES = 9 * 60;

/**
 * 기간 조건 — from·to는 날짜(YYYY-MM-DD, 한국 시간) 또는 UTC 시각. 날짜 from은 그날 0시, 날짜 to는 그날 끝까지(다음 날 0시 미만).
 * 돌려주는 값은 비교용 UTC ISO 문자열(from 이상, to 미만). 읽을 수 없으면 error.
 */
export function periodBounds(from?: string | null, to?: string | null): { from?: string; to?: string; error?: string } {
  const out: { from?: string; to?: string; error?: string } = {};
  const norm = (v: string, end: boolean): string | null => {
    if (DAY.test(v)) {
      const d = new Date(`${v}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
      if (end) d.setUTCDate(d.getUTCDate() + 1);
      return new Date(d.getTime() - PERIOD_DAY_UTC_OFFSET_MINUTES * 60_000).toISOString();
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

/**
 * 서명 대상 — 파일 내용 해시·범위·내보낸 사람·조건(서명이 다른 기간·종류·조건의 파일에 옮겨 붙거나, 머리 줄만 바꿔 다른 사람이
 * 받은 파일로 꾸미지 못하게). 서명은 이 객체의 정규 JSON(canonicalJson)의 'sha256:'+hex 문자열에 대한 Ed25519다(PkiService.sign).
 */
export const exportSignedPayload = (e: { kind: string; generatedAt: string; generatedBy: string; period: { from: string | null; to: string | null }; filters: Record<string, string>; rows: number; sha256: string }) => ({
  kind: e.kind,
  generatedAt: e.generatedAt,
  generatedBy: e.generatedBy,
  period: { from: e.period.from, to: e.period.to },
  filters: { ...e.filters },
  rows: e.rows,
  sha256: e.sha256,
});
export type ExportSignedPayload = ReturnType<typeof exportSignedPayload>;

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. 수식으로 읽히는 앞 글자(= + - @ 탭 CR)는 작은따옴표를 붙인다(OWASP CSV Injection) */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 데이터 부분(머리글 + 행) — 줄 끝은 CRLF(RFC 4180) */
export function csvBody(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/**
 * CSV 파일 — 앞에 # 줄로 범위·해시·서명(데이터 부분의 SHA-256), 그 뒤 데이터 부분.
 * '# signed=' 줄은 서명 대상의 정규 JSON 그대로(한 줄) — 검증 도구(tools/verify-export.ts)가 이 줄과 공개키만으로 확인한다.
 */
export function csvFile(meta: { kind: string; generatedAt: string; generatedBy: string; period: { from: string | null; to: string | null }; filters?: Record<string, string>; integrity: ExportIntegrity }, body: string): string {
  const i = meta.integrity;
  const signed = exportSignedPayload({ ...meta, filters: meta.filters ?? {}, rows: i.rows, sha256: i.sha256 });
  const head = [
    `# Feature Flag Platform ${meta.kind === 'audit' ? '감사 이력' : '검증 이력'} 내보내기`,
    `# generatedAt=${meta.generatedAt} generatedBy=${meta.generatedBy}`,
    `# period=${meta.period.from ?? ''}..${meta.period.to ?? ''} rows=${i.rows}`,
    `# sha256=${i.sha256} (아래 데이터 줄 전체)`,
    ...(i.chainTo ? [`# chain=${i.chainFrom ?? ''}..${i.chainTo}`] : []),
    `# signed=${canonicalJson(signed)}`,
    `# payloadHash=${i.signature.payloadHash}`,
    `# signature=${i.signature.alg}:${i.signature.keyId}:${i.signature.signature}`,
  ];
  return head.join('\r\n') + '\r\n' + body;
}

/** 내보내기 파일을 읽은 결과 — 검증 도구가 해시·서명을 확인하는 재료 */
export interface ParsedExport {
  format: 'csv' | 'json';
  /** 서명 대상(파일에 실린 그대로) */
  payload: ExportSignedPayload;
  signature: { alg: string; keyId: string; signature: string };
  /** 파일에 적힌 서명 입력 해시('sha256:'+hex) — 검증 도구가 payload로 다시 계산해 맞춘다 */
  payloadHash: string | null;
  /** 해시 대상 — CSV는 # 머리 줄 뒤 데이터 줄 전체, JSON은 rows의 정규 JSON */
  data: string;
  /** JSON 봉투의 rows 개수(CSV는 칸 안 줄바꿈 때문에 세지 않는다) */
  rowCount: number | null;
  /** 사람이 읽는 머리 줄·봉투 값이 서명 대상과 다른 곳 — 하나라도 있으면 검증 실패 */
  mismatches: string[];
}

const BOM_CHAR = String.fromCharCode(0xfeff);

/**
 * 내보내기 파일(CSV·JSON) 읽기 — 서명 대상·해시 대상·서명을 되살린다. 형식이 맞지 않으면 Error.
 * 순수 함수(해시·서명 계산 없음) — node:crypto로 확인하는 것은 tools/verify-export.ts.
 */
export function parseExportFile(text: string): ParsedExport {
  const t = text.startsWith(BOM_CHAR) ? text.slice(1) : text;
  if (t.trimStart().startsWith('{')) {
    const env = JSON.parse(t) as ExportEnvelope<unknown>;
    if (!env || !env.integrity?.signature || !Array.isArray(env.rows)) throw new Error('내보내기 JSON 봉투가 아닙니다(integrity·rows 없음)');
    const payload = exportSignedPayload({ kind: env.kind, generatedAt: env.generatedAt, generatedBy: env.generatedBy, period: env.period ?? { from: null, to: null }, filters: env.filters ?? {}, rows: env.integrity.rows, sha256: env.integrity.sha256 });
    const s = env.integrity.signature;
    return { format: 'json', payload, signature: { alg: s.alg, keyId: s.keyId, signature: s.signature }, payloadHash: s.payloadHash ?? null, data: canonicalJson(env.rows), rowCount: env.rows.length, mismatches: [] };
  }
  // CSV — 맨 앞 # 줄들이 머리, 그 뒤 전체가 데이터(해시 대상)
  const head: string[] = [];
  let at = 0;
  while (t.startsWith('#', at)) {
    const nl = t.indexOf('\r\n', at);
    if (nl < 0) throw new Error('내보내기 CSV 머리 줄이 끝나지 않습니다');
    head.push(t.slice(at, nl));
    at = nl + 2;
  }
  const line = (re: RegExp) => head.map((h) => re.exec(h)).find(Boolean) ?? null;
  const signedLine = line(/^# signed=(\{.*\})$/);
  const sigLine = line(/^# signature=([^:]+):([^:]+):(\S+)$/);
  if (!signedLine || !sigLine) throw new Error('내보내기 CSV에 서명 줄(# signed=·# signature=)이 없습니다');
  const raw = JSON.parse(signedLine[1]) as ExportSignedPayload;
  const payload = exportSignedPayload({ ...raw, period: raw.period ?? { from: null, to: null }, filters: raw.filters ?? {} });
  const mismatches: string[] = [];
  if (canonicalJson(payload) !== signedLine[1]) mismatches.push('# signed= 줄이 정규 JSON이 아닙니다');
  const who = line(/^# generatedAt=(\S*) generatedBy=(.*)$/);
  if (!who || who[1] !== payload.generatedAt || who[2] !== payload.generatedBy) mismatches.push('generatedAt·generatedBy 머리 줄이 서명 대상과 다릅니다');
  const per = line(/^# period=(\S*)\.\.(\S*) rows=(\d+)$/);
  if (!per || (per[1] || null) !== payload.period.from || (per[2] || null) !== payload.period.to || Number(per[3]) !== payload.rows) mismatches.push('period·rows 머리 줄이 서명 대상과 다릅니다');
  const sum = line(/^# sha256=([0-9a-f]{64})\b/);
  if (!sum || sum[1] !== payload.sha256) mismatches.push('sha256 머리 줄이 서명 대상과 다릅니다');
  const ph = line(/^# payloadHash=(\S+)$/);
  return { format: 'csv', payload, signature: { alg: sigLine[1], keyId: sigLine[2], signature: sigLine[3] }, payloadHash: ph?.[1] ?? null, data: t.slice(at), rowCount: null, mismatches };
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

