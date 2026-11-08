// ADS 구성(ODD 프로파일·호환 형상·VIN 지원 판정) — 순수 규칙·표·타입(첫 화면에 들어가므로 zod 최상위 호출 금지, 본문 스키마는 schemas/ads-config.ts)
// ADS-BE09 ODD 의미 검증·승인 상한 비교, ADS-BE10 승인 조합(config_set) 대조·보안 최소 버전, ORC-BE02 VIN 지원 판정 4상태. 백엔드·화면이 같은 함수를 쓴다.
import { semverCompare } from '../flags/p0';

// ───────────────────────── ODD 프로파일 (ADS-BE09) ─────────────────────────

/** 축 — 화면은 이 순서로 그린다(배제 맨 위, a11y '배제 우선 표기') */
export const ODD_AXES = ['EXCLUSION', 'GEOGRAPHY', 'ROAD', 'ENVIRONMENT', 'DYNAMIC'] as const;
export type OddAxis = (typeof ODD_AXES)[number];
export const ODD_AXIS_LABEL: Record<OddAxis, string> = { EXCLUSION: '배제', GEOGRAPHY: '지리', ROAD: '도로', ENVIRONMENT: '환경', DYNAMIC: '동적' };

/** 연산자 — 경계는 기호(≤·<) 대신 글자로 쓴다(a11y) */
export type OddOp = 'LE' | 'LT' | 'GE' | 'GT' | 'IN' | 'NOT_IN';
export const ODD_OP_TEXT: Record<OddOp, string> = { LE: '이하(포함)', LT: '미만', GE: '이상(포함)', GT: '초과', IN: '중 하나', NOT_IN: '제외' };

export interface OddCondition {
  key: string;
  axis: OddAxis;
  label: string;
  op: OddOp;
  /** 수치(경계값) 또는 범주 목록. null = 값 없음 */
  value: number | string[] | null;
  unit: string | null;
  /** 승인 상한의 필수 조건 — 프로파일 조건에 반드시 있어야 한다(FFP-F026, rules/ads-publish validateOddRequired) */
  required?: boolean;
}

/** 조건 키 → 양(quantity)·경계 방향. max = 값이 클수록 넓은 ODD, min = 작을수록 넓은 ODD, set = 범주 */
export interface OddKeySpec {
  quantity: 'speed' | 'rain' | 'distance' | 'time' | 'count' | 'category';
  bound: 'max' | 'min' | 'set';
}
export const ODD_KEYS: Record<string, OddKeySpec> = {
  speedMax: { quantity: 'speed', bound: 'max' },
  speedMin: { quantity: 'speed', bound: 'min' },
  rainRateMax: { quantity: 'rain', bound: 'max' },
  visibilityMin: { quantity: 'distance', bound: 'min' },
  headwayMin: { quantity: 'time', bound: 'min' },
  laneCountMin: { quantity: 'count', bound: 'min' },
  region: { quantity: 'category', bound: 'set' },
  roadType: { quantity: 'category', bound: 'set' },
  roadSection: { quantity: 'category', bound: 'set' },
  lighting: { quantity: 'category', bound: 'set' },
};

/** 단위 → 기준 단위 배수(속도 km/h, 강우 mm/h, 거리 m, 시간 s, 차로 수) */
export const ODD_UNITS: Record<string, { quantity: OddKeySpec['quantity']; factor: number }> = {
  'km/h': { quantity: 'speed', factor: 1 },
  'm/s': { quantity: 'speed', factor: 3.6 },
  'mm/h': { quantity: 'rain', factor: 1 },
  m: { quantity: 'distance', factor: 1 },
  km: { quantity: 'distance', factor: 1000 },
  s: { quantity: 'time', factor: 1 },
  lanes: { quantity: 'count', factor: 1 },
};
const QUANTITY_LABEL: Record<OddKeySpec['quantity'], string> = { speed: '속도', rain: '강우', distance: '거리', time: '시간', count: '차로 수', category: '범주' };

/** 조건을 글자로 — '80 km/h 이하(포함)', '고속도로·자동차 전용도로 중 하나' */
export function oddConditionText(c: Pick<OddCondition, 'op' | 'value' | 'unit'>): string {
  if (c.value === null || c.value === undefined) return '값 없음';
  if (Array.isArray(c.value)) return `${c.value.join('·')} ${ODD_OP_TEXT[c.op]}`;
  return `${c.value}${c.unit ? ` ${c.unit}` : ''} ${ODD_OP_TEXT[c.op]}`;
}

export type OddIssueCode = 'UNIT_MIX' | 'UNIT_UNKNOWN' | 'OPERATOR_MISUSE' | 'ENVELOPE_EXCEEDED' | 'EXCLUSION_OVERLAP' | 'REQUIRED_MISSING';
export interface OddIssue {
  code: OddIssueCode;
  key: string;
  /** 짧은 이름 — 막힘 사유 괄호 안('속도 단위 혼용 km/h·m/s', '승인 상한 초과') */
  short: string;
  message: string;
}

export type LimitVerdict = 'WITHIN' | 'EXCEEDS' | 'UNDECIDABLE';
export const LIMIT_VERDICT_LABEL: Record<LimitVerdict, string> = { WITHIN: '상한 안(축소·같음)', EXCEEDS: '확대 — 승인 상한 초과', UNDECIDABLE: '판단 불가' };

