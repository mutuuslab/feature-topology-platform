// Feature 등록 자동 채움(docs/20-architecture/20-60 §5.3) — 기준 행(Feature DB, 26580 feature catalogue 항목)에서 사람이 고르던 칸을 제안한다.
// 순수 함수: 등록 화면(제안 표시)과 백엔드(등록 때 다시 계산해 출처·결정 이력 기록)가 같은 결과를 낸다. 자동 채움은 작성 보조이며 승인 판정의 입력이 아니다.
import type { Asil, ControlPointType } from '../../enums';
import type { AutofillDecision, AutofillSourceKind, FeatureVariability, VariationPoint } from '../../schemas/ple';
import { REF_INTERNAL_GLOSSARY, type RefInternalTerm } from '../refdb/internal-glossary';
import { jcs } from '../jcs';

/** 자동 채움이 읽는 기준 행 필드(검색·상세 응답의 일부 — 금액 필드 없음) */
export interface PleRef {
  refId: string;
  status: string;
  nameKo: string;
  nameEn: string;
  aliases?: readonly string[];
  domain: string;
  cluster?: string;
  component: string;
  swStack?: string;
  lifecycle?: string;
  vehicleType?: string;
  region?: string;
  asilRep: Asil;
  tshirt: string;
  bundleId?: string | null;
  bundleRep?: boolean | null;
  requires?: readonly string[];
  excludes?: readonly string[];
  sourceDetail?: string;
  definition?: {
    level?: string | null;
    parentRefId?: string | null;
    summary?: string | null;
    regulations?: string | null;
    io?: { read?: string | null; write?: string | null } | null;
    drivers?: { dtcs?: string | null; calibrations?: string | null; variants?: string | null } | null;
  } | null;
}

/** 자동 채움이 읽는 Feature 요약(목록 응답의 일부) */
export interface PleFeature {
  featureId: string;
  version: string;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  lifecycle: string;
  asil?: string;
  controlPoints?: readonly string[];
  swIds?: readonly string[];
  ecuPnos?: readonly string[];
  ownerId?: string;
  featureRefs?: readonly { refId: string; role: string }[];
}

export interface PleScope {
  country: string;
  vehicleModel: string;
  trim: string;
}

export type AutofillKey = 'name' | 'description' | 'asil' | 'tags' | 'regulations' | 'domain' | 'component' | 'swLayer' | 'tshirt' | 'controlPoints' | 'scope' | 'owner' | 'variability';

export interface AutofillSource {
  kind: AutofillSourceKind;
  /** 기준 행 ID·사내 용어·규칙 이름 */
  ref: string;
  /** 어느 열·근거 — 화면 출처 표시 */
  column: string;
}

export interface AutofillField {
  key: AutofillKey;
  value: string | string[];
  source: AutofillSource;
  note?: string;
}

export interface ScopeCandidate extends PleScope {
  /** 같은 컴포넌트를 쓰는 Feature 수(카탈로그 근거) */
  sameComponent: number;
  reason: string;
}

export type RelatedKind = 'REQUIRES' | 'REQUIRED_BY' | 'EXCLUDES' | 'BUNDLE' | 'SAME_COMPONENT';
export interface RelatedCandidate {
  featureId: string;
  version: string;
  name: string;
  scope: PleScope;
  kind: RelatedKind;
  viaRef: string;
  reason: string;
}

export type DuplicateKind = 'SAME_SCOPE' | 'OTHER_SCOPE' | 'SIMILAR_NAME';
export interface DuplicateHint {
  kind: DuplicateKind;
  featureId: string;
  version: string;
  name: string;
  scope: PleScope;
  /** SAME_SCOPE는 서버가 사유 없이는 받지 않는다(409) */
  blocking: boolean;
  message: string;
}

export interface AutofillResult {
  refId: string;
  fields: AutofillField[];
  scopeCandidates: ScopeCandidate[];
  related: RelatedCandidate[];
  duplicates: DuplicateHint[];
  variability: FeatureVariability;
}

