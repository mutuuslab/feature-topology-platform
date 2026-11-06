// ADS 구성 — ODD 프로파일(ADS-BE09)·승인 조합(ADS-BE10)·VIN 지원 판정(ORC-BE02). 시드 data/fixtures/ads/config.json(시드 시각 기준 상대값)
// 설계 tests: 의미 검증 오류가 있으면 승인 거부(막힘 사유), 역할 거부, 판단 불가·미확인을 정상·부합·구매 가능으로 세지 않음.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const VARIANT = actor('usr-variant', 'VARIANT_OWNER');
const OPS = actor('usr-ops', 'OPERATOR');

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  await app.app.close();
});

describe('ODD 프로파일 (ADS-BE09)', () => {
  it('목록 — 승인 상한을 넘는 배포 설정 3건, 판단 불가 1건은 따로(상한 안으로 세지 않음)', async () => {
    const r = (await app.http().get('/api/odd-profiles').expect(200)).body;
    expect(r.summary).toMatchObject({ exceeds: 3, undecidable: 1, within: 4, total: 8 });
    expect(r.items.map((x: { profileId: string }) => x.profileId)).toEqual(['ODD-FEAT-00004-v1', 'ODD-FEAT-00004-v2', 'ODD-FEAT-00022-v1']);
    expect(r.items.find((x: { profileId: string }) => x.profileId === 'ODD-FEAT-00004-v2')).toMatchObject({ status: 'DRAFT', issues: 2 });
  });

  it('초안 상세 — 의미 검증 오류 2건과 ux 막힘 사유, 변경 전후, 적용 장소 상태·사유 글자', async () => {
    const d = (await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v2').expect(200)).body;
    expect(d.issues.map((i: { code: string }) => i.code).sort()).toEqual(['ENVELOPE_EXCEEDED', 'UNIT_MIX']);
    expect(d.blockedReason).toBe('의미 검증 오류 2건(속도 단위 혼용 km/h·m/s, 승인 상한 초과)이 남아 승인할 수 없습니다 — 초안에서 고친 뒤 다시 검증하세요.');
    expect(d.diff).toContainEqual({ field: '동적 · 최고 속도', before: '80 km/h 이하(포함)', after: '40 m/s 이하(포함)' });
    expect(d.base).toMatchObject({ profileId: 'ODD-FEAT-00004-v1' });
    const sites = Object.fromEntries(d.sites.map((s: { siteId: string; status: string; reason: string }) => [s.siteId, s]));
    expect(sites['SITE-0003']).toMatchObject({ status: 'EXPOSURE_HOLD', reason: '노출 보류 — 지도 버전 2.3이 승인 상한 밖' });
    expect(sites['SITE-0002']).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
    expect(sites['SITE-0001'].status).toBe('APPROVED');
    expect(d.feature).toMatchObject({ featureId: 'FEAT-00004', version: '4.1.0' });
  });

  it('승인 — 기능안전 담당만(작성자 403), 의미 검증 오류가 남으면 막힘 사유와 함께 거부(422), 이미 승인이면 409', async () => {
    await app.http().post('/api/odd-profiles/ODD-FEAT-00004-v2/approve').set(AUTHOR).send({ reason: '승인 요청' }).expect(403);
    const r = await app.http().post('/api/odd-profiles/ODD-FEAT-00004-v2/approve').set(SAFETY).send({ reason: '승인' }).expect(422);
    expect(r.body.error.message).toContain('의미 검증 오류 2건');
    expect(r.body.error.details.blockers.map((b: { code: string }) => b.code).sort()).toEqual(['ENVELOPE_EXCEEDED', 'UNIT_MIX']);
    expect((await app.http().get('/api/odd-profiles/ODD-FEAT-00004-v2').expect(200)).body.profile.status).toBe('DRAFT');
    await app.http().post('/api/odd-profiles/ODD-FEAT-00004-v1/approve').set(SAFETY).send({ reason: '다시 승인' }).expect(409);
  });

  it('승인된 프로파일은 저장소에서도 바꿀 수 없다(새 버전으로)', () => {
    const db = app.get<Db>(DB);
    expect(() => db.run("UPDATE ads_odd_profile SET doc = '{}' WHERE profile_id = 'ODD-FEAT-00004-v1'")).toThrow(/승인된 ODD 프로파일/);
  });
});

describe('승인 조합 (ADS-BE10)', () => {
  it('목록 — 승인 조합 밖 차량 3대(부분 복구 1대 포함), 형상 미확인 1대는 부합으로 세지 않음', async () => {
    const r = (await app.http().get('/api/config-sets').expect(200)).body;
    expect(r.items.map((s: { setId: string }) => s.setId)).toEqual(['CFG-FEAT-00004-01', 'CFG-FEAT-00022-01']);
    expect(r.summary).toMatchObject({ outside: 3, partial: 1, unconfirmed: 1, match: 3, total: 7 });
    expect(r.items[1].counts).toEqual({ MATCH: 2, MISMATCH: 1, PARTIAL_RECOVERY: 1, BELOW_SECURITY_MIN: 1, UNCONFIRMED: 1 });
  });

  it('차량 대조 — 부분 복구 ECU 글자, 보안 최소 버전 미달 복구 후보 불가, 오래된 보고는 형상 미확인', async () => {
    const r = (await app.http().get('/api/config-sets/CFG-FEAT-00022-01/vehicles').expect(200)).body;
    const by = Object.fromEntries(r.items.map((x: { vin: string }) => [x.vin, x]));
    expect(by['KMH-NX4-0001']).toMatchObject({ cls: 'PARTIAL_RECOVERY', reasons: ['99211-NX400 복구됨', '95790-NX300 미복구'] });
    expect(by['KMH-NX4-0002']).toMatchObject({ cls: 'MISMATCH', code: 'CONFIG_SET_NOT_APPROVED' });
    expect(by['KMH-NX4-0002'].recovery.reason).toBe('복구 후보 불가 — 보안 최소 버전 미달(SW-CARE-SDIST-APP 1.1.9 < 1.2.0)');
    expect(by['KMH-NX4-0004'].cls).toBe('BELOW_SECURITY_MIN');
    expect(by['KMH-NX4-0003']).toMatchObject({ cls: 'UNCONFIRMED', code: 'CONFIG_STALE' });
    expect(by['ego-01'].cls).toBe('MATCH');
  });

  it('등록 — 차량 사양 담당만, ECU SW가 보안 최소 버전보다 낮으면 거부', async () => {
    const body = {
      featureId: 'FEAT-00022', featureVersion: '1.0.0',
      hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }],
      ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.1.0' }],
      securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }],
      reason: '보정 개정 조합',
    };
    await app.http().post('/api/config-sets').set(OPS).send(body).expect(403);
    const bad = await app.http().post('/api/config-sets').set(VARIANT).send(body).expect(422);
    expect(bad.body.error.message).toBe('ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.');
    const ok = await app.http().post('/api/config-sets').set(VARIANT).send({ ...body, ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.2.1' }], oddProfileId: 'ODD-FEAT-00022-v1' }).expect(201);
    expect(ok.body.setId).toBe('CFG-FEAT-00022-02');
  });

  it('등록 — 보안 최소 버전은 요청 본문으로 낮출 수 없다(같은 Feature 승인 조합의 최소 버전이 하한), 앞자리 0 버전은 형식 오류', async () => {
    const body = {
      featureId: 'FEAT-00022', featureVersion: '1.0.0',
      hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }],
      ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.1.0' }],
      reason: '보안 최소 버전 생략 시도',
    };
    // 본문에 보안 최소 버전을 빼거나 낮춰도 기존 승인 조합의 하한(SW-CARE-SDIST-APP 1.2.0)으로 거부
    expect((await app.http().post('/api/config-sets').set(VARIANT).send({ ...body, securityMin: [] }).expect(422)).body.error.message).toBe('ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.');
    await app.http().post('/api/config-sets').set(VARIANT).send({ ...body, securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.0.0' }] }).expect(422);
    // 01.1.0 — 비교할 수 없는 버전이 보안 검사를 지나가지 않는다
    await app.http().post('/api/config-sets').set(VARIANT).send({ ...body, ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '01.1.0' }], securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }] }).expect(400);
    // 저장된 조합은 하한을 그대로 들고 있다
    const ok = await app.http().post('/api/config-sets').set(VARIANT).send({ ...body, ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.3.0' }], securityMin: [] }).expect(201);
    expect(ok.body.securityMin).toEqual(expect.arrayContaining([{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }]));
  });
});

