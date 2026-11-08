// 협력사 패키지·검수 규칙 — 산출물 제출 본문(FR-SPM-002-001·005·006), 필수 10항목 누락(002-003, D-GAP-2), 패키징 품질·무결성·메타데이터(FR-QGV-002-002~004),
// 검수 기준 판정(FR-SPM-003-002), 책임 범위·Test Evidence·Contract Gap(FR-SPM-004-001~003), 협력사 담당자(긴급 연락)
import { describe, expect, it } from 'vitest';
import { CreateSupplierCriteriaBody, ReviewSupplierPackageBody, SUPPLIER_ARTIFACT_TYPES, SubmitSupplierArtifactBody, type SupplierArtifactType } from '../schemas/supplier';
import {
  acceptanceCheck,
  contractGaps,
  evaluateCriterion,
  latestArtifacts,
  missingArtifacts,
  packagingQuality,
  REQUIRED_SUPPLIER_ARTIFACTS,
  semverGreater,
  supplierContactsFor,
  supplierScope,
  type FeatureScopeInput,
  type SupplierArtifactRow,
  type SupplierCriteriaRow,
  type SupplierDirectoryEntry,
  type SupplierPackageRow,
} from './supplier';

const SUM = 'sha256:' + 'a'.repeat(64);
const content: Record<SupplierArtifactType, Record<string, unknown>> = {
  API_CONTRACT: { apiFormat: 'OPENAPI' },
  HUMAN_DOC: {},
  FEATURE_MAPPING: { mappingIds: ['SFM-00001'] },
  CAPABILITY_MANIFEST: { capability: { hwVersions: ['B'], swVersions: [{ swId: 'SW-DMS-APP', version: '2.0.0' }, { swId: 'SW-DMS-SVC', version: '2.1.0' }], ecuCapabilities: [{ ecuPno: '96560-MX500', capabilities: ['IR 카메라'] }] } },
  VARIANT_COMPAT: { variants: [{ vehicleModel: 'MX5', region: 'EU', trim: null, modelYears: [2026, 2027] }] },
  DIAGNOSTICS: { diagnostics: { dtcs: ['B1A2F'], events: ['DMS_DROWSY'] } },
  SAFETY_SECURITY: { safety: { asil: 'C', cybersecurityClaim: 'CAL2 위협 대응', certRef: null } },
  SDK_STUB_MOCK: {},
  TEST_EVIDENCE: { testEvidence: { unitPassed: 120, unitTotal: 120, integrationPassed: 40, integrationTotal: 40, coveragePct: 86, buildStatus: 'SUCCESS', buildWarnings: 2, evidenceIds: ['TEST-DMS-01'] } },
  RELEASE_NOTE: { releaseNote: { releaseId: 'REL-T1B-2026.11', breakingChanges: false, migration: null } },
};
const art = (type: SupplierArtifactType, o: Partial<SupplierArtifactRow> = {}, n = 1): SupplierArtifactRow =>
  ({
    ...SubmitSupplierArtifactBody.parse({ type, version: '2.0.0', title: type, uri: `portal://t1b/${type}`, checksum: SUM, ...content[type] }),
    recordId: `SPA-${String(n).padStart(5, '0')}`,
    packageId: 'SPK-00001',
    submittedBy: 'usr-impl',
    submittedAt: `2026-11-0${n}T00:00:00Z`,
    integrity: 'VERIFIED',
    carriedFrom: null,
    ...o,
  }) as SupplierArtifactRow;
