// 협력사 패키지·검수 규칙(D05-01, 80-60) — 필수 산출물 누락(FR-SPM-002-003), 패키징 품질·무결성·메타데이터(FR-QGV-002-002~004),
// 검수 기준 자동 판정(FR-SPM-003-002), 협력사 책임 범위(FR-SPM-004-001)·Test Evidence 현황(004-002)·Contract Gap(004-003), 협력사 담당자(긴급 차단 연락 대상).
// 백엔드(supplier.service)·화면(협력사 패키지·검수)이 같은 계산을 쓴다. 해시 계산은 서버가 하고 결과(integrity)만 여기서 읽는다.
import type { Asil } from '../enums';
import {
  SUPPLIER_ARTIFACT_TYPES,
  type CapabilityManifest,
  type SubmitSupplierArtifactBody,
  type SupplierArtifactType,
  type SupplierCriterion,
  type SupplierCriterionKind,
  type SupplierPackageStatus,
  type TestEvidenceSummary,
  type VariantCompat,
} from '../schemas/supplier';

// ── 기록 ─────────────────────────────────────────────
export interface SupplierSwc {
  swcId: string;
  name: string;
  swId: string | null;
  ecuPno: string | null;
  addedBy: string;
  addedAt: string;
}
export interface SupplierMappingRow {
  mapId: string;
  featureId: string;
  supplier: string;
  supplierFunctionId: string;
  name: string;
  oemFunctionId: string | null;
  swcs: SupplierSwc[];
  status: 'ACTIVE';
  createdBy: string;
  createdAt: string;
}
/** 산출물 무결성 — VERIFIED(본문을 서버가 다시 계산해 일치), DECLARED(체크섬만 신고 — 판정 불가), MISMATCH(다시 계산한 값이 다름) */
export type ArtifactIntegrity = 'VERIFIED' | 'DECLARED' | 'MISMATCH';
export type SupplierArtifactRow = SubmitSupplierArtifactBody & {
  recordId: string;
  packageId: string;
  submittedBy: string;
  submittedAt: string;
  integrity: ArtifactIntegrity;
  /** 이어받은 산출물이면 원래 기록 */
  carriedFrom: string | null;
};
export interface SupplierPackageRow {
  packageId: string;
  featureId: string;
  featureVersion: string;
  supplier: string;
  version: string;
  status: SupplierPackageStatus;
  basedOn: string | null;
  createdBy: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  submitNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}
export interface SupplierCriteriaRow {
  criteriaId: string;
  featureId: string;
  revision: number;
  items: SupplierCriterion[];
  reason: string;
  createdBy: string;
  createdAt: string;
}
export interface SupplierReviewRow {
  reviewId: string;
  packageId: string;
  decision: 'ACCEPT' | 'REJECT';
  comment: string;
  items: { type: SupplierArtifactType; result: 'PASS' | 'FAIL'; comment: string | null }[];
  /** 판정 때의 자동 확인 결과(기준 개정 번호·종합) */
  criteriaRevision: number | null;
  checkVerdict: AcceptanceVerdict;
  reviewedBy: string;
  reviewedAt: string;
}
/** 협력사 담당자(IF-08 Supplier Portal의 연락처) — 긴급 차단·사건 통지 대상(FR-KSW-003-002가 읽는다) */
export interface SupplierContact {
  contactId: string;
  name: string;
  duty: 'QUALITY' | 'TECHNICAL' | 'SECURITY' | 'FIELD';
  email: string;
  phone: string;
  /** 긴급 차단·안전 사건 때 연락하는가 */
  urgent: boolean;
}
export interface SupplierDirectoryEntry {
  supplier: string;
  displayName: string;
  contacts: SupplierContact[];
}