/** 기준 단위 값 — 단위를 해석하지 못하면 null */
export function toBase(value: number | string[] | null, unit: string | null, quantity: OddKeySpec['quantity']): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !unit) return null;
  const u = ODD_UNITS[unit];
  return u && u.quantity === quantity ? value * u.factor : null;
}

type Bound = Pick<OddCondition, 'op' | 'value' | 'unit'>;

/**
 * 값이 상한 안인가 — max 경계는 크면 확대, min 경계는 작으면 확대, 같은 값이면 상한이 '미만'인데 값이 '이하(포함)'일 때 확대(경계 오기).
 * 값·단위를 해석하지 못하면 판단 불가 — 상한 안으로 세지 않는다(P-4).
 */
export function compareToLimit(key: string, value: Bound, limit: Bound | null): { verdict: LimitVerdict; reason: string } {
  const spec = ODD_KEYS[key];
  if (!spec) return { verdict: 'UNDECIDABLE', reason: `조건 키 ${key}를 해석하지 못함` };
  if (!limit) return { verdict: 'UNDECIDABLE', reason: '승인 상한에 같은 조건이 없음' };
  if (value.value === null || value.value === undefined) return { verdict: 'UNDECIDABLE', reason: '배포 설정 값 없음' };
  if (spec.bound === 'set') {
    if (!Array.isArray(value.value) || !Array.isArray(limit.value)) return { verdict: 'UNDECIDABLE', reason: '범주 값을 해석하지 못함' };
    const allowed = limit.value;
    const extra = value.value.filter((x) => !allowed.includes(x));
    return extra.length ? { verdict: 'EXCEEDS', reason: `상한 밖 범주 ${extra.join('·')}` } : { verdict: 'WITHIN', reason: `상한 ${allowed.join('·')} 안` };
  }
  const v = toBase(value.value, value.unit, spec.quantity);
  const l = toBase(limit.value, limit.unit, spec.quantity);
  if (v === null) return { verdict: 'UNDECIDABLE', reason: `단위 ${value.unit ?? '없음'}을 ${QUANTITY_LABEL[spec.quantity]} 단위로 해석하지 못함` };
  if (l === null) return { verdict: 'UNDECIDABLE', reason: `상한 단위 ${limit.unit ?? '없음'}을 해석하지 못함` };
  const limitText = oddConditionText(limit);
  const eps = 1e-9;
  const wider = spec.bound === 'max' ? v - l > eps : l - v > eps;
  const same = Math.abs(v - l) <= eps;
  if (wider) return { verdict: 'EXCEEDS', reason: `${oddConditionText(value)} — 상한 ${limitText} 밖` };
  if (same && (limit.op === 'LT' || limit.op === 'GT') && (value.op === 'LE' || value.op === 'GE')) return { verdict: 'EXCEEDS', reason: `경계 포함 여부가 상한보다 넓음 — 상한 ${limitText}` };
  return { verdict: 'WITHIN', reason: `상한 ${limitText} 안` };
}

/** 연산자가 키의 경계 방향과 맞는가(배제 축은 '중 하나' = 배제할 범주) */
function opFits(spec: OddKeySpec, c: OddCondition): boolean {
  if (c.axis === 'EXCLUSION') return c.op === 'IN';
  if (spec.bound === 'set') return c.op === 'IN' || c.op === 'NOT_IN';
  if (spec.bound === 'max') return c.op === 'LE' || c.op === 'LT';
  return c.op === 'GE' || c.op === 'GT';
}

/**
 * ODD 의미 검증 — 단위 혼용(같은 양에 두 단위)·단위 해석 실패·연산자 오기(경계 방향과 반대)·승인 상한 초과·배제 우선 위반(배제한 값을 다른 축이 포함).
 * 오류가 하나라도 있으면 승인할 수 없다(ADS-BE09).
 */
