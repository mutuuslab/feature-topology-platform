// 가상검증(CARLA) → 검증 Gate 연결: 시나리오 실행(D06-03) → 정책 검증기(D06-03 정상·D06-06 차량 내 감지) → TMS 제출(D04-02, IF-09) → G5 Evidence.
// 모든 기준 + 재현 정보가 있어야 Gate PASS, 원격 DC2만 쓴 기준선은 기록만 — FFG-TST-009 · FFG-LCY-006 · FFG-DEAC-001
// 기본은 같은 계약의 시험 대역(test/fixtures/fake-carla) — 실제 CARLA 판정은 마지막 describe가 검증 전용 서버(2100)가 떠 있을 때 확인한다(npm run carla:up).
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VirtualRunRepo } from '../../src/domains/d06-qsec/scenario-validation/virtual-run.repo';
import { actor, bootApp, confirmSafety } from '../helpers';

const FAKE = resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs');
const REAL = resolve(__dirname, '..', '..', '..', 'sim', 'carla', 'ffcarla_cli.py');
const PYTHON = process.env.CARLA_PYTHON ?? 'C:/project/2026-10-17_Carlra/.venv/Scripts/python.exe';
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

function useRunner(runner: string) {
  process.env.FF_EVIDENCE_DIR = mkdtempSync(join(tmpdir(), 'ff-vv-'));
  process.env.CARLA_RUNNER = runner;
  delete process.env.SIM_MODE;
}
const restore = () => ['CARLA_RUNNER', 'SIM_MODE', 'FF_EVIDENCE_DIR', 'FAKE_SIM_FAIL', 'FAKE_SIM_NO_REPRO', 'FAKE_SIM_DELAY_MS', 'FAKE_SIM_FOREIGN'].forEach((k) => delete process.env[k]);