// ── 이름표(화면·메시지) ─────────────────────────────────
export const SUPPLIER_ARTIFACT_LABEL: Record<SupplierArtifactType, string> = {
  API_CONTRACT: 'API 계약',
  HUMAN_DOC: '개발 문서',
  FEATURE_MAPPING: 'Feature 매핑',
  CAPABILITY_MANIFEST: 'Capability Manifest',
  VARIANT_COMPAT: 'Variant Compatibility',
  DIAGNOSTICS: '진단·텔레메트리',
  SAFETY_SECURITY: '안전·보안',
  SDK_STUB_MOCK: 'SDK·Stub·Mock',
  TEST_EVIDENCE: 'Test Evidence',
  RELEASE_NOTE: 'Release Note',
};
export const SUPPLIER_CRITERION_LABEL: Record<SupplierCriterionKind, string> = {
  MIN_COVERAGE: '시험 커버리지 최소값(%)',
  ALL_TESTS_PASS: '단위·통합 시험 전부 통과',
  BUILD_CLEAN: '빌드 성공·경고 상한(건)',
  ASIL_COVERS_FEATURE: '안전 등급이 Feature ASIL 이상',
  VARIANT_COVERS_FEATURE: '적용 차량 조건이 Feature 범위를 포함',
  CAPABILITY_COVERS_SW: 'Capability가 Feature SW 버전을 포함',
  BREAKING_HAS_MIGRATION: '호환 깨짐 변경에 이전 방법 기재',
};
/** 필수 산출물 — 80-60 10항목 전부(결정 D-GAP-2). 검수 요청 때 하나라도 없으면 요청을 받지 않는다 */
export const REQUIRED_SUPPLIER_ARTIFACTS: readonly SupplierArtifactType[] = SUPPLIER_ARTIFACT_TYPES;

// ── 산출물 묶음 ─────────────────────────────────────────
/** 유형마다 가장 늦게 낸 산출물(같은 시각이면 기록 번호가 큰 것) */
export function latestArtifacts(records: SupplierArtifactRow[]): Partial<Record<SupplierArtifactType, SupplierArtifactRow>> {
  const out: Partial<Record<SupplierArtifactType, SupplierArtifactRow>> = {};
  for (const r of records) {
    const cur = out[r.type];
    if (!cur || r.submittedAt > cur.submittedAt || (r.submittedAt === cur.submittedAt && r.recordId > cur.recordId)) out[r.type] = r;
  }
  return out;
}

/** 필수 산출물 누락(FR-SPM-002-003) — 10항목 순서대로 */
export function missingArtifacts(latest: Partial<Record<SupplierArtifactType, unknown>>): SupplierArtifactType[] {
  return REQUIRED_SUPPLIER_ARTIFACTS.filter((t) => !latest[t]);
}

/** 체크섬 형식 — sha256:<64자리 16진수> */
export const CHECKSUM_FORMAT = /^sha256:[0-9a-f]{64}$/;

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export interface QualityCheck {
  key: 'PKG_ALL_ITEMS' | 'PKG_CHECKSUM_FORMAT' | 'PKG_INTEGRITY' | 'PKG_METADATA' | 'PKG_MAPPING_ACTIVE';
  label: string;
  /** 명세 요구 */
  requirement: string;
  result: CheckResult;
  detail: string;
}

/**
 * 패키징 품질 기준(FR-QGV-002-002) — 코드에 고정한 다섯 규칙. 무결성(FR-QGV-002-003)·메타데이터(FR-QGV-002-004)를 함께 본다.
 * featureVersions: 등록된 이 Feature의 Version 목록, activeMappingIds: 이 Feature·협력사의 매핑 ID
 */