export function validateOddProfile(p: { conditions: OddCondition[]; envelope: OddCondition[] }): OddIssue[] {
  const out: OddIssue[] = [];
  const unitsByQ = new Map<OddKeySpec['quantity'], Set<string>>();
  for (const c of [...p.envelope, ...p.conditions]) {
    const spec = ODD_KEYS[c.key];
    if (!spec || spec.bound === 'set' || !c.unit) continue;
    unitsByQ.set(spec.quantity, (unitsByQ.get(spec.quantity) ?? new Set<string>()).add(c.unit));
  }
  for (const [q, units] of unitsByQ) {
    if (units.size < 2) continue;
    const short = `${QUANTITY_LABEL[q]} 단위 혼용 ${[...units].join('·')}`;
    out.push({ code: 'UNIT_MIX', key: q, short, message: `${short} — 한 프로파일 안에서 같은 양은 한 단위로 씁니다.` });
  }
  for (const c of p.conditions) {
    const spec = ODD_KEYS[c.key];
    if (!spec) {
      out.push({ code: 'UNIT_UNKNOWN', key: c.key, short: `조건 해석 불가(${c.label})`, message: `조건 키 ${c.key}는 등록된 ODD 조건이 아닙니다.` });
      continue;
    }
    const fits = opFits(spec, c);
    if (!fits) out.push({ code: 'OPERATOR_MISUSE', key: c.key, short: `연산자 오기(${c.label})`, message: `${c.label} 조건은 ${spec.bound === 'max' ? '상한(이하·미만)' : spec.bound === 'min' ? '하한(이상·초과)' : '범주'}이어야 하는데 '${ODD_OP_TEXT[c.op]}'로 적혀 있습니다.` });
    if (c.axis === 'EXCLUSION') continue;
    if (spec.bound !== 'set' && c.value !== null && toBase(c.value, c.unit, spec.quantity) === null) out.push({ code: 'UNIT_UNKNOWN', key: c.key, short: `단위 해석 불가(${c.label})`, message: `${c.label}의 단위 ${c.unit ?? '없음'}을 해석하지 못했습니다.` });
    const lim = p.envelope.find((e) => e.key === c.key) ?? null;
    if (lim && fits) {
      const r = compareToLimit(c.key, c, lim);
      if (r.verdict === 'EXCEEDS') out.push({ code: 'ENVELOPE_EXCEEDED', key: c.key, short: '승인 상한 초과', message: `${c.label} ${r.reason}` });
    }
  }
  // 필수 조건(FFP-F026) — 승인 상한에 required로 둔 조건이 프로파일에 없으면 승인하지 않는다
  for (const e of p.envelope.filter((x) => x.required && !p.conditions.some((c) => c.key === x.key && c.axis !== 'EXCLUSION')))
    out.push({ code: 'REQUIRED_MISSING', key: e.key, short: `필수 조건 없음(${e.label})`, message: `승인 상한의 필수 조건 ${e.label}이(가) 프로파일 조건에 없습니다.` });
  for (const ex of p.conditions.filter((c) => c.axis === 'EXCLUSION' && Array.isArray(c.value))) {
    for (const c of p.conditions.filter((x) => x.axis !== 'EXCLUSION' && x.key === ex.key && x.op === 'IN' && Array.isArray(x.value))) {
      const both = (c.value as string[]).filter((v) => (ex.value as string[]).includes(v));
      if (both.length) out.push({ code: 'EXCLUSION_OVERLAP', key: c.key, short: `배제 우선 위반(${both.join('·')})`, message: `배제 조건의 ${both.join('·')}이(가) ${ODD_AXIS_LABEL[c.axis]} 조건에 포함되어 있습니다 — 배제가 우선합니다.` });
    }
  }
  return out;
}

/** 승인 막힘 사유 — ux ADS-UI04 primaryAction 문장 */
export function oddApprovalBlockedReason(issues: OddIssue[]): string | null {
  if (!issues.length) return null;
  const shorts = [...new Set(issues.map((i) => i.short))];
  return `의미 검증 오류 ${issues.length}건(${shorts.join(', ')})이 남아 승인할 수 없습니다 — 초안에서 고친 뒤 다시 검증하세요.`;
}

/** 직무 분리 — 초안 작성자는 자기 프로파일을 승인하지 않는다(기능안전 담당이어도) */
export const ODD_SELF_APPROVAL = '초안 작성자는 자기 ODD 프로파일을 승인할 수 없습니다 — 다른 기능안전 담당자가 승인합니다.';

/** 배포 설정 한 줄(정책 매개변수)과 승인 상한 비교 */
export interface DeploySetting {
  settingId: string;
  featureId: string;
  featureVersion: string;
  flagKey: string;
  key: string;
  label: string;
  op: OddOp;
  value: number | string[] | null;
  unit: string | null;
}
export interface DeployComparison extends DeploySetting {
  verdict: LimitVerdict;
  reason: string;
  limitText: string | null;
}
export function compareDeploySettings(settings: DeploySetting[], envelope: OddCondition[]): DeployComparison[] {
  return settings.map((s) => {
    const lim = envelope.find((e) => e.key === s.key) ?? null;
    return { ...s, ...compareToLimit(s.key, s, lim), limitText: lim ? oddConditionText(lim) : null };
  });
}
export function countVerdicts(rows: { verdict: LimitVerdict }[]): Record<LimitVerdict, number> {
  const c: Record<LimitVerdict, number> = { WITHIN: 0, EXCEEDS: 0, UNDECIDABLE: 0 };
  for (const r of rows) c[r.verdict]++;
  return c;
}