const all = () => latestArtifacts(SUPPLIER_ARTIFACT_TYPES.map((t) => art(t)));
const pkg = { version: '2.0.0', featureVersion: '2.0.0' };
const feature: FeatureScopeInput = { featureId: 'FEAT-00010', version: '2.0.0', asil: 'C', country: 'EU', vehicleModel: 'MX5', trim: 'Premium', swIds: ['SW-DMS-APP', 'SW-DMS-SVC'], swVersions: ['2.0.0', '2.1.0'] };
const criteria = (items: SupplierCriteriaRow['items']): SupplierCriteriaRow => ({ criteriaId: 'SAC-00001', featureId: 'FEAT-00010', revision: 1, items, reason: '초기 기준', createdBy: 'usr-judge', createdAt: '2026-11-01T00:00:00Z' });
const ALL_CRITERIA = CreateSupplierCriteriaBody.parse({
  featureId: 'FEAT-00010',
  reason: '초기 기준',
  items: [{ kind: 'MIN_COVERAGE', threshold: 80 }, { kind: 'ALL_TESTS_PASS' }, { kind: 'BUILD_CLEAN', threshold: 5 }, { kind: 'ASIL_COVERS_FEATURE' }, { kind: 'VARIANT_COVERS_FEATURE' }, { kind: 'CAPABILITY_COVERS_SW' }, { kind: 'BREAKING_HAS_MIGRATION' }],
}).items;

describe('산출물 제출 본문', () => {
  it('유형별 내용이 필요하다 — Capability Manifest·Variant Compatibility·Test Evidence·Release Note', () => {
    expect(SubmitSupplierArtifactBody.safeParse({ type: 'CAPABILITY_MANIFEST', version: '1', title: 'x', uri: 'portal://x', checksum: SUM }).success).toBe(false);
    expect(SubmitSupplierArtifactBody.safeParse({ type: 'VARIANT_COMPAT', version: '1', title: 'x', uri: 'portal://x', checksum: SUM, variants: [] }).success).toBe(false);
    expect(SubmitSupplierArtifactBody.safeParse({ type: 'HUMAN_DOC', version: '1', title: 'x', uri: 'portal://x', checksum: SUM, ...content.TEST_EVIDENCE }).success).toBe(false);
    expect(SubmitSupplierArtifactBody.safeParse({ type: 'VARIANT_COMPAT', version: '1', title: 'x', uri: 'portal://x', checksum: SUM, ...content.VARIANT_COMPAT }).success).toBe(true);
    const bad = { ...content.TEST_EVIDENCE.testEvidence as object, unitPassed: 121 };
    expect(SubmitSupplierArtifactBody.safeParse({ type: 'TEST_EVIDENCE', version: '1', title: 'x', uri: 'portal://x', checksum: SUM, testEvidence: bad }).success).toBe(false);
  });

  it('검수 결과 — 불합격 항목은 의견 필수, 불합격이 있으면 합격 판정 불가', () => {
    expect(ReviewSupplierPackageBody.safeParse({ decision: 'REJECT', comment: '커버리지 미달', items: [{ type: 'TEST_EVIDENCE', result: 'FAIL' }] }).success).toBe(false);
    expect(ReviewSupplierPackageBody.safeParse({ decision: 'ACCEPT', comment: '확인', items: [{ type: 'TEST_EVIDENCE', result: 'FAIL', comment: '미달' }] }).success).toBe(false);
    expect(ReviewSupplierPackageBody.safeParse({ decision: 'REJECT', comment: '커버리지 미달', items: [{ type: 'TEST_EVIDENCE', result: 'FAIL', comment: '78%' }] }).success).toBe(true);
  });

  it('검수 기준 — 기준값이 필요한 종류·받지 않는 종류, 같은 종류 중복 금지', () => {
    expect(CreateSupplierCriteriaBody.safeParse({ featureId: 'FEAT-00010', reason: '기준', items: [{ kind: 'MIN_COVERAGE' }] }).success).toBe(false);
    expect(CreateSupplierCriteriaBody.safeParse({ featureId: 'FEAT-00010', reason: '기준', items: [{ kind: 'ALL_TESTS_PASS', threshold: 3 }] }).success).toBe(false);
    expect(CreateSupplierCriteriaBody.safeParse({ featureId: 'FEAT-00010', reason: '기준', items: [{ kind: 'ALL_TESTS_PASS' }, { kind: 'ALL_TESTS_PASS' }] }).success).toBe(false);
  });
});

