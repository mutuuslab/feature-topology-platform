// 26580 bill-of-features·카탈로그 트리·제품 구성기·공유 자산(20-60 §4 G1·G3~G9) — 기존 구성 규칙(validateComposition)을 함께 돌린다.
import { describe, expect, it } from 'vitest';
import type { BaselineRef } from '../catalog';
import { billOfFeatures, catalogueTree, configureProduct, sharedAssets, type BofInput } from './bill-of-features';
import type { PleFeature, PleRef } from './autofill';

const ref = (o: Partial<PleRef> & { refId: string }): PleRef => ({ status: 'ACTIVE', nameKo: o.refId, nameEn: o.refId, domain: 'Body & Comfort', component: 'Seat', asilRep: 'QM', tshirt: 'S', ...o });
const refs = new Map(
  [
    ref({ refId: 'BC-SEAT-001', requires: ['BC-SEAT-009'], definition: { drivers: { calibrations: '4' } } }),
    ref({ refId: 'BC-SEAT-009', bundleId: 'KRN-S1', bundleRep: true }),
    ref({ refId: 'BC-SEAT-003', bundleId: 'KRN-S1', bundleRep: false }),
    ref({ refId: 'BC-SEAT-004', bundleId: 'KRN-S1', bundleRep: false, excludes: ['BC-SEAT-005'] }),
    ref({ refId: 'BC-SEAT-005', bundleId: 'KRN-S1', bundleRep: false, excludes: ['BC-SEAT-004'] }),
    ref({ refId: 'AD-LON-002', domain: 'ADAS & AD', component: 'Longitudinal', asilRep: 'B' }),
  ].map((r) => [r.refId, r]),
);
const scope = { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' };
const F = (n: number, refId: string | null, o: Partial<PleFeature> = {}): PleFeature => ({ featureId: `FEAT-0000${n}`, version: '1.0.0', name: `F${n}`, ...scope, lifecycle: 'RELEASED', controlPoints: ['Flag'], swIds: [`SW-${n}`], ecuPnos: ['ECU-1'], featureRefs: refId ? [{ refId, role: 'PRIMARY' }] : [], ...o });
const feats = [F(1, 'BC-SEAT-001', { controlPoints: ['Flag', 'Parameter'] }), F(2, 'BC-SEAT-009'), F(3, 'BC-SEAT-003'), F(4, 'BC-SEAT-004'), F(5, 'BC-SEAT-005'), F(6, 'AD-LON-002'), F(7, null)];
const featureMap = new Map(feats.map((f) => [`${f.featureId}@${f.version}`, f]));
const B = (n: number): BaselineRef => ({ baselineId: `BL-0000${n}`, featureId: `FEAT-0000${n}`, version: '1.0.0', name: `F${n}`, lifecycle: 'RELEASED', ...scope });
const baselines = new Map(feats.map((_, i) => [`BL-0000${i + 1}`, B(i + 1)]));
const input = (ids: number[]): BofInput => ({ product: { ...scope, type: 'PACKAGE', baselineIds: ids.map((n) => `BL-0000${n}`), validFrom: null, validTo: null, catalogId: 'CAT-00001', version: '1.0.0' }, baselines, dependencies: [], features: featureMap, refsById: refs });

describe('bill-of-features — 카탈로그 제약 + 구성 규칙', () => {
  it('선행 기준 행이 상품에 있으면 PASS, 고른 기준 행 집합을 낸다', () => {
    const b = billOfFeatures(input([1, 2]));
    expect(b.result).toBe('PASS');
    expect(b.selectedRefIds).toEqual(['BC-SEAT-001', 'BC-SEAT-009']);
    expect(b.selections[0]).toMatchObject({ featureId: 'FEAT-00001', primaryRefId: 'BC-SEAT-001', catalogueRole: 'PRIMARY' });
  });
  it('선행 기준 행이 없으면 REF_REQUIRES_MISSING(FAIL)', () => {
    const b = billOfFeatures(input([1, 6]));
    expect(b.result).toBe('FAIL');
    expect(b.issues.find((i) => i.code === 'REF_REQUIRES_MISSING')).toMatchObject({ origin: 'CATALOGUE', refs: ['BL-00001', 'BC-SEAT-009'] });
  });
  it('배타 기준 행 둘을 함께 고르면 EXCLUDES·ALTERNATIVE_MULTI(FAIL), 상위 없는 하위 feature는 경고', () => {
    const b = billOfFeatures(input([4, 5]));
    const codes = b.issues.map((i) => i.code);
    expect(codes).toContain('REF_EXCLUDES_CONFLICT');
    expect(codes).toContain('ALTERNATIVE_MULTI');
    expect(b.issues.find((i) => i.code === 'SUB_WITHOUT_PRIMARY')?.severity).toBe('WARN');
  });
  it('기존 구성 규칙(SINGLE 개수·Feature 간 의존)은 그대로 COMPOSITION으로', () => {
    const b = billOfFeatures({ ...input([2, 6]), product: { ...input([2, 6]).product, type: 'SINGLE' }, dependencies: [{ dependencyId: 'DEP-00001', type: 'EXCLUDES', sourceFeatureId: 'FEAT-00002', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00006', targetVersion: null }] });
    expect(b.issues.filter((i) => i.origin === 'COMPOSITION').map((i) => i.code).sort()).toEqual(['EXCLUDES_CONFLICT', 'TYPE_COUNT']);
    expect(b.composition.result).toBe('FAIL');
  });
  it('기준 행 연결이 없는 Feature는 카탈로그 제약을 못 본다는 경고', () => {
    expect(billOfFeatures(input([2, 7])).issues.find((i) => i.code === 'NO_CATALOGUE_LINK')?.severity).toBe('WARN');
  });
});

describe('feature catalogue 트리', () => {
  const t = catalogueTree({ features: feats, refsById: refs });
  it('도메인 → 컴포넌트 → 주요 feature → 하위 feature, 실현 Feature', () => {
    expect(t.domains.map((d) => d.domain)).toEqual(['ADAS & AD', 'Body & Comfort']);
    const seat = t.domains[1].components[0];
    const mem = seat.features.find((f) => f.refId === 'BC-SEAT-009')!;
    expect(mem.catalogueRole).toBe('PRIMARY');
    expect(mem.children.map((c) => c.refId)).toEqual(['BC-SEAT-003', 'BC-SEAT-004', 'BC-SEAT-005']);
    expect(mem.realizations[0]).toMatchObject({ featureId: 'FEAT-00002', role: 'PRIMARY' });
    expect(t.counts).toMatchObject({ domains: 2, primary: 3, sub: 3, constraints: 3 });
    expect(t.counts.variationPoints).toBeGreaterThan(0);
  });
  it('대표로 쓰이지 않고 포함으로만 쓰인 행은 그 Feature 대표 행의 하위 feature', () => {
    const fs = [...feats, F(8, 'AD-LON-002', { featureRefs: [{ refId: 'AD-LON-002', role: 'PRIMARY' }, { refId: 'AD-LON-009', role: 'INCLUDED' }] })];
    const refs2 = new Map([...refs, ['AD-LON-009', ref({ refId: 'AD-LON-009', domain: 'ADAS & AD', component: 'Longitudinal' })]]);
    const acc = catalogueTree({ features: fs, refsById: refs2 }).domains[0].components[0].features.find((f) => f.refId === 'AD-LON-002')!;
    expect(acc.children.map((c) => c.refId)).toEqual(['AD-LON-009']);
    expect(acc.children[0]).toMatchObject({ catalogueRole: 'SUB', parentRefId: 'AD-LON-002' });
    expect(acc.children[0].realizations[0]).toMatchObject({ featureId: 'FEAT-00008', role: 'INCLUDED' });
  });
});

describe('제품 구성기 · 공유 자산', () => {
  it('고른 Feature는 Flag 켬, 같은 범위의 고르지 않은 Feature는 끔, SW 컴포넌트 인스턴스', () => {
    const c = configureProduct({ ...input([1, 2]), policies: [{ policyId: 'POL-1', featureId: 'FEAT-00001', flagKey: 'seat.power', status: 'APPROVED' }] });
    expect(c.instances.flags.find((f) => f.featureId === 'FEAT-00001')).toMatchObject({ flagKey: 'seat.power', value: 'ON', source: 'POLICY' });
    expect(c.instances.flags.find((f) => f.featureId === 'FEAT-00006')?.value).toBe('OFF');
    expect(c.instances.swComponents.map((s) => s.swId)).toEqual(['SW-1', 'SW-2']);
    expect(c.instances.policies).toEqual([{ policyId: 'POL-1', featureId: 'FEAT-00001', status: 'APPROVED' }]);
    expect(c.instances.variationPoints.some((v) => v.featureId === 'FEAT-00006' && v.resolved.startsWith('미선택'))).toBe(true);
  });
  it('공유 자산 — 같은 ECU를 쓰는 Feature를 모으고 상품을 잇는다', () => {
    const a = sharedAssets({ features: feats, policies: [{ policyId: 'POL-1', featureId: 'FEAT-00001', flagKey: 'seat.power', status: 'APPROVED' }], productsByFeature: new Map([['FEAT-00001', ['CAT-00001']]]) });
    const ecu = a.find((x) => x.kind === 'ECU' && x.asset === 'ECU-1')!;
    expect(ecu.features).toHaveLength(7);
    expect(ecu.products).toEqual(['CAT-00001']);
    expect(a.map((x) => x.kind)).toEqual(expect.arrayContaining(['SW_COMPONENT', 'ECU', 'FLAG', 'POLICY']));
  });
});