/** 적용 장소(site) — 상태 낱말은 승인됨·승인 대기·노출 보류 셋(ux ADS-UI04 3회차 확정안) */
export type SiteStatus = 'APPROVED' | 'PENDING' | 'EXPOSURE_HOLD';
export const SITE_STATUS_LABEL: Record<SiteStatus, string> = { APPROVED: '승인됨', PENDING: '승인 대기', EXPOSURE_HOLD: '노출 보류' };
export interface OddSite {
  siteId: string;
  name: string;
  kind: 'PARKING' | 'ZONE' | 'ROAD_SECTION';
  mapVersion: string;
  infraVersion: string;
  /** 변경 영향(인증·안전 판단) 범위 확정 여부 — 미확정이면 승인 대기(IMPACT_REVIEW_OPEN) */
  impactConfirmed: boolean;
}
/** 장소 상태 — 지도·인프라 버전이 승인 상한 밖이면 노출 보류(상품 노출·활성 허용 안 함), 변경 영향 미확정이면 승인 대기 */
export function siteStatus(site: OddSite, approved: { mapVersions: string[]; infraVersions: string[] }): { status: SiteStatus; reason: string; code: string | null } {
  if (!approved.mapVersions.includes(site.mapVersion)) return { status: 'EXPOSURE_HOLD', reason: `노출 보류 — 지도 버전 ${site.mapVersion}이 승인 상한 밖`, code: 'SITE_MAP_OUT_OF_ENVELOPE' };
  if (!approved.infraVersions.includes(site.infraVersion)) return { status: 'EXPOSURE_HOLD', reason: `노출 보류 — 인프라 버전 ${site.infraVersion}이 승인 상한 밖`, code: 'SITE_INFRA_OUT_OF_ENVELOPE' };
  if (!site.impactConfirmed) return { status: 'PENDING', reason: '승인 대기 — 변경 영향(인증·안전 판단) 범위 확정 전', code: 'IMPACT_REVIEW_OPEN' };
  return { status: 'APPROVED', reason: '승인됨 — 지도·인프라 버전이 승인 상한 안', code: null };
}

/** 프로파일 조건 변경 전후 — 축·키별(배제 먼저), 바뀐 줄만 */
export function oddConditionDiff(before: OddCondition[], after: OddCondition[]): { field: string; before: string; after: string }[] {
  const keyOf = (c: OddCondition) => `${c.axis}|${c.key}`;
  const order = (k: string) => ODD_AXES.indexOf(k.split('|')[0] as OddAxis);
  const keys = [...new Set([...before, ...after].map(keyOf))].sort((a, b) => order(a) - order(b));
  const rows: { field: string; before: string; after: string }[] = [];
  for (const k of keys) {
    const b = before.find((c) => keyOf(c) === k);
    const a = after.find((c) => keyOf(c) === k);
    const bt = b ? oddConditionText(b) : '—';
    const at = a ? oddConditionText(a) : '—';
    const c = (a ?? b)!;
    if (bt !== at) rows.push({ field: `${ODD_AXIS_LABEL[c.axis]} · ${c.label}`, before: bt, after: at });
  }
  return rows;
}

export type OddProfileStatus = 'DRAFT' | 'APPROVED';
export interface OddProfile {
  profileId: string;
  featureId: string;
  featureVersion: string;
  version: number;
  status: OddProfileStatus;
  /** 이 초안이 바꾼 이전 프로파일 — 변경 전후 비교 기준 */
  basedOn: string | null;
  conditions: OddCondition[];
  /** 승인 상한(Envelope) */
  envelope: OddCondition[];
  /** 승인 상한 안의 지도·인프라 버전 */
  mapVersions: string[];
  infraVersions: string[];
  sites: OddSite[];
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalReason: string | null;
}

/** 목록 행(GET /api/odd-profiles) */
export interface OddProfileListItem {
  profileId: string;
  featureId: string;
  featureVersion: string;
  featureName: string | null;
  version: number;
  status: OddProfileStatus;
  issues: number;
  deploy: Record<LimitVerdict, number>;
  sites: Record<SiteStatus, number>;
}

// ───────────────────────── 승인 조합(config_set) · 보안 최소 버전 (ADS-BE10) ─────────────────────────

export interface ConfigSet {
  setId: string;
  featureId: string;
  featureVersion: string;
  hw: { ecuPno: string; hwRevision: string }[];
  ecuSw: { ecuPno: string; swId: string; version: string }[];
  model: { id: string; version: string } | null;
  calibration: { id: string; version: string } | null;
  oddProfileId: string | null;
  flagKey: string | null;
  /** 보안 최소 버전(anti-rollback 하한) — SW별 */
  securityMin: { swId: string; version: string }[];
  /** 등록 = 제안(PROPOSED), 다른 사람이 승인해야 대조·발행 근거(rules/ads-config-approval.ts) */
  status: 'PROPOSED' | 'APPROVED';
  proposedBy: string | null;
  proposedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalReason?: string | null;
}
export interface VehicleConfigReport {
  vin: string;
  /** 차량이 형상을 보고한 시각 — null이면 보고 없음 */
  reportedAt: string | null;
  ecus: { ecuPno: string; hwRevision: string; sw: { swId: string; version: string }[] }[];
  model: { id: string; version: string } | null;
  calibration: { id: string; version: string } | null;
  /** 복구 명령 진행 — 대상 ECU와 차량이 복구를 보고한 ECU */
  recovery: { targets: string[]; recovered: string[] } | null;
  /** 복구 후보(되돌릴 SW 버전) — 보안 최소 버전 아래면 후보 불가 */
  recoveryCandidate: { swId: string; version: string } | null;
}