export function packagingQuality(pkg: Pick<SupplierPackageRow, 'version' | 'featureVersion'>, latest: Partial<Record<SupplierArtifactType, SupplierArtifactRow>>, ctx: { featureVersions: string[]; activeMappingIds: string[] }): QualityCheck[] {
  const arts = SUPPLIER_ARTIFACT_TYPES.map((t) => latest[t]).filter((a): a is SupplierArtifactRow => !!a);
  const missing = missingArtifacts(latest);
  const badFormat = arts.filter((a) => !CHECKSUM_FORMAT.test(a.checksum));
  const mismatch = arts.filter((a) => a.integrity === 'MISMATCH');
  const declared = arts.filter((a) => a.integrity === 'DECLARED');
  // 저장된 옛 기록에 상태가 없어도 검증 완료로 추정하지 않는다. 서버가 본문을 확인한 VERIFIED만 통과 근거다.
  const unverified = arts.filter((a) => a.integrity !== 'VERIFIED');
  const note = latest.RELEASE_NOTE?.releaseNote ?? null;
  const meta: string[] = [];
  if (!note) meta.push('Release Note가 없어 배포 ID를 확인할 수 없습니다');
  else if (!note.releaseId.trim()) meta.push('Release Note에 배포 ID가 없습니다');
  if (!ctx.featureVersions.includes(pkg.featureVersion)) meta.push(`대상 Feature Version ${pkg.featureVersion}이(가) Registry에 없습니다`);
  const noVer = arts.filter((a) => !a.version.trim());
  if (noVer.length) meta.push(`버전이 없는 산출물: ${noVer.map((a) => SUPPLIER_ARTIFACT_LABEL[a.type]).join(', ')}`);
  const mapping = latest.FEATURE_MAPPING?.mappingIds ?? null;
  const stale = (mapping ?? []).filter((m) => !ctx.activeMappingIds.includes(m));
  return [
    {
      key: 'PKG_ALL_ITEMS',
      label: '10항목 모두 수집',
      requirement: 'FR-QGV-002-002',
      result: missing.length ? 'FAIL' : 'PASS',
      detail: missing.length ? `빠진 항목: ${missing.map((t) => SUPPLIER_ARTIFACT_LABEL[t]).join(', ')}` : '10항목이 모두 있습니다',
    },
    {
      key: 'PKG_CHECKSUM_FORMAT',
      label: '체크섬 형식(SHA-256)',
      requirement: 'FR-QGV-002-003',
      result: !arts.length ? 'NOT_EVALUABLE' : badFormat.length ? 'FAIL' : 'PASS',
      detail: badFormat.length ? `형식이 틀린 산출물: ${badFormat.map((a) => SUPPLIER_ARTIFACT_LABEL[a.type]).join(', ')}` : `${arts.length}건 모두 sha256 64자리`,
    },
    {
      key: 'PKG_INTEGRITY',
      label: '본문 체크섬 대조',
      requirement: 'FR-QGV-002-003',
      result: mismatch.length ? 'FAIL' : !arts.length || unverified.length ? 'NOT_EVALUABLE' : 'PASS',
      detail: mismatch.length
        ? `다시 계산한 값이 다른 산출물: ${mismatch.map((a) => SUPPLIER_ARTIFACT_LABEL[a.type]).join(', ')}`
        : `본문 대조 ${arts.length - unverified.length}건 일치${declared.length ? ` · 체크섬만 신고 ${declared.length}건` : ''}${unverified.length > declared.length ? ` · 검증 상태 미확인 ${unverified.length - declared.length}건` : ''}`,
    },
    { key: 'PKG_METADATA', label: '배포 ID·버전 정보', requirement: 'FR-QGV-002-004', result: meta.length ? 'FAIL' : 'PASS', detail: meta.length ? meta.join(' · ') : `배포 ID ${note!.releaseId} · 패키지 ${pkg.version} · Feature ${pkg.featureVersion}` },
    {
      key: 'PKG_MAPPING_ACTIVE',
      label: 'Feature 매핑이 등록된 매핑을 가리킴',
      requirement: 'FR-SPM-001-001',
      result: mapping === null ? 'NOT_EVALUABLE' : stale.length ? 'FAIL' : 'PASS',
      detail: mapping === null ? 'Feature 매핑 산출물이 없습니다' : stale.length ? `등록되지 않은 매핑: ${stale.join(', ')}` : `매핑 ${mapping.length}건 확인`,
    },
  ];
}

