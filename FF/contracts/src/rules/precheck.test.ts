import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import { findRequiresCycles, runDataQuality, runPrecheck } from './precheck';

const ds = loadDataset();
const outcomes = runPrecheck(ds);
const byId = Object.fromEntries(outcomes.map((o) => [o.ruleId, o]));

describe('DATA-PRECHECK-1.0 (16 규칙)', () => {
  it('16개 규칙을 모두 평가한다', () => {
    expect(outcomes.map((o) => o.ruleId)).toEqual(ds.precheckRules.map((r) => r.ruleId));
  });

  it('코드로 계산한 판정이 데이터셋의 예시 판정과 일치한다', () => {
    for (const rule of ds.precheckRules) expect(byId[rule.ruleId].result, rule.ruleId).toBe(rule.exampleResult);
  });

  it('요약 수치가 데이터셋 사유와 일치한다', () => {
    expect(byId['DATA-PRECHECK-1.0-04'].summary).toContain('25건 중 20건 PASS');
    expect(byId['DATA-PRECHECK-1.0-06'].summary).toContain('PASS 24건, 미판정 5건');
    expect(byId['DATA-PRECHECK-1.0-07'].summary).toContain('PASS 441건, 검토 중 36건');
    expect(byId['DATA-PRECHECK-1.0-13'].summary).toContain('Baseline 발급 67건 ↔ BOM Item 67건');
  });

  it('위반을 주입하면 FAIL로 바뀐다 (회귀 방지)', () => {
    const broken = structuredClone(ds);
    const d = broken.dependencies[0];
    broken.dependencies.push({ ...d, dependencyId: 'DEP-99999', sourceFeatureId: d.targetFeatureId, sourceVersion: d.targetVersion!, targetFeatureId: d.sourceFeatureId, targetVersion: d.sourceVersion });
    broken.dependencies.push({ ...d, dependencyId: 'DEP-99998', targetFeatureId: d.sourceFeatureId });
    const r = Object.fromEntries(runPrecheck(broken).map((o) => [o.ruleId, o.result]));
    expect(r['DATA-PRECHECK-1.0-11']).toBe('FAIL'); // 자기 참조
    expect(r['DATA-PRECHECK-1.0-12']).toBe('FAIL'); // 역방향 REQUIRES로 순환
    expect(r['DATA-PRECHECK-1.0-06']).toBe('FAIL');
  });
});

describe('REQUIRES 순환 탐지', () => {
  const e = (s: string, t: string) => ({ sourceFeatureId: s, sourceVersion: '1.0.0', targetFeatureId: t, targetVersion: '1.0.0' });
  it('순환이 없으면 빈 목록', () => expect(findRequiresCycles([e('A', 'B'), e('B', 'C')])).toEqual([]));
  it('A→B→C→A를 찾는다', () => {
    const c = findRequiresCycles([e('A', 'B'), e('B', 'C'), e('C', 'A')]);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual(['A@1.0.0', 'B@1.0.0', 'C@1.0.0', 'A@1.0.0']);
  });
});

describe('데이터 품질 점검 (원본 오류는 경고로 노출)', () => {
  const dq = Object.fromEntries(runDataQuality(ds).map((o) => [o.ruleId, o]));
  it('DQ-01: SW_Master 설명의 잘못된 Feature 참조 18건', () => {
    expect(dq['DQ-01'].result).toBe('CONDITIONAL');
    expect(dq['DQ-01'].findings).toHaveLength(18);
    expect(dq['DQ-01'].findings.map((f) => f.key)).toContain('SW-BPRE-APP@0.2.0');
  });
  it('DQ-02: FEAT-00022의 Function 설명이 형제 Feature 명칭을 사용', () => {
    expect(dq['DQ-02'].findings.map((f) => f.key)).toEqual(
      expect.arrayContaining(['FEAT-00022@1.0.0#FUNC-000056', 'FEAT-00022@1.0.0#FUNC-000057']),
    );
  });
});