export type CompatClass = 'MATCH' | 'MISMATCH' | 'PARTIAL_RECOVERY' | 'BELOW_SECURITY_MIN' | 'UNCONFIRMED';
export const COMPAT_CLASSES: CompatClass[] = ['MATCH', 'MISMATCH', 'PARTIAL_RECOVERY', 'BELOW_SECURITY_MIN', 'UNCONFIRMED'];
export const COMPAT_LABEL: Record<CompatClass, string> = { MATCH: '부합', MISMATCH: '불일치', PARTIAL_RECOVERY: '부분 복구', BELOW_SECURITY_MIN: '보안 최소 버전 미달', UNCONFIRMED: '형상 미확인' };
/** 형상 보고 기준 시간 — 넘기면 형상 미확인(부합으로 세지 않음) */
export const CONFIG_REPORT_STALE_MS = 24 * 3600_000;

/** 보안 최소 버전 위반 SW — 조합 등록·복구 후보·차량 보고 공통 */
export function belowSecurityMin(sw: { swId: string; version: string }[], mins: ConfigSet['securityMin']): { swId: string; version: string; min: string }[] {
  const out: { swId: string; version: string; min: string }[] = [];
  for (const s of sw) {
    const m = mins.find((x) => x.swId === s.swId);
    const c = m ? semverCompare(s.version, m.version) : null;
    if (m && c !== null && c < 0) out.push({ swId: s.swId, version: s.version, min: m.version });
  }
  return out;
}

/** 보안 최소 버전 합치기 — SW마다 높은 쪽(요청으로 낮출 수 없다). 비교할 수 없으면 앞(기존) 값을 둔다 */
export function mergeSecurityMin(base: ConfigSet['securityMin'], extra: ConfigSet['securityMin']): ConfigSet['securityMin'] {
  const out = new Map(base.map((m) => [m.swId, m]));
  for (const m of extra) {
    const cur = out.get(m.swId);
    if (!cur || semverCompare(m.version, cur.version) === 1) out.set(m.swId, m);
  }
  return [...out.values()];
}

/** 조합 등록 검사 — ECU SW 하나라도 보안 최소 버전보다 낮거나 비교할 수 없으면 등록 거부(ux ADS-UI05 primaryAction, 판단 불가는 통과로 보지 않는다) */
export function configSetRegistrationBlocker(set: Pick<ConfigSet, 'ecuSw' | 'securityMin'>): string | null {
  if (belowSecurityMin(set.ecuSw, set.securityMin).length) return 'ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.';
  const uncomparable = set.ecuSw.some((s) => {
    const m = set.securityMin.find((x) => x.swId === s.swId);
    return !!m && semverCompare(s.version, m.version) === null;
  });
  return uncomparable ? 'ECU SW 버전을 보안 최소 버전과 비교할 수 없어 이 조합을 등록할 수 없습니다.' : null;
}

/** 복구 후보 — '승인 조합으로 복구 가능/불가'(이전 버전 복귀를 기본 해법처럼 쓰지 않는다, ux ADS-UI05) */
export function recoveryCandidateVerdict(set: Pick<ConfigSet, 'securityMin'>, candidate: { swId: string; version: string } | null): { allowed: boolean | null; reason: string } {
  if (!candidate) return { allowed: null, reason: '복구 후보 없음' };
  const low = belowSecurityMin([candidate], set.securityMin);
  if (low.length) return { allowed: false, reason: `복구 후보 불가 — 보안 최소 버전 미달(${candidate.swId} ${candidate.version} < ${low[0].min})` };
  return { allowed: true, reason: `승인 조합으로 복구 가능(${candidate.swId} ${candidate.version})` };
}

export interface CompatVerdict {
  cls: CompatClass;
  reasons: string[];
  /** 부분 복구 — ECU별 복구됨·미복구 글자 목록(a11y: 막대 색만으로 두지 않는다) */
  ecus: { ecuPno: string; state: 'RECOVERED' | 'NOT_RECOVERED' }[];
  recovery: { allowed: boolean | null; reason: string };
  code: string;
}

/**
 * 차량 보고 형상 ↔ 승인 조합 대조. 순서: 보고 없음·기준 시간 초과 → 형상 미확인(부합으로 세지 않음), 복구 일부만 → 부분 복구(RECOVERY_PARTIAL),
 * 보안 최소 버전 아래 SW → 보안 최소 버전 미달, 한 요소라도 다르면 불일치(CONFIG_SET_NOT_APPROVED — 개별 버전이 모두 유효해도), 모두 같으면 부합.
 */
