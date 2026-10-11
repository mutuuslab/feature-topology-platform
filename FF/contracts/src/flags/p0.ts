// FP-UL-P0-1.0 기준 동작의 TS 이식 — 원본: Feature_Platform_Unleash_P0_Revision_v1_0/appendices/contracts/p0_reference.js
// 의미를 바꾸지 않는다(골든 벡터·동작 테스트로 고정). 3치 논리: 신뢰할 수 없거나 없는 문맥은 UNKNOWN → 결정은 HOLD → Safe Default.
// 브라우저·Node 공용: SHA-256은 globalThis.crypto.subtle(Web Crypto)을 쓴다.

export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';
const T: Tri = 'TRUE';
const F: Tri = 'FALSE';
const U: Tri = 'UNKNOWN';

export const and3 = (a: Tri[]): Tri => (a.includes(F) ? F : a.includes(U) ? U : T);
export const or3 = (a: Tri[]): Tri => (a.includes(T) ? T : a.includes(U) ? U : F);
export const not3 = (a: Tri): Tri => (a === U ? U : a === T ? F : T);

export function decimalCompare(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const re = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 64 || b.length > 64 || !re.test(a) || !re.test(b)) return null;
  const split = (s: string): [bigint, number] => {
    const p = s.split('.');
    return [BigInt(p[0] + (p[1] || '')), (p[1] || '').length];
  };
  let [aa, as] = split(a);
  let [bb, bs] = split(b);
  const scale = Math.max(as, bs);
  aa *= 10n ** BigInt(scale - as);
  bb *= 10n ** BigInt(scale - bs);
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

