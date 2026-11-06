// Feature 관계 유형 10종(FR-DEP-009-001·002)·등록 검증(순환·대칭·반대 짝·충돌)·excludes 동시 활성화 정책(FR-DEP-009-003)
import { describe, expect, it } from 'vitest';
import { RelationType } from '../enums';
import { loadDataset } from '../testing/fixtures';
import { concurrentExclusivePolicies, RELATION_TYPE_LIST, RELATION_TYPES } from './relation-types';
import { judgeDependency, validateNewDependency } from './topology';

const ds = loadDataset();
const reg = new Map(ds.features.map((f) => [`${f.featureId}@${f.version}`, f]));

describe('관계 유형 값 목록', () => {
  it('명세 10종(parent_of·child_of·composed_of·requires·excludes·overrides·fallback_to·degrades_to·replaces·duplicates)을 모두 담는다', () => {
    expect(RELATION_TYPE_LIST.map((t) => RELATION_TYPES[t].spec).sort()).toEqual(
      ['child_of', 'composed_of', 'degrades_to', 'duplicates', 'excludes', 'fallback_to', 'overrides', 'parent_of', 'replaces', 'requires'],
    );
    expect(RelationType.options).toEqual(RELATION_TYPE_LIST);
  });
  it('parent_of와 child_of는 서로 반대 짝, excludes·duplicates는 대칭', () => {
    expect(RELATION_TYPES.PARENT_OF.inverse).toBe('CHILD_OF');
    expect(RELATION_TYPES.CHILD_OF.inverse).toBe('PARENT_OF');
    expect(RELATION_TYPE_LIST.filter((t) => RELATION_TYPES[t].symmetric)).toEqual(['EXCLUDES', 'DUPLICATES']);
  });
});