export function classifyVehicleConfig(set: ConfigSet, report: VehicleConfigReport | null, now: number, staleAfterMs = CONFIG_REPORT_STALE_MS): CompatVerdict {
  const recovery = recoveryCandidateVerdict(set, report?.recoveryCandidate ?? null);
  const base = { ecus: [] as CompatVerdict['ecus'], recovery };
  if (!report || !report.reportedAt) return { ...base, cls: 'UNCONFIRMED', reasons: ['형상 보고 없음'], code: 'CONFIG_UNREPORTED' };
  if (!(now - Date.parse(report.reportedAt) <= staleAfterMs)) return { ...base, cls: 'UNCONFIRMED', reasons: [`형상 보고 기준 시간(${Math.round(staleAfterMs / 3600_000)}시간) 초과`], code: 'CONFIG_STALE' };
  const rec = report.recovery;
  if (rec && rec.recovered.length > 0 && rec.targets.some((t) => !rec.recovered.includes(t))) {
    const ecus = rec.targets.map((e) => ({ ecuPno: e, state: rec.recovered.includes(e) ? ('RECOVERED' as const) : ('NOT_RECOVERED' as const) }));
    return { ...base, cls: 'PARTIAL_RECOVERY', reasons: ecus.map((e) => `${e.ecuPno} ${e.state === 'RECOVERED' ? '복구됨' : '미복구'}`), ecus, code: 'RECOVERY_PARTIAL' };
  }
  const low = belowSecurityMin(report.ecus.flatMap((e) => e.sw), set.securityMin);
  if (low.length) return { ...base, cls: 'BELOW_SECURITY_MIN', reasons: low.map((x) => `${x.swId} ${x.version} < 보안 최소 ${x.min}`), code: 'SECURITY_MIN_VIOLATION' };
  const reasons: string[] = [];
  for (const h of set.hw) {
    const e = report.ecus.find((x) => x.ecuPno === h.ecuPno);
    if (!e) reasons.push(`HW ${h.ecuPno} 없음`);
    else if (e.hwRevision !== h.hwRevision) reasons.push(`HW ${h.ecuPno} ${e.hwRevision} ≠ ${h.hwRevision}`);
  }
  for (const s of set.ecuSw) {
    const got = report.ecus.find((x) => x.ecuPno === s.ecuPno)?.sw.find((x) => x.swId === s.swId);
    if (!got) reasons.push(`SW ${s.swId} 보고 없음`);
    else if (got.version !== s.version) reasons.push(`SW ${s.swId} ${got.version} ≠ ${s.version}`);
  }
  if (set.model && (report.model?.id !== set.model.id || report.model?.version !== set.model.version)) reasons.push(`모델 ${report.model?.version ?? '보고 없음'} ≠ ${set.model.version}`);
  if (set.calibration && (report.calibration?.id !== set.calibration.id || report.calibration?.version !== set.calibration.version)) reasons.push(`보정 ${report.calibration?.version ?? '보고 없음'} ≠ ${set.calibration.version}`);
  if (reasons.length) return { ...base, cls: 'MISMATCH', reasons, code: 'CONFIG_SET_NOT_APPROVED' };
  return { ...base, cls: 'MATCH', reasons: ['승인 조합과 같음'], code: 'CONFIG_SET_MATCH' };
}

/** 승인 조합 밖 차량 = 불일치 + 부분 복구 + 보안 최소 버전 미달. 형상 미확인은 따로(부합·밖 어느 쪽에도 넣지 않는다) */
export function compatSummary(rows: { cls: CompatClass }[]): { outside: number; partial: number; unconfirmed: number; match: number; total: number } {
  const n = (k: CompatClass) => rows.filter((r) => r.cls === k).length;
  return { outside: n('MISMATCH') + n('PARTIAL_RECOVERY') + n('BELOW_SECURITY_MIN'), partial: n('PARTIAL_RECOVERY'), unconfirmed: n('UNCONFIRMED'), match: n('MATCH'), total: rows.length };
}

/** 승인 조합 목록 행·차량 대조 행(GET /api/config-sets, /:id/vehicles) */
export interface ConfigSetListItem extends ConfigSet {
  featureName: string | null;
  counts: Record<CompatClass, number>;
}
export interface ConfigVehicleRow extends CompatVerdict {
  vin: string;
  label: string;
  reportedAt: string | null;
  sw: { swId: string; version: string }[];
}

// ───────────────────────── VIN 지원 판정 (ORC-BE02) ─────────────────────────

/** 4상태 + 판매 대상 아님(시장·권리 미충족). 판단 불가·미확인 사유가 하나라도 있으면 '차량 확인 필요' — 구매 가능으로 표시하지 않는다 */
export type EligibilityState = 'ELIGIBLE' | 'UPDATE_REQUIRED' | 'HW_MISSING' | 'VEHICLE_CHECK' | 'NOT_OFFERED';
export const ELIGIBILITY_STATES: Exclude<EligibilityState, 'NOT_OFFERED'>[] = ['ELIGIBLE', 'UPDATE_REQUIRED', 'HW_MISSING', 'VEHICLE_CHECK'];
export const ELIGIBILITY_LABEL: Record<EligibilityState, string> = {
  ELIGIBLE: '바로 구매 가능(지원 확인됨)',
  UPDATE_REQUIRED: '업데이트 후 가능',
  HW_MISSING: '부품 미장착',
  VEHICLE_CHECK: '차량 확인 필요',
  NOT_OFFERED: '판매 대상 아님',
};
export type ReasonAxis = 'MARKET' | 'SW' | 'HW' | 'RIGHTS';
export const REASON_AXES: ReasonAxis[] = ['MARKET', 'SW', 'HW', 'RIGHTS'];
export const REASON_AXIS_LABEL: Record<ReasonAxis, string> = { MARKET: '시장 승인', SW: 'SW', HW: 'HW', RIGHTS: '권리' };
/** 칸 결과 — 미확인(관측 없음·기준 시간 초과·연동 전)과 판단 불가(근거 부족)를 나눈다(P-9) */
export type ReasonResult = 'MET' | 'UNMET' | 'UNDECIDABLE' | 'UNCONFIRMED';
export const REASON_RESULT_LABEL: Record<ReasonResult, string> = { MET: '충족', UNMET: '미충족', UNDECIDABLE: '판단 불가', UNCONFIRMED: '미확인' };
export interface EligibilityReason {
  axis: ReasonAxis;
  result: ReasonResult;
  basis: string;
  code: string;
}