const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const num = (s: string | null | undefined) => {
  const n = parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const refSrc = (ref: string, column: string): AutofillSource => ({ kind: 'REF', ref, column });

/** 분류 태그 — 기준 행의 도메인·컴포넌트·SW 계층·수명주기·차종·지역(30-95 §6.3과 같은 순서) */
export function refTags(r: PleRef): string[] {
  return uniq([r.domain, r.component, r.swStack, r.lifecycle, r.vehicleType, r.region].map((x) => (x ?? '').replace(/,/g, ' ').trim()).filter(Boolean)).map((x) => x.slice(0, 80));
}

/** 규제·표준 조항 — '·'·';'로 이어 쓴 엑셀 값을 나눈다(요구사항 ID가 아님) */
export function refRegulations(r: PleRef): string[] {
  const parts = [r.definition?.regulations ?? '', r.sourceDetail ?? ''].flatMap((s) => s.split(/\s+·\s+|;\s*/));
  return uniq(parts.map((x) => x.trim()).filter(Boolean)).map((x) => x.slice(0, 500));
}

/** 제어점 계획 — Flag는 런타임 켬/끔 변이점(FF 제어 기본), 나머지는 기준 행 정의(⑩⑪ 신호·⑬ 고장 코드·⑭ 보정 값)가 있을 때만 */
export function controlPointPlan(r: PleRef): { type: ControlPointType; source: AutofillSource; note: string }[] {
  const d = r.definition ?? {};
  const out: { type: ControlPointType; source: AutofillSource; note: string }[] = [{ type: 'Flag', source: { kind: 'RULE', ref: 'FLAG_DEFAULT', column: '런타임 켬/끔' }, note: '모든 Feature는 Flag로 켜고 끈다' }];
  const cal = num(d.drivers?.calibrations);
  if (cal > 0) out.push({ type: 'Parameter', source: refSrc(r.refId, '⑭ 보정 값'), note: `보정 값 ${cal}개` });
  if ((d.io?.read ?? '').trim() || (d.io?.write ?? '').trim()) out.push({ type: 'Signal', source: refSrc(r.refId, '⑩⑪ 신호'), note: [d.io?.read, d.io?.write].filter((x) => x && x.trim()).join(' / ').slice(0, 120) });
  const dtc = num(d.drivers?.dtcs);
  if (dtc > 0) out.push({ type: 'DTC', source: refSrc(r.refId, '⑬ 고장 코드'), note: `고장 코드 ${dtc}개` });
  return out;
}

/** 기준 행의 카탈로그 상위 — 정의 ② 상위 ID('없음'·'; ' 구분) 첫 값, 없으면 묶음 대표 행(자기가 대표면 없음) */
export function catalogueParentOf(r: PleRef, bundleRepOf?: (bundleId: string) => string | undefined): string | null {
  const raw = (r.definition?.parentRefId ?? '').split(/;\s*/).map((x) => x.trim()).find((x) => x && x !== '없음');
  if (raw) return raw;
  if (r.bundleId && !r.bundleRep && bundleRepOf) {
    const rep = bundleRepOf(r.bundleId);
    if (rep && rep !== r.refId) return rep;
  }
  return null;
}

/** 26580 변이 프로필 제안(§5.2) — 사람이 고칠 수 있다. 공통(MANDATORY)은 제안하지 않는다(26580 3.4 Note 2: 공통 특성은 feature가 아님) */
export function proposeVariability(r: PleRef, opts: { controlPoints?: readonly string[]; swIds?: readonly string[]; bundleRepOf?: (bundleId: string) => string | undefined } = {}): FeatureVariability {
  const parent = catalogueParentOf(r, opts.bundleRepOf);
  const cps = opts.controlPoints ?? controlPointPlan(r).map((c) => c.type);
  const variants = num(r.definition?.drivers?.variants);
  const vps: VariationPoint[] = [];
  const d = r.definition ?? {};
  if (cps.includes('Flag')) vps.push({ vpId: 'VP-FLAG', assetKind: 'FLAG', asset: `flag:${r.refId.toLowerCase()}`, mapping: '선택 → 켬 · 미선택 → 끔' });
  if (cps.includes('Parameter')) vps.push({ vpId: 'VP-PARAM', assetKind: 'PARAMETER', asset: `보정 값 ${num(d.drivers?.calibrations) || '세트'}${num(d.drivers?.calibrations) ? '개' : ''}`, mapping: variants > 1 ? `변형 ${variants}개 중 선택한 보정 세트` : '선택 → 보정 세트 적용' });
  if (cps.includes('Signal')) vps.push({ vpId: 'VP-SIG', assetKind: 'SIGNAL', asset: ([d.io?.read, d.io?.write].filter((x) => x && x.trim()).join(' / ') || r.component).slice(0, 200), mapping: '선택 → 신호 송수신 · 미선택 → 송신 안 함' });
  if (cps.includes('DTC')) vps.push({ vpId: 'VP-DTC', assetKind: 'DTC', asset: `고장 코드 ${num(d.drivers?.dtcs) || ''}${num(d.drivers?.dtcs) ? '개' : '목록'}`, mapping: '선택 → 진단 활성 · 미선택 → 진단 꺼짐' });
  const sw = opts.swIds?.length ? opts.swIds : [r.component];
  for (const [i, s] of sw.slice(0, 4).entries()) vps.push({ vpId: `VP-SW${i + 1}`, assetKind: 'SW_COMPONENT', asset: s.slice(0, 200), mapping: '선택 → 컴포넌트 포함·구성' });
  return {
    catalogueRole: parent ? 'SUB' : 'PRIMARY',
    parentRefId: parent,
    featureType: variants > 1 ? 'ENUM' : 'BOOLEAN',
    variability: r.excludes?.length ? 'ALTERNATIVE' : 'OPTIONAL',
    bindingTime: cps.includes('Flag') ? 'RUNTIME_FLAG' : cps.includes('Parameter') ? 'CALIBRATION' : 'BUILD',
    variationPoints: vps,
  };
}

/** 지역 표기(엑셀 AD열) → 국가 코드. '글로벌'은 모든 등록 국가 */
export const REGION_COUNTRIES: Record<string, readonly string[] | 'ALL'> = {
  글로벌: 'ALL',
  'UNECE 협약국': ['EU', 'KR', 'JP', 'AU', 'ME'],
  'Euro NCAP': ['EU'],
  'EU(GSR)': ['EU'],
  EU: ['EU'],
  '미국(CARB OBD)': ['US'],
  '미국(FMVSS)': ['US'],
  '중국(GB)': ['CN'],
  '인도(AIS)': ['IN'],
};

export function regionCountries(region: string | undefined, known: readonly string[]): string[] {
  const m = REGION_COUNTRIES[(region ?? '').trim()];
  if (!m || m === 'ALL') return [...known].sort();
  return known.filter((c) => m.includes(c)).sort();
}

const scopeKey = (s: PleScope) => `${s.country}|${s.vehicleModel}|${s.trim}`;
const primaryOf = (f: PleFeature) => f.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;

/** 적용 범위 후보 — 지역에 맞는 국가의 등록 범위(Feature·상품), 같은 컴포넌트를 쓰는 Feature가 많은 범위 먼저 */
export function scopeCandidates(r: PleRef, features: readonly PleFeature[], refsById: ReadonlyMap<string, PleRef>, extra: readonly PleScope[] = [], limit = 8): ScopeCandidate[] {
  const all = new Map<string, PleScope>();
  for (const s of [...features, ...extra]) all.set(scopeKey(s), { country: s.country, vehicleModel: s.vehicleModel, trim: s.trim });
  const countries = regionCountries(r.region, uniq([...all.values()].map((s) => s.country)));
  const same = new Map<string, number>();
  for (const f of features) {
    const p = primaryOf(f);
    if (p && refsById.get(p)?.component === r.component) same.set(scopeKey(f), (same.get(scopeKey(f)) ?? 0) + 1);
  }
  const fleet = (r.vehicleType ?? '').trim();
  return [...all.values()]
    .filter((s) => countries.includes(s.country))
    .map((s) => {
      const n = same.get(scopeKey(s)) ?? 0;
      const why = [n ? `같은 컴포넌트 Feature ${n}건` : '', `지역 ${r.region || '미지정'}`, fleet && fleet !== '공통' ? `차종 유형 ${fleet}(확인 필요)` : ''].filter(Boolean).join(' · ');
      return { ...s, sameComponent: n, reason: why };
    })
    .sort((a, b) => b.sameComponent - a.sameComponent || scopeKey(a).localeCompare(scopeKey(b)))
    .slice(0, limit);
}

/** 담당 후보 — 같은 컴포넌트, 없으면 같은 도메인 Feature가 가장 많이 쓰는 담당(가장 최근 Version 기준). 없으면 null */
export function ownerCandidate(r: PleRef, features: readonly PleFeature[], refsById: ReadonlyMap<string, PleRef>): { owner: string; basis: 'COMPONENT' | 'DOMAIN'; count: number } | null {
  const latest = latestByFeature(features).filter((f) => !!f.ownerId?.trim());
  for (const basis of ['COMPONENT', 'DOMAIN'] as const) {
    const n = new Map<string, number>();
    for (const f of latest) {
      const p = refsById.get(primaryOf(f) ?? '');
      if (p && (basis === 'COMPONENT' ? p.component === r.component : p.domain === r.domain)) n.set(f.ownerId!, (n.get(f.ownerId!) ?? 0) + 1);
    }
    const best = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) return { owner: best[0], basis, count: best[1] };
  }
  return null;
}

