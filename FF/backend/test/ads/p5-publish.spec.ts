// ADS 구성 마감(P5) — 정책 컴파일 ODD 상한(ADS-BE09), 발행 후보·차량 증명·복구 결정(ADS-BE10), 결정적 빌드 digest(ADS-BE11),
// 분류·시장 기준선 입력·확정(ADS-BE16), 캠페인 ↔ 릴리스 양방향 조회(ADS-BE17). 시드 data/fixtures/ads/config.json·change.json
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POLICY_COMPILER_VERSION, type Policy } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { PolicyRepo, policyHash } from '../../src/domains/d01-policy/policy-repos';
import { SecureDeployService } from '../../src/domains/d06-qsec/secure-deploy/secure-deploy.service';
import { IfCallRepo } from '../../src/adapters/if-call/if-call.repo';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const SAFETY2 = actor('park.safety', 'SAFETY_OFFICER');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const RM = actor('usr-release', 'RELEASE_MANAGER');
const REG = actor('usr-reg', 'REGULATORY_OWNER');
const OPS_LEAD = actor('usr-opslead', 'OPS_LEAD');
const SEC = actor('usr-csm', 'SECURITY_OFFICER');

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  await app.app.close();
});

/** 승인된 정책을 바로 만든다(검증·승인 흐름은 다른 시험) — 배포 검사만 본다.
 *  사용 권한 상품은 떼어 낸다: POL-00002의 CAT-00019 구성에는 다른 Feature가 없어 배포 시점 컴플라이언스 룰(ENTITLEMENT_REQUIRED, P1)이 먼저 막는다(통합 17단계) */
function approvedPolicy(featureId: string, featureVersion: string, flagKey: string): string {
  const repo = app.get(PolicyRepo);
  const base = repo.get('POL-00002')!;
  const p = { ...base, policyId: repo.nextId(), featureId, featureVersion, flagKey, entitlementCatalogId: null, status: 'APPROVED', deployedAt: null, deployedBy: null, stageBasisPoints: null, stagedAt: null, revision: 1 } as Policy;
  p.contentHash = policyHash(p);
  repo.insert(p);
  return p.policyId;
}
const classify = (f: string, v: string, body: Record<string, unknown>, who = AUTHOR) => app.http().put(`/api/features/${f}/versions/${v}/classification`).set(who).send(body);
const owners = { CREATE: '기획팀', OPERATE: '차량운영센터', SUSPEND: '기획팀', DISPOSE: '기획팀' };