describe('필수 산출물·패키징 품질', () => {
  it('필수 산출물은 80-60 10항목 전부(D-GAP-2)', () => {
    expect(REQUIRED_SUPPLIER_ARTIFACTS).toEqual(SUPPLIER_ARTIFACT_TYPES);
    const some = latestArtifacts([art('API_CONTRACT'), art('RELEASE_NOTE')]);
    expect(missingArtifacts(some)).toEqual(['HUMAN_DOC', 'FEATURE_MAPPING', 'CAPABILITY_MANIFEST', 'VARIANT_COMPAT', 'DIAGNOSTICS', 'SAFETY_SECURITY', 'SDK_STUB_MOCK', 'TEST_EVIDENCE']);
    expect(missingArtifacts(all())).toEqual([]);
  });

  it('유형마다 가장 늦게 낸 산출물이 남는다', () => {
    const l = latestArtifacts([art('API_CONTRACT', { version: '1.0.0' }, 1), art('API_CONTRACT', { version: '1.1.0' }, 3), art('API_CONTRACT', { version: '1.0.1' }, 2)]);
    expect(l.API_CONTRACT?.version).toBe('1.1.0');
  });

  it('다섯 규칙 — 모두 갖추면 PASS', () => {
    const q = packagingQuality(pkg, all(), { featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] });
    expect(q.map((c) => [c.key, c.result])).toEqual([
      ['PKG_ALL_ITEMS', 'PASS'],
      ['PKG_CHECKSUM_FORMAT', 'PASS'],
      ['PKG_INTEGRITY', 'PASS'],
      ['PKG_METADATA', 'PASS'],
      ['PKG_MAPPING_ACTIVE', 'PASS'],
    ]);
  });

  it('체크섬 형식·본문 대조 불일치·배포 ID 누락·등록되지 않은 매핑·없는 Feature Version은 FAIL', () => {
    const l = all();
    l.SDK_STUB_MOCK = art('SDK_STUB_MOCK', { checksum: 'md5:1234' });
    l.API_CONTRACT = art('API_CONTRACT', { integrity: 'MISMATCH' });
    l.RELEASE_NOTE = art('RELEASE_NOTE', { releaseNote: { releaseId: ' ', breakingChanges: false, migration: null } });
    const q = Object.fromEntries(packagingQuality({ version: '2.0.0', featureVersion: '9.9.9' }, l, { featureVersions: ['2.0.0'], activeMappingIds: [] }).map((c) => [c.key, c]));
    expect(q.PKG_CHECKSUM_FORMAT.result).toBe('FAIL');
    expect(q.PKG_CHECKSUM_FORMAT.detail).toMatch(/SDK·Stub·Mock/);
    expect(q.PKG_INTEGRITY.result).toBe('FAIL');
    expect(q.PKG_INTEGRITY.detail).toMatch(/API 계약/);
    expect(q.PKG_METADATA.result).toBe('FAIL');
    expect(q.PKG_METADATA.detail).toMatch(/배포 ID가 없습니다.*9\.9\.9/);
    expect(q.PKG_MAPPING_ACTIVE.result).toBe('FAIL');
    expect(q.PKG_MAPPING_ACTIVE.detail).toMatch(/SFM-00001/);
  });

  it('본문 없이 체크섬만 신고한 산출물은 무결성 통과 근거가 아니다', () => {
    const l = all();
    l.SDK_STUB_MOCK = art('SDK_STUB_MOCK', { integrity: 'DECLARED' });
    const c = packagingQuality(pkg, l, { featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] }).find((x) => x.key === 'PKG_INTEGRITY')!;
    expect(c.result).toBe('NOT_EVALUABLE');
    expect(c.detail).toContain('체크섬만 신고 1건');
  });

  it('검증 상태가 없는 옛 기록을 검증된 본문으로 추정하지 않는다', () => {
    const l = all();
    const stored: Partial<SupplierArtifactRow> = art('SDK_STUB_MOCK');
    delete stored.integrity;
    l.SDK_STUB_MOCK = stored as SupplierArtifactRow;
    const c = packagingQuality(pkg, l, { featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] }).find((x) => x.key === 'PKG_INTEGRITY')!;
    expect(c.result).toBe('NOT_EVALUABLE');
    expect(c.detail).toContain('검증 상태 미확인 1건');
  });

  it('검증하지 않은 본문과 체크섬 불일치가 섞이면 불일치를 실패로 유지한다', () => {
    const l = all();
    l.API_CONTRACT = art('API_CONTRACT', { integrity: 'MISMATCH' });
    l.SDK_STUB_MOCK = art('SDK_STUB_MOCK', { integrity: 'DECLARED' });
    const r = acceptanceCheck({ pkg, latest: l, criteria: criteria(ALL_CRITERIA), feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] });
    expect(r.verdict).toBe('NOT_MET');
    expect(r.packaging.find((c) => c.key === 'PKG_INTEGRITY')?.result).toBe('FAIL');
  });
});

