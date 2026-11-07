// JIRA Epic = FF Feature(80-50 §4, D-ALM-1) — Epic 필드 표·주인·작업 중 버전 고르기·FF가 Epic에 쓸 값.
// 엔진(백엔드 ext-sync)·화면·모의 서버가 같은 표를 읽는다. 순수 함수만(환경 변수는 인자로 받는다).
import type { Lifecycle } from '../../enums';

/** Epic 사용자 필드 — 키는 FF 쪽 이름, 값은 JIRA 필드 ID(customfield_xxxxx). 실서버 ID는 JIRA_FIELDS(JSON)로 모은다 */
export const EPIC_FIELD_KEYS = ['country', 'vehicleModel', 'trim', 'asil', 'ownerId', 'featureDb', 'featureId', 'workingVersion', 'releaseVersion', 'gates', 'workProducts', 'ffLink'] as const;
export type EpicFieldKey = (typeof EPIC_FIELD_KEYS)[number];

/**
 * 주인이 아닌 쪽(JIRA)에서 바꾸면(§4.2):
 *   immutable — 늘 되돌림(범위 변경은 새 Feature) · request — 작업 중 버전이 PROPOSED면 초안 수정 요청, 아니면 되돌림
 *   review — 사람이 고름(기능안전 담당 확인, 검토함) · readonly — 되돌림
 */
export type EpicFieldChange = 'immutable' | 'request' | 'review' | 'readonly';
export interface EpicFieldRule {
  key: EpicFieldKey;
  /** JIRA 화면의 필드 이름(모의 서버도 같은 이름으로 만든다) */
  name: string;
  /** 화면 안내용 한국어 이름 */
  ko: string;
  change: EpicFieldChange;
  /** JIRA 필드 모양 — option은 { value }, array는 문자열 목록 */
  schema: 'string' | 'option' | 'array' | 'url';
  /** 옛 환경 변수(필드마다 하나) — JIRA_FIELDS에 없으면 이것을 읽는다(하위 호환) */
  legacyEnv?: string;
  /** 프로세스 내 모의 연결의 필드 ID */
  mockId: string;
}
export const EPIC_FIELDS: readonly EpicFieldRule[] = [
  { key: 'country', name: 'FF Country', ko: '국가', change: 'immutable', schema: 'string', legacyEnv: 'JIRA_FIELD_COUNTRY', mockId: 'ffCountry' },
  { key: 'vehicleModel', name: 'FF Vehicle Model', ko: '차종', change: 'immutable', schema: 'string', legacyEnv: 'JIRA_FIELD_VEHICLE_MODEL', mockId: 'ffVehicleModel' },
  { key: 'trim', name: 'FF Trim', ko: '트림', change: 'immutable', schema: 'string', legacyEnv: 'JIRA_FIELD_TRIM', mockId: 'ffTrim' },
  { key: 'asil', name: 'ASIL', ko: 'ASIL', change: 'review', schema: 'option', legacyEnv: 'JIRA_FIELD_ASIL', mockId: 'ffAsil' },
  { key: 'ownerId', name: 'FF Owner Team', ko: '담당 조직', change: 'request', schema: 'string', legacyEnv: 'JIRA_FIELD_OWNER', mockId: 'ffOwner' },
  { key: 'featureDb', name: 'FF Feature DB', ko: 'Feature DB 기준 기능', change: 'request', schema: 'array', legacyEnv: 'JIRA_FIELD_FEATURE_DB', mockId: 'ffFeatureDb' },
  { key: 'featureId', name: 'FF Feature ID', ko: 'Feature ID', change: 'readonly', schema: 'string', mockId: 'ffFeatureId' },
  { key: 'workingVersion', name: 'FF Working Version', ko: '작업 중 버전', change: 'readonly', schema: 'string', mockId: 'ffWorkingVersion' },
  { key: 'releaseVersion', name: 'FF Release Version', ko: '출시 버전', change: 'readonly', schema: 'string', mockId: 'ffReleaseVersion' },
  { key: 'gates', name: 'FF Gates', ko: '게이트', change: 'readonly', schema: 'string', mockId: 'ffGates' },
  { key: 'workProducts', name: 'FF Work Products', ko: '산출물 작성률', change: 'readonly', schema: 'string', mockId: 'ffWorkProducts' },
  { key: 'ffLink', name: 'FF Link', ko: 'Feature Platform 링크', change: 'readonly', schema: 'url', mockId: 'ffLink' },
];
export const EPIC_FIELD = Object.fromEntries(EPIC_FIELDS.map((f) => [f.key, f])) as Record<EpicFieldKey, EpicFieldRule>;

