/**
 * UI04 Feature BOM 기준선 — 엔진 순수 함수 + 화면 계약.
 *
 * 이 화면의 계약은 "승인 워크플로가 예쁘게 보인다"가 아니라 **실제 기준선 데이터 위에서
 * 계산이 돈다**는 것이다. 그래서 순수 함수는 data/featureBom.ts 의 실제 seed(BOM_BASELINES)와
 * 실제 store 초기 상태로 검증하고, 화면은 실제 Provider 스택(MemoryRouter + AppProvider) 위에서
 * 검증한다.
 *
 * 승인 차단은 문장이 아니라 필드에서 계산된다는 원칙도 여기서 고정한다 — 게이트 순서
 * (상태 409 → 구성원 422 → 사유 422 → hash 409 → 자기 승인 403 → 검증 412 → FAIL·위반 422 → 202)를
 * 각각 실제로 밟는다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { FeatureBom } from '../pages/featureBom';
import { BOM_AREAS, BOM_AREA_KO, BOM_REQUIRED_AREAS, IMPL_BOM_INDEX } from '../data/implementation';
import {
  BASELINE_INDEX,
  BASELINE_STATES,
  BASELINE_STATE_KO,
  BASELINE_STATE_TONE,
  BOM_BASELINES,
  BOM_CONDITION_PROFILES,
  BOM_VIOLATIONS,
  CONDITION_AXES,
  PROFILE_OUTCOME_KO,
  baselineTransition,
  baselineUsageOf,
  baselineViolationsOf,
  bomContentHash,
  bomStats,
  buildBomViews,
  computeBaselineViolations,
  evaluateProfiles,
  implementationBomsOf,
  memberCheckReport,
  type BomBaseline,
  type BomContext,
} from '../data/featureBom';

afterEach(() => cleanup());

// ── 실측 입력 ───────────────────────────────────────────────────────────────

const key = (b: BomBaseline) => `${b.id}@${b.version}`;
const byId = (k: string): BomBaseline => {
  const b = BASELINE_INDEX.get(k);
  if (!b) throw new Error(`기준선 ${k} 없음`);
  return b;
};
/** 기준선 하나의 검출 코드 — 정렬해서 집합처럼 비교한다. */
const codesOf = (k: string) => baselineViolationsOf(byId(k)).map(v => v.code).sort();

