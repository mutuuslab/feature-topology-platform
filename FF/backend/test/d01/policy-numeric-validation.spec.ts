// 작성·수정의 형식 거부와 저장 정책의 검증·승인을 분리한다. 숫자 연산의 정본은 기존 decimalCompare다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import type { INestApplication } from '@nestjs/common';
import type { Constraint, Policy } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const numeric = (operator: Constraint['operator'], value: string, inverted = false): Constraint => ({ contextName: 'modelYear', operator, values: [value], inverted, caseInsensitive: false });
const strategy = (constraints: Constraint[]) => ({ name: '수치 조건', constraints });

describe('P11b 수치 정책의 실제 작성·수정·검증·승인', () => {
  let app: INestApplication;
  let http: () => any;
  let n = 0;
  beforeAll(async () => ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z', showcaseFill: false })));
  afterAll(async () => { await app?.close(); for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k]; });
  const body = (strategies = [] as { name: string; constraints: Constraint[] }[]) => ({ featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: `ivi_00024_numeric_${++n}`, description: '수치 정책 검증 회귀', strategies });
  const create = async (strategies = [] as { name: string; constraints: Constraint[] }[]) => (await http().post('/api/policies').set(AUTHOR).send(body(strategies)).expect(201)).body as Policy;
  const validate = async (id: string) => (await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body;
  const decision = (id: string) => http().post(`/api/policies/${id}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '검증 결과 확인' });
  const policyCheck = (v: any) => v.run.results.find((r: any) => r.componentId === 'D06-01');

  for (const value of ['not-a-number', 'NaN', 'Infinity', '1e309']) it(`NUM_GT ${value} 작성은 입력 오류이며 저장 검증의 기존 방어와 구분한다`, async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send(body([strategy([numeric('NUM_GT', value)])]));
    let validation: any = null;
    let approval: any = null;
    if (c.status === 201) {
      validation = await validate(c.body.policyId);
      approval = await decision(c.body.policyId);
    }
    console.info('P11B_NUM_CREATE', JSON.stringify({ value, createStatus: c.status, check: validation && policyCheck(validation).result, overall: validation?.run.decision, approvalStatus: approval?.status }));
    expect(c.status).toBe(400);
    expect(c.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'strategies.0.constraints.0.values.0' })]));
  });

  it('NUM 값 수정도 거부하고 기존 내용·개정본을 보존한다', async () => {
    const p = await create();
    const changed = await http().patch(`/api/policies/${p.policyId}`).set(AUTHOR).send({ strategies: [strategy([numeric('NUM_GT', 'not-a-number')])] });
    if (changed.status === 200) {
      const v = await validate(p.policyId);
      const a = await decision(p.policyId);
      console.info('P11B_NUM_PATCH', JSON.stringify({ patchStatus: changed.status, check: policyCheck(v).result, overall: v.run.decision, approvalStatus: a.status }));
    }
    expect(changed.status).toBe(400);
    const saved = (await http().get(`/api/policies/${p.policyId}`).expect(200)).body.policy;
    expect(saved).toMatchObject({ revision: p.revision, strategies: [] });
  });

  for (const path of ['create', 'patch'] as const) it(`${path}: 동일 속성 AND의 GT2030/LT2020 모순은 검증과 승인을 통과하지 못한다`, async () => {
    // 다른 OR 전략에는 실제 대상이 있다. 대상 0건의 HOLD가 모순 검증 결함을 가리지 않게 한다.
    const bad = [strategy([numeric('NUM_GT', '2030'), numeric('NUM_LT', '2020')]), { name: '정상 대상 OR', constraints: [{ contextName: 'country', operator: 'IN' as const, values: ['KR'] }] }];
    const p = await create(path === 'create' ? bad : []);
    if (path === 'patch') await http().patch(`/api/policies/${p.policyId}`).set(AUTHOR).send({ strategies: bad }).expect(200);
    const v = await validate(p.policyId);
    const a = await decision(p.policyId);
    console.info('P11B_NUM_CONFLICT', JSON.stringify({ path, check: policyCheck(v).result, overall: v.run.decision, approvalStatus: a.status }));
    expect(policyCheck(v)).toMatchObject({ result: 'FAIL', findings: expect.arrayContaining([expect.objectContaining({ code: 'CONFLICT', result: 'FAIL' })]) });
    expect(v.run.decision).not.toBe('GO');
    expect(a.status).toBe(422);
  });

  it('구형 저장 정책의 비숫자 값도 기존 검증이 계속 거부한다', async () => {
    const p = await create();
    app.get(PolicyRepo).update({ ...p, strategies: [{ name: '수치 조건', constraints: [{ ...numeric('NUM_GT', 'not-a-number'), inverted: false, caseInsensitive: false }] }] });
    const v = await validate(p.policyId);
    expect(policyCheck(v).result).toBe('FAIL');
    expect((await decision(p.policyId)).status).toBe(422);
  });

  it('서로 다른 OR 전략의 GT2030 / LT2030을 AND 모순으로 묶지 않는다', async () => {
    const p = await create([strategy([numeric('NUM_GT', '2030')]), { name: '다른 OR 조건', constraints: [numeric('NUM_LT', '2030')] }]);
    const v = await validate(p.policyId);
    expect(policyCheck(v).result).toBe('PASS');
    expect(v.run.decision).toBe('GO');
    expect((await decision(p.policyId)).status).toBe(200);
  });

  it('포함 경계의 같은 값과 정밀한 십진수 구간은 정상 승인된다', async () => {
    const p = await create([strategy([numeric('NUM_GTE', '2025'), numeric('NUM_LTE', '2025')]), { name: '정밀 십진수', constraints: [numeric('NUM_GT', '1'), numeric('NUM_LT', '1.00000000000000001')] }]);
    const v = await validate(p.policyId);
    expect(policyCheck(v).result).toBe('PASS');
    expect(v.run.decision).toBe('GO');
    expect((await decision(p.policyId)).status).toBe(200);
  });

  it('문자열·Semver 연산과 수치 조건을 함께 써도 정상 의미를 보존한다', async () => {
    const p = await create([strategy([{ contextName: 'country', operator: 'IN', values: ['KR', 'US'] }, { contextName: 'swVersion', operator: 'SEMVER_GT', values: ['1.0.0'] }, numeric('NUM_GTE', '2020'), numeric('NUM_LT', '2030')])]);
    const v = await validate(p.policyId);
    expect(policyCheck(v).result).toBe('PASS');
    expect(v.run.decision).toBe('GO');
    expect((await decision(p.policyId)).status).toBe(200);
  });
});