export function semverCompare(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const r = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 256 || b.length > 256) return null;
  const aa = a.match(r);
  const bb = b.match(r);
  if (!aa || !bb) return null;
  for (const m of [aa, bb]) if (m[4]?.split('.').some((x) => /^\d+$/.test(x) && x.length > 1 && x[0] === '0')) return null;
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(aa[i]);
    const y = BigInt(bb[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  if (!aa[4] && !bb[4]) return 0;
  if (!aa[4]) return 1;
  if (!bb[4]) return -1;
  const pa = aa[4].split('.');
  const pb = bb[4].split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (pa[i] === pb[i]) continue;
    const an = /^\d+$/.test(pa[i]);
    const bn = /^\d+$/.test(pb[i]);
    if (an && bn) return BigInt(pa[i]) < BigInt(pb[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** RFC 3339 UTC(ms 선택) — 정규형이 아니면 null */
export function time(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return null;
  const v = Date.parse(s);
  if (!Number.isFinite(v)) return null;
  const canonical = s.includes('.') ? s : s.replace('Z', '.000Z');
  return new Date(v).toISOString() === canonical ? v : null;
}

export const CONSTRAINT_OPERATORS = [
  'IN', 'NOT_IN', 'STR_CONTAINS', 'STR_STARTS_WITH', 'STR_ENDS_WITH',
  'NUM_EQ', 'NUM_GT', 'NUM_GTE', 'NUM_LT', 'NUM_LTE',
  'SEMVER_EQ', 'SEMVER_GT', 'SEMVER_LT',
  'DATE_AFTER', 'DATE_BEFORE',
] as const;
export type ConstraintOperator = (typeof CONSTRAINT_OPERATORS)[number];

export interface Constraint {
  contextName: string;
  operator: ConstraintOperator;
  values: string[];
  inverted?: boolean;
  caseInsensitive?: boolean;
}

/** 문맥 항목 — 품질이 TRUSTED가 아니면 판단하지 않는다(UNKNOWN) */
export interface ContextItem {
  value: string | null | undefined;
  quality: 'TRUSTED' | 'STALE' | 'UNTRUSTED';
}
export type EvalContext = Record<string, ContextItem | undefined>;

export function constraint(rule: Constraint, context: EvalContext): Tri {
  const item = context[rule.contextName];
  if (!item || item.quality !== 'TRUSTED' || item.value === null || item.value === undefined) return U;
  let value: string = item.value;
  let vals = rule.values;
  if (typeof value !== 'string' || !Array.isArray(vals) || !vals.length || vals.some((x) => typeof x !== 'string')) return U;
  value = value.normalize('NFC');
  vals = vals.map((x) => x.normalize('NFC'));
  if (rule.caseInsensitive) {
    if (!['IN', 'NOT_IN', 'STR_CONTAINS', 'STR_STARTS_WITH', 'STR_ENDS_WITH'].includes(rule.operator) || [value, ...vals].some((x) => /[^\x00-\x7F]/.test(x))) return U;
    value = value.toLowerCase();
    vals = vals.map((x) => x.toLowerCase());
  }
  let yes: boolean | undefined;
  switch (rule.operator) {
    case 'IN':
      yes = vals.includes(value);
      break;
    case 'NOT_IN':
      yes = !vals.includes(value);
      break;
    case 'STR_CONTAINS':
      yes = vals.some((v) => value.includes(v));
      break;
    case 'STR_STARTS_WITH':
      yes = vals.some((v) => value.startsWith(v));
      break;
    case 'STR_ENDS_WITH':
      yes = vals.some((v) => value.endsWith(v));
      break;
    default: {
      if (vals.length !== 1) return U;
      let cmp: number | null;
      if (rule.operator.startsWith('NUM_')) cmp = decimalCompare(value, vals[0]);
      else if (rule.operator.startsWith('SEMVER_')) cmp = semverCompare(value, vals[0]);
      else if (rule.operator === 'DATE_AFTER' || rule.operator === 'DATE_BEFORE') {
        const a = time(value);
        const b = time(vals[0]);
        if (a === null || b === null) return U;
        cmp = a < b ? -1 : a > b ? 1 : 0;
      } else return U;
      if (cmp === null) return U;
      const op = rule.operator.split('_').at(-1)!;
      yes = ({ EQ: cmp === 0, GT: cmp > 0, GTE: cmp >= 0, LT: cmp < 0, LTE: cmp <= 0, AFTER: cmp > 0, BEFORE: cmp < 0 } as Record<string, boolean>)[op];
      if (yes === undefined) return U;
    }
  }
  const result = yes ? T : F;
  return rule.inverted ? not3(result) : result;
}

export type Decision = 'ALLOW' | 'DENY' | 'HOLD';
export interface DecideResult {
  decision: Decision;
  reason: 'INVALID_RESULT' | 'CONTEXT_UNKNOWN' | 'PREDICATE_DENIED' | 'POLICY_MATCH';
  intent: boolean;
}

/** 전략(OR)과 필수 조건(AND)로 결정 — UNKNOWN은 HOLD(차량은 Safe Default 유지) */
export function decide({ flagEnabled = true, valid = true, sourceDefaultUsed = false, mandatory = [] as Tri[], strategies = [] as Tri[] }): DecideResult {
  if (!valid || sourceDefaultUsed) return { decision: 'HOLD', reason: 'INVALID_RESULT', intent: false };
  const proposal = and3([flagEnabled ? T : F, or3(strategies)]);
  const out = and3([proposal, ...mandatory]);
  return { decision: out === T ? 'ALLOW' : out === F ? 'DENY' : 'HOLD', reason: out === U ? 'CONTEXT_UNKNOWN' : out === F ? 'PREDICATE_DENIED' : 'POLICY_MATCH', intent: out === T };
}

export interface PublishInput {
  allowedRole: boolean;
  author: string;
  authorDelegates?: string[];
  approver: string;
  approverDelegates?: string[];
  candidateHash: string;
  approvedHash: string;
  sourceRevision: string | number;
  approvedSourceRevision: string | number;
  qualityPassed: boolean;
  authorizationValid: boolean;
  supported: boolean;
  maintenance: boolean;
  sequence: number;
  highestSequence: number;
}

/** 서명 게시 적격성 — 자기 승인·해시 불일치·원천 변경·승인 미완·미지원 규칙·점검 중·재전송을 막는다 */
export function publishCheck(x: PublishInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!x.allowedRole) reasons.push('ACTION_DENIED');
  const authors = new Set([x.author, ...(x.authorDelegates || [])]);
  if (authors.has(x.approver) || (x.approverDelegates || []).some((v) => authors.has(v))) reasons.push('SELF_APPROVAL');
  if (x.candidateHash !== x.approvedHash) reasons.push('HASH_MISMATCH');
  if (x.sourceRevision !== x.approvedSourceRevision) reasons.push('SOURCE_DRIFT');
  if (!x.qualityPassed || !x.authorizationValid) reasons.push('APPROVAL_INCOMPLETE');
  if (!x.supported) reasons.push('UNSUPPORTED_RULE');
  if (x.maintenance) reasons.push('MAINTENANCE');
  if (x.sequence <= x.highestSequence) reasons.push('REPLAY');
  return { eligible: !reasons.length, reasons };
}

export interface ReadbackReport {
  nodeId: string;
  metricType: 'READBACK' | 'ACK';
  publication: string;
  policyHash: string;
  featureVersion: string;
  bootId: string;
  sequence: number;
  ageMs: number;
  observed: unknown;
}
export interface ReadbackExpected {
  publication: string;
  policyHash: string;
  featureVersion: string;
  bootIds: Record<string, string>;
  minSequence: Record<string, number>;
  maxAgeMs: number;
  desired: unknown;
}

/** 다중 ECU 회신 집계 — ECU readback이 기대값과 일치해야 CONFIRMED (BD-12) */
export function aggregate(required: string[], nodes: ReadbackReport[], expected: ReadbackExpected) {
  if (new Set(required).size !== required.length) return { state: 'UNKNOWN' as const, confirmed: 0, denominator: required.length, nodes: [], reason: 'DUPLICATE_REQUIRED_NODE' };
  const results = required.map((nodeId) => {
    const reports = nodes.filter((n) => n.nodeId === nodeId);
    const n = reports[0];
    if (!n) return { nodeId, state: 'UNKNOWN', reason: 'NO_REPORT' };
    if (reports.length !== 1) return { nodeId, state: 'UNKNOWN', reason: 'UNREDUCED_REPORTS' };
    if (n.metricType !== 'READBACK') return { nodeId, state: 'UNKNOWN', reason: 'ACK_ONLY' };
    if (n.publication !== expected.publication || n.policyHash !== expected.policyHash) return { nodeId, state: 'UNKNOWN', reason: 'OTHER_PUBLICATION' };
    if (!expected.featureVersion || n.featureVersion !== expected.featureVersion) return { nodeId, state: 'UNKNOWN', reason: 'OTHER_FEATURE_VERSION' };
    if (n.bootId !== expected.bootIds[nodeId]) return { nodeId, state: 'UNKNOWN', reason: 'OTHER_BOOT' };
    if (!Number.isInteger(expected.minSequence[nodeId]) || !Number.isInteger(n.sequence) || n.sequence < expected.minSequence[nodeId]) return { nodeId, state: 'UNKNOWN', reason: 'OLD_SEQUENCE' };
    if (!Number.isFinite(n.ageMs) || !Number.isFinite(expected.maxAgeMs) || expected.maxAgeMs < 0 || n.ageMs < 0 || n.ageMs > expected.maxAgeMs) return { nodeId, state: 'UNKNOWN', reason: 'STALE_REPORT' };
    return { nodeId, state: n.observed === expected.desired ? 'CONFIRMED' : 'DIVERGED', reason: n.observed === expected.desired ? 'READBACK_MATCH' : 'STATE_MISMATCH' };
  });
  const known = results.filter((n) => n.state === 'CONFIRMED').length;
  const state = !required.length ? 'UNKNOWN' : results.some((n) => n.state === 'DIVERGED') ? 'DIVERGED' : known === required.length ? 'CONFIRMED' : known ? 'PARTIAL' : 'UNKNOWN';
  return { state, confirmed: known, denominator: required.length, nodes: results };
}

/** FP-COHORT-1 — SHA-256(길이 접두 NFC 부분들) 앞 8바이트 big-endian mod 10000. Unleash murmur3와 호환되지 않는다(의도). */
export async function cohortBucket(profileVersion: string, groupId: string, salt: string, targetingKey: string): Promise<number> {
  if (!targetingKey) throw new Error('TARGETING_KEY_MISSING');
  const enc = new TextEncoder();
  const parts = [profileVersion, groupId, salt, targetingKey].map((x) => enc.encode(x.normalize('NFC')));
  const data = new Uint8Array(parts.reduce((n, x) => n + 4 + x.length, 0));
  let o = 0;
  for (const p of parts) {
    new DataView(data.buffer).setUint32(o, p.length, false);
    o += 4;
    data.set(p, o);
    o += p.length;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Number(new DataView(digest).getBigUint64(0, false) % 10000n);
}