describe('정책 컴파일 — 승인 상한 (ADS-BE09·FFP-F016·F025)', () => {
  it('프로파일 상세에 Flag별 컴파일 검사 — 상한 초과·판단 불가 설정은 막힘 사유', async () => {
    const d = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v1').expect(200)).body;
    const by = Object.fromEntries(d.compile.map((c: { flagKey: string; blockers: { code: string; ref: string }[] }) => [c.flagKey, c.blockers.map((b) => `${b.code}:${b.ref}`)]));
    expect(by).toEqual({ hda2_00004_speed: ['ODD_ENVELOPE_EXCEEDED:DS-0001', 'ODD_ENVELOPE_EXCEEDED:DS-0002'], hda2_00004_road: ['ODD_ENVELOPE_EXCEEDED:DS-0003'], hda2_00004_weather: ['ODD_UNDECIDABLE:DS-0004'] });
  });

  it('승인 상한보다 넓은 배포 설정이 묶인 정책은 배포(빌드) 거부 — 사유 코드와 감사', async () => {
    const id = approvedPolicy('FEAT-00004', '4.1.0', 'hda2_00004_speed');
    const r = await app.http().post(`/api/policies/${id}/deploy`).set(RM).send({ reason: '배포' }).expect(422);
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code)).toEqual(['ODD_ENVELOPE_EXCEEDED', 'ODD_ENVELOPE_EXCEEDED']);
    expect((await app.http().get(`/api/policies/${id}`).expect(200)).body.policy.status).toBe('APPROVED');
    const a = (await app.http().get(`/api/audit?target=${id}&result=FAILED`).expect(200)).body.items;
    expect(a.some((x: { action: string }) => x.action === 'POLICY_DEPLOY')).toBe(true);
  });

  it('배포된 게시본 build에 ODD 프로파일 참조(정책·로그 결합 식별자)와 컴파일러 판이 남는다', async () => {
    const id = approvedPolicy('FEAT-00004', '4.1.0', 'hda2_00004_lane');
    const r = (await app.http().post(`/api/policies/${id}/deploy`).set(RM).send({ reason: '배포' }).expect(200)).body;
    const pub = (await app.http().get(`/api/publications/${r.publicationId}`).expect(200)).body.publication;
    expect(pub.build).toMatchObject({ oddProfileRef: 'ODD-FEAT-00004-v1', compilerVersion: POLICY_COMPILER_VERSION, bundleDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
  });

  it('같은 Feature의 두 ODD 버전 판정 로그는 프로파일별로 따로 센다', async () => {
    const db = app.get<Db>(DB);
    const ins = (odd: string, verdict: string) =>
      db.run("INSERT INTO safety_verdict (vin, feature_id, action, verdict, reason_codes, odd_ref, observed_at, received_at, source) VALUES ('KMH-GN7-0001', 'FEAT-00004', 'ACTIVATE', ?, '[]', ?, ?, ?, 'SIMULATED')", verdict, odd, AT, AT);
    ins('ODD-FEAT-00004-v1', 'ALLOW');
    ins('ODD-FEAT-00004-v1', 'DENY');
    ins('ODD-FEAT-00004-v2', 'ALLOW');
    const v1 = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v1').expect(200)).body.logs;
    const v2 = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v2').expect(200)).body.logs;
    expect(v1).toMatchObject({ oddRef: 'ODD-FEAT-00004-v1', ALLOW: 1, DENY: 1, total: 2 });
    expect(v2).toMatchObject({ oddRef: 'ODD-FEAT-00004-v2', ALLOW: 1, total: 1 });
  });

  it('HT02 적용 장소 추가 — 변경 영향 확정 전이면 승인 대기(IMPACT_REVIEW_OPEN), 승인 거부, 승인 상한 불변', async () => {
    const before = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v1').expect(200)).body.profile.envelope;
    const s = (await app.http().post('/api/odd-profiles/ODD-FEAT-00004-v1/sites').set(AUTHOR).send({ name: '판교 시범 구역', kind: 'ZONE', mapVersion: '2.2', infraVersion: 'IF-1.5', changeImpactRef: null, reason: '시범 구역 추가' }).expect(201)).body;
    expect(s).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
    const r = await app.http().post(`/api/odd-profiles/ODD-FEAT-00004-v1/sites/${s.siteId}/approve`).set(SAFETY2).send({ reason: '승인' }).expect(422);
    expect(r.body.error.details.blockers[0].code).toBe('IMPACT_REVIEW_OPEN');
    const ok = (await app.http().post('/api/odd-profiles/ODD-FEAT-00004-v1/sites').set(AUTHOR).send({ name: '서울 남부 구간', kind: 'ROAD_SECTION', mapVersion: '2.2', infraVersion: 'IF-1.5', changeImpactRef: 'CI-0001', reason: '구간 추가' }).expect(201)).body;
    expect(ok.status).toBe('PENDING');
    await app.http().post(`/api/odd-profiles/ODD-FEAT-00004-v1/sites/${ok.siteId}/approve`).set(AUTHOR).send({ reason: '승인' }).expect(403);
    expect((await app.http().post(`/api/odd-profiles/ODD-FEAT-00004-v1/sites/${ok.siteId}/approve`).set(SAFETY2).send({ reason: '영향 확정 확인' }).expect(201)).body).toMatchObject({ status: 'APPROVED' });
    const d = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v1').expect(200)).body;
    expect(d.profile.envelope).toEqual(before);
    expect(d.sites.find((x: { siteId: string }) => x.siteId === s.siteId)).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
    expect(d.sites.find((x: { siteId: string }) => x.siteId === ok.siteId)).toMatchObject({ status: 'APPROVED' });
  });
});

