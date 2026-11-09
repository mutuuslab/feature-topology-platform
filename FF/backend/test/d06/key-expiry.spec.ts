// 회귀: 5년 운영 재생에서 발견 — 서명 키 수명(365일)이 지나도 플랫폼이 만료된 키로 계속 서명해, 1년 뒤 배포가 차량에서 전부
// KEY_EXPIRED로 거부(게시본 TIMEOUT)됐다. 이제 만료된 키로는 서명하지 않고(배포 422, 원 변경도 되돌림) 키를 교체하면 다시 배포된다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-key-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp, completeTestSupplierEvidence, confirmSafety, releaseVersion, signG7 } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const JUDGE=actor('choi.judge','GATE_JUDGE');

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
    // Other signing purposes have been renewed through the real rotation API. Build a new release with current
    // Gate evidence while retaining the original expired policy-purpose key until the deployment test.
    const version=(await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({baseVersion:'1.0.0',reason:'정책 키 만료 격리 시험',changes:{featureRefs:[{refId:'AD-LON-009',role:'PRIMARY'}]}}).expect(201)).body.feature.version;
    const base=`/api/features/FEAT-00022/versions/${version}`;
    const source=(await http().get('/api/features/FEAT-00022/versions/1.0.0/classification').expect(200)).body.classification;
    const {adsFeature,ddtImpact,safetyRelated,owner,lifecycleOwners}=source;
    await http().put(`${base}/classification`).set(AUTHOR).send({adsFeature,ddtImpact,safetyRelated,owner,lifecycleOwners,reason:'원래 ADS 분류·상태별 책임을 새 Version에서 검토'}).expect(200);
    const classification=(await http().post(`${base}/classification/confirm`).set(SAFETY).send({reason:'현재 Version 분류·책임 독립 확인'}).expect(201)).body;
    expect(classification.completeness.classified).toBe(true);
    await http().put(`${base}/safety`).set(AUTHOR).send({fClass:'F3'}).expect(200);
    await confirmSafety(http,'FEAT-00022',version);
    for(const gate of ['G1','G2','G3'])await http().post(`${base}/gates`).set(JUDGE).send({gate,inputResult:'PASS',rationale:'현재 근거 확인',evidenceRef:`EV-${gate}`}).expect(201);
    await http().post(`${base}/transitions`).set(APPROVER).send({to:'APPROVED',reason:'현재 버전 승인'}).expect(200);
    await http().post(`${base}/gates`).set(JUDGE).send({gate:'G4',inputResult:'PASS',rationale:'현재 설계 확인',evidenceRef:'EV-G4'}).expect(201);
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: version, controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '키 만료 시험', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const id = c.body.policyId;
    const ids=[id];const feature=(await http().get(base).expect(200)).body.feature;
    for(const controlPoint of feature.controlPoints.filter((point:string)=>point!=='Parameter')){
      const other=await http().post('/api/policies').set(AUTHOR).send({featureId:'FEAT-00022',featureVersion:version,controlPoint,flagKey:`care_00022_key_${controlPoint.toLowerCase()}`,description:'출시의 다른 Control Point 준비',safeDefault:false}).expect(201);
      ids.push(other.body.policyId);
    }
    for(const policyId of ids)await http().post('/api/virtual-validations').set(AUTHOR).send({policyId}).expect(201);
    completeTestSupplierEvidence(app,'FEAT-00022',version);
    await signG7(http,'FEAT-00022',version);
    for(const gate of ['G5','G6','G7'])await http().post(`${base}/gates`).set(JUDGE).send({gate,inputResult:'PASS',rationale:'현재 서명 근거 확인',evidenceRef:`EV-${gate}`}).expect(201);
    for(const policyId of ids){
      expect((await http().post(`/api/policies/${policyId}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      await http().post(`/api/policies/${policyId}/decision`).set(APPROVER).send({decision:'APPROVE',reason:'GO'}).expect(200);
    }
    const current=await http().get(base).expect(200);
    expect(current.body.feature.lifecycle,JSON.stringify(current.body.transitions)).toBe('VERIFIED');
    await releaseVersion(http,'FEAT-00022',version);
    return id as string;
  };

  it('366일 뒤 — 배포는 422(키 교체 안내), 정책은 APPROVED 그대로, 게시본이 생기지 않는다', async () => {
    const clock = app.get(Clock);
    clock.set(new Date(clock.now().getTime() + 366 * 86_400_000));
    const keys=(await http().get('/api/pki/keys').expect(200)).body.items;
    const expiredPolicy=keys.find((key:any)=>key.purpose==='policy' && key.status==='ACTIVE');
    expect(Date.parse(expiredPolicy.notAfter)).toBeLessThan(clock.now().getTime());
    for(const purpose of new Set(['gate',...keys.filter((key:any)=>key.status==='ACTIVE' && key.purpose!=='policy').map((key:any)=>key.purpose)])){
      const renewed=(await http().post('/api/pki/rotate').set(SAFETY).send({reason:'정책 키 만료 시험의 다른 용도 갱신',purpose}).expect(201)).body;
      expect(Date.parse(renewed.notAfter)).toBeGreaterThan(clock.now().getTime());
    }
    const id = await approved();
    const before = app.get<Db>(DB).get<{ n: number }>('SELECT count(*) AS n FROM publication')!.n;
    const r = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: '1년 뒤 배포' }).expect(422);
    expect(r.body.error.message).toMatch(/서명 키 KEY-\d+가 .*만료.*교체/);
    expect(r.body.error.details).toMatchObject({keyId:expiredPolicy.keyId,purpose:'policy',signing:'KEY_EXPIRED'});
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