/** 관련 Feature 후보 — 기준 행 선행(REQUIRES)·배타·같은 묶음·같은 컴포넌트, 이 행을 선행으로 쓰는 Feature. dependency는 만들지 않는다(사람이 Topology에서) */
export function relatedCandidates(r: PleRef, features: readonly PleFeature[], refsById: ReadonlyMap<string, PleRef>, scope?: PleScope, limit = 12): RelatedCandidate[] {
  const out: RelatedCandidate[] = [];
  const seen = new Set<string>();
  const latest = latestByFeature(features);
  const push = (f: PleFeature, kind: RelatedKind, viaRef: string, reason: string) => {
    const k = `${f.featureId}|${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ featureId: f.featureId, version: f.version, name: f.name, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, kind, viaRef, reason });
  };
  const order = (xs: PleFeature[]) => xs.sort((a, b) => Number(scope ? scopeKey(b) === scopeKey(scope) : 0) - Number(scope ? scopeKey(a) === scopeKey(scope) : 0) || a.featureId.localeCompare(b.featureId));
  for (const req of r.requires ?? []) for (const f of order(latest.filter((f) => primaryOf(f) === req))) push(f, 'REQUIRES', req, `선행 기준 행 ${req}`);
  for (const ex of r.excludes ?? []) for (const f of order(latest.filter((f) => primaryOf(f) === ex))) push(f, 'EXCLUDES', ex, `배타 기준 행 ${ex}`);
  for (const f of order(latest.filter((f) => (refsById.get(primaryOf(f) ?? '')?.requires ?? []).includes(r.refId)))) push(f, 'REQUIRED_BY', primaryOf(f)!, `이 기능을 선행으로 쓰는 ${primaryOf(f)}`);
  if (r.bundleId) for (const f of order(latest.filter((f) => { const p = refsById.get(primaryOf(f) ?? ''); return !!p && p.refId !== r.refId && p.bundleId === r.bundleId; }))) push(f, 'BUNDLE', primaryOf(f)!, `같은 묶음 ${r.bundleId}`);
  for (const f of order(latest.filter((f) => { const p = refsById.get(primaryOf(f) ?? ''); return !!p && p.refId !== r.refId && p.component === r.component; }))) push(f, 'SAME_COMPONENT', primaryOf(f)!, `같은 컴포넌트 ${r.component}`);
  return out.slice(0, limit);
}

/** Feature ID마다 가장 높은 Version 하나 */
export function latestByFeature<T extends { featureId: string; version: string }>(features: readonly T[]): T[] {
  const m = new Map<string, T>();
  const cmp = (a: string, b: string) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  for (const f of features) { const p = m.get(f.featureId); if (!p || cmp(f.version, p.version) > 0) m.set(f.featureId, f); }
  return [...m.values()];
}

/** 이름 단어 — 영문·숫자 덩어리와 한글 덩어리(두 글자 이상). 한/영을 붙여 쓴 글("Seat메모리")도 글자 종류가 바뀌는 곳에서 나눈다 */
export function nameTokens(s: string): string[] {
  return uniq((s.toLowerCase().match(/[0-9a-z]+|[가-힣]+/g) ?? []).filter((t) => t.length >= 2));
}

/** 이름 유사도 — 공백·대소문자 무시 포함 관계면 1, 아니면 단어 Jaccard */
export function nameSimilarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  // 포함 관계 — 서버 등록 거부(FeatureRepo.similar)와 같은 규칙이라 미리 경고한 것만 거부된다
  if (x === y || x.includes(y) || y.includes(x)) return 1;
  const ta = new Set(nameTokens(a)), tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

export const SIMILAR_NAME_THRESHOLD = 0.6;

/** 중복·유사 경고 — 같은 범위 같은 대표 행(서버 409), 다른 범위 같은 대표 행(새 범위 확인), 같은 범위 비슷한 이름 */
export function duplicateHints(input: { refId: string; name?: string; scope?: PleScope }, features: readonly PleFeature[]): DuplicateHint[] {
  const out: DuplicateHint[] = [];
  const latest = latestByFeature(features).filter((f) => f.lifecycle !== 'RETIRED');
  for (const f of latest) {
    const scope = { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim };
    const same = !!input.scope && scopeKey(scope) === scopeKey(input.scope);
    if (primaryOf(f) === input.refId) {
      out.push(same
        ? { kind: 'SAME_SCOPE', featureId: f.featureId, version: f.version, name: f.name, scope, blocking: true, message: `같은 범위에 같은 기준 행을 쓰는 ${f.featureId}가 있습니다 — 새 Version인지 확인하세요.` }
        : { kind: 'OTHER_SCOPE', featureId: f.featureId, version: f.version, name: f.name, scope, blocking: false, message: `${f.country}·${f.vehicleModel}·${f.trim}에 같은 기능(${f.featureId})이 있습니다 — 새 범위 등록이 맞는지 확인하세요.` });
    } else if (same && input.name && nameSimilarity(input.name, f.name) >= SIMILAR_NAME_THRESHOLD) {
      out.push({ kind: 'SIMILAR_NAME', featureId: f.featureId, version: f.version, name: f.name, scope, blocking: false, message: `같은 범위에 이름이 비슷한 ${f.featureId}(${f.name})가 있습니다.` });
    }
  }
  const rank: Record<DuplicateKind, number> = { SAME_SCOPE: 0, SIMILAR_NAME: 1, OTHER_SCOPE: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.featureId.localeCompare(b.featureId)).slice(0, 10);
}

/** 대표 기준 행 하나로 등록 칸을 채운다 — 화면 미리 채움과 서버 출처 기록이 같은 함수 */
export function autofillFromRef(
  r: PleRef,
  ctx: { features: readonly PleFeature[]; refsById: ReadonlyMap<string, PleRef>; scopes?: readonly PleScope[]; scope?: PleScope; name?: string },
): AutofillResult {
  const cps = controlPointPlan(r);
  const regs = refRegulations(r);
  const description = (r.definition?.summary?.trim() || r.nameEn).slice(0, 2000);
  const bundleRepOf = (b: string) => [...ctx.refsById.values()].find((x) => x.bundleId === b && x.bundleRep)?.refId;
  const variability = proposeVariability(r, { controlPoints: cps.map((c) => c.type), bundleRepOf });
  const scopes = scopeCandidates(r, ctx.features, ctx.refsById, ctx.scopes ?? []);
  const owner = ownerCandidate(r, ctx.features, ctx.refsById);
  const fields: AutofillField[] = [
    { key: 'name', value: r.nameKo.slice(0, 200), source: refSrc(r.refId, '한글 기능명(G)') },
    { key: 'description', value: description, source: refSrc(r.refId, r.definition?.summary?.trim() ? '③ 기능 요약' : '영문 기능명(F)') },
    { key: 'asil', value: r.asilRep, source: refSrc(r.refId, '대표 ASIL(L)') },
    { key: 'domain', value: r.domain, source: refSrc(r.refId, '도메인(B)') },
    { key: 'component', value: r.component, source: refSrc(r.refId, '컴포넌트(D)') },
    ...(r.swStack ? [{ key: 'swLayer' as const, value: r.swStack, source: refSrc(r.refId, 'SW 계층(E)') }] : []),
    { key: 'tshirt', value: r.tshirt, source: refSrc(r.refId, 'T-shirt(S)') },
    { key: 'tags', value: refTags(r), source: refSrc(r.refId, '분류 열 B·D·E·H·AC·AD') },
    ...(regs.length ? [{ key: 'regulations' as const, value: regs, source: refSrc(r.refId, '⑯ 규제·표준 · 출처 상세(Z)') }] : []),
    { key: 'controlPoints', value: cps.map((c) => c.type), source: { kind: 'RULE', ref: 'CONTROL_POINT_PLAN', column: cps.map((c) => `${c.type}: ${c.source.column}`).join(' · ') }, note: cps.map((c) => `${c.type} ${c.note}`).join(' · ') },
    ...(owner ? [{ key: 'owner' as const, value: owner.owner, source: { kind: 'CATALOGUE' as const, ref: 'OWNERS', column: owner.basis === 'COMPONENT' ? `같은 컴포넌트 Feature ${owner.count}건의 담당` : `같은 도메인 Feature ${owner.count}건의 담당` } }] : []),
    ...(scopes[0] ? [{ key: 'scope' as const, value: [scopes[0].country, scopes[0].vehicleModel, scopes[0].trim], source: { kind: 'CATALOGUE' as const, ref: 'SCOPES', column: `등록 범위 ${scopes.length}곳 중 첫 후보` }, note: scopes[0].reason }] : []),
    { key: 'variability', value: [variability.catalogueRole, variability.featureType, variability.variability, variability.bindingTime], source: { kind: 'RULE', ref: 'VARIABILITY_PROPOSAL', column: '26580 변이 프로필 제안' } },
  ];
  return {
    refId: r.refId,
    fields,
    scopeCandidates: scopes,
    related: relatedCandidates(r, ctx.features, ctx.refsById, ctx.scope),
    duplicates: duplicateHints({ refId: r.refId, name: ctx.name, scope: ctx.scope }, ctx.features),
    variability,
  };
}

// ───────── 이름·설명 → 기준 행 추천 ─────────

/** 기준 행 → 자동 채움이 읽는 필드만(금액 열·관리 메모 없음) — 응답에 행 전체를 싣지 않는다 */
export function pleRefOf(r: PleRef): PleRef {
  const d = r.definition;
  return {
    refId: r.refId, status: r.status, nameKo: r.nameKo, nameEn: r.nameEn, aliases: r.aliases, domain: r.domain, cluster: r.cluster, component: r.component,
    swStack: r.swStack, lifecycle: r.lifecycle, vehicleType: r.vehicleType, region: r.region, asilRep: r.asilRep, tshirt: r.tshirt, bundleId: r.bundleId ?? null, bundleRep: r.bundleRep ?? null,
    requires: r.requires, excludes: r.excludes, sourceDetail: r.sourceDetail,
    definition: d ? { level: d.level ?? null, parentRefId: d.parentRefId ?? null, summary: d.summary ?? null, regulations: d.regulations ?? null, io: d.io ?? null, drivers: d.drivers ?? null } : null,
  };
}

export interface RefSuggestion {
  /** 고르기에 쓰는 기준 행(금액 없음) */
  ref: PleRef;
  refId: string;
  nameKo: string;
  nameEn: string;
  domain: string;
  component: string;
  asilRep: Asil;
  status: string;
  score: number;
  reasons: string[];
}

/** 이름·설명 글에서 기준 행 후보 — 기능명 포함·별칭·사내 용어(`REF_INTERNAL_GLOSSARY`)·단어 겹침. 폐기 행은 빼고 점수 순 */
export function suggestRefsFromText(text: string, refs: readonly PleRef[], glossary: readonly RefInternalTerm[] = REF_INTERNAL_GLOSSARY, limit = 8): RefSuggestion[] {
  const t = norm(text);
  if (t.length < 2) return [];
  const tokens = nameTokens(text);
  const gloss = new Map<string, string[]>();
  for (const g of glossary) if (norm(g.term).length >= 2 && t.includes(norm(g.term))) for (const id of g.refIds) gloss.set(id, [...(gloss.get(id) ?? []), g.term]);
  const out: RefSuggestion[] = [];
  for (const r of refs) {
    if (r.status === 'RETIRED') continue;
    let score = 0;
    const reasons: string[] = [];
    for (const n of [r.nameKo, r.nameEn]) if (norm(n).length >= 2 && t.includes(norm(n))) { score += 10; reasons.push(`기능명 '${n}'`); break; }
    const alias = (r.aliases ?? []).find((a) => norm(a).length >= 2 && t.includes(norm(a)));
    if (alias) { score += 8; reasons.push(`별칭 '${alias}'`); }
    for (const g of gloss.get(r.refId) ?? []) { score += 9; reasons.push(`사내 용어 '${g}'`); }
    const name = new Set([...nameTokens(r.nameKo), ...nameTokens(r.nameEn)]);
    const hit = tokens.filter((x) => name.has(x));
    if (hit.length) { score += 3 * hit.length; reasons.push(`단어 ${hit.slice(0, 3).map((x) => `'${x}'`).join('·')}`); }
    const summary = new Set(nameTokens(r.definition?.summary ?? ''));
    const sh = tokens.filter((x) => summary.has(x) && !name.has(x)).length;
    if (sh) score += sh;
    if (score >= 3) out.push({ ref: pleRefOf(r), refId: r.refId, nameKo: r.nameKo, nameEn: r.nameEn, domain: r.domain, component: r.component, asilRep: r.asilRep, status: r.status, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.refId.localeCompare(b.refId)).slice(0, limit);
}

// ───────── 등록 때 칸별 결정(출처 이력) ─────────

/** 등록 최종 값(본문) — 자동 채움 결정 비교 대상 */
export interface RegisteredValues {
  name: string;
  description: string;
  asil: string;
  tags: readonly string[];
  refRegulations?: readonly string[];
  controlPoints: readonly string[];
  ownerId?: string;
  country: string;
  vehicleModel: string;
  trim: string;
  variability?: FeatureVariability | null;
}

export interface AutofillDecisionRow {
  field: string;
  sourceKind: AutofillSourceKind | null;
  sourceRef: string | null;
  suggested: unknown;
  final: unknown;
  decision: AutofillDecision;
}

const sameSet = (a: readonly string[], b: readonly string[]) => uniq(a).sort().join('\u0000') === uniq(b).sort().join('\u0000');
/** 프로필 칸 비교 — 변이점은 제어점에서 만드는 값이라 빼고 본다(제어점을 고친 것은 controlPoints 칸이 EDITED). 화면 '기준값/수정됨'과 같은 규칙 */
export const sameProfile = (a: FeatureVariability, b: FeatureVariability) => jcs({ ...a, variationPoints: [] }) === jcs({ ...b, variationPoints: [] });
/** 이력 출처 문장 — 기준 행은 'ID · 열', 규칙·카탈로그는 사람이 읽는 근거만(내부 규칙 이름은 싣지 않는다) */
const sourceText = (s: AutofillSource) => (s.kind === 'REF' ? `${s.ref} · ${s.column}` : s.column).slice(0, 300);

/** 제안과 최종 값 비교 → 칸별 ACCEPTED·EDITED·ADDED. 범위는 후보 중 하나면 ACCEPTED */
export function autofillDecisions(result: AutofillResult, v: RegisteredValues): AutofillDecisionRow[] {
  const f = (k: AutofillKey) => result.fields.find((x) => x.key === k);
  const rows: AutofillDecisionRow[] = [];
  const row = (field: string, fld: AutofillField | undefined, final: unknown, same: boolean) =>
    rows.push({ field, sourceKind: fld?.source.kind ?? null, sourceRef: fld ? sourceText(fld.source) : null, suggested: fld?.value ?? null, final, decision: !fld ? 'ADDED' : same ? 'ACCEPTED' : 'EDITED' });
  const str = (k: AutofillKey) => String(f(k)?.value ?? '');
  row('name', f('name'), v.name, v.name.trim() === str('name').trim());
  row('description', f('description'), v.description, v.description.trim() === str('description').trim());
  row('asil', f('asil'), v.asil, v.asil === str('asil'));
  row('tags', f('tags'), [...v.tags], sameSet(v.tags, (f('tags')?.value as string[]) ?? []));
  if (v.refRegulations?.length || f('regulations')) row('regulations', f('regulations'), [...(v.refRegulations ?? [])], sameSet(v.refRegulations ?? [], (f('regulations')?.value as string[]) ?? []));
  row('controlPoints', f('controlPoints'), [...v.controlPoints], sameSet(v.controlPoints, (f('controlPoints')?.value as string[]) ?? []));
  if (v.ownerId !== undefined) row('owner', f('owner'), v.ownerId, v.ownerId.trim() === str('owner').trim());
  const scope = { country: v.country, vehicleModel: v.vehicleModel, trim: v.trim };
  const sf = f('scope');
  rows.push({ field: 'scope', sourceKind: sf ? 'CATALOGUE' : null, sourceRef: sf ? sourceText(sf.source) : null, suggested: result.scopeCandidates.map((s) => [s.country, s.vehicleModel, s.trim]), final: [scope.country, scope.vehicleModel, scope.trim], decision: !result.scopeCandidates.length ? 'ADDED' : result.scopeCandidates.some((s) => scopeKey(s) === scopeKey(scope)) ? 'ACCEPTED' : 'EDITED' });
  const fv = v.variability ?? null;
  rows.push({ field: 'variability', sourceKind: 'RULE', sourceRef: '26580 변이 프로필 제안', suggested: result.variability, final: fv ?? result.variability, decision: !fv || sameProfile(fv, result.variability) ? 'ACCEPTED' : 'EDITED' });
  return rows;
}
