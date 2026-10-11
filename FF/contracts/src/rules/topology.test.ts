import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import { judgeDependency, validateNewDependency } from './topology';

const ds = loadDataset();
const reg = new Map(ds.features.map((f) => [`${f.featureId}@${f.version}`, f]));
const get = (id: string, v: string | null) => (v ? reg.get(`${id}@${v}`) : undefined);

describe('의존관계 판정 (표 9)', () => {
  it('코드 판정이 데이터셋 29건의 판정 결과와 모두 같다 (PASS 24, 미판정 5)', () => {
    for (const d of ds.dependencies) {
      const r = judgeDependency(d, get(d.sourceFeatureId, d.sourceVersion), get(d.targetFeatureId, d.targetVersion));
      expect(r.verdict, `${d.dependencyId} ${r.rationale}`).toBe(d.verdict);
    }
  });

  it('대상 Version 미확정은 CONDITIONAL, 없는 대상은 FAIL', () => {
    const d = ds.dependencies.find((x) => x.dependencyId === 'DEP-00013')!;
    const src = get(d.sourceFeatureId, d.sourceVersion);
    expect(judgeDependency({ ...d, targetVersion: null }, src, undefined).verdict).toBe('CONDITIONAL');
    expect(judgeDependency({ ...d, targetVersion: '9.9.9' }, src, undefined).verdict).toBe('FAIL');
  });

  it('REQUIRES 대상이 원천보다 뒤처지면 FAIL', () => {
    const d = ds.dependencies.find((x) => x.dependencyId === 'DEP-00013')!;
    const src = get(d.sourceFeatureId, d.sourceVersion)!;
    const tgt = { ...get(d.targetFeatureId, d.targetVersion)!, lifecycle: 'DEVELOPING' as const };
    expect(judgeDependency(d, src, tgt).verdict).toBe('FAIL');
  });
});

describe('신규 의존관계 구조 검증', () => {
  const d13 = ds.dependencies.find((x) => x.dependencyId === 'DEP-00013')!;
  const s = get(d13.sourceFeatureId, d13.sourceVersion)!;
  const t = get(d13.targetFeatureId, d13.targetVersion)!;
  const codes = (x: ReturnType<typeof validateNewDependency>) => x.map((i) => i.code);

  it('같은 관계 재등록은 DUPLICATE_KEY', () => expect(codes(validateNewDependency(ds.dependencies, d13, s, t))).toContain('DUPLICATE_KEY'));
  it('역방향 REQUIRES는 순환', () => {
    const rev = { type: 'REQUIRES' as const, sourceFeatureId: t.featureId, sourceVersion: t.version, targetFeatureId: s.featureId, targetVersion: s.version };
    expect(codes(validateNewDependency(ds.dependencies, rev, t, s))).toEqual(['REQUIRES_CYCLE']);
  });
  it('EXCLUDES는 대칭 — 역방향 재등록은 중복', () => {
    const e = ds.dependencies.find((x) => x.type === 'EXCLUDES')!;
    const rev = { type: 'EXCLUDES' as const, sourceFeatureId: e.targetFeatureId, sourceVersion: e.targetVersion!, targetFeatureId: e.sourceFeatureId, targetVersion: e.sourceVersion };
    const src = get(rev.sourceFeatureId, rev.sourceVersion)!;
    expect(codes(validateNewDependency(ds.dependencies, rev, src, get(rev.targetFeatureId, rev.targetVersion)))).toContain('EXCLUDES_SYMMETRIC_DUPLICATE');
  });
  it('자기 참조·다른 범위', () => {
    expect(codes(validateNewDependency(ds.dependencies, { ...d13, targetFeatureId: s.featureId, targetVersion: s.version }, s, s))).toContain('SELF_REFERENCE');
    const eu = ds.features.find((f) => f.country !== s.country)!;
    expect(codes(validateNewDependency(ds.dependencies, { ...d13, targetFeatureId: eu.featureId, targetVersion: eu.version }, s, eu))).toContain('SCOPE_MISMATCH');
  });
});
