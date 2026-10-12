// P9 PoC 6단계 러너 — 실제 서비스로 ①~⑥을 끝까지, 행위자·역할 분리, 회신 대기 단계(④·⑥), 재실행 시 이전 차단 복구, 42 컴포넌트 활동.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp } from '../helpers';

const OPS = actor('seo.ops', 'OPERATOR');

describe('PoC 6단계 러너 (P9)', () => {
  let app: INestApplication;
  let http: () => any;
  let runId: string;
  const advance = async () => (await http().post(`/api/poc/runs/${runId}/advance`).set(OPS).send({}).expect(200)).body;
  const flush = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    app.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };

  beforeAll(async () => {
    Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', UNLEASH_MODE: 'mock', VECU_DIR: resolve(__dirname, '..', 'fixtures', 'fake-vecu'), FF_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'ff-poc-')) });
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'UNLEASH_MODE', 'VECU_DIR', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it('시작은 운영·출시·승인·안전 담당만 — 6단계 PENDING, 단계마다 관여 컴포넌트', async () => {
    await http().post('/api/poc/runs').set(actor('kim.author', 'FEATURE_AUTHOR')).send({}).expect(403);
    const r = (await http().post('/api/poc/runs').set(OPS).send({}).expect(201)).body;
    runId = r.runId;
    expect(r).toMatchObject({ runId: 'POC-00001', status: 'RUNNING', subject: { featureId: 'FEAT-00022', flagKey: 'care_00022_param', vin: 'ego-01' } });
    expect(r.steps.map((s: any) => s.status)).toEqual(Array(6).fill('PENDING'));
    expect(r.steps[5].components).toEqual(expect.arrayContaining(['D03-03', 'D06-10']));
  });

  it('① 등록·상품: FEAT-00022 RELEASED, Gate 9/9, BL-00028, 상품 구성', async () => {
    const s = (await advance()).steps[0];
    expect(s.status).toBe('DONE');
    expect(s.evidence).toMatchObject({ lifecycle: 'RELEASED', gatesPass: '9/9', baseline: 'BL-00028' });
    expect(String(s.evidence.products)).toMatch(/CAT-00019/);
  });

  it('② 정책: 작성자 작성 → vECU 가상검증 → 8종 GO → 승인자 승인 (작성자≠승인자)', async () => {
    const s = (await advance()).steps[1];
    expect(s.status, s.note).toBe('DONE');
    expect(s.evidence).toMatchObject({ safety: 'GO', status: 'APPROVED' });
    expect(s.actions.map((a: any) => `${a.route}:${a.role}`)).toEqual(['createPolicy:FEATURE_AUTHOR', 'runVirtual:FEATURE_AUTHOR', 'validatePolicy:FEATURE_AUTHOR', 'decidePolicy:FEATURE_APPROVER']);
  });

  it('③ 권한·활성화: 시연 차량 체험권 유효 → 승인 정책 기준 ON', async () => {
    const s = (await advance()).steps[2];
    expect(s.status).toBe('DONE');
    expect(s.evidence).toMatchObject({ trial: true, demoDecision: 'ON POLICY_MATCH' });
    expect(Number(s.evidence.allow)).toBeGreaterThan(0);
  });

  it('④ 배포: 서명 게시 → 회신 대기(RUNNING) → 기한 후 PARTIAL(통신 단절 1대)로 완료, Unleash 동기화', async () => {
    let s = (await advance()).steps[3];
    expect(s.status).toBe('RUNNING');
    expect(s.evidence).toMatchObject({ unleash: 'SYNCED' });
    expect(String(s.evidence.publicationId)).toMatch(/^PUB-/);
    flush(10_000);
    s = (await advance()).steps[3];
    expect(s.status).toBe('DONE');
    expect(s.evidence).toMatchObject({ delivery: 'PARTIAL', confirmed: '5/6' });
    expect(s.note).toMatch(/재연결 대사/);
  });

  it('⑤ 차량: HELLO 후 이번 게시본으로 차량 측 ON, OpenFeature(OFREP)도 ON', async () => {
    const s = (await advance()).steps[4];
    expect(s.status, s.note).toBe('DONE');
    expect(s.evidence).toMatchObject({ sameAsDeployed: true, vehicleValue: true, openFeature: true, openFeatureReason: 'TARGETING_MATCH' });
    expect(s.actions.find((a: any) => a.route === 'ofrepEvaluate').role).toBe('VEHICLE');
  });

  it('⑥ 이상·차단: 차량 2대 고장 보고 → 이상 건(긴급 차단 권고) → 운영자 차단 → 회신 CONFIRMED → Safe Default → 품질 피드백', async () => {
    let r = await advance();
    let s = r.steps[5];
    expect(s.status).toBe('RUNNING');
    expect(s.evidence).toMatchObject({ advice: 'KILL' });
    flush(2_000);
    r = await advance();
    s = r.steps[5];
    expect(s.status, s.note).toBe('DONE');
    expect(s.evidence).toMatchObject({ killDelivery: 'CONFIRMED 2/2', serverValue: false, serverReason: 'KILL_SWITCH', anomalyStatus: 'MITIGATED' });
    expect(String(s.evidence.feedbackId)).toMatch(/^FB-/);
    expect(r.status).toBe('DONE');
    const roles = new Set(r.steps.flatMap((x: any) => x.actions.map((a: any) => a.role)));
    expect([...roles].sort()).toEqual(expect.arrayContaining(['FEATURE_APPROVER', 'FEATURE_AUTHOR', 'OPERATOR', 'RELEASE_MANAGER', 'VEHICLE']));
  });

  it('다시 시작하면 이전 PoC 차단을 복구하고 새 실행', async () => {
    const r = (await http().post('/api/poc/runs').set(OPS).send({}).expect(201)).body;
    expect(r.runId).toBe('POC-00002');
    expect(r.refs.restoredKills).toMatch(/^KILL-/);
    expect((await http().get('/api/kill-requests?status=ACTIVE').expect(200)).body.items).toEqual([]);
  });

  it('42 컴포넌트 활동 — 이번 실행으로 이벤트가 남은 컴포넌트', async () => {
    const a = (await http().get('/api/components/activity?minutes=1440').expect(200)).body.items;
    expect(a).toHaveLength(42);
    const busy = a.filter((x: any) => x.events > 0).map((x: any) => x.id);
    expect(busy).toEqual(expect.arrayContaining(['D01-06', 'D06-08', 'D03-03', 'D06-12', 'D04-06']));
  });
});