// ── 검수 기준 자동 판정 ─────────────────────────────────
const ASIL_RANK: Record<Asil, number> = { QM: 0, A: 1, B: 2, C: 3, D: 4 };
export interface FeatureScopeInput {
  featureId: string;
  version: string;
  asil: Asil;
  country: string;
  vehicleModel: string;
  trim: string;
  swIds: string[];
  swVersions: string[];
}
export interface CriterionResult {
  kind: SupplierCriterionKind;
  label: string;
  threshold: number | null;
  result: CheckResult;
  detail: string;
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
/** 기준 한 건 판정 — 판정에 쓸 산출물이 없으면 NOT_EVALUABLE(합격으로 보지 않는다) */
export function evaluateCriterion(c: SupplierCriterion, latest: Partial<Record<SupplierArtifactType, SupplierArtifactRow>>, f: FeatureScopeInput): CriterionResult {
  const base = { kind: c.kind, label: SUPPLIER_CRITERION_LABEL[c.kind], threshold: c.threshold };
  const no = (t: SupplierArtifactType) => ({ ...base, result: 'NOT_EVALUABLE' as const, detail: `${SUPPLIER_ARTIFACT_LABEL[t]} 산출물이 없습니다` });
  const t: TestEvidenceSummary | null = latest.TEST_EVIDENCE?.testEvidence ?? null;
  switch (c.kind) {
    case 'MIN_COVERAGE':
      if (!t) return no('TEST_EVIDENCE');
      return { ...base, result: t.coveragePct >= (c.threshold ?? 0) ? 'PASS' : 'FAIL', detail: `커버리지 ${pct(t.coveragePct)} (기준 ${pct(c.threshold ?? 0)} 이상)` };
    case 'ALL_TESTS_PASS': {
      if (!t) return no('TEST_EVIDENCE');
      const failed = t.unitTotal - t.unitPassed + (t.integrationTotal - t.integrationPassed);
      const total = t.unitTotal + t.integrationTotal;
      if (!total) return { ...base, result: 'FAIL', detail: '실행한 시험이 없습니다' };
      return { ...base, result: failed ? 'FAIL' : 'PASS', detail: failed ? `실패 ${failed}건 (단위 ${t.unitPassed}/${t.unitTotal}, 통합 ${t.integrationPassed}/${t.integrationTotal})` : `단위 ${t.unitTotal}건·통합 ${t.integrationTotal}건 모두 통과` };
    }
    case 'BUILD_CLEAN':
      if (!t) return no('TEST_EVIDENCE');
      if (t.buildStatus !== 'SUCCESS') return { ...base, result: 'FAIL', detail: '빌드가 실패했습니다' };
      return { ...base, result: t.buildWarnings <= (c.threshold ?? 0) ? 'PASS' : 'FAIL', detail: `빌드 성공 · 경고 ${t.buildWarnings}건 (상한 ${c.threshold ?? 0}건)` };
    case 'ASIL_COVERS_FEATURE': {
      const s = latest.SAFETY_SECURITY?.safety;
      if (!s) return no('SAFETY_SECURITY');
      return { ...base, result: ASIL_RANK[s.asil] >= ASIL_RANK[f.asil] ? 'PASS' : 'FAIL', detail: `협력사 ASIL ${s.asil} · Feature ASIL ${f.asil}` };
    }
    case 'VARIANT_COVERS_FEATURE': {
      const v: VariantCompat[] | null = latest.VARIANT_COMPAT?.variants ?? null;
      if (!v) return no('VARIANT_COMPAT');
      const hit = v.find((x) => x.vehicleModel === f.vehicleModel && x.region === f.country && (x.trim === null || x.trim === f.trim));
      return { ...base, result: hit ? 'PASS' : 'FAIL', detail: hit ? `${f.vehicleModel}·${f.country}·${f.trim} 포함 (MY ${hit.modelYears.join('·')})` : `${f.vehicleModel}·${f.country}·${f.trim}이(가) 적용 차량 조건에 없습니다` };
    }
    case 'CAPABILITY_COVERS_SW': {
      const cap: CapabilityManifest | null = latest.CAPABILITY_MANIFEST?.capability ?? null;
      if (!cap) return no('CAPABILITY_MANIFEST');
      const lack = f.swIds.map((s, i) => `${s}@${f.swVersions[i] ?? '?'}`).filter((k) => !cap.swVersions.some((x) => `${x.swId}@${x.version}` === k));
      return { ...base, result: lack.length ? 'FAIL' : 'PASS', detail: lack.length ? `Capability에 없는 SW: ${lack.join(', ')}` : `Feature SW ${f.swIds.length}건 모두 포함` };
    }
    case 'BREAKING_HAS_MIGRATION': {
      const n = latest.RELEASE_NOTE?.releaseNote;
      if (!n) return no('RELEASE_NOTE');
      if (!n.breakingChanges) return { ...base, result: 'PASS', detail: '호환 깨짐 변경 없음' };
      return { ...base, result: n.migration && n.migration.trim().length >= 2 ? 'PASS' : 'FAIL', detail: n.migration ? '호환 깨짐 변경 · 이전 방법 기재' : '호환 깨짐 변경인데 이전 방법이 없습니다' };
    }
  }
}

/** 종합 — NO_CRITERIA(기준 미등록), NOT_MET(불합격·판정 불가가 하나라도), MET */
export type AcceptanceVerdict = 'MET' | 'NOT_MET' | 'NO_CRITERIA';
export interface AcceptanceCheck {
  verdict: AcceptanceVerdict;
  criteriaRevision: number | null;
  criteria: CriterionResult[];
  packaging: QualityCheck[];
  missing: SupplierArtifactType[];
}

/** 검수 기준 충족 여부(FR-SPM-003-002) — 등록된 기준 + 고정 패키징 품질 기준. 하나라도 PASS가 아니면 NOT_MET */
export function acceptanceCheck(input: {
  pkg: Pick<SupplierPackageRow, 'version' | 'featureVersion'>;
  latest: Partial<Record<SupplierArtifactType, SupplierArtifactRow>>;
  criteria: SupplierCriteriaRow | null;
  feature: FeatureScopeInput;
  featureVersions: string[];
  activeMappingIds: string[];
}): AcceptanceCheck {
  const packaging = packagingQuality(input.pkg, input.latest, input);
  const criteria = (input.criteria?.items ?? []).map((c) => evaluateCriterion(c, input.latest, input.feature));
  const bad = [...packaging, ...criteria].some((c) => c.result !== 'PASS');
  return { verdict: !input.criteria ? 'NO_CRITERIA' : bad ? 'NOT_MET' : 'MET', criteriaRevision: input.criteria?.revision ?? null, criteria, packaging, missing: missingArtifacts(input.latest) };
}

/** 같은 Feature·협력사에서 다음 패키지 버전이 마지막 버전보다 커야 한다 */
export function semverGreater(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

// ── 책임 범위 ─────────────────────────────────────────
export type ScopeRelation = 'CHANGED_SW' | 'USED_SW' | 'MAPPED' | 'DEPENDENT';
export const SCOPE_RELATION_LABEL: Record<ScopeRelation, string> = {
  CHANGED_SW: '바뀐 SW 공급',
  USED_SW: '쓰는 SW 공급',
  MAPPED: '기능 매핑',
  DEPENDENT: '의존 Feature 경유',
};
export type EvidenceStatus = 'COMPLETE' | 'PARTIAL' | 'MISSING';
export type ContractGapKind = 'NO_CRITERIA' | 'NO_PACKAGE' | 'NO_API_CONTRACT' | 'NO_MAPPING';
export const CONTRACT_GAP_LABEL: Record<ContractGapKind, string> = {
  NO_CRITERIA: '검수 기준 없음',
  NO_PACKAGE: '릴리스 패키지 없음',
  NO_API_CONTRACT: 'API 계약 없음',
  NO_MAPPING: '협력사 기능 매핑 없음',
};
export interface ScopeSw {
  swId: string;
  version: string;
  previousVersion: string | null;
  changed: boolean;
  viaFeatureId: string | null;
}
export interface SupplierScopeEntry {
  supplier: string;
  relations: ScopeRelation[];
  sw: ScopeSw[];
  mappings: { mapId: string; supplierFunctionId: string; swcs: number }[];
  latestPackage: { packageId: string; version: string; status: SupplierPackageStatus; featureVersion: string } | null;
  evidence: { status: EvidenceStatus; detail: string; coveragePct: number | null; evidenceIds: string[] };
  gaps: ContractGapKind[];
  contacts: SupplierContact[];
}

interface SwRef {
  swId: string;
  version: string;
  supplier: string;
}
/** SW 마스터에서 (swId, version) → 공급사. 정확한 버전이 없으면 같은 swId의 공급사(데이터셋은 SW마다 공급사가 하나) */
export function supplierOfSw(sw: SwRef[], swId: string, version: string | null): string | null {
  return (sw.find((s) => s.swId === swId && s.version === version) ?? sw.find((s) => s.swId === swId))?.supplier ?? null;
}

/**
 * 협력사 책임 범위(FR-SPM-004-001) — 이 Version이 쓰는 SW의 공급사(직전 Version과 버전이 다르면 '바뀐 SW'), 협력사 기능 매핑,
 * 이 Feature를 필요로 하는 의존 Feature의 SW 공급사. 각 협력사에 Test Evidence 현황(004-002)과 Contract Gap(004-003)을 붙인다.
 */
export function supplierScope(input: {
  feature: FeatureScopeInput;
  previous: { version: string; swIds: string[]; swVersions: string[] } | null;
  dependents: { featureId: string; swIds: string[]; swVersions: string[] }[];
  sw: SwRef[];
  mappings: SupplierMappingRow[];
  packages: SupplierPackageRow[];
  latestByPackage: Record<string, Partial<Record<SupplierArtifactType, SupplierArtifactRow>>>;
  hasCriteria: boolean;
  directory: SupplierDirectoryEntry[];
  /** P3 추적 연결의 필수 Test Case Evidence(이 Feature) */
  traceEvidence: { required: number; withEvidence: number };
}): SupplierScopeEntry[] {
  const { feature: f } = input;
  const by = new Map<string, { relations: Set<ScopeRelation>; sw: ScopeSw[] }>();
  const touch = (supplier: string) => {
    if (!by.has(supplier)) by.set(supplier, { relations: new Set(), sw: [] });
    return by.get(supplier)!;
  };
  f.swIds.forEach((swId, i) => {
    const version = f.swVersions[i] ?? '';
    const supplier = supplierOfSw(input.sw, swId, version);
    if (!supplier) return;
    const j = input.previous?.swIds.indexOf(swId) ?? -1;
    const previousVersion = input.previous && j >= 0 ? (input.previous.swVersions[j] ?? null) : null;
    const changed = !!input.previous && previousVersion !== version;
    const e = touch(supplier);
    e.relations.add(changed ? 'CHANGED_SW' : 'USED_SW');
    e.sw.push({ swId, version, previousVersion, changed, viaFeatureId: null });
  });
  const mine = input.mappings.filter((m) => m.featureId === f.featureId);
  for (const m of mine) touch(m.supplier).relations.add('MAPPED');
  for (const d of input.dependents)
    d.swIds.forEach((swId, i) => {
      const supplier = supplierOfSw(input.sw, swId, d.swVersions[i] ?? null);
      if (!supplier) return;
      const e = touch(supplier);
      if (e.relations.has('CHANGED_SW') || e.relations.has('USED_SW')) return;
      e.relations.add('DEPENDENT');
      e.sw.push({ swId, version: d.swVersions[i] ?? '', previousVersion: null, changed: false, viaFeatureId: d.featureId });
    });

  return [...by.entries()]
    .map(([supplier, e]) => {
      const pkgs = input.packages.filter((p) => p.featureId === f.featureId && p.supplier === supplier).sort((a, b) => (semverGreater(a.version, b.version) ? -1 : 1));
      const latestPkg = pkgs[0] ?? null;
      const latest = latestPkg ? (input.latestByPackage[latestPkg.packageId] ?? {}) : {};
      const ms = mine.filter((m) => m.supplier === supplier);
      const direct = e.relations.has('CHANGED_SW') || e.relations.has('USED_SW') || e.relations.has('MAPPED');
      const gaps: ContractGapKind[] = [];
      if (direct) {
        if (!input.hasCriteria) gaps.push('NO_CRITERIA');
        if (!latestPkg) gaps.push('NO_PACKAGE');
        else if (!latest.API_CONTRACT) gaps.push('NO_API_CONTRACT');
        if (!ms.length) gaps.push('NO_MAPPING');
      }
      return {
        supplier,
        relations: (['CHANGED_SW', 'USED_SW', 'MAPPED', 'DEPENDENT'] as ScopeRelation[]).filter((r) => e.relations.has(r)),
        sw: e.sw,
        mappings: ms.map((m) => ({ mapId: m.mapId, supplierFunctionId: m.supplierFunctionId, swcs: m.swcs.length })),
        latestPackage: latestPkg ? { packageId: latestPkg.packageId, version: latestPkg.version, status: latestPkg.status, featureVersion: latestPkg.featureVersion } : null,
        evidence: evidenceStatus(latest.TEST_EVIDENCE?.testEvidence ?? null, input.traceEvidence),
        gaps,
        contacts: input.directory.find((d) => d.supplier === supplier)?.contacts ?? [],
      };
    })
    .sort((a, b) => rankOf(a) - rankOf(b) || a.supplier.localeCompare(b.supplier));
}
const rankOf = (e: { relations: ScopeRelation[] }) => Math.min(...e.relations.map((r) => ['CHANGED_SW', 'USED_SW', 'MAPPED', 'DEPENDENT'].indexOf(r)));

/**
 * Test Evidence 현황(FR-SPM-004-002) — 협력사 패키지의 Test Evidence 산출물과 이 Feature의 필수 Test Case Evidence(추적 연결).
 * COMPLETE: 협력사 Evidence가 있고 필수 Test Case가 모두 Evidence를 가짐, PARTIAL: 한쪽만, MISSING: 협력사 Evidence 없음
 */
export function evidenceStatus(t: TestEvidenceSummary | null, trace: { required: number; withEvidence: number }): SupplierScopeEntry['evidence'] {
  const traceOk = trace.withEvidence >= trace.required;
  const traceText = trace.required ? `필수 Test Case ${trace.withEvidence}/${trace.required}건 Evidence` : '필수 Test Case 없음';
  if (!t) return { status: 'MISSING', detail: `협력사 Test Evidence 없음 · ${traceText}`, coveragePct: null, evidenceIds: [] };
  const run = `시험 ${t.unitPassed + t.integrationPassed}/${t.unitTotal + t.integrationTotal}건 통과 · 커버리지 ${pct(t.coveragePct)}`;
  return { status: traceOk ? 'COMPLETE' : 'PARTIAL', detail: `${run} · ${traceText}`, coveragePct: t.coveragePct, evidenceIds: t.evidenceIds };
}

/** Contract Gap 목록(FR-SPM-004-003) — 책임 범위 결과에서 검수 기준·API 계약(패키지 포함)·기능 매핑이 빠진 협력사 */
export function contractGaps(featureId: string, version: string, scope: SupplierScopeEntry[]) {
  return scope.flatMap((s) => s.gaps.map((kind) => ({ featureId, version, supplier: s.supplier, kind, label: CONTRACT_GAP_LABEL[kind], packageId: s.latestPackage?.packageId ?? null })));
}
export type ContractGapRow = ReturnType<typeof contractGaps>[number];

/** 협력사 담당자 — 이 Feature의 SW 공급사 담당자 중 긴급 연락 대상(FR-KSW-003-002가 쓴다) */
export function supplierContactsFor(f: Pick<FeatureScopeInput, 'swIds' | 'swVersions'>, sw: SwRef[], directory: SupplierDirectoryEntry[], urgentOnly = true): { supplier: string; contacts: SupplierContact[] }[] {
  const suppliers = [...new Set(f.swIds.map((s, i) => supplierOfSw(sw, s, f.swVersions[i] ?? null)).filter((s): s is string => !!s))];
  return suppliers.map((supplier) => ({ supplier, contacts: (directory.find((d) => d.supplier === supplier)?.contacts ?? []).filter((c) => !urgentOnly || c.urgent) }));
}