describe('발행 후보·차량 증명 (ADS-BE10·FFP-F005·F039)', () => {
  it('ADAS(비 ADS) Feature는 대상을 바꾸지 않고 승인 조합 밖 차량을 미리보기에 사유로 보인다', async () => {
    const r = (await app.http().get('/api/policies/POL-00002/publish-preview').expect(200)).body;
    expect(r).toMatchObject({ enforced: false, blockers: [] });
    expect(r.targets).toHaveLength(6);
    expect(Object.fromEntries(r.excluded.map((x: { vin: string; code: string }) => [x.vin, x.code]))).toEqual({ 'KMH-NX4-0001': 'RECOVERY_PARTIAL', 'KMH-NX4-0002': 'CONFIG_SET_NOT_APPROVED', 'KMH-NX4-0003': 'CONFIG_UNCONFIRMED', 'KMH-NX4-0004': 'SECURITY_MIN_VIOLATION' });
  });

  it('ADS Feature로 분류하면 확정 전 발행 거부(CLS_UNREGISTERED), 확정 뒤 승인 조합 밖 차량을 게시 대상에서 뺀다(개별 버전이 유효해도)', async () => {
    await classify('FEAT-00022', '1.0.0', { adsFeature: true, ddtImpact: 'SUPPORT', safetyRelated: true, owner: 'ADAS상품기획팀', lifecycleOwners: owners, reason: 'ADS 기능으로 재분류' }).expect(200);
    expect((await app.http().get('/api/policies/POL-00002/publish-preview').expect(200)).body.blockers.map((b: { code: string }) => b.code)).toEqual(['CLS_UNREGISTERED']);
    await app.http().post('/api/features/FEAT-00022/versions/1.0.0/classification/confirm').set(SAFETY).send({ reason: 'ADS 분류 확정' }).expect(201);
    const pv = (await app.http().get('/api/policies/POL-00002/publish-preview').expect(200)).body;
    expect(pv).toMatchObject({ enforced: true, blockers: [], targets: ['ego-01', 'lead-01'] });
    const id = approvedPolicy('FEAT-00022', '1.0.0', 'care_00022_param');
    const d = (await app.http().post(`/api/policies/${id}/deploy`).set(RM).send({ reason: 'ADS 배포' }).expect(200)).body;
    const pub = (await app.http().get(`/api/publications/${d.publicationId}`).expect(200)).body.publication;
    expect(pub.payload.targets.sort()).toEqual(['ego-01', 'lead-01']);
    expect(pub.build.candidates.excluded.map((x: { code: string }) => x.code).sort()).toEqual(['CONFIG_SET_NOT_APPROVED', 'CONFIG_UNCONFIRMED', 'RECOVERY_PARTIAL', 'SECURITY_MIN_VIOLATION']);
  });

  it('승인 조합이 없는 F2 ADS Feature는 발행 거부(CONFIG_SET_MISSING)', async () => {
    await classify('FEAT-00001', '2.2.0', { adsFeature: true, ddtImpact: 'SUPPORT', safetyRelated: true, owner: 'Parking기획팀', lifecycleOwners: owners, reason: 'ADS 재분류' }).expect(200);
    await app.http().post('/api/features/FEAT-00001/versions/2.2.0/classification/confirm').set(SAFETY).send({ reason: '확정' }).expect(201);
    const id = approvedPolicy('FEAT-00001', '2.2.0', 'rpa_00001_x');
    const r = await app.http().post(`/api/policies/${id}/deploy`).set(RM).send({ reason: '배포' }).expect(422);
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code)).toContain('CONFIG_SET_MISSING');
  });

  it('차량 증명(ATTESTATION)이 ECU·모델·보정 전체를 보고하면 승인 조합과 대조 — 일부 ECU만 복구는 RECOVERY_PARTIAL, 재활성화 후보 아님', async () => {
    const set = (await app.http().get('/api/config-sets').expect(200)).body.items.find((s: { setId: string }) => s.setId === 'CFG-FEAT-00022-01');
    const ecus = set.hw.map((h: { ecuPno: string; hwRevision: string }) => ({ ecuPno: h.ecuPno, hwRevision: h.hwRevision, sw: set.ecuSw.filter((s: { ecuPno: string }) => s.ecuPno === h.ecuPno).map((s: { swId: string; version: string }) => ({ swId: s.swId, version: s.version })) }));
    const send = (seq: number, recovered: string[]) =>
      app.http().post('/vehicle/v1/KMH-NX4-0002/reports').set({ 'X-Vehicle-Id': 'KMH-NX4-0002' }).send({ type: 'ATTESTATION', bootId: 'BOOT-P5', sequence: seq, observedAt: AT, configs: [], vehicleConfig: { ecus, model: set.model, calibration: set.calibration, recovery: { targets: set.hw.map((h: { ecuPno: string }) => h.ecuPno), recovered }, recoveryCandidate: null } });
    const part = (await send(1, [set.hw[0].ecuPno]).expect(200)).body.attestation.configSets;
    expect(part).toEqual([expect.objectContaining({ setId: 'CFG-FEAT-00022-01', cls: 'PARTIAL_RECOVERY', code: 'RECOVERY_PARTIAL', reactivation: expect.objectContaining({ eligible: false }) })]);
    const full = (await send(2, set.hw.map((h: { ecuPno: string }) => h.ecuPno)).expect(200)).body.attestation.configSets;
    expect(full[0]).toMatchObject({ cls: 'MATCH', reactivation: { eligible: true } });
    const row = (await app.http().get('/api/config-sets/CFG-FEAT-00022-01/vehicles').expect(200)).body.items.find((x: { vin: string }) => x.vin === 'KMH-NX4-0002');
    expect(row.cls).toBe('MATCH');
  });

  it('복구 결정 — 보안 최소 버전 아래 후보로 이전 버전 복구는 거부, 정지 유지 결정은 근거와 함께 남는다', async () => {
    const bad = await app.http().post('/api/config-sets/recovery-decisions').set(OPS_LEAD).send({ vin: 'KMH-NX4-0001', path: 'RESTORE_PREVIOUS', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: 'PUB-00002', rationale: '이전 버전 복구' });
    // 0001의 복구 후보 SW-CAMERA-FW 8.1.0은 보안 최소 버전 대상이 아니다 — 메타데이터는 유효
    expect(bad.status).toBe(201);
    const low = await app.http().post('/api/config-sets/recovery-decisions').set(OPS_LEAD).send({ vin: 'KMH-NX4-0004', path: 'RESTORE_PREVIOUS', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: 'PUB-00002', rationale: '이전 버전 복구' });
    expect(low.status).toBe(201);
    const db = app.get<Db>(DB);
    db.run("UPDATE ads_vehicle_config SET doc = json_set(doc, '$.recoveryCandidate', json('{\"swId\":\"SW-CARE-SDIST-APP\",\"version\":\"1.1.0\"}')) WHERE vin = 'KMH-NX4-0004'");
    const r = await app.http().post('/api/config-sets/recovery-decisions').set(OPS_LEAD).send({ vin: 'KMH-NX4-0004', path: 'RESTORE_PREVIOUS', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: 'PUB-00002', rationale: '취약 이미지로 복구' }).expect(422);
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code)).toEqual(['SECURITY_MIN_VIOLATION']);
    await app.http().post('/api/config-sets/recovery-decisions').set(AUTHOR).send({ vin: 'KMH-NX4-0004', path: 'SAFE_STATE', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: null, rationale: '정지 유지' }).expect(403);
    const s = (await app.http().post('/api/config-sets/recovery-decisions').set(SAFETY).send({ vin: 'KMH-NX4-0004', path: 'SAFE_STATE', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: null, rationale: '복구 후보가 보안 최소 버전 미달 — 정지 유지' }).expect(201)).body;
    expect(s).toMatchObject({ vin: 'KMH-NX4-0004', path: 'SAFE_STATE', decidedBy: 'usr-safety', configSetRef: 'CFG-FEAT-00022-01' });
    const list = (await app.http().get('/api/config-sets/recovery-decisions?vin=KMH-NX4-0004').expect(200)).body.items;
    expect(list.map((x: { path: string }) => x.path)).toEqual(['RESTORE_PREVIOUS', 'SAFE_STATE']);
    expect(() => db.run("UPDATE ads_recovery_decision SET path = 'SERVICE'")).toThrow(/추가만/);
  });

  it('서명 유효 epoch보다 낮은 메타데이터의 게시본으로 복구는 거부(EPOCH_STALE)', async () => {
    await app.http().post('/api/pki/epoch').set(SEC).send({ reason: '키 유출 대응 연습' }).expect(201);
    const r = await app.http().post('/api/config-sets/recovery-decisions').set(OPS_LEAD).send({ vin: 'KMH-NX4-0001', path: 'RESTORE_PREVIOUS', configSetRef: 'CFG-FEAT-00022-01', candidatePublicationId: 'PUB-00002', rationale: '이전 게시본으로 복구' }).expect(422);
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code)).toEqual(['EPOCH_STALE']);
  });
});