describe('검수 기준 판정', () => {
  it('10항목과 모든 기준을 갖춰도 검증하지 않은 본문이 있으면 검수 통과가 아니다', () => {
    const latest = latestArtifacts(SUPPLIER_ARTIFACT_TYPES.map((t) => art(t, { integrity: 'DECLARED' })));
    const r = acceptanceCheck({ pkg, latest, criteria: criteria(ALL_CRITERIA), feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] });
    expect(r.verdict).toBe('NOT_MET');
    expect(r.packaging.find((c) => c.key === 'PKG_INTEGRITY')?.result).toBe('NOT_EVALUABLE');
  });

  it('일곱 기준 모두 충족 → MET', () => {
    const r = acceptanceCheck({ pkg, latest: all(), criteria: criteria(ALL_CRITERIA), feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] });
    expect(r.verdict).toBe('MET');
    expect(r.criteria.every((c) => c.result === 'PASS')).toBe(true);
  });

  it('커버리지 미달·시험 실패·빌드 경고 초과·낮은 ASIL·범위 밖 차량·Capability 누락·이전 방법 없는 호환 깨짐 → FAIL', () => {
    const l = all();
    l.TEST_EVIDENCE = art('TEST_EVIDENCE', { testEvidence: { unitPassed: 118, unitTotal: 120, integrationPassed: 40, integrationTotal: 40, coveragePct: 78, buildStatus: 'SUCCESS', buildWarnings: 9, evidenceIds: ['T1'] } });
    l.SAFETY_SECURITY = art('SAFETY_SECURITY', { safety: { asil: 'B', cybersecurityClaim: 'x', certRef: null } });
    l.VARIANT_COMPAT = art('VARIANT_COMPAT', { variants: [{ vehicleModel: 'MX5', region: 'US', trim: null, modelYears: [2026] }] });
    l.CAPABILITY_MANIFEST = art('CAPABILITY_MANIFEST', { capability: { hwVersions: ['B'], swVersions: [{ swId: 'SW-DMS-APP', version: '2.0.0' }], ecuCapabilities: [{ ecuPno: 'E', capabilities: ['IR 카메라'] }] } });
    l.RELEASE_NOTE = art('RELEASE_NOTE', { releaseNote: { releaseId: 'REL-1', breakingChanges: true, migration: null } });
    const r = acceptanceCheck({ pkg, latest: l, criteria: criteria(ALL_CRITERIA), feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] });
    expect(r.verdict).toBe('NOT_MET');
    expect(Object.fromEntries(r.criteria.map((c) => [c.kind, c.result]))).toEqual({
      MIN_COVERAGE: 'FAIL',
      ALL_TESTS_PASS: 'FAIL',
      BUILD_CLEAN: 'FAIL',
      ASIL_COVERS_FEATURE: 'FAIL',
      VARIANT_COVERS_FEATURE: 'FAIL',
      CAPABILITY_COVERS_SW: 'FAIL',
      BREAKING_HAS_MIGRATION: 'FAIL',
    });
    expect(r.criteria.find((c) => c.kind === 'MIN_COVERAGE')!.detail).toBe('커버리지 78% (기준 80% 이상)');
    expect(r.criteria.find((c) => c.kind === 'CAPABILITY_COVERS_SW')!.detail).toMatch(/SW-DMS-SVC@2\.1\.0/);
  });

  it('판정에 쓸 산출물이 없으면 NOT_EVALUABLE(합격 아님), 기준이 없으면 NO_CRITERIA', () => {
    const l = all();
    delete l.TEST_EVIDENCE;
    expect(evaluateCriterion({ kind: 'MIN_COVERAGE', threshold: 80, note: null }, l, feature).result).toBe('NOT_EVALUABLE');
    expect(acceptanceCheck({ pkg, latest: l, criteria: criteria([{ kind: 'MIN_COVERAGE', threshold: 80, note: null }]), feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] }).verdict).toBe('NOT_MET');
    expect(acceptanceCheck({ pkg, latest: all(), criteria: null, feature, featureVersions: ['2.0.0'], activeMappingIds: ['SFM-00001'] }).verdict).toBe('NO_CRITERIA');
  });

  it('패키지 버전 비교', () => {
    expect(semverGreater('2.0.1', '2.0.0')).toBe(true);
    expect(semverGreater('2.10.0', '2.9.9')).toBe(true);
    expect(semverGreater('2.0.0', '2.0.0')).toBe(false);
  });
});

