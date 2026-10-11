// FP-UL-P0-1.0 이식 검증 — (1) 골든 벡터, (2) 원본 p0_reference.js와의 차등 비교(수천 개 생성 입력), (3) 핵심 의미.
import { beforeAll, describe, expect, it } from 'vitest';
import golden from './fixtures/cohort_golden_vectors.json';
import * as P from './p0';

let REF: any;
beforeAll(async () => {
  // @ts-ignore — 원본은 모듈이 아니라 IIFE다(globalThis.FPP0를 만든다)
  await import('./fixtures/p0_reference.js');
  REF = (globalThis as any).FPP0;
});

// 결정적 의사난수 (테스트 재현성)
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

describe('FP-COHORT-1 골든 벡터', () => {
  it.each(golden.vectors.map((v) => [v.targetingKey, v] as const))('%s', async (_k, v) => {
    expect(await P.cohortBucket(v.profileVersion, v.groupId, v.cohortSalt, v.targetingKey)).toBe(v.bucket);
  });
  it('알고리즘 표기·벤더 비호환 선언', () => {
    expect(golden.algorithm).toBe('FP-COHORT-1');
    expect(golden.vendorEquivalent).toBe(false);
  });
  it('targetingKey가 없으면 오류 (임의 버킷 금지)', async () => {
    await expect(P.cohortBucket('1', 'g', 's', '')).rejects.toThrow('TARGETING_KEY_MISSING');
  });
});

describe('원본 p0_reference.js와 차등 비교', () => {
  const r = rng(20261012);
  const nums = ['0', '1', '-1', '10', '10.0', '10.50', '2.5', '007', '1e3', '', 'abc', '99999999999999999999.1'];
  const vers = ['1.0.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-01', '1.10.0', '1.2.3+build', '2.0.0-rc.1', '01.0.0', 'x'];
  const times = ['2026-10-12T00:00:00Z', '2026-10-12T00:00:00.000Z', '2026-02-30T00:00:00Z', '2026-10-12', '2026-10-12T09:00:00.500Z'];
  const strs = ['KR', 'kr', 'EU', 'NX4 PE', 'Premium', '한국', 'é', 'é', 'F111A114001'];

  it('decimalCompare·semverCompare·time — 2000 쌍', () => {
    for (let i = 0; i < 2000; i++) {
      const a = pick(r, nums), b = pick(r, nums);
      expect(P.decimalCompare(a, b), `dec ${a} ${b}`).toBe(REF.decimalCompare(a, b));
      const c = pick(r, vers), d = pick(r, vers);
      expect(P.semverCompare(c, d), `sem ${c} ${d}`).toBe(REF.semverCompare(c, d));
      const t = pick(r, times);
      expect(P.time(t), t).toBe(REF.time(t));
    }
  });

  it('constraint — 연산자·반전·대소문자·문맥 품질 조합 3000건', () => {
    const ops = P.CONSTRAINT_OPERATORS;
    for (let i = 0; i < 3000; i++) {
      const operator = pick(r, ops);
      const pool = operator.startsWith('NUM_') ? nums : operator.startsWith('SEMVER_') ? vers : operator.startsWith('DATE_') ? times : strs;
      const n = 1 + Math.floor(r() * 3);
      const rule = { contextName: 'k', operator, values: Array.from({ length: n }, () => pick(r, pool)), inverted: r() < 0.3, caseInsensitive: r() < 0.3 };
      const q = pick(r, ['TRUSTED', 'TRUSTED', 'TRUSTED', 'STALE', 'UNTRUSTED'] as const);
      const ctx = r() < 0.1 ? {} : { k: { value: r() < 0.05 ? null : pick(r, pool), quality: q } };
      expect(P.constraint(rule, ctx as any), JSON.stringify({ rule, ctx })).toBe(REF.constraint(rule, ctx));
    }
  });

  it('decide — 3치 조합 전수', () => {
    const tri = ['TRUE', 'FALSE', 'UNKNOWN'] as const;
    for (const flagEnabled of [true, false])
      for (const valid of [true, false])
        for (const a of tri)
          for (const b of tri)
            for (const m of tri) {
              const x = { flagEnabled, valid, strategies: [a, b], mandatory: [m] };
              expect(P.decide(x as any)).toEqual(REF.decide(x));
            }
  });

  it('cohortBucket — 무작위 키 200개', async () => {
    for (let i = 0; i < 200; i++) {
      const key = `VIN-${Math.floor(r() * 1e9)}-${pick(r, strs)}`;
      expect(await P.cohortBucket('1', 'care_00022', 'SALT', key)).toBe(await REF.cohortBucket('1', 'care_00022', 'SALT', key));
    }
  });
});

describe('P0 핵심 의미', () => {
  const trusted = (value: string) => ({ value, quality: 'TRUSTED' as const });
  it('신뢰되지 않은 문맥은 UNKNOWN → 결정 HOLD (Safe Default 유지)', () => {
    const t = P.constraint({ contextName: 'country', operator: 'IN', values: ['KR'] }, { country: { value: 'KR', quality: 'STALE' } });
    expect(t).toBe('UNKNOWN');
    expect(P.decide({ strategies: [t] }).decision).toBe('HOLD');
  });
  it('필수 조건이 FALSE면 DENY, 모두 TRUE면 ALLOW', () => {
    const kr = P.constraint({ contextName: 'country', operator: 'IN', values: ['KR'] }, { country: trusted('KR') });
    expect(P.decide({ strategies: [kr], mandatory: ['FALSE'] }).decision).toBe('DENY');
    expect(P.decide({ strategies: [kr], mandatory: ['TRUE'] })).toEqual({ decision: 'ALLOW', reason: 'POLICY_MATCH', intent: true });
  });
  it('게시 적격성: 자기 승인·해시 불일치·재전송을 모두 사유로 낸다', () => {
    const r = P.publishCheck({ allowedRole: true, author: 'a', approver: 'a', candidateHash: 'h1', approvedHash: 'h2', sourceRevision: 1, approvedSourceRevision: 1, qualityPassed: true, authorizationValid: true, supported: true, maintenance: false, sequence: 3, highestSequence: 3 });
    expect(r).toEqual({ eligible: false, reasons: ['SELF_APPROVAL', 'HASH_MISMATCH', 'REPLAY'] });
  });
  it('다중 ECU 회신: 하나라도 다르면 DIVERGED, 일부만 오면 PARTIAL', () => {
    const exp = { publication: 'PUB-1', policyHash: 'H', featureVersion: '1.0.0', bootIds: { a: 'b1', b: 'b2' }, minSequence: { a: 1, b: 1 }, maxAgeMs: 5000, desired: 'SAFE_DEFAULT' };
    const rep = (nodeId: string, observed: string) => ({ nodeId, metricType: 'READBACK' as const, publication: 'PUB-1', policyHash: 'H', featureVersion: '1.0.0', bootId: exp.bootIds[nodeId as 'a'], sequence: 2, ageMs: 100, observed });
    expect(P.aggregate(['a', 'b'], [rep('a', 'SAFE_DEFAULT'), rep('b', 'SAFE_DEFAULT')], exp).state).toBe('CONFIRMED');
    expect(P.aggregate(['a', 'b'], [rep('a', 'SAFE_DEFAULT')], exp).state).toBe('PARTIAL');
    expect(P.aggregate(['a', 'b'], [rep('a', 'SAFE_DEFAULT'), rep('b', 'ACTIVE')], exp).state).toBe('DIVERGED');
  });
});