/** 정본 조건 예시 — 기존 조건행에서 실제로 뽑은 값만 쓴다. */
const KR_BDC = { market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-B', sw: 'ANY', upgvc: 'UPGVC-X' };
const KR_LIGHT = { market: 'KR', model: 'ADAS-LIGHT', modelYear: 'MY2027+', trim: 'Premium', option: 'NOT_APPLICABLE', hw: 'ECU-BDC-B', sw: 'SW-1', upgvc: 'UPGVC-X' };

const member = (o: Partial<BomBaseline['members'][number]> = {}): BomBaseline['members'][number] => ({
  memberId: 'MBR-X', parentRef: 'FEAT-LIGHT-001@2.0.0', featureVersionRef: 'FEAT-LIGHT-001@2.0.0',
  implementationRef: 'IBOM-LIGHT-001@2.0.0', conditionProfileRef: 'AP-KR-LIGHT@1', quantity: 1, ...o,
});

/** 검토 중 승인 후보 — 게이트 각 단계를 하나씩 어긋나게 만들어 검증한다. */
function synth(over: Partial<BomBaseline> = {}): BomBaseline {
  return {
    ...byId('BL-LIGHT-2027.1@1.0.0'),
    members: [member()],
    items: [],
    topologyNodes: ['FEAT-LIGHT-001@2.0.0'],
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 기준선 정본
// ════════════════════════════════════════════════════════════════════════════

describe('UI04 기준선 정본', () => {
  it('6개 기준선이 id@version 유일 키로 색인되고 상태는 5종 어휘만 쓴다', () => {
    expect(BOM_BASELINES).toHaveLength(6);
    expect(BASELINE_INDEX.size).toBe(6);
    expect(new Set(BOM_BASELINES.map(key)).size).toBe(6);
    for (const b of BOM_BASELINES) {
      expect(BASELINE_STATES).toContain(b.state);
      expect(BASELINE_STATE_KO[b.state]).toBeTruthy();
      expect(['pass', 'pending', 'fail', 'muted']).toContain(BASELINE_STATE_TONE[b.state]);
      expect(b.memberSetRef).toBeTruthy();
      expect(b.ownerRef).toBeTruthy();
      expect(b.author).toBeTruthy();
      expect(b.topologyRef).toMatch(/^TOPO-[\w-]+@\d+\.\d+\.\d+$/);
      expect(b.topologyNodes.length).toBe(new Set(b.topologyNodes).size);
    }
  });

  it('상태 분포가 신규 5상태를 모두 실제 데이터로 담는다', () => {
    const s = bomStats();
    expect(s.byState).toEqual({ DRAFT: 1, IN_REVIEW: 2, CHANGES_REQUESTED: 1, APPROVED: 1, REVOKED: 1 });
    expect(s.total).toBe(Object.values(s.byState).reduce((a, b) => a + b, 0));
  });

  it('모든 contentHash 가 64자리 hex 이고 정규 직렬화 재계산과 일치한다', () => {
    for (const b of BOM_BASELINES) {
      expect(b.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(bomContentHash(b)).toBe(b.contentHash);
    }
  });

  it('Item 은 구성원 × 11개 영역으로 전개되고 부모가 기준선 안에 있다', () => {
    for (const b of BOM_BASELINES) {
      const expected = new Set(b.members.flatMap(m => BOM_AREAS.map(a => `${m.memberId}-${m.conditionProfileRef}-${a}`)));
      const derived = b.items.filter(i => expected.has(i.id));
      expect(derived).toHaveLength(expected.size);
      expect(new Set(b.items.map(i => i.id)).size).toBe(b.items.length);
      const parents = new Set([...b.members.map(m => m.memberId), ...b.members.map(m => m.featureVersionRef)]);
      for (const it of derived) expect(parents.has(it.parentRef)).toBe(true);
      // 최상위 멤버의 parentRef 는 자기 자신을 가리킨다
      for (const m of b.members) expect(m.parentRef).toBe(m.featureVersionRef);
    }
  });

  it('파생되지 않은 Item 은 기준선 밖 부모를 가진 예외 한 건뿐이다', () => {
    const extra: string[] = [];
    for (const b of BOM_BASELINES) {
      const expected = new Set(b.members.flatMap(m => BOM_AREAS.map(a => `${m.memberId}-${m.conditionProfileRef}-${a}`)));
      for (const it of b.items.filter(i => !expected.has(i.id))) {
        extra.push(`${key(b)} ${it.id} → ${it.parentRef}`);
        expect(it.parentRef).not.toBe(it.id);
      }
    }
    expect(extra).toEqual(['BL-ADAS-2027.1@1.0.0 MBR-ADAS-A-Requirement → FEAT-ADAS-001@2.3.0']);
    expect(bomStats().items).toBe(10 * BOM_AREAS.length + extra.length);
  });

  it('BOM 영역은 11종이고 필수 영역이 그 안에 있다', () => {
    expect(BOM_AREAS).toHaveLength(11);
    expect(BOM_AREAS.length).toBe(bomStats().areas);
    for (const a of BOM_REQUIRED_AREAS) expect(BOM_AREAS).toContain(a);
    for (const a of BOM_AREAS) expect(BOM_AREA_KO[a]).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. contentHash 결속
// ════════════════════════════════════════════════════════════════════════════

describe('contentHash — 승인·검증·증적의 결속 기준', () => {
  const base = byId('BL-LIGHT-ADAS-2027.1@1.0.0');

  it('구성원·Item 순서를 바꿔도 hash 가 같다', () => {
    const shuffled = { members: [...base.members].reverse(), items: [...base.items].reverse() };
    expect(bomContentHash(shuffled)).toBe(base.contentHash);
  });

  it('구성원 구현 참조가 바뀌면 hash 가 바뀐다', () => {
    const changed = { members: base.members.map(m => ({ ...m, implementationRef: 'IBOM-LIGHT-001@2.0.0' })), items: base.items };
    expect(bomContentHash(changed)).not.toBe(base.contentHash);
  });

  it('수량 변경도 hash 를 바꾼다', () => {
    const changed = { members: base.members.map(m => ({ ...m, quantity: m.quantity + 1 })), items: base.items };
    expect(bomContentHash(changed)).not.toBe(base.contentHash);
  });

  it('상태·승인·철회 기록은 내용이 아니므로 hash 를 바꾸지 않는다', () => {
    const asDraft = { ...base, state: 'DRAFT' as const, approval: undefined, assessmentRef: undefined };
    const revoked = { ...base, state: 'REVOKED' as const, revokedAt: '2026-09-13 10:00', revokedReason: '철회' };
    expect(bomContentHash(asDraft)).toBe(base.contentHash);
    expect(bomContentHash(revoked)).toBe(base.contentHash);
  });

  it('승인 기록이 현재 hash 를 가리킬 때만 hash 결속이 성립한다', () => {
    const approved = base;
    expect(approved.approval?.contentHashRef).toBe(approved.contentHash);
    const stale = byId('BL-BDC-2027.1@1.0.0');
    expect(stale.approval?.contentHashRef).not.toBe(stale.contentHash);
    const s = bomStats();
    expect(s.hashVerified).toBe(1);
    expect(s.hashMismatch).toBe(2);
    expect(s.independentApproval).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 위반 계산 — 승인 차단 사유
// ════════════════════════════════════════════════════════════════════════════

describe('위반 계산 — 승인 차단은 필드에서 계산한다', () => {
  it('모든 위반이 차단 사유이고 code|target 중복이 없다', () => {
    expect(BOM_VIOLATIONS.length).toBeGreaterThan(0);
    for (const v of BOM_VIOLATIONS) {
      expect(v.blocking).toBe(true);
      expect(v.detail).toBeTruthy();
      expect(v.target).toMatch(/@\d+\.\d+\.\d+/);
    }
    expect(new Set(BOM_VIOLATIONS.map(v => `${v.code}|${v.target}`)).size).toBe(BOM_VIOLATIONS.length);
    const sum = BOM_BASELINES.reduce((n, b) => n + baselineViolationsOf(b).length, 0);
    expect(sum).toBe(BOM_VIOLATIONS.length);
    expect(bomStats().blocking).toBe(BOM_VIOLATIONS.length);
  });

  it('기준선별 검출 코드가 seed 데이터와 일치한다', () => {
    expect(codesOf('BL-LIGHT-ADAS-2027.1@1.0.0')).toEqual([]);
    expect(codesOf('BL-LIGHT-2027.1@1.0.0')).toEqual([]);
    expect(codesOf('BL-BDC-2027.1@1.0.0')).toEqual(['ASSESSMENT_REQUIRED', 'HASH_MISMATCH', 'UNRESOLVED_ITEM']);
    expect(codesOf('BL-BDC-2027.2@2.0.0')).toEqual([
      'BOM_TOPOLOGY_MISMATCH', 'IMPL_BOM_UNKNOWN', 'MEMBER_OUTSIDE_BASELINE', 'MULTI_IMPLEMENTATION_MEMBER', 'UNRESOLVED_ITEM',
    ]);
    expect(codesOf('BL-ADAS-2027.1@1.0.0')).toEqual(['CONFIG_CONFLICT', 'DUPLICATE_MEMBER', 'MEMBER_OUTSIDE_BASELINE']);
    expect(codesOf('BL-BDC-2026.4@4.0.0')).toEqual(['HASH_MISMATCH', 'SELF_APPROVAL', 'UNRESOLVED_ITEM']);
  });

  it('승인 완료 기준선은 차단 위반이 0건이다', () => {
    const approved = BOM_BASELINES.filter(b => b.state === 'APPROVED');
    expect(approved.length).toBeGreaterThan(0);
    for (const b of approved) expect(baselineViolationsOf(b)).toEqual([]);
  });

  it('연속 중복 구성원은 한 건으로만 보고한다', () => {
    const dup = synth({ members: [member(), member(), member()] });
    const v = computeBaselineViolations([dup]);
    expect(v.filter(x => x.code === 'DUPLICATE_MEMBER')).toHaveLength(1);
    expect(v).toHaveLength(1);
  });

  it('해석 불가 구현의 Item 은 UNRESOLVED_ITEM 으로 중복 보고하지 않는다', () => {
    const b = byId('BL-BDC-2027.2@2.0.0');
    const adas = b.members.find(m => m.memberId === 'MBR-ADAS');
    expect(adas?.implementationRef).toBe('IBOM-ADAS-001@2.1.0');
    expect(IMPL_BOM_INDEX.get('IBOM-ADAS-001@2.1.0')).toBeUndefined();
    // 미등록 구현의 Item 은 전개 자체가 안 되므로 UNRESOLVED 로 남고, 보고는 IMPL_BOM_UNKNOWN 한 건이다
    expect(b.items.filter(i => i.id.startsWith('MBR-ADAS-')).every(i => i.resolution === 'UNRESOLVED')).toBe(true);
    expect(baselineViolationsOf(b).filter(v => v.target.includes('MBR-ADAS')).map(v => v.code)).toEqual(['IMPL_BOM_UNKNOWN']);
  });

  it('검증 결과 결속 검사는 검토 중·승인 상태에서만 돈다', () => {
    const revoked = byId('BL-BDC-2026.4@4.0.0');
    expect(revoked.assessmentRef).toBeUndefined();
    expect(codesOf('BL-BDC-2026.4@4.0.0')).not.toContain('ASSESSMENT_REQUIRED');

    const needAssessment = synth({ state: 'IN_REVIEW', assessmentRef: undefined });
    expect(computeBaselineViolations([needAssessment]).map(v => v.code)).toEqual(['ASSESSMENT_REQUIRED']);

    const staleAssessment = synth({
      state: 'APPROVED',
      assessmentRef: { id: 'ASM-X', hashRef: 'OTHER', result: 'PASS', harness: 'HIL-X', at: '2026-09-13 09:00' },
    });
    expect(computeBaselineViolations([staleAssessment]).map(v => v.code)).toEqual(['HASH_MISMATCH']);
  });

  it('구현 구성의 featureRef 가 멤버 버전과 다르면 하위 버전 참조로 차단한다', () => {
    const v = baselineViolationsOf(byId('BL-BDC-2027.2@2.0.0')).find(x => x.target.endsWith('MBR-EU-BDC'));
    expect(v?.code).toBe('MEMBER_OUTSIDE_BASELINE');
    expect(v?.detail).toContain('FEAT-BDC-001@1.0.0');
  });

  it('Topology node 집합과 구성원이 다르면 양쪽 차이를 그대로 보고한다', () => {
    const v = baselineViolationsOf(byId('BL-BDC-2027.2@2.0.0')).find(x => x.code === 'BOM_TOPOLOGY_MISMATCH');
    expect(v?.target).toBe('BL-BDC-2027.2@2.0.0 → TOPO-BDC-BODY@3.2.0');
    expect(v?.detail).toContain('Topology 에만 있는 node FEAT-PARK-001@1.0.0');
  });

  it('구현 구성 FK 를 구성원별로 해석한다', () => {
    const pairs = implementationBomsOf(byId('BL-BDC-2027.2@2.0.0'));
    expect(pairs.map(p => p.ref).sort()).toEqual(['IBOM-ADAS-001@2.1.0', 'IBOM-BDC-001@1.0.0', 'IBOM-BDC-001@1.1.0']);
    expect(pairs.filter(p => !p.bom).map(p => p.ref)).toEqual(['IBOM-ADAS-001@2.1.0']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. 조건 Profile — 구현 선택 판정
// ════════════════════════════════════════════════════════════════════════════

describe('조건 Profile — 행 안은 AND, 행 사이는 OR', () => {
  it('조건 축 8종을 쓰고 배열을 교차곱으로 전개하지 않는다', () => {
    expect([...CONDITION_AXES]).toEqual(['market', 'model', 'modelYear', 'trim', 'option', 'hw', 'sw', 'upgvc']);
    expect(BOM_CONDITION_PROFILES).toHaveLength(6);
    for (const r of BOM_CONDITION_PROFILES) {
      expect(BOM_CONDITION_PROFILES.filter(x => `${x.id}@${x.version}` === `${r.id}@${r.version}`)).toHaveLength(1);
      expect(IMPL_BOM_INDEX.has(r.implementationRef)).toBe(true);
      for (const axis of CONDITION_AXES) expect(typeof r[axis]).toBe('string');
    }
  });

  it('행 안의 조건은 AND 다 — 한 축이라도 다르면 그 행은 참이 아니다', () => {
    // 시장이 EU 면 ADAS-LIGHT 행은 조건 불일치 → 남는 행이 없어 지원 없음
    expect(evaluateProfiles({ ...KR_LIGHT, market: 'EU' })).toMatchObject({ outcome: 'NOT_SUPPORTED', matched: [] });
  });

  it('ANY·NOT_APPLICABLE 은 제약 없음으로 취급한다', () => {
    const r = evaluateProfiles({ ...KR_LIGHT, option: 'Premium', hw: 'ECU-ANYTHING', sw: 'SW-9' });
    expect(r.outcome).toBe('SELECTED');
    expect(r.implementationRef).toBe('IBOM-LIGHT-001@2.0.0');
    expect(r.matched).toEqual(['AP-KR-LIGHT@1']);
  });

  it('확정 판정이 하나면 그 구현을 고른다', () => {
    const r = evaluateProfiles(KR_LIGHT);
    expect(r.outcome).toBe('SELECTED');
    expect(r.implementationRef).toBe('IBOM-LIGHT-001@2.0.0');
    expect(r.reason).toContain('정확 구현 IBOM-LIGHT-001@2.0.0 선택');
  });

  it('같은 조건의 두 행이 다른 구현을 고르면 임의 우선순위를 만들지 않는다', () => {
    const r = evaluateProfiles(KR_BDC);
    expect(r.outcome).toBe('CONFIG_CONFLICT');
    expect(r.implementationRef).toBeUndefined();
    expect(r.matched).toEqual(['AP-KR-A@1', 'AP-KR-A2@2']);
    expect(r.reason).toContain('임의 우선순위를 만들지 않는다');
  });

  it('필수 조건 입력이 비면 활성화를 보류한다', () => {
    const empty = evaluateProfiles({});
    expect(empty.outcome).toBe('UNVERIFIED');
    expect(empty.matched).toHaveLength(BOM_CONDITION_PROFILES.length);
    expect(empty.implementationRef).toBeUndefined();

    const unknownTrim = evaluateProfiles({ ...KR_BDC, trim: 'UNKNOWN' });
    expect(unknownTrim.outcome).toBe('UNVERIFIED');
    expect(unknownTrim.reason).toContain('필수 조건 입력이 UNKNOWN');

    // 일부 축만 알면 그 행은 확정이 아니라 보류다
    const partial: BomContext = { market: 'KR', model: 'ADAS-LIGHT', upgvc: 'UPGVC-X' };
    expect(evaluateProfiles(partial).outcome).toBe('UNVERIFIED');
  });

  it('조건을 만족하는 행이 없으면 지원 없음으로 남긴다', () => {
    const r = evaluateProfiles({ ...KR_BDC, market: 'US' });
    expect(r).toMatchObject({ outcome: 'NOT_SUPPORTED', matched: [] });
    expect(r.implementationRef).toBeUndefined();
    expect(PROFILE_OUTCOME_KO[r.outcome]).toBe('지원 없음');
  });

  it('행 목록을 넘기면 그 목록만으로 판정한다', () => {
    const rows = BOM_CONDITION_PROFILES.filter(r => r.id === 'AP-KR-A');
    expect(evaluateProfiles(KR_BDC, rows)).toMatchObject({ outcome: 'SELECTED', implementationRef: 'IBOM-BDC-001@1.1.0' });
    expect(evaluateProfiles(KR_LIGHT, rows).outcome).toBe('NOT_SUPPORTED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Master · Configured · Effective — 파생 표현
// ════════════════════════════════════════════════════════════════════════════

describe('Master·Configured·Effective 는 파생 표현이다', () => {
  const base = byId('BL-LIGHT-ADAS-2027.1@1.0.0');

  it('세 view 는 모두 읽기 전용이고 순서가 고정이다', () => {
    const views = buildBomViews(base, KR_LIGHT);
    expect(views.map(v => v.kind)).toEqual(['MASTER', 'CONFIGURED', 'EFFECTIVE']);
    for (const v of views) {
      expect(v.readOnly).toBe(true);
      expect(v.title).toBeTruthy();
      expect(v.note).toBeTruthy();
      expect(v.rows).toHaveLength(base.members.length);
      expect(v.rows.map(r => r.key)).toEqual(base.members.map(m => m.memberId));
    }
  });

  it('MASTER 는 실행 조건과 무관하게 승인 구성을 그대로 보여준다', () => {
    const [a] = buildBomViews(base, KR_LIGHT);
    const [b] = buildBomViews(base, {});
    expect(a.rows.map(r => r.viewValue)).toEqual(b.rows.map(r => r.viewValue));
    expect(a.rows.map(r => r.viewValue)).toEqual(base.members.map(m => m.implementationRef));
    expect(a.rows.every(r => r.review === 'NONE')).toBe(true);
  });

  it('CONFIGURED — 확정 판정이면 선택 구현을, 아니면 차단·확인 필요로 남긴다', () => {
    const [, selected] = buildBomViews(base, KR_LIGHT);
    expect(selected.rows.every(r => r.viewValue === 'IBOM-LIGHT-001@2.0.0')).toBe(true);
    expect(selected.rows.every(r => r.review === 'NONE')).toBe(true);

    const [, blocked] = buildBomViews(base, KR_BDC);
    expect(blocked.rows.every(r => r.viewValue.startsWith('조건 충돌'))).toBe(true);
    expect(blocked.rows.every(r => r.review === 'BLOCKED')).toBe(true);
    expect(blocked.rows[0].impact).toContain('AP-KR-A@1');

    const [, unsupported] = buildBomViews(base, { ...KR_BDC, market: 'US' });
    expect(unsupported.rows.every(r => r.review === 'BLOCKED')).toBe(true);

    const [, review] = buildBomViews(base, {});
    expect(review.rows.every(r => r.review === 'REVIEW')).toBe(true);
  });

  it('EFFECTIVE — Control 영역 관측값을 붙이고 미보고를 그대로 표시한다', () => {
    const [, , effective] = buildBomViews(base, KR_LIGHT);
    const impl = IMPL_BOM_INDEX.get(base.members[0].implementationRef);
    const control = impl?.items.find(i => i.area === 'Control');
    expect(control?.refs.length).toBeGreaterThan(0);
    expect(effective.rows[0].baselineValue).toBe(control?.refs.join(', '));
    expect(effective.rows[0].viewValue).toContain(`${control?.refs[0]}=미보고`);
    expect(effective.rows[0].impact).toContain('실행 권한으로 해석하지 않는다');
    expect(effective.note).toContain('관측');

    const observed = buildBomViews(base, KR_LIGHT, { [control!.refs[0]]: 42 });
    expect(observed[2].rows[0].viewValue).toContain(`${control!.refs[0]}=42`);
    expect(observed[2].rows.every(r => r.review === 'REVIEW')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. 승인 워크플로 — 상태 전이와 게이트
// ════════════════════════════════════════════════════════════════════════════

describe('승인 워크플로 — 접수와 업무 완료를 구분한다', () => {
  it('허용되지 않은 상태 전이는 409 STATE_CONFLICT 다', () => {
    const matrix: [string, Parameters<typeof baselineTransition>[1]][] = [
      ['BL-LIGHT-2027.1@1.0.0', 'submit'],
      ['BL-LIGHT-2027.1@1.0.0', 'revoke'],
      ['BL-LIGHT-2027.1@1.0.0', 'revise'],
      ['BL-BDC-2027.2@2.0.0', 'approve'],
      ['BL-BDC-2027.2@2.0.0', 'requestChanges'],
      ['BL-LIGHT-ADAS-2027.1@1.0.0', 'submit'],
      ['BL-BDC-2026.4@4.0.0', 'submit'],
    ];
    for (const [k, action] of matrix) {
      const r = baselineTransition(byId(k), action, 'lee.jihyun@quality', { reason: '사유', violations: [] });
      expect([k, action, r.http, r.code]).toEqual([k, action, 409, 'STATE_CONFLICT']);
      expect(r.ok).toBe(false);
      expect(r.message).toContain(BASELINE_STATE_KO[byId(k).state]);
    }
  });

  it('승인 202 — 승인 기록이 현재 contentHash 를 가리키고 입력을 바꾸지 않는다', () => {
    const b = byId('BL-LIGHT-2027.1@1.0.0');
    const before = JSON.stringify(b);
    const r = baselineTransition(b, 'approve', 'lee.jihyun@quality', { reason: '독립 승인', role: 'approver' });
    expect(r).toMatchObject({ ok: true, http: 202, next: 'APPROVED' });
    expect(r.approval).toMatchObject({
      actor: 'lee.jihyun@quality', role: 'approver', reason: '독립 승인', at: '2026-09-13 10:20', contentHashRef: b.contentHash,
    });
    expect(r.message).toContain(`contentHash ${b.contentHash.slice(0, 12)}…`);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('검토 요청·보완 요청·다시 작성·철회도 상태만 갱신한다', () => {
    const submit = baselineTransition(synth({ state: 'DRAFT' }), 'submit', 'kim.taeho@body', { violations: [] });
    expect(submit).toMatchObject({ ok: true, http: 202, next: 'IN_REVIEW' });
    expect(submit.message).toContain('Location: /api/ui/v1/commands/cmd-');

    const revise = baselineTransition(byId('BL-ADAS-2027.1@1.0.0'), 'revise', 'jung.hana@adas');
    expect(revise).toMatchObject({ ok: true, http: 202, next: 'DRAFT' });

    const changes = baselineTransition(synth({ state: 'IN_REVIEW', approval: undefined }), 'requestChanges', 'lee.jihyun@quality', { reason: '근거 보완' });
    expect(changes).toMatchObject({ ok: true, http: 202, next: 'CHANGES_REQUESTED' });

    const revoke = baselineTransition(byId('BL-LIGHT-ADAS-2027.1@1.0.0'), 'revoke', 'lee.jihyun@quality', { reason: '구성 불일치' });
    expect(revoke).toMatchObject({ ok: true, http: 202, next: 'REVOKED' });
    expect(revoke.message).toContain('기록은 보존하고');
  });

  it('보완 요청은 사유가 있어야 접수된다', () => {
    const b = synth({ state: 'IN_REVIEW', approval: undefined });
    expect(baselineTransition(b, 'requestChanges', 'lee.jihyun@quality')).toMatchObject({ ok: false, http: 422, code: 'REASON_REQUIRED' });
    expect(baselineTransition(b, 'requestChanges', 'lee.jihyun@quality', { reason: '   ' }).code).toBe('REASON_REQUIRED');
  });

  it('구성원이 없는 기준선은 검토로 올리거나 승인할 수 없다', () => {
    const draft = synth({ state: 'DRAFT', members: [], items: [] });
    expect(baselineTransition(draft, 'submit', 'kim.taeho@body', { violations: [] }))
      .toMatchObject({ ok: false, http: 422, code: 'MEMBER_OUTSIDE_BASELINE' });

    const review = synth({ state: 'IN_REVIEW', members: [], items: [], approval: undefined });
    expect(baselineTransition(review, 'approve', 'lee.jihyun@quality', { violations: [] }))
      .toMatchObject({ ok: false, http: 422, code: 'MEMBER_OUTSIDE_BASELINE' });
    // 구성원이 없어도 다시 작성·철회는 막지 않는다
    expect(baselineTransition(draft, 'submit', 'kim.taeho@body', { violations: [] }).message).toContain('구성원이 없는');
  });

  it('작성자 자기 승인은 403 이다', () => {
    const r = baselineTransition(synth({ state: 'IN_REVIEW', approval: undefined }), 'approve', 'kim.taeho@body', { violations: [] });
    expect(r).toMatchObject({ ok: false, http: 403, code: 'SELF_APPROVAL' });
    expect(r.message).toContain('별도 승인자가 필요하다');
  });

  it('현재 hash 의 검증 결과가 없으면 412, 결과가 FAIL 이면 422 다', () => {
    const noAssessment = synth({ state: 'IN_REVIEW', approval: undefined, assessmentRef: undefined });
    expect(baselineTransition(noAssessment, 'approve', 'lee.jihyun@quality', { violations: [] }))
      .toMatchObject({ ok: false, http: 412, code: 'ASSESSMENT_REQUIRED' });

    const staleHash = synth({
      state: 'IN_REVIEW', approval: undefined,
      assessmentRef: { id: 'ASM-X', hashRef: 'OTHER', result: 'PASS', harness: 'HIL-X', at: '2026-09-13 09:00' },
    });
    expect(baselineTransition(staleHash, 'approve', 'lee.jihyun@quality', { violations: [] }).http).toBe(412);

    const failed = synth({
      state: 'IN_REVIEW', approval: undefined,
      assessmentRef: { id: 'ASM-X', hashRef: 'CURRENT', result: 'FAIL', harness: 'HIL-X', at: '2026-09-13 09:00' },
    });
    expect(baselineTransition(failed, 'approve', 'lee.jihyun@quality', { violations: [] }))
      .toMatchObject({ ok: false, http: 422, code: 'UNRESOLVED_ITEM' });
  });

  it('조건부(CONDITIONAL) 검증 결과는 승인을 막지 않는다 — 차단은 위반 계산이 한다', () => {
    const conditional = synth({
      state: 'IN_REVIEW', approval: undefined,
      assessmentRef: { id: 'ASM-ADAS-0390', hashRef: 'CURRENT', result: 'CONDITIONAL', harness: 'HIL-ADAS-07', at: '2026-09-09 15:12' },
    });
    expect(baselineTransition(conditional, 'approve', 'lee.jihyun@quality', { violations: [] }))
      .toMatchObject({ ok: true, http: 202, next: 'APPROVED' });
    // 실제 seed 의 조건부 기준선은 위반 계산에서 막힌다
    expect(codesOf('BL-ADAS-2027.1@1.0.0').length).toBeGreaterThan(0);
    expect(baselineTransition(byId('BL-ADAS-2027.1@1.0.0'), 'approve', 'lee.jihyun@quality').http).toBe(409);
  });

  it('승인 후보 hash 불일치는 자기 승인보다 먼저 판정된다', () => {
    const stale = synth({
      state: 'IN_REVIEW',
      approval: { actor: 'lee.jihyun@quality', role: 'approver', at: '2026-09-10 11:40', reason: '1차 검토 승인', contentHashRef: 'deadbeef' },
    });
    expect(baselineTransition(stale, 'approve', 'lee.jihyun@quality', { violations: [] }))
      .toMatchObject({ ok: false, http: 409, code: 'HASH_MISMATCH' });
    // 실제 seed 에서도 같은 결과 — 작성자가 승인하려 해도 hash 불일치가 먼저다
    expect(baselineTransition(byId('BL-BDC-2027.1@1.0.0'), 'approve', 'kim.taeho@body'))
      .toMatchObject({ ok: false, http: 409, code: 'HASH_MISMATCH' });
  });

  it('승인 기록 hash 가 현재 내용과 같으면 통과한다', () => {
    const b = byId('BL-LIGHT-2027.1@1.0.0');
    const same = synth({
      state: 'IN_REVIEW',
      approval: { actor: 'lee.jihyun@quality', role: 'approver', at: '2026-09-10 11:40', reason: '1차 승인', contentHashRef: b.contentHash },
    });
    expect(computeBaselineViolations([same])).toEqual([]);
    expect(baselineTransition(same, 'approve', 'lee.jihyun@quality', { violations: [] }).ok).toBe(true);
  });

  it('차단 위반이 있으면 422 로 막고 첫 차단 코드를 그대로 보고한다', () => {
    const r = baselineTransition(byId('BL-BDC-2027.2@2.0.0'), 'submit', 'kim.taeho@body');
    expect(r).toMatchObject({ ok: false, http: 422, code: 'MULTI_IMPLEMENTATION_MEMBER' });
    expect(r.message).toContain('검토 요청 차단 위반 5건');
    expect(r.message).toContain('MULTI_IMPLEMENTATION_MEMBER, MEMBER_OUTSIDE_BASELINE');
  });

  it('저장소의 현재 위반 집합을 주입하면 그 결과로 판정한다', () => {
    const b = synth({ state: 'DRAFT' });
    const crafted = [{ code: 'CONFIG_CONFLICT' as const, target: `${key(b)} → MBR-X`, detail: '주입', blocking: true }];
    expect(baselineTransition(b, 'submit', 'kim.taeho@body', { violations: crafted }))
      .toMatchObject({ ok: false, http: 422, code: 'CONFIG_CONFLICT' });
    expect(baselineTransition(b, 'submit', 'kim.taeho@body', { violations: [] }).ok).toBe(true);
    // 비차단 위반은 승인을 막지 않는다
    const warning = [{ code: 'CONFIG_CONFLICT' as const, target: `${key(b)} → MBR-X`, detail: '경고', blocking: false }];
    expect(baselineTransition(b, 'submit', 'kim.taeho@body', { violations: warning }).ok).toBe(true);
  });

  it('접수 시각과 역할을 넘기면 그대로 기록한다', () => {
    const r = baselineTransition(byId('BL-LIGHT-2027.1@1.0.0'), 'approve', 'park.minsoo@quality', { role: 'approver', at: '2026-09-13 11:02' });
    expect(r.approval?.at).toBe('2026-09-13 11:02');
    expect(r.approval?.reason).toBe('승인');
    expect(r.approval?.contentHashRef).toBe(byId('BL-LIGHT-2027.1@1.0.0').contentHash);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. KPI · 역조회 · 구성원 검사
// ════════════════════════════════════════════════════════════════════════════

describe('KPI · 역조회 · 구성원 검사', () => {
  it('KPI 는 계산 결과를 그대로 노출한다', () => {
    expect(bomStats()).toEqual({
      total: 6,
      byState: { DRAFT: 1, IN_REVIEW: 2, CHANGES_REQUESTED: 1, APPROVED: 1, REVOKED: 1 },
      approved: 1, inReview: 2, draft: 1, revoked: 1,
      members: 10, items: 111, areas: 11,
      blocking: 14, hashVerified: 1, hashMismatch: 2, independentApproval: 2,
    });
  });

  it('KPI 는 대상 집합을 바꾸면 그 집합만 계산한다', () => {
    const one = [byId('BL-LIGHT-ADAS-2027.1@1.0.0')];
    const s = bomStats(one, baselineViolationsOf(one[0]));
    expect(s.total).toBe(1);
    expect(s.approved).toBe(1);
    expect(s.inReview).toBe(0);
    expect(s.draft).toBe(0);
    expect(s.members).toBe(2);
    expect(s.items).toBe(22);
    expect(s.blocking).toBe(0);
    expect(s.hashVerified).toBe(1);
    expect(s.hashMismatch).toBe(0);
  });

  it('사용처 역조회 — 승인 여부는 상태와 hash 결속을 모두 만족할 때만 참이다', () => {
    const used = baselineUsageOf('FEAT-BDC-001@1.1.0');
    expect(used.map(u => u.ref)).toEqual(['BL-BDC-2027.1@1.0.0', 'BL-BDC-2027.2@2.0.0']);
    expect(used.every(u => u.approved === false)).toBe(true);
    expect(used[0]).toMatchObject({
      state: 'IN_REVIEW', approver: 'park.minsoo@quality', approvedAt: '2026-09-10 11:40', independent: true,
      contentHash: byId('BL-BDC-2027.1@1.0.0').contentHash,
    });
    expect(used[1].independent).toBe(false);
    expect(baselineUsageOf('FEAT-NONE-001@1.0.0')).toEqual([]);
  });

  it('구성원 검사 보고서 — 미등록 구현·미등록 Profile·미해석 영역을 행 단위로 남긴다', () => {
    const good = memberCheckReport(byId('BL-LIGHT-ADAS-2027.1@1.0.0'));
    expect(good.hash).toBe(byId('BL-LIGHT-ADAS-2027.1@1.0.0').contentHash);
    expect(good.checkedAt).toBeTruthy();
    expect(good.rows).toHaveLength(2);
    expect(good.rows.every(r => r.ok && r.implKnown && r.featureMatches && r.profileKnown && r.unresolvedAreas.length === 0)).toBe(true);

    const partial = memberCheckReport(byId('BL-ADAS-2027.1@1.0.0'));
    expect(partial.rows[0]).toMatchObject({ memberId: 'MBR-ADAS-A', profileKnown: false, ok: false, conditionProfileRef: 'AP-KR-A2@9' });
    expect(partial.rows[1].ok).toBe(true);

    const unknown = memberCheckReport(byId('BL-BDC-2027.2@2.0.0'));
    const adas = unknown.rows.find(r => r.memberId === 'MBR-ADAS');
    expect(adas).toMatchObject({ implKnown: false, featureMatches: false, ok: false });
    // 미등록 구현은 영역을 전개할 수 없으므로 빈 목록 — 보고는 위반 계산의 IMPL_BOM_UNKNOWN 한 건이다
    expect(adas?.unresolvedAreas).toEqual([]);
    expect(baselineViolationsOf(byId('BL-BDC-2027.2@2.0.0')).filter(v => v.target.includes('MBR-ADAS')))
      .toEqual([expect.objectContaining({ code: 'IMPL_BOM_UNKNOWN' })]);

    const supplier = memberCheckReport(byId('BL-BDC-2027.1@1.0.0')).rows[0];
    expect(supplier.ok).toBe(false);
    expect(supplier.unresolvedAreas).toEqual([BOM_AREA_KO.Supplier]);

    const other = memberCheckReport(byId('BL-LIGHT-2027.1@1.0.0'), 'f'.repeat(64));
    expect(other.hash).toBe('f'.repeat(64));
    expect(byId('BL-LIGHT-2027.1@1.0.0').contentHash).not.toBe(other.hash);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. 화면 계약 — 실제 Provider 스택
// ════════════════════════════════════════════════════════════════════════════

function renderBom() {
  const utils = render(
    <MemoryRouter initialEntries={['/master/bom']}>
      <AppProvider>
        <FeatureBom />
      </AppProvider>
    </MemoryRouter>,
  );
  const { container } = utils;
  const kpis = () => [...container.querySelectorAll('.kpis .kpi')].map(el => ({
    v: el.querySelector('.v')?.textContent ?? '',
    l: el.querySelector('.l')?.textContent ?? '',
  }));
  const listedRows = () => [...(container.querySelector('table')?.querySelectorAll('tbody tr') ?? [])];
  const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
  const baseSelect = () => container.querySelectorAll('select')[0] as HTMLSelectElement;
  return { ...utils, kpis, listedRows, button, baseSelect };
}

describe('UI04 화면 계약', () => {
  it('KPI 10칸과 6개 영역 탭을 실제 기준선 데이터로 그린다', () => {
    const { container, kpis } = renderBom();
    const k = kpis();
    expect(k.map(x => x.l)).toEqual([
      '기준선', '승인', '검토 중', '작성 중', '차단 위반', '구성원', 'Item · 11개 영역', 'hash 결속 승인', '승인 hash 불일치', '독립 승인',
    ]);
    expect(k.map(x => x.v)).toEqual(['6', '1', '2', '1', '14', '10', '111', '1', '2', '2']);

    const tabs = [...container.querySelectorAll('.tabs button')];
    expect(tabs).toHaveLength(6);
    expect(tabs.map(t => t.textContent)).toEqual([
      'UI04-S01 기준선 목록과 상세',
      'UI04-S02 Feature 구성원',
      'UI04-S03 구현 구성과 11개 영역',
      'UI04-S04 Master·Configured·Effective',
      'UI04-S05 조건과 Topology 검증',
      'UI04-S06 기준선 승인과 이력',
    ]);
    expect(container.textContent).toContain('C03');
  });

  it('기본 선택에서 hash 재계산·승인 결속·구현 선택 판정을 함께 노출한다', () => {
    const { container, baseSelect } = renderBom();
    expect(baseSelect().options).toHaveLength(6);
    expect(baseSelect().value).toBe('BL-LIGHT-ADAS-2027.1@1.0.0');
    expect(container.textContent).toContain('members+items 정규 직렬화 재계산 일치');
    expect(container.textContent).toContain('기준선 목록');
    // 기본 조건(KR · BDC-BODY · MY2027+ · Premium)은 같은 조건의 두 행이 충돌한다
    expect(container.textContent).toContain('조건 충돌');
    // 승인 hash 불일치 2건이 KPI 와 목록에 그대로 실린다
    expect(container.textContent).toContain('불일치');
    expect(renderBom().listedRows()).toHaveLength(6);
  });

  it('기준선 목록 필터는 상태별 실제 건수로 걸러낸다', () => {
    const { container, listedRows, button, baseSelect } = renderBom();
    expect(listedRows()).toHaveLength(6);
    fireEvent.click(button('작성 중 1'));
    expect(listedRows()).toHaveLength(1);
    expect(listedRows()[0].textContent).toContain('BL-BDC-2027.2');
    fireEvent.click(button('보완 요청 1'));
    expect(listedRows()).toHaveLength(1);
    expect(listedRows()[0].textContent).toContain('BL-ADAS-2027.1');
    fireEvent.click(button('전체 6'));
    expect(listedRows()).toHaveLength(6);
    expect(container.textContent).toContain('불일치');

    // 승인 후 구성이 바뀐 기준선을 고르면 승인 효력 없음이 그대로 드러난다
    fireEvent.change(baseSelect(), { target: { value: 'BL-BDC-2027.1@1.0.0' } });
    expect(container.textContent).toContain('승인 후 구성이 바뀌어 승인 효력이 없다');
    expect(container.textContent).toContain('park.minsoo@quality');
  });

  it('업무 명령 버튼은 현재 상태에서 가능한 것만 활성이다', () => {
    const { button, baseSelect } = renderBom();
    fireEvent.click(screen.getByRole('button', { name: /UI04-S06/ }));
    // 기본 선택은 승인 완료 기준선 — 철회만 가능하다
    expect(button(/REVOKE_BASELINE/).disabled).toBe(false);
    expect(button(/APPROVE/).disabled).toBe(true);
    expect(button(/SUBMIT_REVIEW/).disabled).toBe(true);
    expect(button(/REVISE_DRAFT/).disabled).toBe(true);

    fireEvent.change(baseSelect(), { target: { value: 'BL-LIGHT-2027.1@1.0.0' } });
    expect(button(/APPROVE/).disabled).toBe(false);
    expect(button(/REQUEST_CHANGES/).disabled).toBe(false);
    expect(button(/REVOKE_BASELINE/).disabled).toBe(true);

    fireEvent.change(baseSelect(), { target: { value: 'BL-ADAS-2027.1@1.0.0' } });
    expect(button(/SUBMIT_REVIEW/).disabled).toBe(false);
    expect(button(/REVISE_DRAFT/).disabled).toBe(false);
  });

  it('APPROVE 를 실행하면 202 접수와 승인 KPI 증가가 실제 store 에 반영된다', () => {
    const { container, kpis, button, baseSelect } = renderBom();
    fireEvent.click(screen.getByRole('button', { name: /UI04-S06/ }));
    fireEvent.change(baseSelect(), { target: { value: 'BL-LIGHT-2027.1@1.0.0' } });
    fireEvent.click(button(/APPROVE/));

    expect(container.textContent).toContain('HTTP 202');
    expect(container.textContent).toContain('승인 접수');
    expect(container.textContent).toContain(byId('BL-LIGHT-2027.1@1.0.0').contentHash.slice(0, 12));
    expect(container.textContent).toContain('lee.jihyun@quality');
    expect(kpis()[1].v).toBe('2');
    expect(kpis()[7].v).toBe('2');
    // 접수만이 아니라 업무 상태가 바뀌었다 — 승인 버튼이 더 이상 가능하지 않다
    expect(button(/APPROVE/).disabled).toBe(true);
    expect(button(/REVOKE_BASELINE/).disabled).toBe(false);
  });

  it('차단 위반이 있는 기준선의 검토 요청은 422 코드를 그대로 보여주고 상태를 바꾸지 않는다', () => {
    const { container, kpis, button, baseSelect } = renderBom();
    fireEvent.click(screen.getByRole('button', { name: /UI04-S06/ }));
    const before = kpis().map(x => x.v);
    fireEvent.change(baseSelect(), { target: { value: 'BL-ADAS-2027.1@1.0.0' } });
    fireEvent.click(button(/SUBMIT_REVIEW/));

    expect(container.textContent).toContain('HTTP 422');
    expect(container.textContent).toContain('DUPLICATE_MEMBER');
    expect(container.textContent).toContain('검토 요청 차단 위반');
    expect(kpis().map(x => x.v)).toEqual(before);
  });
});