describe('책임 범위·Test Evidence·Contract Gap·담당자', () => {
  const sw = [
    { swId: 'SW-DMS-APP', version: '2.0.0', supplier: 'Tier1-B' },
    { swId: 'SW-DMS-SVC', version: '2.1.0', supplier: 'Tier1-B' },
    { swId: 'SW-HUD', version: '1.0.0', supplier: 'Tier1-E' },
    { swId: 'SW-CAM', version: '3.0.0', supplier: 'Tier1-G' },
  ];
  const directory: SupplierDirectoryEntry[] = [
    { supplier: 'Tier1-B', displayName: 'Tier1-B', contacts: [{ contactId: 'C1', name: '정민호', duty: 'QUALITY', email: 'q@t1b.example', phone: '02-0000-0001', urgent: true }, { contactId: 'C2', name: '오세린', duty: 'TECHNICAL', email: 't@t1b.example', phone: '02-0000-0002', urgent: false }] },
  ];
  const base = {
    feature: { ...feature, swIds: ['SW-DMS-APP', 'SW-DMS-SVC', 'SW-HUD'], swVersions: ['2.0.0', '2.1.0', '1.0.0'] },
    previous: { version: '1.9.0', swIds: ['SW-DMS-APP', 'SW-DMS-SVC', 'SW-HUD'], swVersions: ['1.9.0', '2.1.0', '1.0.0'] },
    dependents: [{ featureId: 'FEAT-00099', swIds: ['SW-CAM'], swVersions: ['3.0.0'] }],
    sw,
    mappings: [{ mapId: 'SFM-00001', featureId: 'FEAT-00010', supplier: 'Tier1-B', supplierFunctionId: 'DMS_FUNC_032', name: '졸음 판단', oemFunctionId: null, swcs: [], status: 'ACTIVE' as const, createdBy: 'u', createdAt: 't' }],
    packages: [
      { packageId: 'SPK-00001', featureId: 'FEAT-00010', featureVersion: '2.0.0', supplier: 'Tier1-B', version: '2.0.0', status: 'SUBMITTED', basedOn: null, createdBy: 'u', createdAt: 't', submittedBy: 'u', submittedAt: 't', submitNote: null, decidedBy: null, decidedAt: null } as SupplierPackageRow,
      { packageId: 'SPK-00002', featureId: 'FEAT-00010', featureVersion: '2.0.0', supplier: 'Tier1-E', version: '1.0.0', status: 'DRAFT', basedOn: null, createdBy: 'u', createdAt: 't', submittedBy: null, submittedAt: null, submitNote: null, decidedBy: null, decidedAt: null } as SupplierPackageRow,
    ],
    latestByPackage: { 'SPK-00001': all(), 'SPK-00002': latestArtifacts([art('HUMAN_DOC')]) },
    hasCriteria: false,
    directory,
    traceEvidence: { required: 2, withEvidence: 1 },
  };

  it('바뀐 SW·쓰는 SW·의존 Feature 경유 협력사, 담당자와 최신 패키지', () => {
    const s = supplierScope(base);
    expect(s.map((e) => [e.supplier, e.relations])).toEqual([
      ['Tier1-B', ['CHANGED_SW', 'USED_SW', 'MAPPED']],
      ['Tier1-E', ['USED_SW']],
      ['Tier1-G', ['DEPENDENT']],
    ]);
    expect(s[0].sw.find((x) => x.swId === 'SW-DMS-APP')).toMatchObject({ changed: true, previousVersion: '1.9.0' });
    expect(s[0].latestPackage).toMatchObject({ packageId: 'SPK-00001', status: 'SUBMITTED' });
    expect(s[0].contacts).toHaveLength(2);
    expect(s[2].sw[0]).toMatchObject({ swId: 'SW-CAM', viaFeatureId: 'FEAT-00099' });
  });

  it('Test Evidence 현황 — 협력사 Evidence + 필수 Test Case Evidence', () => {
    const s = supplierScope(base);
    expect(s[0].evidence).toMatchObject({ status: 'PARTIAL', coveragePct: 86, evidenceIds: ['TEST-DMS-01'] });
    expect(s[0].evidence.detail).toBe('시험 160/160건 통과 · 커버리지 86% · 필수 Test Case 1/2건 Evidence');
    expect(s[1].evidence.status).toBe('MISSING');
    expect(supplierScope({ ...base, traceEvidence: { required: 2, withEvidence: 2 } })[0].evidence.status).toBe('COMPLETE');
  });

  it('Contract Gap — 검수 기준 없음·API 계약 없음·매핑 없음, 의존 경유 협력사는 Gap 대상 아님', () => {
    const gaps = contractGaps('FEAT-00010', '2.0.0', supplierScope(base));
    expect(gaps.map((g) => [g.supplier, g.kind])).toEqual([
      ['Tier1-B', 'NO_CRITERIA'],
      ['Tier1-E', 'NO_CRITERIA'],
      ['Tier1-E', 'NO_API_CONTRACT'],
      ['Tier1-E', 'NO_MAPPING'],
    ]);
    const withCriteria = contractGaps('FEAT-00010', '2.0.0', supplierScope({ ...base, hasCriteria: true, packages: [] }));
    expect(withCriteria.map((g) => [g.supplier, g.kind])).toEqual([
      ['Tier1-B', 'NO_PACKAGE'],
      ['Tier1-E', 'NO_PACKAGE'],
      ['Tier1-E', 'NO_MAPPING'],
    ]);
  });

  it('협력사 담당자 — 긴급 연락 대상만(기본)', () => {
    expect(supplierContactsFor(base.feature, sw, directory)).toEqual([
      { supplier: 'Tier1-B', contacts: [expect.objectContaining({ contactId: 'C1', urgent: true })] },
      { supplier: 'Tier1-E', contacts: [] },
    ]);
    expect(supplierContactsFor(base.feature, sw, directory, false)[0].contacts).toHaveLength(2);
  });
});
