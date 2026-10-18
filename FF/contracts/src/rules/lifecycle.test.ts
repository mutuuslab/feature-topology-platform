// 상세설계서 표 10 (Lifecycle 전이)·표 7 (재판정)·Baseline 해시 규칙을 표 기반으로 고정한다.
import { describe, expect, it } from 'vitest';
import { GATES, type GateId, type GateStatus, type Lifecycle } from '../enums';
import type { FeatureVersionRow } from '../schemas/dataset';
import { loadDataset } from '../testing/fixtures';
import { canonicalJson, snapshotContent, snapshotDiff } from './canonical';
import { autoTransition, bumpVersion, compareVersion, evaluateTransition, FEATURE_TRANSITIONS, type TransitionContext } from './lifecycle';
import { changedKeys, gatesToRejudge } from './rejudge';

const ds = loadDataset();
const base = ds.features.find((f) => f.featureId === 'FEAT-00022')!;
const at = (lc: Lifecycle, patch: Partial<FeatureVersionRow> = {}): FeatureVersionRow => ({ ...base, lifecycle: lc, ...patch });
const pass = (...gs: GateId[]) => Object.fromEntries(gs.map((g) => [g, 'PASS' as GateStatus]));
const ctx = (p: Partial<TransitionContext> = {}): TransitionContext => ({ latestGates: {}, dependencies: [], policyCoverage: 99, ...p });
const codes = (r: ReturnType<typeof evaluateTransition>) => r.blockers.map((b) => b.code);
const SIGNED = { signedBy: 'usr-author', signedAt: '2026-10-18T09:00:00+09:00' };

describe('Lifecycle 전이 표', () => {
  it('7단계 전이 규칙이 설계서 순서대로 정의되어 있다', () => {
    expect(FEATURE_TRANSITIONS.map((r) => `${r.from}>${r.to}`)).toEqual([
      'PROPOSED>APPROVED', 'APPROVED>DEVELOPING', 'DEVELOPING>VERIFIED', 'VERIFIED>RELEASED', 'VERIFIED>DEVELOPING', 'RELEASED>DEPRECATED', 'DEPRECATED>RETIRED',
    ]);
  });

  it.each([
    ['PROPOSED', 'APPROVED', ['G1', 'G2', 'G3']],
    ['DEVELOPING', 'VERIFIED', ['G4', 'G5', 'G6', 'G7']],
    ['VERIFIED', 'RELEASED', ['G8', 'G9']],
  ] as const)('%s → %s 는 %j PASS가 필요하다', (from, to, gates) => {
    const actorRole = to === 'APPROVED' ? 'FEATURE_APPROVER' : to === 'RELEASED' ? 'RELEASE_MANAGER' : 'SYSTEM';
    const ok = evaluateTransition(at(from), to, ctx({ latestGates: pass(...gates), actor: { id: 'a', role: actorRole }, reason: '근거 확인', releaseSignoff: SIGNED }));
    expect(ok.blockers).toEqual([]);
    for (const g of gates) {
      const missing = evaluateTransition(at(from), to, ctx({ latestGates: pass(...gates.filter((x) => x !== g)) }));
      expect(missing.blockers).toContainEqual(expect.objectContaining({ code: 'GATE_UNJUDGED', ref: g }));
      const review = evaluateTransition(at(from), to, ctx({ latestGates: { ...pass(...gates), [g]: '검토 중' } }));
      expect(review.blockers).toContainEqual(expect.objectContaining({ code: 'GATE_NOT_PASSED', ref: g }));
    }
  });

  it('출시(VERIFIED→RELEASED)는 Feature Owner의 Release Sign-off가 있어야 한다 — 보고서 6.1 G7 승인자(사용자 결정 2026-10-18)', () => {
    const base = { latestGates: pass('G8', 'G9'), actor: { id: 'han.release', role: 'RELEASE_MANAGER' as const }, reason: '출시' };
    const none = evaluateTransition(at('VERIFIED'), 'RELEASED', ctx(base));
    expect(none.blockers).toEqual([expect.objectContaining({ code: 'RELEASE_SIGNOFF_MISSING' })]);
    expect(codes(evaluateTransition(at('VERIFIED'), 'RELEASED', ctx({ ...base, releaseSignoff: null })))).toEqual(['RELEASE_SIGNOFF_MISSING']);
    expect(evaluateTransition(at('VERIFIED'), 'RELEASED', ctx({ ...base, releaseSignoff: SIGNED })).blockers).toEqual([]);
    // 출시 외 전이에는 요구하지 않는다
    expect(codes(evaluateTransition(at('VERIFIED'), 'DEVELOPING', ctx({ actor: { id: 'q', role: 'GATE_JUDGE' }, reason: '재검증' })))).toEqual([]);
  });

  it('정의되지 않은 전이(되돌리기·건너뛰기)는 NO_RULE', () => {
    expect(codes(evaluateTransition(at('RELEASED'), 'VERIFIED', ctx()))).toEqual(['NO_RULE']);
    expect(codes(evaluateTransition(at('PROPOSED'), 'RELEASED', ctx()))).toEqual(['NO_RULE']);
  });

  it('필수 입력이 비면 INPUT_MISSING (APPROVED→DEVELOPING은 Control Point 1개 이상)', () => {
    expect(codes(evaluateTransition(at('APPROVED', { controlPoints: [] }), 'DEVELOPING', ctx()))).toEqual(['INPUT_MISSING']);
    expect(codes(evaluateTransition(at('DEVELOPING', { swIds: [] }), 'VERIFIED', ctx({ latestGates: pass('G4', 'G5', 'G6', 'G7') })))).toEqual(['INPUT_MISSING']);
  });

  it('PROPOSED→APPROVED: 의존관계 대상 Version 미확정이면 막힌다', () => {
    const r = evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: pass('G1', 'G2', 'G3'), dependencies: [{ dependencyId: 'DEP-00001', targetVersion: null, verdict: '미판정' }] }));
    expect(codes(r)).toContain('DEPENDENCY_UNRESOLVED');
  });

  it('DEVELOPING→VERIFIED: Control Point별 정책이 모두 등록되어야 한다', () => {
    const r = evaluateTransition(at('DEVELOPING'), 'VERIFIED', ctx({ latestGates: pass('G4', 'G5', 'G6', 'G7'), policyCoverage: 1 }));
    expect(codes(r)).toEqual(['POLICY_MISSING']);
  });

  it('역할·직무 분리·사유: 작성자는 자기 버전을 승인할 수 없다', () => {
    const g = pass('G1', 'G2', 'G3');
    expect(codes(evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: g, actor: { id: 'u1', role: 'FEATURE_AUTHOR' }, reason: '확인' })))).toEqual(['ROLE']);
    expect(codes(evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: g, actor: { id: 'u1', role: 'FEATURE_APPROVER' }, createdBy: 'u1', reason: '확인' })))).toEqual(['SEPARATION_OF_DUTY']);
    expect(codes(evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: g, actor: { id: 'u2', role: 'FEATURE_APPROVER' }, reason: ' ' })))).toEqual(['REASON_REQUIRED']);
  });

  it('자동 전이: CP가 있으면 APPROVED→DEVELOPING, G4~G7 PASS면 DEVELOPING→VERIFIED', () => {
    expect(autoTransition(at('APPROVED'), ctx())?.to).toBe('DEVELOPING');
    expect(autoTransition(at('APPROVED', { controlPoints: [] }), ctx())).toBeUndefined();
    expect(autoTransition(at('DEVELOPING'), ctx({ latestGates: pass('G4', 'G5', 'G6', 'G7') }))?.to).toBe('VERIFIED');
    expect(autoTransition(at('VERIFIED'), ctx({ latestGates: pass(...GATES) }))).toBeUndefined(); // 출시는 사람이 승인
  });

  it('semver 비교·증가', () => {
    expect(compareVersion('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(bumpVersion('2.1.4', 'minor')).toBe('2.2.0');
    expect(bumpVersion('2.1.4', 'major')).toBe('3.0.0');
  });
});

