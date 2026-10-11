// vECU 가상검증 → 검증 Gate 연결: 시나리오 실행(D06-03) → 정책 검증기(D06-03 정상·D06-06 오류+Kill) → TMS 제출(D04-02, IF-09) → G5 증적.
// 기본은 같은 계약의 시험 대역(test/fixtures/fake-vecu) — 실제 vECU 판정은 마지막 describe가 C:\project\2026-10-11_vECU로 확인한다.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const FAKE = resolve(__dirname, '..', 'fixtures', 'fake-vecu');
const REAL = process.env.VECU_DIR_REAL ?? resolve(__dirname, '../../../../../2026-10-11_vECU');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

function useVecu(dir: string | null) {
  process.env.FF_EVIDENCE_DIR = mkdtempSync(join(tmpdir(), 'ff-vv-'));
  if (dir) (process.env.VECU_DIR = dir), delete process.env.VECU_MODE;
  else process.env.VECU_MODE = 'off';
}
const restore = () => ['VECU_DIR', 'VECU_MODE', 'FF_EVIDENCE_DIR', 'FAKE_VECU_FAIL'].forEach((k) => delete process.env[k]);

describe('vECU 가상검증 → 검증 Gate', () => {
  let app: INestApplication;
  let http: () => any;
  let pid: string;
  beforeAll(async () => {
    useVecu(FAKE);
    ({ app, http } = await bootApp());
    app.get(Clock).set('2026-10-12T01:00:00.000Z');
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    pid = c.body.policyId;
  });
  afterAll(async () => {
    await app.close();
    restore();
  });

  const validate = async () => (await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200)).body.run;
  const result = (run: any, id: string) => run.results.find((r: any) => r.componentId === id);

  it('시나리오 목록: FEAT-00022 정상 추종(D06-03 전 기준)·오류+Kill(D06-06 Kill 경로)', async () => {
    const r = (await http().get('/api/virtual-validations/scenarios?featureId=FEAT-00022').expect(200)).body.items;
    expect(r.map((s: any) => [s.scenarioId, s.validator])).toEqual([['SCN-FEAT00022-NOMINAL', 'D06-03'], ['SCN-FEAT00022-FAULT-KILL', 'D06-06']]);
    expect((await http().get('/api/vecu/status').expect(200)).body.available).toBe(true);
  });

  it('가상검증 전에는 정책 검증이 HOLD — 증적 없이 승인할 수 없다', async () => {
    const run = await validate();
    expect(run.decision).toBe('HOLD');
    expect(result(run, 'D06-03').findings[0].message).toMatch(/SCN-FEAT00022-NOMINAL 미실행/);
    expect(result(run, 'D06-06').findings[0].message).toMatch(/SCN-FEAT00022-FAULT-KILL 미실행/);
  });

  it('실행: 정상 추종 PASS, 오류+Kill은 종합 FAIL이지만 Kill 경로 기준만 보는 Gate 판정은 PASS', async () => {
    await http().post('/api/virtual-validations').set(actor('x', 'AUDITOR')).send({ policyId: pid }).expect(403);
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201)).body.items;
    expect(r.map((x: any) => [x.runId, x.scenarioId, x.source, x.overall, x.gateResult])).toEqual([
      ['VV-00001', 'SCN-FEAT00022-NOMINAL', 'vecu', 'PASS', 'PASS'],
      ['VV-00002', 'SCN-FEAT00022-FAULT-KILL', 'vecu', 'FAIL', 'PASS'],
    ]);
    const fk = r[1].criteria;
    expect(fk.filter((c: any) => c.deciding).map((c: any) => c.id)).toEqual(['kill_latency', 'min_ttc', 'max_decel', 'recovery']);
    expect(r[0].evidence.files.map((f: any) => f.name)).toEqual(['verdict.json', 'report.html']);
  });

  it('증적 파일: 기록된 파일만, 보고서는 스크립트 차단 헤더로', async () => {
    const v = await http().get('/api/virtual-validations/VV-00001/files/verdict.json').expect(200);
    expect(JSON.parse(v.text ?? JSON.stringify(v.body)).testId).toMatch(/^TEST-care_00022_param-SCN-FEAT00022-NOMINAL/);
    const h = await http().get('/api/virtual-validations/VV-00001/files/report.html').expect(200);
    expect(h.headers['content-security-policy']).toContain("default-src 'none'");
    await http().get('/api/virtual-validations/VV-00001/files/..%2F..%2Fpackage.json').expect(404);
    await http().get('/api/virtual-validations/VV-00001/files/telemetry.jsonl').expect(404);
  });

  it('가상검증 후 정책 검증 GO — D06-03·D06-06에 근거(INFO)가 남고, 오류 주입 구간 위험은 의도된 결과로 표시', async () => {
    const run = await validate();
    expect(run.decision).toBe('GO');
    expect(result(run, 'D06-03').findings.map((f: any) => f.message)).toEqual([expect.stringMatching(/SCN-FEAT00022-NOMINAL PASS \(TEST-/)]);
    expect(result(run, 'D06-06').findings[1].message).toMatch(/의도된 결과/);
  });

  it('정책 내용이 바뀌면 이전 가상검증은 근거가 아니다 → 다시 HOLD', async () => {
    await http().patch(`/api/policies/${pid}`).set(AUTHOR).send({ description: '설명만 수정' }).expect(200);
    expect((await validate()).decision).toBe('HOLD');
  });

  it('Kill 경로 기준 실패 → 안전 동작 검증 FAIL → BLOCKED', async () => {
    process.env.FAKE_VECU_FAIL = 'kill_latency';
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
    delete process.env.FAKE_VECU_FAIL;
    const run = await validate();
    expect(result(run, 'D06-06').result).toBe('FAIL');
    expect(run.decision).toBe('BLOCKED');
  });

  it('vECU 미연결 → unavailable 기록(증적 불인정), TMS 제출 불가', async () => {
    process.env.VECU_MODE = 'off';
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
    delete process.env.VECU_MODE;
    expect(r).toMatchObject({ source: 'unavailable', gateResult: 'UNAVAILABLE', error: 'VECU_MODE=off' });
    expect(result(await validate(), 'D06-03').findings[0].message).toMatch(/vECU 미연결/);
    await http().post(`/api/virtual-validations/${r.runId}/tms`).set(JUDGE).send({}).expect(422);
  });

  describe('G5 Verification Gate — TMS(IF-09)에 제출한 vECU PASS만 근거', () => {
    let ver: string;
    let vpid: string;
    let pass: string;
    let fail: string;

    it('준비: FEAT-00022 새 Version → G1~G3 → 승인(DEVELOPING) → 그 Version 정책의 가상검증', async () => {
      const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '감속 파라미터 개선', changes: { description: '위험 단계 감속 요청 파라미터 개선' } }).expect(201);
      ver = v.body.feature.version;
      for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: ver, controlPoint: 'Parameter', flagKey: 'care_00022_param', description: 'v2', safeDefault: false }).expect(201);
      vpid = c.body.policyId;
      const ok = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: vpid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
      process.env.FAKE_VECU_FAIL = 'min_ttc';
      const bad = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: vpid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
      delete process.env.FAKE_VECU_FAIL;
      [pass, fail] = [ok.runId, bad.runId];
      expect([ok.gateResult, bad.gateResult]).toEqual(['PASS', 'FAIL']);
    });

    const g5 = (evidenceRef: string, inputResult = 'PASS') => http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G5', inputResult, rationale: 'vECU 가상검증', evidenceRef });

    it('다른 Version의 가상검증·FAIL 결과·TMS 미제출은 PASS 근거로 거부(422, FAILED 감사)', async () => {
      expect((await g5('VV-00001').expect(422)).body.error.message).toMatch(/1\.0\.0의 가상검증/);
      expect((await g5(fail).expect(422)).body.error.message).toMatch(/PASS 근거가 될 수 없습니다/);
      expect((await g5(pass).expect(422)).body.error.message).toMatch(/TMS\(IF-09\)에 제출한 증적만/);
      await g5(fail, 'FAIL').expect(201); // FAIL 판정의 근거로는 쓸 수 있다
    });

    it('TMS 제출(멱등) → 같은 VV로 G5 PASS 판정, 외부 연계 기록에 IF-09', async () => {
      const t1 = (await http().post(`/api/virtual-validations/${pass}/tms`).set(JUDGE).send({}).expect(201)).body;
      const t2 = (await http().post(`/api/virtual-validations/${pass}/tms`).set(JUDGE).send({}).expect(201)).body;
      expect(t1.tms.tmsId).toMatch(/^TMS-\d{5}$/);
      expect(t2.tms.tmsId).toBe(t1.tms.tmsId);
      const r = await g5(`${pass} · ${t1.tms.tmsId}`).expect(201);
      expect(r.body.record).toMatchObject({ gate: 'G5', status: 'PASS' });
      const calls = (await http().get('/api/integrations/calls?ifId=IF-09').expect(200)).body.items;
      expect(calls).toHaveLength(1);
      expect(calls[0].request).toMatchObject({ testId: t1.testId, gateResult: 'PASS' });
    });
  });
});