describe('가상검증(CARLA) → 검증 Gate', () => {
  let app: INestApplication;
  let http: () => any;
  let pid: string;
  beforeAll(async () => {
    useRunner(FAKE);
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' })); // 시드 기준일도 같은 날(체험권 날짜는 기준일 상대값)
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    pid = c.body.policyId;
  });
  afterAll(async () => {
    await app.close();
    restore();
  });

  const validate = async () => (await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200)).body.run;
  const result = (run: any, id: string) => run.results.find((r: any) => r.componentId === id);

  it('시나리오 목록: FEAT-00022 정상 추종(D06-03)·차량 내 감지(D06-06)·원격 DC2 기준선(검증기 없음)', async () => {
    const r = (await http().get('/api/virtual-validations/scenarios?featureId=FEAT-00022').expect(200)).body.items;
    expect(r.map((s: any) => [s.scenarioId, s.validator])).toEqual([['SCN-FEAT00022-NOMINAL', 'D06-03'], ['SCN-FEAT00022-FAULT-ONBOARD', 'D06-06'], ['SCN-FEAT00022-FAULT-REMOTE-DC2', 'BASELINE']]);
    const st = (await http().get('/api/sim/status').expect(200)).body;
    expect(st).toMatchObject({ available: true, simulator: 'CARLA', port: 2100, server: { version: '0.9.16', map: 'Town04', foreignVehicles: 0 }, reason: null });
  });

  it('공유 서버를 가리키면(FF가 만들지 않은 차량) 사용 불가로 알린다 — 검증 전용 서버만 쓴다', async () => {
    process.env.FAKE_SIM_FOREIGN = '28';
    await new Promise((r) => setTimeout(r, 5_100)); // 탐침 캐시(5 s) 만료
    const st = (await http().get('/api/sim/status').expect(200)).body;
    delete process.env.FAKE_SIM_FOREIGN;
    expect(st).toMatchObject({ available: false, server: { foreignVehicles: 28 }, reason: expect.stringMatching(/FF가 만들지 않은 차량 28대/) });
  }, 15_000);

  it('FFG-TST-003 조합 시험 계획: Topology 허용 조합의 covering array와 금지 조합 부정 시험(실제 거부 확인)', async () => {
    const p = (await http().get('/api/virtual-validations/combinations?featureId=FEAT-00022').expect(200)).body;
    expect(p).toMatchObject({ featureId: 'FEAT-00022', group: ['FEAT-00022', 'FEAT-00145'], scope: { country: expect.any(String) } });
    expect(p.safetyFlags).toContain('FEAT-00022'); // Registry F3
    expect(p.array.rows.some((r: boolean[]) => r[0] && !r[1])).toBe(false); // 22 ON · 145 OFF 금지
    expect(p.array.covered).toBe(p.array.tuples);
    expect(p.negatives).toEqual([expect.objectContaining({ on: ['FEAT-00022'], off: ['FEAT-00145'], expect: 'REQUIRES_MISSING', rejected: true })]);
    const x = (await http().get('/api/virtual-validations/combinations?featureId=FEAT-00023').expect(200)).body;
    expect(x.negatives).toEqual([expect.objectContaining({ on: ['FEAT-00023', 'FEAT-00181'], expect: 'EXCLUDES_CONFLICT', rejected: true })]);
    await http().get('/api/virtual-validations/combinations?featureId=FEAT-99999').expect(404);
  });

  it('가상검증 전에는 정책 검증이 HOLD — Evidence 없이 승인할 수 없다', async () => {
    const run = await validate();
    expect(run.decision).toBe('HOLD');
    expect(result(run, 'D06-03').findings[0].message).toMatch(/SCN-FEAT00022-NOMINAL 미실행/);
    expect(result(run, 'D06-06').findings[0].message).toMatch(/SCN-FEAT00022-FAULT-ONBOARD 미실행/);
  });

  it('실행: 정상·차량 내 감지 PASS, 원격 DC2 기준선은 위험 구간 때문에 FAIL — 종합과 Gate 판정이 어긋나지 않는다', async () => {
    await http().post('/api/virtual-validations').set(actor('x', 'AUDITOR')).send({ policyId: pid }).expect(403);
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201)).body.items;
    expect(r.map((x: any) => [x.runId, x.scenarioId, x.role, x.source, x.overall, x.gateResult])).toEqual([
      ['VV-00001', 'SCN-FEAT00022-NOMINAL', 'NOMINAL', 'carla', 'PASS', 'PASS'],
      ['VV-00002', 'SCN-FEAT00022-FAULT-ONBOARD', 'FAULT_ONBOARD', 'carla', 'PASS', 'PASS'],
      ['VV-00003', 'SCN-FEAT00022-FAULT-REMOTE-DC2', 'BASELINE_REMOTE', 'carla', 'FAIL', 'FAIL'],
    ]);
    // 회귀: 알려진 실패(위험·오판단)를 정보 항목으로 면제하던 이전 판정 방식 — 이제 기준선도 모든 기준으로 판정한다
    expect(r[2].gateReasons).toEqual(expect.arrayContaining([expect.stringMatching(/'위험' 단계/), expect.stringMatching(/FTTI 여유/)]));
    expect(r[2].criteria.find((c: any) => c.id === 'kill_latency')).toMatchObject({ status: 'pass', deciding: true });
    // Registry 안전 분류(FEAT-00022 F3/DC2)가 패키지로 넘어가 감지 한계 = FTTI 5 s − 고장 램프 1.5 s
    expect(r[1].safety).toMatchObject({ deactClass: 'DC2', takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000 });
    expect(r[1].criteria.find((c: any) => c.id === 'detect_latency')).toMatchObject({ status: 'pass', limit: 3.5 });
    expect(r[1].repro).toMatchObject({ scenarioHash: expect.stringMatching(/^[0-9a-f]{64}$/), scriptHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(r[0].evidence.files.map((f: any) => f.name)).toEqual(['verdict.json', 'report.html', 'carla_recording.log']);
    expect(r[1].repro).toMatchObject({ toolVersion: expect.stringMatching(/^ff-carla/), map: 'Town04', replay: expect.stringMatching(/carla_recording\.log/) });
    // 판단(evaluation)은 FF 단일 평가기가 계산해 패키지로 넘긴 값 — 실행기가 그대로 싣는다
    expect(r[0].evaluation).toMatchObject({ value: true, decision: expect.any(String) });
  });

  it('재현 정보 없는 실행은 모든 기준이 통과해도 Gate FAIL — 근거로 쓸 수 없다', async () => {
    process.env.FAKE_SIM_NO_REPRO = '1';
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
    delete process.env.FAKE_SIM_NO_REPRO;
    expect(r).toMatchObject({ overall: 'PASS', gateResult: 'FAIL', repro: null, gateReasons: [expect.stringMatching(/재현 정보/)] });
    // 다음 시험이 기대하는 '최신 실행'을 되돌린다
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201);
  });

  it('Evidence 파일: 기록된 파일만, 보고서는 스크립트 차단 헤더로', async () => {
    const v = await http().get('/api/virtual-validations/VV-00001/files/verdict.json').expect(200);
    expect(JSON.parse(v.text ?? JSON.stringify(v.body)).testId).toMatch(/^TEST-care_00022_param-SCN-FEAT00022-NOMINAL/);
    const h = await http().get('/api/virtual-validations/VV-00001/files/report.html').expect(200);
    expect(h.headers['content-security-policy']).toContain("default-src 'none'");
    await http().get('/api/virtual-validations/VV-00001/files/..%2F..%2Fpackage.json').expect(404);
    await http().get('/api/virtual-validations/VV-00001/files/telemetry.jsonl').expect(404);
    await http().get('/api/virtual-validations/VV-00001/files/carla_recording.log').expect(200);
  });

  // 회귀: 이전 어댑터는 spawnSync로 실행기를 기다려 실행 중 백엔드 전체가 멈췄다(CARLA 3종은 수십 초)
  it('실행 중에도 다른 요청에 응답한다 — 실행기는 비동기, 한 번에 하나(대기열)', async () => {
    process.env.FAKE_SIM_DELAY_MS = '1500';
    const t0 = Date.now();
    const run = http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).then((x: any) => ({ x, at: Date.now() - t0 }));
    await new Promise((r) => setTimeout(r, 300));
    const st = (await http().get('/api/sim/status').expect(200)).body;
    await http().get('/api/health').expect(200);
    const health = Date.now() - t0;
    const done = await run;
    delete process.env.FAKE_SIM_DELAY_MS;
    expect(done.x.status).toBe(201);
    expect(st.queue.running).toBe(1);
    expect(health).toBeLessThan(done.at);
  }, 20_000);

  it('가상검증 후 정책 검증 GO — D06-03·D06-06에 근거(INFO)가 남고, 기준선 FAIL은 검증기에 쓰이지 않는다', async () => {
    const run = await validate();
    expect(run.decision).toBe('GO');
    expect(result(run, 'D06-03').findings.map((f: any) => f.message)).toEqual([
      expect.stringMatching(/SCN-FEAT00022-NOMINAL PASS \(TEST-/),
      // D02-02 기능 지원 조건 참고 — 범위 안이지만 기능 앱 SW가 1.2.1 미만인 차량. 판정(GO)은 그대로다
      expect.stringMatching(/^지원 조건 미달 2대 \(KMH-NX4-0002 SW 1\.2\.0, KMH-NX4-0004 SW 1\.1\.9 < 1\.2\.1\)/),
    ]);
    expect(result(run, 'D06-06').findings[0].message).toMatch(/SCN-FEAT00022-FAULT-ONBOARD PASS/);
    expect(JSON.stringify(result(run, 'D06-06').findings)).not.toMatch(/의도된 결과|REMOTE-DC2/);
  });

  it('정책 내용이 바뀌면 이전 가상검증은 근거가 아니다 → 다시 HOLD', async () => {
    await http().patch(`/api/policies/${pid}`).set(AUTHOR).send({ description: '설명만 수정' }).expect(200);
    expect((await validate()).decision).toBe('HOLD');
  });

  it('차량 내 감지 기준 실패 → 안전 동작 검증 FAIL → BLOCKED', async () => {
    process.env.FAKE_SIM_FAIL = 'detect_latency';
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
    delete process.env.FAKE_SIM_FAIL;
    const run = await validate();
    expect(result(run, 'D06-06').result).toBe('FAIL');
    expect(run.decision).toBe('BLOCKED');
  });

  it('실행기 미연결 → unavailable 기록(Evidence 불인정), TMS 제출 불가', async () => {
    process.env.SIM_MODE = 'off';
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
    delete process.env.SIM_MODE;
    expect(r).toMatchObject({ source: 'unavailable', gateResult: 'UNAVAILABLE', error: 'SIM_MODE=off' });
    expect(result(await validate(), 'D06-03').findings[0].message).toMatch(/CARLA 실행기 미연결/);
    await http().post(`/api/virtual-validations/${r.runId}/tms`).set(JUDGE).send({}).expect(422);
  });

  // 실행기 교체(2026-10-17): 이전 실행기(vECU)로 남은 기록은 이력으로만 읽고 검증·TMS·G5 근거로 쓰지 않는다
  it('이전 실행기(vECU) 기록은 PASS여도 Evidence가 아니다 — 검증기 CONDITIONAL, TMS 제출 거부', async () => {
    const repo = app.get(VirtualRunRepo);
    const cur = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
    const old = { ...cur, runId: repo.nextId(), source: 'vecu' as const, simulator: 'ausfahrt-ffval/2', at: new Date(Date.parse(cur.at) + 1000).toISOString() };
    repo.insert(old);
    expect(result(await validate(), 'D06-03').findings[0].message).toMatch(/이전 실행기 기록 — CARLA로 다시 실행/);
    expect((await http().post(`/api/virtual-validations/${old.runId}/tms`).set(JUDGE).send({}).expect(422)).body.error.message).toMatch(/CARLA 실행기가 실제로 실행한 결과만/);
  });

  describe('G5 Verification Gate — TMS(IF-09)에 제출한 CARLA PASS만 근거', () => {
    let ver: string;
    let vpid: string;
    let pass: string;
    let fail: string;

    it('준비: FEAT-00022 새 Version → G1~G3 → 승인(DEVELOPING) → 그 Version 정책의 가상검증', async () => {
      const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '감속 파라미터 개선', changes: { description: '위험 단계 감속 요청 파라미터 개선' } }).expect(201);
      ver = v.body.feature.version;
      await confirmSafety(http, 'FEAT-00022', ver);
      for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: ver, controlPoint: 'Parameter', flagKey: 'care_00022_param', description: 'v2', safeDefault: false }).expect(201);
      vpid = c.body.policyId;
      const ok = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: vpid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
      process.env.FAKE_SIM_FAIL = 'min_ttc';
      const bad = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: vpid, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items[0];
      delete process.env.FAKE_SIM_FAIL;
      [pass, fail] = [ok.runId, bad.runId];
      expect([ok.gateResult, bad.gateResult]).toEqual(['PASS', 'FAIL']);
    });

    const g5 = (evidenceRef: string, inputResult = 'PASS') => http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G5', inputResult, rationale: 'CARLA 가상검증', evidenceRef });

    it('다른 Version의 가상검증·FAIL 결과·TMS 미제출은 PASS 근거로 거부(422, FAILED 감사)', async () => {
      expect((await g5('VV-00001').expect(422)).body.error.message).toMatch(/1\.0\.0의 가상검증/);
      expect((await g5(fail).expect(422)).body.error.message).toMatch(/PASS 근거가 될 수 없습니다/);
      expect((await g5(pass).expect(422)).body.error.message).toMatch(/TMS\(IF-09\)에 제출한 Evidence만/);
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

// 실제 실행기 — 검증 전용 CARLA 서버(2100)가 떠 있을 때만(npm run carla:up). 공유 서버(2000)는 쓰지 않는다.
describe.skipIf(!existsSync(PYTHON))('실제 CARLA 0.9.16 실행기 판정 (검증 전용 서버)', () => {
  let app: INestApplication;
  let http: () => any;
  let up = false;
  beforeAll(async () => {
    useRunner(REAL);
    ({ app, http } = await bootApp());
    up = (await http().get('/api/sim/status').expect(200)).body.available;
  }, 60_000);
  afterAll(async () => {
    await app.close();
    restore();
  });

  it('FEAT-00022 (CS-01): 정상 추종 PASS · 차량 내 감지 ≈19.1 s → FTTI 여유 ≥ 0 PASS · 원격 DC2 기준선 FAIL(위험 구간) — Evidence 해시·recorder·재현 정보', async (ctx) => {
    if (!up) ctx.skip();
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '실제 CARLA', safeDefault: false }).expect(201);
    const r = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201)).body.items;
    expect(r.map((x: any) => [x.scenarioId.slice(14), x.source, x.overall, x.gateResult])).toEqual([['NOMINAL', 'carla', 'PASS', 'PASS'], ['FAULT-ONBOARD', 'carla', 'PASS', 'PASS'], ['FAULT-REMOTE-DC2', 'carla', 'FAIL', 'FAIL']]);
    const on = Object.fromEntries(r[1].criteria.map((x: any) => [x.id, x]));
    expect(on.detect_latency.at).toBeGreaterThan(18.8);
    expect(on.detect_latency.at).toBeLessThan(19.5);
    expect(on.ftti_margin.value).toBeGreaterThanOrEqual(0);
    expect(on.danger_time).toMatchObject({ status: 'pass', value: 0 });
    const rem = Object.fromEntries(r[2].criteria.map((x: any) => [x.id, x]));
    expect(rem.danger_time).toMatchObject({ status: 'fail', deciding: true });
    expect(rem.kill_latency.value).toBeLessThanOrEqual(1);
    expect(r[1].evidence.files.map((f: any) => f.name)).toEqual(expect.arrayContaining(['verdict.json', 'telemetry.jsonl', 'events.json', 'report.html', 'carla_recording.log']));
    expect(r[1].repro).toMatchObject({ toolVersion: expect.stringMatching(/^ff-carla 1\./), seed: 0, map: 'Town04' });
    expect(r[0].simulator).toMatch(/CARLA 0\.9\.16/);
  }, 300_000);
});