describe('재판정 Gate (표 7)', () => {
  it.each([
    [{ name: 'x' }, 'VERIFIED', ['G1']],
    [{ requirementIds: ['REQ-X'] }, 'VERIFIED', ['G2']],
    [{ upgVc: ['X'] }, 'VERIFIED', ['G3']],
    [{ asil: 'C' as const }, 'VERIFIED', ['G7']],
    [{ swVersions: ['9.9.9', '2.3.0'] }, 'VERIFIED', ['G5']],
    [{ functions: [] }, 'VERIFIED', ['G6']],
    [{ controlPoints: ['Flag' as const] }, 'VERIFIED', ['G4']],
    [{ controlPoints: ['Flag' as const] }, 'APPROVED', []], // DEVELOPING 이전 CP는 자유 수정
    [{ dependencyIds: [] }, 'VERIFIED', ['G1', 'G3']],
    [{ tags: ['x'] }, 'VERIFIED', []],
  ] as const)('%j (%s) → %j', (patch, lc, gates) => {
    expect(gatesToRejudge(changedKeys(base, patch as any), lc as Lifecycle)).toEqual(gates);
  });
});

describe('Baseline 스냅샷 해시 입력', () => {
  const bl = ds.bomItems.find((b) => b.baselineId === 'BL-00028')!;
  it('Lifecycle이 바뀌어도 정규화 결과는 같다', () => {
    expect(canonicalJson(snapshotContent({ ...bl, lifecycle: 'DEPRECATED' }))).toBe(canonicalJson(snapshotContent(bl)));
  });
  it('Registry 행과 BOM 행의 스냅샷 내용이 같다 (19 속성 중 Lifecycle을 뺀 18개가 해시 입력)', () => {
    expect(canonicalJson(snapshotContent(base))).toBe(canonicalJson(snapshotContent(bl)));
    expect(Object.keys(snapshotContent(bl))).toHaveLength(18);
    expect(Object.keys(snapshotContent(bl))).not.toContain('lifecycle');
  });
  it('키 순서와 무관하다', () => expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}'));
  it('diff는 바뀐 필드만', () => {
    const prev = snapshotContent(bl);
    expect(snapshotDiff(prev, { ...prev, swVersions: ['1.3.0', '2.3.0'] })).toEqual([{ field: 'swVersions', before: ['1.2.1', '2.3.0'], after: ['1.3.0', '2.3.0'] }]);
  });
});