/** OTA 설치 기록(IF-05, ADS-OTA01) 연동 전 — '업데이트 후 가능'을 내지 않는다(ux ORC-UI02 4회차 확정안) */
export const OTA_INSTALL_LINKED = false;

/**
 * 상태 결정 — 시장·권리 미충족 → 판매 대상 아님, HW 미충족 → 부품 미장착, 판단 불가·미확인 하나라도 → 차량 확인 필요,
 * SW만 미충족 → 업데이트 후 가능(설치 기록 연동 뒤에만 — 그 전에는 SW 칸이 미확인으로 온다), 모두 충족 → 바로 구매 가능.
 */
export function eligibilityState(reasons: EligibilityReason[]): EligibilityState {
  const r = (a: ReasonAxis) => reasons.find((x) => x.axis === a)?.result ?? 'UNDECIDABLE';
  if (r('MARKET') === 'UNMET' || r('RIGHTS') === 'UNMET') return 'NOT_OFFERED';
  if (r('HW') === 'UNMET') return 'HW_MISSING';
  if (REASON_AXES.some((a) => r(a) === 'UNDECIDABLE' || r(a) === 'UNCONFIRMED')) return 'VEHICLE_CHECK';
  if (r('SW') === 'UNMET') return 'UPDATE_REQUIRED';
  return 'ELIGIBLE';
}

export interface EligibilityInput {
  vehicle: { vin: string; country: string };
  catalog: { catalogId: string; country: string; saleType: string };
  /** 법적 승인 — 시장 Compliance Profile(없으면 null). ADS Feature는 ADS Profile도 확인이어야 한다 */
  legalProfile: { profileId: string; status: string } | null;
  /** 내부 상품 승인(product_market_approval) — 없으면 null */
  productApproval: { approvedBy: string } | null;
  /** 판정 기준 Feature(상품 구성의 대표 Feature) — 필요 SW·ECU */
  feature: { featureId: string; version: string; swId: string | null; requiredSw: string | null; ecuPnos: string[] } | null;
  /** 출고 구성 기록 ECU 목록(ORC-UI08 전에는 없음) */
  asBuiltEcus: string[] | null;
  report: VehicleConfigReport | null;
  /** 같은 VIN·상품 권한 이력 */
  grants: { grantId: string; kind: string; status: string; validTo: string }[];
  now: number;
  staleAfterMs?: number;
  otaLinked?: boolean;
}

