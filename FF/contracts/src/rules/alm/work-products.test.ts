// codeBeamer 산출물 완결성(80-50 §5.4·§5.5) — 규칙 WP-1~7, 필요 조건, 게이트 단계별 막힘
import { describe, expect, it } from 'vitest';
import { computeCompleteness, cyberRequired, relationKindOf, requiredKinds, WP_GATE_STAGES, wpKindOfTracker, wpStageBlockers, wpSummaryText, type WpItem, type WpRelation } from './work-products';

const I = (key: string, kind: WpItem['kind'], approved = true, over: Partial<WpItem> = {}): WpItem => ({ key, kind, title: key, status: approved ? 'Approved' : 'Draft', approved, version: 1, ...over });
const R = (from: string, to: string, kind: WpRelation['kind'], suspect = false): WpRelation => ({ from, to, kind, suspect });
/** 완결된 한 벌 — 안전 요구 포함(ASIL B), 보안 요구 없음 */
const full = (): { items: WpItem[]; relations: WpRelation[] } => ({
  items: [I('SR', 'SYS_REQ'), I('SA', 'SYS_ARCH'), I('WR', 'SW_REQ'), I('WA', 'SW_ARCH'), I('DD', 'SW_DD'), I('FS', 'SAFETY_REQ'), I('T1', 'TEST_SPEC')],
  relations: [R('SA', 'SR', 'allocated'), R('WR', 'SR', 'derived'), R('WA', 'WR', 'allocated'), R('DD', 'WA', 'refines'), R('SR', 'FS', 'allocated'), ...['SR', 'SA', 'WR', 'WA', 'DD'].map((x) => R('T1', x, 'verifies'))],
});
const run = (x: { items: WpItem[]; relations: WpRelation[] }, ctx = { asil: 'B', cyber: false }) => computeCompleteness({ featureId: 'FEAT-00012', version: '1.0.0', ctx, ...x });

describe('필요한 종류(§5.1)', () => {
  it('ASIL QM이면 안전 요구 빼고, 사이버보안 대상일 때만 보안 요구', () => {
    expect(requiredKinds({ asil: 'QM', cyber: false })).toEqual(['SYS_REQ', 'SYS_ARCH', 'SW_REQ', 'SW_ARCH', 'SW_DD', 'TEST_SPEC']);
    expect(requiredKinds({ asil: 'B', cyber: true })).toHaveLength(8);
  });
  it('사이버보안 대상(A-4 기본값) — TARA 기록·ADS·R155·통신 도메인·원격/OTA', () => {
    expect(cyberRequired({ hasTara: true }).required).toBe(true);
    expect(cyberRequired({ regClass: 'R1' }).required).toBe(true);
    expect(cyberRequired({ refDomains: ['CO'] }).required).toBe(true);
    expect(cyberRequired({ name: '원격 시동' }).required).toBe(true);
    expect(cyberRequired({ regClass: 'R0', name: '오토 홀드', refDomains: ['CH'] })).toEqual({ required: false, why: expect.any(String) });
  });
});

describe('완결성 WP-1~7', () => {
  it('한 벌이 모두 있으면 100%, 문제 없음', () => {
    const r = run(full());
    expect(r).toMatchObject({ rate: 100, passedKinds: 7, requiredKinds: 7, problems: [], suspects: 0 });
    expect(wpSummaryText(r)).toBe('산출물 7/7 완결(100%)');
  });
  it('승인 0건(WP-1)·도출 없음(WP-2)·설계 끊김(WP-3)·안전 할당 없음(WP-4)·시험 없음(WP-5)', () => {
    const x = full();
    x.items = x.items.map((i) => (i.key === 'DD' ? { ...i, approved: false, status: 'In Review' } : i));
    x.relations = x.relations.filter((r) => !(r.from === 'WR' && r.to === 'SR') && !(r.from === 'SA' && r.to === 'SR') && !(r.from === 'SR' && r.to === 'FS') && !(r.from === 'T1' && r.to === 'WA'));
    const r = run(x);
    const rules = new Set(r.problems.map((p) => `${p.rule}:${p.kind}`));
    // 시험 사양(승인)이 미승인 상세설계를 검증하면 WP-6
    expect([...rules].sort()).toEqual(['WP-1:SW_DD', 'WP-2:SYS_REQ', 'WP-4:SAFETY_REQ', 'WP-5:SW_ARCH', 'WP-6:TEST_SPEC'].sort());
    expect(r.kinds.find((k) => k.kind === 'SW_DD')).toMatchObject({ required: true, items: 1, approved: 0, passed: false });
    expect(r.rate).toBe(Math.round((2 / 7) * 100));
  });
  it('HW 전용 시스템 요구는 Allocation Rationale로 WP-2 면제, 폐기 항목·다른 버전 항목은 보지 않는다', () => {
    const x = full();
    x.items.push(I('SR2', 'SYS_REQ', true, { allocationRationale: 'HW 전용 — 브레이크 액추에이터' }), I('OLD', 'SW_REQ', true, { obsolete: true }), I('V2', 'SW_REQ', true, { ffVersion: '2.0.0' }));
    x.relations.push(R('T1', 'SR2', 'verifies'));
    expect(run(x).problems).toEqual([]);
  });
  it('승인 항목이 미승인 항목에 기대면 WP-6, 의심 관계는 WP-7', () => {
    const x = full();
    x.items = x.items.map((i) => (i.key === 'WA' ? { ...i, approved: false, status: 'Draft' } : i));
    x.relations = x.relations.map((r) => (r.from === 'WR' && r.to === 'SR' ? { ...r, suspect: true } : r));
    const r = run(x);
    expect(r.problems.filter((p) => p.rule === 'WP-6').map((p) => p.item).sort()).toEqual(['DD', 'T1']);
    expect(r.problems.filter((p) => p.rule === 'WP-7').map((p) => p.item)).toEqual(['WR']);
    expect(r.suspects).toBe(1);
  });
  it('같은 입력이면 같은 근거 문자열(증거 해시) — 순서와 무관', () => {
    const a = run(full());
    const x = full();
    x.items.reverse();
    x.relations.reverse();
    expect(run(x).basis).toBe(a.basis);
  });
});

describe('게이트 단계(§5.5)', () => {
  it('정의 승인(G2)은 시스템 요구·안전·보안(WP-1·2·4)만 — 아래 단계 누락은 막지 않는다', () => {
    const x = full();
    x.items = x.items.filter((i) => i.key !== 'DD');
    x.relations = x.relations.filter((r) => r.from !== 'DD' && r.to !== 'DD');
    const r = run(x);
    expect(wpStageBlockers(r, WP_GATE_STAGES[0])).toEqual([]);
    expect(wpStageBlockers(r, WP_GATE_STAGES[1]).map((p) => p.rule).sort()).toEqual(['WP-1', 'WP-3']);
    expect(wpStageBlockers(r, WP_GATE_STAGES[2]).length).toBeGreaterThanOrEqual(2);
  });
  it('트래커 이름·종류 쌍 → 관계 이름', () => {
    expect(wpKindOfTracker('[SWE.3]Software Detailed Design')).toBe('SW_DD');
    expect(wpKindOfTracker('기타')).toBeNull();
    expect(relationKindOf('SW_REQ', 'SYS_REQ')).toBe('derived');
    expect(relationKindOf('TEST_SPEC', 'SW_DD')).toBe('verifies');
    expect(relationKindOf('SYS_REQ', 'SAFETY_REQ')).toBe('allocated');
    expect(relationKindOf('SW_DD', 'SYS_REQ')).toBeNull();
  });
});