describe('결정적 빌드 digest (ADS-BE11·FFP-F013 TC21)', () => {
  it('같은 승인 정책을 다시 빌드하면 게시본 ID·서명 해시는 달라도 bundle digest가 같고 컴파일러 판이 기록된다', () => {
    const db = app.get<Db>(DB);
    const sd = app.get(SecureDeployService);
    const p = app.get(PolicyRepo).get('POL-00001')!;
    const sys = { id: 'system', role: 'SYSTEM', correlationId: 'tc21' } as const;
    const a = db.tx(() => sd.publishPolicy(p, sys));
    const b = db.tx(() => sd.publishPolicy(p, sys));
    expect(a.publicationId).not.toBe(b.publicationId);
    expect(a.signature.payloadHash).not.toBe(b.signature.payloadHash);
    expect(a.build?.bundleDigest).toBe(b.build?.bundleDigest);
    expect(a.build?.compilerVersion).toBe(POLICY_COMPILER_VERSION);
  });
});

describe('분류·시장 기준선 입력·확정 (ADS-BE16·FFP-F001·F003·F004)', () => {
  it('분류 입력은 작성자, 확정은 기능안전 담당 — 확정 뒤 DDT 영향을 바꾸면 재확정 전까지 미분류', async () => {
    await classify('FEAT-00019', '2.0.0', { adsFeature: false, ddtImpact: 'PARTIAL', safetyRelated: true, owner: 'Vehicle Dynamics팀', lifecycleOwners: owners, reason: '분류 입력' }, SAFETY).expect(403);
    const put = (await classify('FEAT-00019', '2.0.0', { adsFeature: false, ddtImpact: 'PARTIAL', safetyRelated: true, owner: 'Vehicle Dynamics팀', lifecycleOwners: owners, reason: '분류 입력' }).expect(200)).body;
    expect(put.classification).toMatchObject({ status: 'DRAFT', source: 'MANUAL', ddtImpact: 'PARTIAL' });
    await app.http().post('/api/features/FEAT-00019/versions/2.0.0/classification/confirm').set(AUTHOR).send({ reason: '확정' }).expect(403);
    const c = (await app.http().post('/api/features/FEAT-00019/versions/2.0.0/classification/confirm').set(SAFETY).send({ reason: '4축 확인' }).expect(201)).body;
    expect(c.completeness).toMatchObject({ classified: true });
    expect(c.classification.confirmHash).toBeTruthy();
    const ch = (await classify('FEAT-00019', '2.0.0', { adsFeature: false, ddtImpact: 'FULL', safetyRelated: true, owner: 'Vehicle Dynamics팀', lifecycleOwners: owners, reason: 'DDT 영향 변경' }).expect(200)).body;
    expect(ch.classification.status).toBe('DRAFT');
    expect(ch.completeness.gaps).toContain('CONFIRM');
    expect(ch.ownerHistory.length).toBeGreaterThanOrEqual(4);
    expect(ch.ruleEnabled).toBe(true);
  });

  it('빈 축이 남으면 확정 거부(사유)', async () => {
    await classify('FEAT-00011', '1.3.0', { adsFeature: false, ddtImpact: null, safetyRelated: true, owner: '팀', lifecycleOwners: { CREATE: '팀' }, reason: '일부 입력' }).expect(200);
    const r = await app.http().post('/api/features/FEAT-00011/versions/1.3.0/classification/confirm').set(SAFETY).send({ reason: '확정' }).expect(422);
    expect(r.body.error.message).toContain('DDT');
  });

  it('분류 대상 Version은 미분류면 출시 전이 거부(CLS_UNREGISTERED), 중단 전이는 상태 책임자 미지정이면 거부', async () => {
    await classify('FEAT-00003', '3.3.0', { adsFeature: false, ddtImpact: 'SUPPORT', safetyRelated: false, owner: 'UX기획팀', lifecycleOwners: { CREATE: 'UX기획팀', OPERATE: '차량운영센터', SUSPEND: 'UX기획팀', DISPOSE: 'UX기획팀' }, reason: 'DDT 영향 정정' }).expect(200);
    const r = await app.http().post('/api/features/FEAT-00003/versions/3.3.0/transitions').set(RM).send({ to: 'RELEASED', reason: '출시' }).expect(422);
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code)).toContain('CLS_UNREGISTERED');
    await classify('FEAT-00004', '4.1.0', { adsFeature: false, ddtImpact: 'SUPPORT', safetyRelated: true, owner: 'ADAS기획팀', lifecycleOwners: { CREATE: 'ADAS기획팀', OPERATE: '차량운영센터', SUSPEND: null, DISPOSE: 'ADAS기획팀' }, reason: '중단 책임자 공석' }).expect(200);
    const d = await app.http().post('/api/features/FEAT-00004/versions/4.1.0/transitions').set(RM).send({ to: 'DEPRECATED', reason: '중단' }).expect(422);
    expect(d.body.error.details.blockers.map((b: { code: string }) => b.code)).toContain('LIFECYCLE_OWNER_MISSING');
  });

  it('TC23 사용 중단·종료 Feature의 신규 허용 정책 생성은 거부', async () => {
    for (const [f, v] of [['FEAT-00017', '2.5.0'], ['FEAT-00018', '1.8.4']]) {
      const r = await app.http().post('/api/policies').set(AUTHOR).send({ featureId: f, featureVersion: v, controlPoint: 'Signal', flagKey: `x_${f.slice(-5)}_new`, description: '새 허용', safeDefault: false });
      expect(r.status).toBe(422);
    }
  });

  it('시장 기준선 입력은 법규 담당 — 승인 ODD는 같은 Version의 승인 프로파일만', async () => {
    const body = { approvalType: 'TYPE_APPROVAL', regulations: [{ reg: 'UN R79', series: '04' }, { reg: 'UN R171', series: '00' }], oddProfileRef: 'ODD-FEAT-00004-v1', approvalStatus: 'APPROVED', note: '유럽 형식승인 확인', reason: 'EU 승인 반영' };
    await app.http().put('/api/market-baselines/FEAT-00004/4.1.0/EU').set(AUTHOR).send(body).expect(403);
    await app.http().put('/api/market-baselines/FEAT-00004/4.1.0/EU').set(REG).send({ ...body, oddProfileRef: 'ODD-FEAT-00004-v2' }).expect(422);
    const r = (await app.http().put('/api/market-baselines/FEAT-00004/4.1.0/EU').set(REG).send(body).expect(200)).body;
    expect(r).toMatchObject({ market: 'EU', approvalStatus: 'APPROVED', assumed: false });
    const list = (await app.http().get('/api/market-baselines?featureId=FEAT-00004&version=4.1.0').expect(200)).body.items;
    expect(list.find((b: { market: string }) => b.market === 'EU')).toMatchObject({ approvalType: 'TYPE_APPROVAL', approvalStatus: 'APPROVED' });
  });
});

describe('캠페인 ↔ 릴리스 양방향 (ADS-BE17·FFP-F017)', () => {
  it('campaignId로 게시본·정책 릴리스를 찾는다 — 없는 캠페인 404, 연결 없는 캠페인은 빈 목록', async () => {
    const pub = (await app.http().get('/api/publications/PUB-00002').expect(200)).body.publication;
    const c = (await app.http().get(`/api/campaigns/${pub.campaignId}`).expect(200)).body;
    expect(c.publications.map((p: { publicationId: string }) => p.publicationId)).toEqual(['PUB-00002']);
    expect(c.policies).toEqual([expect.objectContaining({ policyId: 'POL-00002', flagKey: 'care_00022_param' })]);
    await app.http().get('/api/campaigns/CMP-99999').expect(404);
    app.get(IfCallRepo).call('IF-05', 'ORPHAN-1', { channel: 'OTA' }, () => ({ campaignId: 'CMP-07777', accepted: true }));
    expect((await app.http().get('/api/campaigns/CMP-07777').expect(200)).body).toMatchObject({ campaignId: 'CMP-07777', publications: [], policies: [] });
  });
});