describe('ODD 프로파일 승인 — 직무 분리', () => {
  it('초안 작성자는 기능안전 담당이어도 자기 초안을 승인할 수 없다(거부 기록), 다른 담당자는 승인', async () => {
    const db = app.get<Db>(DB);
    const base = JSON.parse(db.get<{ doc: string }>("SELECT doc FROM ads_odd_profile WHERE profile_id = 'ODD-FEAT-00022-v1'")!.doc);
    const draft = { ...base, profileId: 'ODD-FEAT-00022-v2', version: 2, status: 'DRAFT', basedOn: 'ODD-FEAT-00022-v1', createdBy: 'usr-safety', approvedBy: null, approvedAt: null };
    db.run('INSERT INTO ads_odd_profile (profile_id, feature_id, feature_version, version, status, doc) VALUES (?, ?, ?, ?, ?, ?)', draft.profileId, draft.featureId, draft.featureVersion, 2, 'DRAFT', JSON.stringify(draft));
    const r = await app.http().post('/api/odd-profiles/ODD-FEAT-00022-v2/approve').set(SAFETY).send({ reason: '자기 초안 승인' }).expect(403);
    expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
    const audit = (await app.http().get('/api/audit?target=ODD-FEAT-00022-v2').set(actor('usr-auditor', 'AUDITOR')).expect(200)).body;
    expect(JSON.stringify(audit)).toContain('DENIED');
    const ok = await app.http().post('/api/odd-profiles/ODD-FEAT-00022-v2/approve').set(actor('usr-safety2', 'SAFETY_OFFICER')).send({ reason: '독립 승인' }).expect(201);
    expect(ok.body.profile).toMatchObject({ status: 'APPROVED', approvedBy: 'usr-safety2' });
  });
});

