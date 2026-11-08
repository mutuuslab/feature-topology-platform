import { describe, expect, it } from 'vitest';
import { CreatePolicyBody, PolicySpec, UpdatePolicyBody, type Policy } from '../schemas/policy';
import type { Constraint } from '../flags/p0';
import { validatePolicy, type ValidationInput } from './validators';

const c = (operator: Constraint['operator'], value: string, inverted = false): Constraint => ({ contextName: 'modelYear', operator, values: [value], inverted });
const body = (strategies: { name: string; constraints: Constraint[] }[]) => ({ featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'ivi_00024_numeric', description: '수치 검증', strategies });
const check = (strategies: { name: string; constraints: Constraint[] }[]) => validatePolicy({ policy: body(strategies) as Policy, feature: { controlPoints: ['Flag'] }, activePolicies: [], flagKeyClash: [] } as unknown as ValidationInput);
const and = (constraints: Constraint[]) => [{ name: '동일 AND', constraints }];

describe('작성·수정 NUM 값은 기존 정밀 십진수 평가 문법을 따른다', () => {
  for (const value of ['not-a-number', 'NaN', 'Infinity', '-Infinity', '1e3', '0x10', ' ', '01', '+1', '.5', '1.', '9'.repeat(65)]) it(`${value} 형식을 작성·수정에서 거부한다`, () => {
    const strategies = and([c('NUM_GT', value)]);
    expect(CreatePolicyBody.safeParse(body(strategies)).success).toBe(false);
    expect(UpdatePolicyBody.safeParse({ strategies }).success).toBe(false);
  });
  for (const value of ['0', '-0', '-12.5', '2025', '9007199254740993', '0.00000000000000000001']) it(`${value} 정밀도를 보존한다`, () => {
    const strategies = and([c('NUM_EQ', value)]);
    expect(CreatePolicyBody.parse(body(strategies)).strategies[0].constraints[0].values).toEqual([value]);
    expect(UpdatePolicyBody.safeParse({ strategies }).success).toBe(true);
  });
  it('숫자처럼 보이지 않는 문자열과 Semver 값은 해당 연산의 기존 문법을 유지한다', () => {
    const strategies = and([{ contextName: 'country', operator: 'IN', values: ['NaN'] }, { contextName: 'swVersion', operator: 'SEMVER_GT', values: ['1.2.0-rc.1'] }]);
    expect(CreatePolicyBody.safeParse(body(strategies)).success).toBe(true);
    expect(check(strategies).result).toBe('PASS');
  });
  it('구형 저장 자료는 파싱한 뒤 검증기의 FAIL 근거로 남긴다', () => {
    const strategies = and([c('NUM_GT', 'not-a-number')]);
    expect(PolicySpec.safeParse(body(strategies)).success).toBe(true);
    expect(check(strategies).result).toBe('FAIL');
  });
});

describe('동일 속성 AND의 수치 구간 모순만 차단한다', () => {
  const impossible = [
    [c('NUM_GT', '2030'), c('NUM_LT', '2020')],
    [c('NUM_GTE', '5'), c('NUM_LT', '5')],
    [c('NUM_GT', '5'), c('NUM_LTE', '5')],
    [c('NUM_EQ', '5'), c('NUM_EQ', '6')],
    [c('NUM_EQ', '5'), c('NUM_GT', '5')],
    [c('NUM_GT', '4'), c('NUM_LT', '6'), c('NUM_EQ', '6')],
    [c('NUM_GT', '5', true), c('NUM_GT', '5')],
    [c('NUM_GTE', '5', true), c('NUM_GTE', '5')],
    [c('NUM_LT', '5', true), c('NUM_LT', '5')],
    [c('NUM_LTE', '5', true), c('NUM_LTE', '5')],
    [c('NUM_EQ', '5'), c('NUM_EQ', '5', true)],
  ];
  for (const [index, constraints] of impossible.entries()) it(`불가능한 AND 구간 ${index + 1}은 CONFLICT`, () => {
    expect(check(and(constraints))).toMatchObject({ result: 'FAIL', findings: expect.arrayContaining([expect.objectContaining({ code: 'CONFLICT', result: 'FAIL' })]) });
  });
  const possible = [
    [c('NUM_GTE', '5'), c('NUM_LTE', '5')],
    [c('NUM_GT', '4'), c('NUM_LT', '6')],
    [c('NUM_EQ', '5'), c('NUM_GTE', '5'), c('NUM_LTE', '5')],
    [c('NUM_LT', '5'), c('NUM_EQ', '5', true)],
    [c('NUM_GT', '5', true), c('NUM_LTE', '5')],
    [c('NUM_GTE', '-1'), c('NUM_LTE', '0')],
    [c('NUM_GT', '9007199254740992'), c('NUM_LT', '9007199254740994')],
    [c('NUM_GT', '1'), c('NUM_LT', '1.00000000000000001')],
  ];
  for (const [index, constraints] of possible.entries()) it(`비어 있지 않은 AND 구간 ${index + 1}은 유지`, () => {
    expect(check(and(constraints)).result).toBe('PASS');
  });
  it('OR 전략 사이 또는 다른 속성 사이에는 구간을 교차하지 않는다', () => {
    expect(check([{ name: 'OR1', constraints: [c('NUM_GT', '2030')] }, { name: 'OR2', constraints: [c('NUM_LT', '2020')] }]).result).toBe('PASS');
    expect(check(and([c('NUM_GT', '2030'), { ...c('NUM_LT', '2020'), contextName: 'upgVc' }])).result).toBe('PASS');
  });
});