describe.skipIf(!existsSync(join(REAL, 'tools', 'ffval_cli.mjs')))('실제 vECU (C:\\project\\2026-10-11_vECU) 판정', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    useVecu(REAL);
    ({ app, http } = await bootApp());
  });
  afterAll(async () => {
    await app.close();
    restore();
  });

  it('FEAT-00022: 정상 추종 PASS · 오류+Kill 종합 FAIL(위험 구간)·Kill 경로 PASS — 증적 해시 포함', async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '실제 vECU', safeDefault: false }).expect(201);
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201)).body.items;
    expect(r.map((x: any) => [x.source, x.overall, x.gateResult])).toEqual([['vecu', 'PASS', 'PASS'], ['vecu', 'FAIL', 'PASS']]);
    const fk = Object.fromEntries(r[1].criteria.map((x: any) => [x.id, x]));
    expect(fk.danger_time).toMatchObject({ status: 'fail', deciding: false });
    expect(fk.kill_latency).toMatchObject({ status: 'pass', deciding: true });
    expect(fk.kill_latency.value).toBeLessThanOrEqual(1);
    expect(r[1].evidence.files.map((f: any) => f.name)).toEqual(expect.arrayContaining(['verdict.json', 'telemetry.jsonl', 'events.json', 'report.html']));
    expect(fk.min_ttc).toMatchObject({ status: 'pass', deciding: true });
    expect(r[0].simulator).toMatch(/ausfahrt-ffval/);
  });
});
