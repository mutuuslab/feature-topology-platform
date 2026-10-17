// 회귀: 5년 운영 재생에서 발견 — 서명 키 수명(365일)이 지나도 플랫폼이 만료된 키로 계속 서명해, 1년 뒤 배포가 차량에서 전부
// KEY_EXPIRED로 거부(게시본 TIMEOUT)됐다. 이제 만료된 키로는 서명하지 않고(배포 422, 원 변경도 되돌림) 키를 교체하면 다시 배포된다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-key-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');

describe('서명 키 만료 — 만료된 키로 서명하지 않는다 (D06-10)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });
  const approved = async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '키 만료 시험', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const id = c.body.policyId;
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: id }).expect(201);
    expect((await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await http().post(`/api/policies/${id}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO' }).expect(200);
    return id as string;
  };

  it('366일 뒤 — 배포는 422(키 교체 안내), 정책은 APPROVED 그대로, 게시본이 생기지 않는다', async () => {
    const id = await approved();
    const before = app.get<Db>(DB).get<{ n: number }>('SELECT count(*) AS n FROM publication')!.n;
    const clock = app.get(Clock);
    clock.set(new Date(clock.now().getTime() + 366 * 86_400_000));
    const r = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: '1년 뒤 배포' }).expect(422);
    expect(r.body.error.message).toMatch(/서명 키 KEY-\d+가 .*만료.*교체/);
    expect((await http().get(`/api/policies/${id}`).expect(200)).body.policy.status).toBe('APPROVED');
    expect(app.get<Db>(DB).get<{ n: number }>('SELECT count(*) AS n FROM publication')!.n).toBe(before);

    // 교체 뒤에는 배포되고 차량이 받아들인다(KEY_EXPIRED 거부 없음)
    await http().post('/api/pki/rotate').set(SAFETY).send({ reason: '정기 교체(만료)', purpose: 'policy' }).expect(201);
    const d = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: '키 교체 뒤 배포' }).expect(200);
    const scheduler = app.get(Scheduler);
    scheduler.flush(12_000);
    clock.set(new Date(clock.now().getTime() + 12_000));
    const rejected = app.get<Db>(DB).all<{ doc: string }>('SELECT doc FROM readback WHERE publication_id = ?', d.body.publicationId).filter((x) => JSON.parse(x.doc).rejectReason === 'KEY_EXPIRED');
    expect(rejected).toEqual([]);
  });
});