/**
 * Epic 필드 ID 표 — JIRA_FIELDS(JSON, 키 → customfield_xxxxx) > 옛 변수(JIRA_FIELD_COUNTRY 등) > 모의 기본값.
 * live에서 읽기 전용 필드 ID가 없으면 그 필드는 쓰지 않는다(빈 값) — mock 기본값은 live가 아닐 때만.
 */
export function parseJiraFields(get: (key: string) => string | undefined, live: boolean): { ids: Partial<Record<EpicFieldKey, string>> } | { error: string } {
  const raw = (get('JIRA_FIELDS') ?? '').trim();
  let map: Record<string, unknown> = {};
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
      map = v as Record<string, unknown>;
    } catch {
      return { error: 'JIRA_FIELDS는 JSON 객체여야 합니다 — 예: {"country":"customfield_10010"}' };
    }
    for (const [k, x] of Object.entries(map)) {
      if (!(EPIC_FIELD_KEYS as readonly string[]).includes(k)) return { error: `JIRA_FIELDS의 '${k}'는 Epic 필드가 아닙니다 — 쓸 수 있는 키: ${EPIC_FIELD_KEYS.join(', ')}` };
      if (typeof x !== 'string' || !x.trim()) return { error: `JIRA_FIELDS.${k} 값이 비어 있습니다` };
    }
  }
  const ids: Partial<Record<EpicFieldKey, string>> = {};
  for (const f of EPIC_FIELDS) {
    const id = (typeof map[f.key] === 'string' ? (map[f.key] as string).trim() : '') || (f.legacyEnv ? (get(f.legacyEnv) ?? '').trim() : '') || (live ? '' : f.mockId);
    if (id) ids[f.key] = id;
  }
  const seen = new Map<string, string>();
  for (const [k, id] of Object.entries(ids)) {
    if (seen.has(id)) return { error: `JIRA 필드 ${id}를 ${seen.get(id)}와 ${k}가 함께 씁니다 — 서로 달라야 합니다` };
    seen.set(id, k);
  }
  return { ids };
}

/** 한 Feature의 버전 하나(Epic 계산에 필요한 값만) */
export interface EpicVersionInput {
  featureId: string;
  version: string;
  name: string;
  description?: string;
  lifecycle: Lifecycle;
  country: string;
  vehicleModel: string;
  trim: string;
  asil: string;
  ownerId: string;
  featureRefs?: { refId: string; role: 'PRIMARY' | 'INCLUDED' }[];
}

