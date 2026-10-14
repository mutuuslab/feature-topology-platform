// Gate Decision Record — FFG-LCY-001: 서명된 결정 기록 없이는 전이하지 않는다, 서명 뒤 기록 변조는 검출
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import { decisionPayload, decisionState, decisionUsable, type GateDecision } from './gate-decision';
import { jcs } from './jcs';
import { evaluateTransition, type TransitionContext } from './lifecycle';

const ds = loadDataset();
const rec = ds.gateRecords.find((g) => g.status === 'PASS')!;
const sig = { alg: 'EdDSA' as const, kid: 'KEY-0009', value: 'x'.repeat(86) };
const signed = (provenance: 'PLATFORM' | 'IMPORT' = 'PLATFORM'): GateDecision => ({ payload: decisionPayload(rec, { id: 'usr-judge', role: 'GATE_JUDGE' }, provenance), signature: sig, signedAt: rec.judgedAt });

describe('Gate Decision Record (FFG-LCY-001)', () => {
  it('본문은 대상·판정·근거 Evidence·승인자 역할·시각을 담고, 정규화 바이트가 결정적이다', () => {
    const p = signed().payload;
    expect(p).toMatchObject({ schema: 'ffp-gate-decision/1', target: { featureId: rec.featureId, featureVersion: rec.featureVersion }, gate: rec.gate, status: rec.status, evidenceRef: rec.evidenceRef, approver: { role: 'GATE_JUDGE' }, judgedAt: rec.judgedAt });
    expect(jcs(decisionPayload({ ...rec }, { id: 'usr-judge', role: 'GATE_JUDGE' }, 'PLATFORM'))).toBe(jcs(p));
  });

  it('상태: 플랫폼 서명 SIGNED, 이관 봉인 IMPORTED, 없음 MISSING, 서명 불일치·서명 뒤 변조 INVALID', () => {
    expect(decisionState(rec, signed(), true).state).toBe('SIGNED');
    expect(decisionState(rec, signed('IMPORT'), true).state).toBe('IMPORTED');
    expect(decisionState(rec, null, false).state).toBe('MISSING');
    expect(decisionState(rec, signed(), false).state).toBe('INVALID');
    // 서명은 맞지만 Gate 기록의 판정이 그 뒤에 바뀌었다(검토 중 → PASS 등)
    const tampered = { ...rec, evidenceRef: 'EV-FORGED', status: 'PASS' as const };
    expect(decisionState(tampered, signed(), true)).toMatchObject({ state: 'INVALID', reason: expect.stringMatching(/evidenceRef/) });
    expect([decisionUsable('SIGNED'), decisionUsable('IMPORTED'), decisionUsable('MISSING'), decisionUsable('INVALID')]).toEqual([true, true, false, false]);
  });

  it('서명 없는 Gate PASS로는 전이하지 않는다 — GATE_UNSIGNED', () => {
    const f = { ...ds.features.find((x) => x.featureId === 'FEAT-00022')!, lifecycle: 'PROPOSED' as const };
    const ctx: TransitionContext = { latestGates: { G1: 'PASS', G2: 'PASS', G3: 'PASS' }, dependencies: [], policyCoverage: 99, actor: { id: 'a', role: 'FEATURE_APPROVER' }, reason: '근거 확인' };
    expect(evaluateTransition(f, 'APPROVED', ctx).blockers).toEqual([]);
    const r = evaluateTransition(f, 'APPROVED', { ...ctx, unsignedGates: { G2: 'SIM-G2-000001: 서명된 Decision Record가 없습니다' } });
    expect(r.blockers).toEqual([expect.objectContaining({ code: 'GATE_UNSIGNED', ref: 'G2' })]);
  });
});
