import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CostBasis } from './basis';
import { anchorSamples, anchorSuggestion, type CostRefFacts } from './engine';
import { costMre, PutCostActualBody } from '../../schemas/cost';
const root = join(__dirname, '../../../..');
const basis = CostBasis.parse(JSON.parse(readFileSync(join(root, 'data/reference/cost-basis/v1.3.json'), 'utf8')));
const refs: CostRefFacts[] = JSON.parse(readFileSync(join(root, 'data/reference/feature-db/v1.3/refs.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(root, 'data/golden/cost/s0-bcm-example.json'), 'utf8'));
describe('교정 제안·실적 오차', () => {
  it('단일17·번들4 표본과 Excel E34 기하평균은 같은 값이다', () => {
    const samples = anchorSamples(basis, refs);
    expect(samples.filter((s) => s.kind === 'single')).toHaveLength(17);
    expect(samples.filter((s) => s.kind === 'bundle')).toHaveLength(4);
    for (const sample of samples) expect(sample.eurPerPt).toBe(sample.eur / sample.ptsAsil);
    expect(Math.abs(anchorSuggestion(basis, refs) / golden.excel.anchorSuggest - 1)).toBeLessThan(1e-12);
  });
  it('표본 없음·누락·0원 번들로 NaN·Infinity를 만들지 않는다', () => {
    expect(() => anchorSuggestion({ ...basis, calibration: { singles: [], bundles: [] } }, refs)).toThrow();
    expect(() => anchorSamples({ ...basis, calibration: { singles: ['NONE'], bundles: [] } }, refs)).toThrow();
    expect(() => anchorSamples({ ...basis, calibration: { singles: [], bundles: ['NONE'] } }, refs)).toThrow();
  });
  it('중복 기준 행 기대 공수 합·미선택 제외·실적 없는 행 제외·평균을 계산한다', () => {
    const lines = [{ refId: 'A', e: 3, effQty: 1 }, { refId: 'A', e: 1, effQty: 1 }, { refId: 'A', e: 100, effQty: 0 }, { refId: 'B', e: 8, effQty: 0 }, { refId: 'C', e: 2, effQty: 1 }];
    const value = costMre(lines, new Map([['A', 5], ['B', 4], ['C', 1], ['D', 2]]));
    expect(value).toEqual({ rows: [{ refId: 'A', e: 4, actual: 5, mre: 0.2 }, { refId: 'C', e: 2, actual: 1, mre: 1 }], n: 2, missing: 0, avg: 0.6 });
    expect(costMre(lines, new Map()).avg).toBeNull();
    expect(costMre(lines, new Map([['A', 0], ['C', NaN]]))).toMatchObject({ n: 0, missing: 2, avg: null });
    expect(costMre([{ refId: 'A', e: Infinity, effQty: 1 }], new Map([['A', 1]]))).toMatchObject({ n: 0, missing: 1, avg: null });
  });
  it('실적은 양수 또는 명시적인 삭제만, 부가 필드·무한·0은 거부한다', () => {
    for (const actual of [0, -1, 100001, NaN, Infinity]) expect(PutCostActualBody.safeParse({ actual }).success).toBe(false);
    expect(PutCostActualBody.safeParse({}).success).toBe(false);
    expect(PutCostActualBody.safeParse({ actual: 1, totalCost: 1 }).success).toBe(false);
    expect(PutCostActualBody.parse({ actual: null })).toEqual({ actual: null });
  });
});