describe('새 관계 유형의 등록 검증', () => {
  // 같은 범위(KR/NX4 PE/Premium)의 Feature 셋
  const scoped = ds.features.filter((f) => f.country === 'KR' && f.vehicleModel === 'NX4 PE' && f.trim === 'Premium');
  const [a, b, c] = [...new Set(scoped.map((f) => f.featureId))].slice(0, 3).map((id) => scoped.find((f) => f.featureId === id)!);
  const rel = (type: RelationType, s: typeof a, t: typeof a) => ({ dependencyId: 'DEP-90000', type, sourceFeatureId: s.featureId, sourceVersion: s.version, targetFeatureId: t.featureId, targetVersion: t.version, country: s.country, vehicleModel: s.vehicleModel, trim: s.trim, targetVersionCheck: '버전 확정' as const, verdict: 'PASS' as const, ruleVersion: 'x', rationale: '', _missing: {} });
  const codes = (x: ReturnType<typeof validateNewDependency>) => x.map((i) => i.code);

  it('child_of는 이미 있는 반대 parent_of와 같은 관계 — INVERSE_DUPLICATE', () => {
    const existing = [rel('PARENT_OF', a, b)];
    expect(codes(validateNewDependency(existing, rel('CHILD_OF', b, a), b, a))).toContain('INVERSE_DUPLICATE');
  });
  it('상위·구성 관계가 원천으로 되돌아오면 RELATION_CYCLE', () => {
    const existing = [rel('PARENT_OF', a, b), rel('COMPOSED_OF', b, c)];
    expect(codes(validateNewDependency(existing, rel('PARENT_OF', c, a), c, a))).toContain('RELATION_CYCLE');
    // child_of는 반대 방향으로 읽는다 — c child_of a는 a→c, 순환 아님
    expect(codes(validateNewDependency(existing, rel('CHILD_OF', c, a), c, a))).not.toContain('RELATION_CYCLE');
  });
  it('대체 전환·기능 축소 고리도 순환으로 막는다', () => {
    const existing = [rel('FALLBACK_TO', a, b)];
    expect(codes(validateNewDependency(existing, rel('DEGRADES_TO', b, a), b, a))).toContain('RELATION_CYCLE');
  });
  it('duplicates는 대칭 — 역방향 재등록은 SYMMETRIC_DUPLICATE', () => {
    expect(codes(validateNewDependency([rel('DUPLICATES', a, b)], rel('DUPLICATES', b, a), b, a))).toContain('SYMMETRIC_DUPLICATE');
  });
  it('같은 두 Feature에 requires와 excludes를 함께 두면 CONFLICTING_RELATION', () => {
    expect(codes(validateNewDependency([rel('REQUIRES', a, b)], rel('EXCLUDES', b, a), b, a))).toContain('CONFLICTING_RELATION');
    expect(codes(validateNewDependency([rel('EXCLUDES', a, b)], rel('COMPOSED_OF', a, b), a, b))).toContain('CONFLICTING_RELATION');
  });
  it('구성·대체 전환 대상은 원천만큼 진행돼 있어야 PASS, 상위·우선 적용은 범위만 본다', () => {
    const src = { ...reg.get(`${a.featureId}@${a.version}`)!, lifecycle: 'RELEASED' as const };
    const young = { ...b, lifecycle: 'DEVELOPING' as const };
    expect(judgeDependency(rel('COMPOSED_OF', a, b), src, young).verdict).toBe('FAIL');
    expect(judgeDependency(rel('FALLBACK_TO', a, b), src, young).verdict).toBe('FAIL');
    expect(judgeDependency(rel('PARENT_OF', a, b), src, young)).toMatchObject({ verdict: 'PASS' });
    expect(judgeDependency(rel('OVERRIDES', a, b), src, young).rationale).toContain(RELATION_TYPES.OVERRIDES.label);
  });
  it('기존 REQUIRES·EXCLUDES 판정 문구는 그대로', () => {
    const d13 = ds.dependencies.find((x) => x.dependencyId === 'DEP-00013')!;
    const r = judgeDependency(d13, reg.get(`${d13.sourceFeatureId}@${d13.sourceVersion}`), reg.get(`${d13.targetFeatureId}@${d13.targetVersion}`));
    expect(r.rationale).toMatch(/^대상 FEAT-00145 5\.4\.2 RELEASED 확정/);
  });
});

describe('excludes 동시 활성화 — 정책 단위', () => {
  const p = (policyId: string, featureId: string, status: string, enabled = true) => ({ policyId, featureId, featureVersion: '1.0.0', flagKey: `k_${policyId.slice(-2)}`, status, enabled, stageBasisPoints: null, rollout: { mode: 'ALL' as const, basisPoints: 10000 } });
  it('두 Feature 모두 배포·켜짐 정책이 있으면 양쪽 정책을 돌려준다', () => {
    const r = concurrentExclusivePolicies([p('POL-00001', 'FEAT-00001', 'DEPLOYED'), p('POL-00002', 'FEAT-00002', 'DEPLOYED'), p('POL-00003', 'FEAT-00002', 'DRAFT')], 'FEAT-00001', 'FEAT-00002');
    expect(r.conflict).toBe(true);
    expect(r.source.map((x) => x.policyId)).toEqual(['POL-00001']);
    expect(r.target.map((x) => x.policyId)).toEqual(['POL-00002']);
  });
  it('한쪽이 꺼졌거나 0% 배포면 동시 활성화가 아니다', () => {
    expect(concurrentExclusivePolicies([p('POL-00001', 'FEAT-00001', 'DEPLOYED'), p('POL-00002', 'FEAT-00002', 'DEPLOYED', false)], 'FEAT-00001', 'FEAT-00002').conflict).toBe(false);
    const zero = { ...p('POL-00002', 'FEAT-00002', 'DEPLOYED'), stageBasisPoints: 0 };
    expect(concurrentExclusivePolicies([p('POL-00001', 'FEAT-00001', 'DEPLOYED'), zero], 'FEAT-00001', 'FEAT-00002').conflict).toBe(false);
  });
});
