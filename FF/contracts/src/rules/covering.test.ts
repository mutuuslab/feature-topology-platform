// 조합 시험 계획 — FFG-TST-003: 허용 조합 = Topology, 안전 관련 Flag 2개 이상 상호작용이면 3-way covering array, 금지 조합은 부정 시험
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import { validateComposition, type BaselineRef } from './catalog';
import { combinationPlan, combinationViolations, coveringArray, interactionGroup } from './covering';

const deps = loadDataset().dependencies;
const covers = (rows: boolean[][], n: number, t: number) => {
  const missing: string[] = [];
  const idx = (k: number, start: number, acc: number[]): number[][] => (acc.length === k ? [acc] : Array.from({ length: n - start }, (_, j) => idx(k, start + j + 1, [...acc, start + j])).flat());
  for (const s of idx(t, 0, [])) for (let v = 0; v < 1 << t; v++) if (!rows.some((r) => s.every((i, j) => r[i] === !!(v & (1 << j))))) missing.push(`${s}:${v}`);
  return missing;
};

describe('covering array (3-way)', () => {
  it('제약 없는 5개 Flag: 모든 3-조합 × 8값을 덮고, 전수 32행보다 적다', () => {
    const a = coveringArray(['A', 'B', 'C', 'D', 'E'], 3, () => true);
    expect(covers(a.rows, 5, 3)).toEqual([]);
    expect(a).toMatchObject({ strength: 3, tuples: 80, covered: 80, infeasible: 0 });
    expect(a.rows.length).toBeLessThan(32);
  });

  it('제약이 있으면 금지 행은 나오지 않고, 만들 수 없는 조합은 infeasible로 센다', () => {
    // A REQUIRES B, C EXCLUDES D
    const d = [
      { dependencyId: 'D1', type: 'REQUIRES' as const, sourceFeatureId: 'A', targetFeatureId: 'B' },
      { dependencyId: 'D2', type: 'EXCLUDES' as const, sourceFeatureId: 'C', targetFeatureId: 'D' },
    ];
    const f = ['A', 'B', 'C', 'D', 'E'];
    const a = coveringArray(f, 3, (row) => combinationViolations(f.filter((_, i) => row[i]), d).length === 0);
    expect(a.rows.every((r) => !(r[0] && !r[1]) && !(r[2] && r[3]))).toBe(true);
    expect(a.covered).toBe(a.tuples);
    expect(a.infeasible).toBeGreaterThan(0);
  });
});

describe('Feature 조합 시험 계획 (시드 Topology)', () => {
  it('FEAT-00022: 상호작용 범위는 REQUIRES로 이어진 FEAT-00145까지, 둘 다 안전 관련이면 3-way(인자 2개라 전수) — 금지 1건', () => {
    expect(interactionGroup('FEAT-00022', deps)).toEqual(['FEAT-00022', 'FEAT-00145']);
    const p = combinationPlan('FEAT-00022', deps, () => 'F3');
    expect(p).toMatchObject({ group: ['FEAT-00022', 'FEAT-00145'], safetyFlags: ['FEAT-00022', 'FEAT-00145'], strength: 2, requestedStrength: 3 });
    expect(p.basis).toMatch(/3-way/);
    expect(p.array.rows).toHaveLength(3); // 4가지 중 22 ON·145 OFF는 금지
    expect(p.negatives).toEqual([{ on: ['FEAT-00022'], off: ['FEAT-00145'], expect: 'REQUIRES_MISSING', dependencyId: expect.stringMatching(/^DEP-/) }]);
  });

  it('부정 시험: 금지 조합은 Feature 판정과 상품 구성 검증(catalog) 모두에서 거부된다', () => {
    for (const fid of ['FEAT-00022', 'FEAT-00023']) {
      const p = combinationPlan(fid, deps, () => 'F2');
      expect(p.negatives.length).toBeGreaterThan(0);
      for (const n of p.negatives) {
        expect(combinationViolations(n.on, deps).map((v) => v.code)).toContain(n.expect);
        // 상품 구성으로 같은 조합을 만들어도 거부
        const ds = deps.filter((d) => d.dependencyId === n.dependencyId);
        const baselines: Record<string, BaselineRef> = Object.fromEntries(
          n.on.map((f, i) => [`BL-${i}`, { baselineId: `BL-${i}`, featureId: f, version: f === ds[0].sourceFeatureId ? ds[0].sourceVersion : (ds[0].targetVersion ?? '1.0.0'), name: f, lifecycle: 'RELEASED', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }]),
        );
        const r = validateComposition({ product: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', type: n.on.length > 1 ? 'PACKAGE' : 'SINGLE', baselineIds: Object.keys(baselines), validFrom: null, validTo: null } as any, baselines, dependencies: ds });
        expect(r.issues.map((i) => i.code)).toContain(n.expect);
      }
    }
  });

  it('안전 관련 Flag가 하나뿐이면 2-way, 분류가 없는 Flag는 안전 관련으로 본다(fail-closed)', () => {
    expect(combinationPlan('FEAT-00022', deps, (f) => (f === 'FEAT-00022' ? 'F3' : 'F1'))).toMatchObject({ safetyFlags: ['FEAT-00022'], strength: 2 });
    expect(combinationPlan('FEAT-00022', deps, () => null).safetyFlags).toHaveLength(2);
  });
});