const PRE_RELEASE: readonly Lifecycle[] = ['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED'];
const RELEASED_LIKE: readonly Lifecycle[] = ['RELEASED', 'DEPRECATED'];
const semver = (v: string) => v.split('.').map(Number);
const byVersion = (a: { version: string }, b: { version: string }) => {
  const [x, y] = [semver(a.version), semver(b.version)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * Epic이 따르는 버전(§4.1, D10 A-1 기본값) — 작업 중 버전 = 가장 최근에 만든(가장 높은) 출시 전 버전.
 * 없으면 가장 높은 출시 버전(RELEASED·DEPRECATED), 그것도 없으면 가장 높은 버전. 출시 버전 칸 = 가장 높은 RELEASED(없으면 DEPRECATED).
 */
export function epicVersions<T extends { version: string; lifecycle: Lifecycle }>(versions: readonly T[]): { epic: T | null; working: T | null; released: T | null } {
  const sorted = [...versions].sort(byVersion);
  const working = [...sorted].reverse().find((v) => PRE_RELEASE.includes(v.lifecycle)) ?? null;
  const latestReleased = [...sorted].reverse().find((v) => RELEASED_LIKE.includes(v.lifecycle)) ?? null;
  const released = [...sorted].reverse().find((v) => v.lifecycle === 'RELEASED') ?? latestReleased;
  return { epic: working ?? latestReleased ?? sorted.at(-1) ?? null, working, released };
}

/** Epic 제목 `[FF] {이름} — {국가}/{차종}/{트림}` — 이름은 작업 중 버전 것 */
export const epicSummary = (f: Pick<EpicVersionInput, 'name' | 'country' | 'vehicleModel' | 'trim'>) => `[FF] ${f.name} — ${f.country}/${f.vehicleModel}/${f.trim}`;
/** 제목에서 이름만 — FF 형식이 아니면 제목 전체(JIRA에서 만든 Epic) */
export function nameOfEpicSummary(summary: string): string {
  const m = /^\[FF\]\s+(.+?)\s+—\s+[^—/]+\/[^—]+\/[^—]+$/.exec(summary.trim());
  return (m ? m[1] : summary).trim();
}

/** 게이트 칸 — `G1 PASS · G2 FAIL · G3 —` */
export function gatesText(latest: Partial<Record<string, string>>, gates: readonly string[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']): string {
  return gates.map((g) => `${g} ${latest[g] ?? '—'}`).join(' · ');
}

/** FF가 Epic에 쓸 값(주인 = FF) — 화면·대사·거울 쓰기가 같은 값을 기대값으로 쓴다 */
export interface EpicDesired {
  featureId: string;
  /** Epic 상태가 따르는 버전 */
  version: string;
  lifecycle: Lifecycle;
  summary: string;
  fields: Record<EpicFieldKey, string | string[] | null>;
}
export function epicDesired(versions: readonly EpicVersionInput[], extra: { gates?: Partial<Record<string, string>>; workProducts?: string | null; link?: string | null } = {}): EpicDesired | null {
  const { epic, working, released } = epicVersions(versions);
  if (!epic) return null;
  const refs = epic.featureRefs ?? [];
  const featureDb = [...refs.filter((r) => r.role === 'PRIMARY'), ...refs.filter((r) => r.role !== 'PRIMARY')].map((r) => r.refId);
  return {
    featureId: epic.featureId,
    version: epic.version,
    lifecycle: epic.lifecycle,
    summary: epicSummary(epic),
    fields: {
      country: epic.country,
      vehicleModel: epic.vehicleModel,
      trim: epic.trim,
      asil: epic.asil,
      ownerId: epic.ownerId,
      featureDb: featureDb.length ? featureDb : null,
      featureId: epic.featureId,
      workingVersion: working?.version ?? null,
      releaseVersion: released?.version ?? null,
      gates: extra.gates ? gatesText(extra.gates) : null,
      workProducts: extra.workProducts ?? null,
      ffLink: extra.link ?? null,
    },
  };
}

/** 두 필드 값이 같은가 — 목록은 순서까지, 비었으면 null과 같다 */
export function sameEpicValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (Array.isArray(v)) return v.length ? v.map((x) => String(x).trim().toUpperCase()).join(',') : null;
    return String(v).trim();
  };
  return n(a) === n(b);
}

/** 원격 Epic 필드 중 FF 기대값과 다른 키(원격에 실린 키만 본다) */
export function epicFieldDiff(desired: EpicDesired, remote: Partial<Record<EpicFieldKey, unknown>>): EpicFieldKey[] {
  return EPIC_FIELD_KEYS.filter((k) => k in remote && !sameEpicValue(remote[k], desired.fields[k]));
}