/** VIN × 상품 지원 판정 — 사유 4칸(시장 승인·SW·HW·권리)과 상태 */
export function decideEligibility(i: EligibilityInput): { state: EligibilityState; reasons: EligibilityReason[]; headline: string } {
  const stale = i.staleAfterMs ?? CONFIG_REPORT_STALE_MS;
  const out: Partial<Record<ReasonAxis, EligibilityReason>> = {};
  const put = (axis: ReasonAxis, result: ReasonResult, basis: string, code: string) => (out[axis] = { axis, result, basis, code });
  // 시장 승인 — 법적 승인(Profile 확인)과 내부 상품 승인을 다른 코드로
  const mk = i.vehicle.country;
  if (mk !== i.catalog.country) put('MARKET', 'UNMET', `상품 시장 ${i.catalog.country} — 차량 시장 ${mk}`, 'MARKET_MISMATCH');
  else if (!i.legalProfile || i.legalProfile.status !== 'CONFIRMED') put('MARKET', 'UNDECIDABLE', `시장 Profile(승인 시장) 기준 — ${mk} Profile ${i.legalProfile ? '검증 필요' : '없음'}`, 'LEGAL_APPROVAL_UNCONFIRMED');
  else if (!i.productApproval) put('MARKET', 'UNDECIDABLE', `시장 Profile(승인 시장) 기준 — 법적 승인 확인, 내부 상품 승인 기록 없음(${mk})`, 'PRODUCT_APPROVAL_MISSING');
  else put('MARKET', 'MET', `시장 Profile(승인 시장) 기준 — ${i.legalProfile.profileId} 확인 · 내부 상품 승인 ${mk}`, 'MARKET_APPROVED');
  // HW — 출고 구성 기록 또는 차량 보고 구성으로 확인될 때만 충족
  const need = [...new Set(i.feature?.ecuPnos ?? [])];
  const known = i.asBuiltEcus ?? (i.report?.reportedAt ? i.report.ecus.map((e) => e.ecuPno) : null);
  const source = i.asBuiltEcus ? '출고 구성 기록' : '차량 보고 구성';
  const missing = known ? need.filter((e) => !known.includes(e)) : [];
  if (!i.feature) put('HW', 'UNDECIDABLE', '상품 구성의 Feature를 찾지 못함', 'FEATURE_UNKNOWN');
  else if (!known) put('HW', 'UNDECIDABLE', '출고 구성 기록 없음 · 차량 보고 구성 없음', 'AS_BUILT_UNKNOWN');
  else if (missing.length) put('HW', 'UNMET', `필요 ECU ${missing.join('·')} 없음(${source})`, 'HW_MISSING');
  else put('HW', 'MET', `필요 ECU ${need.join('·')} 확인(${source})`, 'HW_PRESENT');
  // SW — 차량 보고 구성의 기능 앱 SW와 필요 버전
  const req = i.feature?.requiredSw ?? null;
  const swId = i.feature?.swId ?? null;
  const rep = i.report;
  if (!req || !swId) put('SW', 'MET', 'SW 조건 없음', 'SW_NO_REQUIREMENT');
  else if (!rep?.reportedAt) put('SW', 'UNCONFIRMED', `SW ${req} 필요 — 형상 보고 없음`, 'CONFIG_UNREPORTED');
  else if (!(i.now - Date.parse(rep.reportedAt) <= stale)) put('SW', 'UNCONFIRMED', `SW ${req} 필요 — 형상 보고 ${Math.max(0, Math.round((i.now - Date.parse(rep.reportedAt)) / 86_400_000))}일 전`, 'CONFIG_STALE');
  else {
    const got = rep.ecus.flatMap((e) => e.sw).find((s) => s.swId === swId)?.version ?? null;
    const c = got ? semverCompare(got, req) : null;
    if (!got) put('SW', 'UNDECIDABLE', `SW ${req} 필요 — ${swId} 보고 없음`, 'SW_UNREPORTED');
    else if (c === null) put('SW', 'UNDECIDABLE', `SW ${req} 필요 — 보고 버전 ${got} 해석 못함`, 'SW_UNPARSEABLE');
    else if (c >= 0) put('SW', 'MET', `SW ${got} — 필요 ${req} 이상`, 'SW_OK');
    else if (i.otaLinked ?? OTA_INSTALL_LINKED) put('SW', 'UNMET', `SW ${req} 필요(현재 ${got}) — 업데이트 뒤 사용`, 'SW_UPDATE_REQUIRED');
    else put('SW', 'UNCONFIRMED', `SW ${req} 필요(현재 ${got}) — 설치 기록 연동 전`, 'OTA_INSTALL_UNLINKED');
  }
  // 권리 — 지금 권리(제안·사용 중)가 있으면 충족, 체험 상품은 1회
  const today = new Date(i.now).toISOString().slice(0, 10);
  const live = i.grants.find((g) => (g.status === 'ACTIVE' || g.status === 'OFFERED') && g.validTo.slice(0, 10) >= today);
  const usedTrial = i.catalog.saleType === '체험' ? i.grants.find((g) => g !== live && g.kind === '체험' && ['ACTIVE', 'EXPIRED', 'CONVERTED'].includes(g.status)) : undefined;
  if (live) put('RIGHTS', 'MET', `권리 보유 중 ${live.grantId}(${live.status === 'OFFERED' ? '제안' : live.kind})`, 'RIGHTS_HELD');
  else if (usedTrial) put('RIGHTS', 'UNMET', `체험 1회 사용함 ${usedTrial.grantId}`, 'TRIAL_USED');
  else put('RIGHTS', 'MET', '권리 충돌 없음', 'RIGHTS_FREE');
  const reasons = REASON_AXES.map((a) => out[a]!);
  const state = eligibilityState(reasons);
  return { state, reasons, headline: eligibilityHeadline(state, reasons) };
}

/** 핵심 메시지 문장 — '차량 확인 필요 — SW 1.3.0 필요, 설치 기록 연동 전이라 미확인'(ux ORC-UI02 keyMessage 형식, 값만 데이터) */
export function eligibilityHeadline(state: EligibilityState, reasons: EligibilityReason[]): string {
  const label = ELIGIBILITY_LABEL[state];
  const of = (code: string) => reasons.find((r) => r.code === code);
  if (state === 'VEHICLE_CHECK') {
    const ota = of('OTA_INSTALL_UNLINKED');
    if (ota) return `${label} — SW ${ota.basis.match(/SW (\S+) 필요/)?.[1] ?? ''} 필요, 설치 기록 연동 전이라 미확인`;
    if (of('AS_BUILT_UNKNOWN')) return `${label} — 판단 불가(출고 구성 기록 없음)`;
    const stale = of('CONFIG_STALE');
    if (stale) return `${label} — 미확인(형상 보고 ${stale.basis.match(/(\d+)일 전/)?.[1] ?? ''}일 전)`;
    if (of('CONFIG_UNREPORTED')) return `${label} — 미확인(형상 보고 없음)`;
    const first = reasons.find((r) => r.result === 'UNDECIDABLE' || r.result === 'UNCONFIRMED');
    return first ? `${label} — ${REASON_RESULT_LABEL[first.result]}(${first.basis})` : label;
  }
  const axes: ReasonAxis[] = state === 'HW_MISSING' ? ['HW'] : state === 'UPDATE_REQUIRED' ? ['SW'] : ['MARKET', 'RIGHTS'];
  const unmet = state === 'ELIGIBLE' ? undefined : reasons.find((r) => r.result === 'UNMET' && axes.includes(r.axis));
  return unmet ? `${label} — ${unmet.basis}` : label;
}