describe('VIN 지원 판정 (ORC-BE02)', () => {
  const elig = (vin: string, catalogId: string) => app.http().get(`/api/vehicles/${vin}/eligibility?catalogId=${catalogId}`).expect(200).then((r) => r.body);

  it("기본 예시 — 구형 SW 차량은 설치 기록 연동 전이라 '업데이트 후 가능'이 아니라 차량 확인 필요 — 미확인", async () => {
    const d = await elig('KMH-NX4-0004', 'CAT-00019');
    expect(d.state).toBe('VEHICLE_CHECK');
    expect(d.headline).toBe('차량 확인 필요 — SW 1.2.1 필요, 설치 기록 연동 전이라 미확인');
    expect(d.reasons.map((r: { axis: string; result: string }) => `${r.axis}:${r.result}`)).toEqual(['MARKET:MET', 'SW:UNCONFIRMED', 'HW:MET', 'RIGHTS:MET']);
    expect(d.reasons[0].basis).toContain('시장 Profile(승인 시장) 기준');
    expect(d.otaLinked).toBe(false);
  });

  it('바로 구매 가능 · 부품 미장착 · 판단 불가(출고 구성 기록 없음) · 미확인(형상 보고 3일 전) · 내부 상품 승인 없음', async () => {
    expect((await elig('lead-01', 'CAT-00019')).state).toBe('ELIGIBLE');
    expect((await elig('KMH-GN7-0001', 'CAT-00002')).state).toBe('ELIGIBLE');
    expect((await elig('KMH-NX4-0101', 'CAT-00019')).state).toBe('HW_MISSING');
    expect((await elig('KMH-NE-0001', 'CAT-00019')).headline).toBe('차량 확인 필요 — 판단 불가(출고 구성 기록 없음)');
    expect((await elig('KMH-NX4-0003', 'CAT-00019')).headline).toBe('차량 확인 필요 — 미확인(형상 보고 3일 전)');
    const noApproval = await elig('KMH-GN7-0001', 'CAT-00018');
    expect(noApproval.state).toBe('VEHICLE_CHECK');
    expect(noApproval.reasons[0].code).toBe('PRODUCT_APPROVAL_MISSING');
    expect((await elig('TMA-NX4-0001', 'CAT-00019')).state).toBe('NOT_OFFERED');
  });

  it('상품이 없으면 400 — 판정하지 않는다', async () => {
    await app.http().get('/api/vehicles/KMH-NX4-0004/eligibility').expect(400);
    await app.http().get('/api/vehicles/NO-SUCH/eligibility?catalogId=CAT-00019').expect(404);
  });
});
