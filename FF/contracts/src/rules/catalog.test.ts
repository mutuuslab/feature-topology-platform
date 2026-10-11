import { describe, expect, it } from 'vitest';
import type { ProductRow } from '../schemas/dataset';
import { loadDataset } from '../testing/fixtures';
import { evaluateProductGuards, productRuleFor, PRODUCT_TRANSITIONS, validateComposition, type BaselineRef } from './catalog';

const ds = loadDataset();
const reg = new Map(ds.features.map((f) => [`${f.featureId}@${f.version}`, f]));
const baselines: Record<string, BaselineRef> = {};
for (const b of ds.bomItems) {
  const f = reg.get(`${b.featureId}@${b.version}`)!;
  baselines[b.baselineId] = { baselineId: b.baselineId, featureId: b.featureId, version: b.version, name: b.name, lifecycle: f.lifecycle, country: b.country, vehicleModel: b.vehicleModel, trim: b.trim };
}
const product = (id: string) => ds.products.find((p) => p.catalogId === id)!;
const check = (p: Partial<ProductRow> & Pick<ProductRow, 'baselineIds'>, carriedOver: string[] = []) =>
  validateComposition({ product: { ...product('CAT-00019'), ...p }, baselines, dependencies: ds.dependencies, carriedOver });
const codes = (r: ReturnType<typeof validateComposition>) => r.issues.map((i) => i.code);

describe('상품 구성 검증 (§2.7, §4)', () => {
  it('데이터셋 상품 18건은 모두 구성 검증 PASS (기존 구성은 유지 허용)', () => {
    for (const p of ds.products) {
      const r = validateComposition({ product: p, baselines, dependencies: ds.dependencies, carriedOver: p.baselineIds });
      expect(r.result, `${p.catalogId} ${JSON.stringify(r.issues)}`).toBe('PASS');
    }
  });

  it('CAT-00019: FEAT-00022의 REQUIRES 대상 FEAT-00145(BL-00163)를 빼면 FAIL', () => {
    expect(check({ baselineIds: ['BL-00028', 'BL-00029', 'BL-00030'] }).issues).toContainEqual(expect.objectContaining({ code: 'REQUIRES_MISSING', refs: ['DEP-00013'] }));
  });

  it('EXCLUDES 관계 Feature를 함께 넣으면 FAIL', () => {
    const exc = ds.dependencies.find((d) => d.type === 'EXCLUDES')!;
    const blOf = (fid: string) => Object.values(baselines).find((b) => b.featureId === fid)!;
    const a = blOf(exc.sourceFeatureId);
    const b = blOf(exc.targetFeatureId);
    const r = validateComposition({ product: { ...product('CAT-00019'), country: a.country, vehicleModel: a.vehicleModel, trim: a.trim, baselineIds: [a.baselineId, b.baselineId] }, baselines, dependencies: ds.dependencies });
    expect(codes(r)).toContain('EXCLUDES_CONFLICT');
  });

  it('같은 Feature 두 Version, 없는 Baseline, 범위 불일치, 개수·기간 위반', () => {
    const two = Object.values(baselines).filter((b) => b.featureId === 'FEAT-00001').map((b) => b.baselineId);
    expect(codes(check({ baselineIds: [...two, 'BL-00163'] }))).toContain('DUPLICATE_FEATURE');
    expect(codes(check({ baselineIds: ['BL-99999', 'BL-00028', 'BL-00163'] }))).toContain('BASELINE_UNKNOWN');
    // FEAT-00001 2.1.0도 KR/NX4 PE/Premium이지만 FEAT-00002·FEAT-00144를 REQUIRES — 함께 넣지 않으면 FAIL
    expect(check({ baselineIds: ['BL-00001', 'BL-00028', 'BL-00163'] }).issues.flatMap((i) => i.refs)).toEqual(['DEP-00001', 'DEP-00002'])
    expect(codes(check({ type: 'SINGLE', baselineIds: ['BL-00028', 'BL-00163'] }))).toContain('TYPE_COUNT');
    expect(codes(check({ validFrom: '2026-12-01', validTo: '2026-10-01', baselineIds: ['BL-00028', 'BL-00163'] }))).toContain('VALIDITY_RANGE');
    const other = Object.values(baselines).find((b) => b.country !== 'KR')!;
    expect(codes(check({ baselineIds: ['BL-00028', 'BL-00163', other.baselineId] }))).toContain('SCOPE_MISMATCH');
  });

  it('DEPRECATED/RETIRED는 신규 선택 금지, 기존 구성 유지는 허용', () => {
    const dep = Object.values(baselines).find((b) => b.lifecycle === 'DEPRECATED')!;
    const p = { country: dep.country, vehicleModel: dep.vehicleModel, trim: dep.trim, type: 'SINGLE' as const, baselineIds: [dep.baselineId] };
    expect(codes(check(p))).toContain('STATE_NOT_ELIGIBLE');
    expect(codes(check(p, [dep.baselineId]))).not.toContain('STATE_NOT_ELIGIBLE');
  });
});

describe('상품 Lifecycle (표 17)', () => {
  const comp = (ids: string[]) => validateComposition({ product: { ...product('CAT-00019'), baselineIds: ids }, baselines, dependencies: ds.dependencies });
  const ctx = (ids = product('CAT-00019').baselineIds, validTo: string | null = '2026-10-31') => ({ composition: comp(ids), today: '2026-10-11', validFrom: '2026-10-01', validTo });

  it('구성 승인과 고객 출시 승인은 별도 승인으로 정의된다', () => {
    expect(PRODUCT_TRANSITIONS.filter((r) => r.approval).map((r) => `${r.from}>${r.to}:${r.approval}`)).toEqual(['PROPOSED>APPROVED:CONFIG', 'VERIFIED>RELEASED:RELEASE']);
  });

  it('CAT-00019(모든 구성 Feature RELEASED)는 APPROVED→VERIFIED 가능, 개발 대기 자동 전이는 불필요', () => {
    expect(evaluateProductGuards(productRuleFor('APPROVED', 'VERIFIED')!, ctx())).toEqual([]);
    expect(evaluateProductGuards(productRuleFor('APPROVED', 'DEVELOPING')!, ctx())).toHaveLength(1);
  });

  it('출시에는 유효기간이 필요하고, 종료는 유효 종료일 이후에만', () => {
    expect(evaluateProductGuards(productRuleFor('VERIFIED', 'RELEASED')!, ctx(undefined, null))[0]).toContain('유효');
    expect(evaluateProductGuards(productRuleFor('DEPRECATED', 'RETIRED')!, ctx())[0]).toContain('지나야');
    expect(evaluateProductGuards(productRuleFor('DEPRECATED', 'RETIRED')!, { ...ctx(), today: '2026-11-01' })).toEqual([]);
  });
});
