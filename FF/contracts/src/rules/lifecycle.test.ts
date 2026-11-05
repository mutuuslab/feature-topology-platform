// 상세설계서 표 10 (Lifecycle 전이)·표 7 (재판정)·Baseline 해시 규칙을 표 기반으로 고정한다.
import { describe, expect, it } from 'vitest';
import { GATES, type GateId, type GateStatus, type Lifecycle } from '../enums';
import type { FeatureVersionRow } from '../schemas/dataset';
import { loadDataset } from '../testing/fixtures';
import { canonicalJson, SNAPSHOT_EXCLUDE, snapshotContent, snapshotDiff } from './canonical';
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
    // 출시는 표 10의 G8·G9에 더해 9 Gate 전부를 다시 본다(FR-REG-002-008/009, requirements-defects.test.ts)
    ['VERIFIED', 'RELEASED', [...GATES]],
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
    const base = { latestGates: pass(...GATES), actor: { id: 'han.release', role: 'RELEASE_MANAGER' as const }, reason: '출시' };
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
    // 막힌 사유는 영문 필드 키가 아니라 화면 이름으로(담당자 웨이브 P2-2)
    expect(evaluateTransition(at('DEVELOPING', { swIds: [] }), 'VERIFIED', ctx({ latestGates: pass('G4', 'G5', 'G6', 'G7') })).blockers[0].message).toBe('필수 입력 누락: SW ID');
    expect(evaluateTransition(at('PROPOSED', { requirementIds: [] }), 'APPROVED', ctx({ latestGates: pass('G1', 'G2', 'G3') })).blockers.map((b) => b.message)).toContain('필수 입력 누락: 요구사항 ID');
  });

  it('PROPOSED→APPROVED: 의존관계 대상 Version 미확정이면 막힌다', () => {
    const r = evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: pass('G1', 'G2', 'G3'), dependencies: [{ dependencyId: 'DEP-00001', targetVersion: null, verdict: '미판정' }] }));
    expect(codes(r)).toContain('DEPENDENCY_UNRESOLVED');
  });

  it('PROPOSED→APPROVED: 연결된 기준 행이 요청 중(PENDING)·폐기(RETIRED)·없음이면 막힌다(30-95 §5.2, D-REF-7)', () => {
    const refs = [
      { refId: 'CH-BRK-009', role: 'PRIMARY' as const, refVersion: 'v1.3' },
      { refId: 'CH-BRK-006', role: 'INCLUDED' as const, refVersion: 'v1.3' },
    ];
    const status = (m: Record<string, 'ACTIVE' | 'REVIEW' | 'DEPRECATED' | 'RETIRED' | 'PENDING'>) => (id: string) => m[id];
    const ok = { latestGates: pass('G1', 'G2', 'G3'), actor: { id: 'usr-approver', role: 'FEATURE_APPROVER' as const }, reason: '근거 확인' };
    // 활성·검토 필요·폐기 예정은 통과(경고는 등록 때 남긴다)
    expect(evaluateTransition(at('PROPOSED', { featureRefs: refs }), 'APPROVED', ctx({ ...ok, refStatusOf: status({ 'CH-BRK-009': 'REVIEW', 'CH-BRK-006': 'DEPRECATED' }) })).blockers).toEqual([]);
    const blocked = evaluateTransition(at('PROPOSED', { featureRefs: refs }), 'APPROVED', ctx({ ...ok, refStatusOf: status({ 'CH-BRK-009': 'PENDING' }) }));
    expect(blocked.blockers.map((b) => [b.code, b.ref])).toEqual([
      ['REFDB_LINK_BLOCKED', 'CH-BRK-009'],
      ['REFDB_LINK_BLOCKED', 'CH-BRK-006'],
    ]);
    expect(blocked.blockers[0].message).toMatch(/요청 중/);
    expect(codes(evaluateTransition(at('PROPOSED', { featureRefs: refs }), 'APPROVED', ctx({ ...ok, refStatusOf: status({ 'CH-BRK-009': 'ACTIVE', 'CH-BRK-006': 'RETIRED' }) })))).toEqual(['REFDB_LINK_BLOCKED']);
    // 상태 조회를 주지 않는 호출자(Feature DB 연결 전)는 그대로
    expect(evaluateTransition(at('PROPOSED', { featureRefs: refs }), 'APPROVED', ctx(ok)).blockers).toEqual([]);
    // 다른 전이에는 걸지 않는다
    expect(codes(evaluateTransition(at('APPROVED', { featureRefs: refs }), 'DEVELOPING', ctx({ refStatusOf: () => 'PENDING' })))).not.toContain('REFDB_LINK_BLOCKED');
  });

  it('PROPOSED→APPROVED: 대표 기준 행 연결이 없으면 막힌다(사용자 결정 2026-11-04) — 다른 전이·상태 조회 없는 호출자는 그대로', () => {
    const ok = { latestGates: pass('G1', 'G2', 'G3'), actor: { id: 'usr-approver', role: 'FEATURE_APPROVER' as const }, reason: '근거 확인', refStatusOf: () => 'ACTIVE' as const };
    for (const featureRefs of [undefined, [], [{ refId: 'CH-BRK-006', role: 'INCLUDED' as const, refVersion: 'v1.3' }]]) {
      const r = evaluateTransition(at('PROPOSED', { featureRefs }), 'APPROVED', ctx(ok));
      expect(r.blockers.map((b) => [b.code, b.ref])).toEqual([['REFDB_LINK_BLOCKED', 'featureRefs']]);
      expect(r.blockers[0].message).toContain('기준 행을 연결하세요');
    }
    expect(evaluateTransition(at('PROPOSED', { featureRefs: undefined }), 'APPROVED', ctx({ ...ok, refStatusOf: undefined })).blockers).toEqual([]);
    // 이미 승인된 버전의 뒤 단계(출시 등)는 연결을 보지 않는다
    expect(codes(evaluateTransition(at('RELEASED', { featureRefs: undefined }), 'DEPRECATED', ctx({ refStatusOf: () => 'ACTIVE' })))).not.toContain('REFDB_LINK_BLOCKED');
  });

  it('PROPOSED→APPROVED: 대표 행의 대표 ASIL이 등록 뒤 바뀌면 지금 값 기준 사유가 있어야 한다(30-95 §6.3)', () => {
    const refs = [{ refId: 'CH-BRK-009', role: 'PRIMARY' as const, refVersion: 'v1.3' }];
    const ok = { latestGates: pass('G1', 'G2', 'G3'), actor: { id: 'usr-approver', role: 'FEATURE_APPROVER' as const }, reason: '근거 확인', refStatusOf: () => 'ACTIVE' as const };
    const asOf = (rep: 'QM' | 'A' | 'B' | 'C' | 'D') => () => rep;
    // 같으면 통과
    expect(evaluateTransition(at('PROPOSED', { asil: 'B', featureRefs: refs }), 'APPROVED', ctx({ ...ok, refAsilRepOf: asOf('B') })).blockers).toEqual([]);
    // 대표 ASIL이 C로 바뀜 — 사유 없음
    const none = evaluateTransition(at('PROPOSED', { asil: 'B', featureRefs: refs }), 'APPROVED', ctx({ ...ok, refAsilRepOf: asOf('C') }));
    expect(none.blockers.map((b) => [b.code, b.ref])).toEqual([['REFDB_LINK_BLOCKED', 'CH-BRK-009']]);
    expect(none.blockers[0].message).toMatch(/C → B/);
    // 이전 대표 ASIL 기준 사유(from A)는 효력이 없다
    const stale = evaluateTransition(at('PROPOSED', { asil: 'B', featureRefs: refs, asilDeviation: { from: 'A', to: 'B', reason: '이전 판단' } }), 'APPROVED', ctx({ ...ok, refAsilRepOf: asOf('C') }));
    expect(stale.blockers.map((b) => b.code)).toEqual(['REFDB_LINK_BLOCKED']);
    expect(stale.blockers[0].message).toMatch(/이전 대표 ASIL A/);
    // 지금 값 기준 사유면 통과
    expect(evaluateTransition(at('PROPOSED', { asil: 'B', featureRefs: refs, asilDeviation: { from: 'C', to: 'B', reason: '하향 근거 HARA' } }), 'APPROVED', ctx({ ...ok, refAsilRepOf: asOf('C') })).blockers).toEqual([]);
    // 대표 ASIL 조회를 주지 않으면 보지 않는다
    expect(evaluateTransition(at('PROPOSED', { asil: 'B', featureRefs: refs }), 'APPROVED', ctx(ok)).blockers).toEqual([]);
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

  // UX3-08(3초 테스트 S4): Feature 상세 스테퍼에 "허용 역할이 아닙니다 (RELEASE_MANAGER)"처럼 역할 코드가 보였다 — 한글 역할 라벨로
  it('역할 막힘 사유는 역할 코드가 아니라 한글 역할 라벨', () => {
    const r = evaluateTransition(at('RELEASED'), 'DEPRECATED', ctx({ actor: { id: 'u1', role: 'FEATURE_AUTHOR' }, reason: '확인' }));
    const role = r.blockers.find((b) => b.code === 'ROLE')!;
    expect(role.message).toBe('허용 역할이 아닙니다 (Feature 출시 담당자)');
    expect(role.message).not.toMatch(/[A-Z]+_[A-Z]+/);
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
  it('기준 기능 연결(featureRefs, refVersion 포함)은 해시 입력이다 — SNAPSHOT_EXCLUDE에 넣지 않는다(30-95 §5.3, 하네스 리뷰 M5)', () => {
    expect(SNAPSHOT_EXCLUDE as readonly string[]).not.toContain('featureRefs');
    const linked = { ...bl, featureRefs: [{ refId: 'AD-LON-009', role: 'PRIMARY' as const, refVersion: 'v1.3' }] };
    expect(snapshotContent(linked).featureRefs).toEqual(linked.featureRefs);
    // 연결 당시 발행 버전이 다르면 다른 내용
    const bumped = { ...linked, featureRefs: [{ ...linked.featureRefs[0], refVersion: 'v1.4' }] };
    expect(canonicalJson(snapshotContent(bumped))).not.toBe(canonicalJson(snapshotContent(linked)));
    // 연결이 없는 기존 스냅샷(BL-00028)의 정규화 결과는 그대로
    expect(Object.keys(snapshotContent(bl))).not.toContain('featureRefs');
  });
  it('키 순서와 무관하다', () => expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}'));
  it('diff는 바뀐 필드만', () => {
    const prev = snapshotContent(bl);
    expect(snapshotDiff(prev, { ...prev, swVersions: ['1.3.0', '2.3.0'] })).toEqual([{ field: 'swVersions', before: ['1.2.1', '2.3.0'], after: ['1.3.0', '2.3.0'] }]);
  });
});
