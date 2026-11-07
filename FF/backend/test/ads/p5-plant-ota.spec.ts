// 생산 출고 실물 구성 대조·품질 보류(ORC-UI08, B06)와 OTA 설치 계약(ADS-OTA01, IF-05 설치 보고 — TC16·TC18·S04). 시드 data/fixtures/ads/p5.json
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
const BOM = actor('usr-bom', 'BOM_APPROVER');
const OPS = actor('usr-ops', 'OPERATOR');
const SECRET = 'p5-ota-webhook-secret';

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  process.env.FF_OTA_WEBHOOK_SECRET = SECRET;
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  delete process.env.FF_OTA_WEBHOOK_SECRET;
  await app.app.close();
});

describe('출고 실물 구성 대조 (ORC-UI08)', () => {
  it('B06 — 주문 사양과 실물 구성이 다른 차량은 품질 보류, 실물 미확인은 일치로 세지 않는다', async () => {
    const r = (await app.http().get('/api/plants/eol/mismatches').expect(200)).body;
    expect(r.summary).toMatchObject({ hold: 3, unconfirmed: 1, shippedWithMismatch: 0 });
    const by = Object.fromEntries(r.items.map((x: { vin: string; status: string; verdict: string }) => [x.vin, `${x.verdict}/${x.status}`]));
    expect(by).toMatchObject({ 'KMH-NX4-0001': 'MISMATCH/QUALITY_HOLD', 'KMH-NX4-0002': 'MISMATCH/QUALITY_HOLD', 'KMH-NX4-0101': 'MISMATCH/REWORK', 'KMH-NX4-0003': 'UNCONFIRMED/UNCONFIRMED', 'KMH-GN7-0001': 'MATCH/READY' });
  });

  it('재대조 결과 없는 출고 근거 저장 거부, 생산 품질(BOM 승인자 위임)이 아니면 거부, 불일치 남은 해제 거부', async () => {
    await app.http().post('/api/plants/eol/checks').set(OPS).send({ vin: 'KMH-NX4-0001', decision: 'HOLD', cause: '카메라 개정 불일치', reason: '보류' }).expect(403);
    const noRecheck = await app.http().post('/api/plants/eol/checks').set(BOM).send({ vin: 'KMH-NX4-0001', decision: 'RELEASE', cause: '재작업 완료', shippedEvidence: 'SHIP-0001', reason: '출고' }).expect(422);
    expect(noRecheck.body.error.details.blockers.map((b: { code: string }) => b.code)).toEqual(['RECHECK_MISSING']);
    const open = await app.http().post('/api/plants/eol/checks').set(BOM).send({ vin: 'KMH-NX4-0001', decision: 'RELEASE', cause: '해제', reason: '해제' }).expect(422);
    expect(open.body.error.details.blockers[0].code).toBe('MISMATCH_OPEN');
    const db = app.get<Db>(DB);
    expect(() => db.run("INSERT INTO eol_check (check_id, vin, decision, decided_by, decided_role, decided_at, shipped_evidence, doc) VALUES ('X', 'KMH-NX4-0001', 'RELEASE', 'a', 'BOM_APPROVER', 't', 'SHIP-X', '{}')")).toThrow();
  });

  it('재작업 → 공장 품질 시스템 재대조 일치 → 보류 해제·출고 근거 저장, 이력은 추가만', async () => {
    await app.http().post('/api/plants/eol/checks').set(BOM).send({ vin: 'KMH-NX4-0001', decision: 'REWORK', cause: '전방 카메라 Rev.B 장착 — 주문 Rev.C', reworkRef: 'RW-2026-1101', reason: '재작업 지시' }).expect(201);
    await app.http().post('/api/plants/eol/as-built').set(BOM).send({ vin: 'KMH-NX4-0001', plant: 'HMMC 체코 공장', scannedAt: AT, orderEcus: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C' }], builtEcus: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C' }] }).expect(201);
    const ok = (await app.http().post('/api/plants/eol/checks').set(BOM).send({ vin: 'KMH-NX4-0001', decision: 'RELEASE', cause: '재작업 완료', reworkRef: 'RW-2026-1101', recheckResult: 'PASS', shippedEvidence: 'SHIP-2026-1105', reason: '재대조 일치' }).expect(201)).body;
    expect(ok).toMatchObject({ decidedBy: 'usr-bom', decidedRole: 'BOM_APPROVER', recheckResult: 'PASS' });
    const v = (await app.http().get('/api/plants/eol/vehicles/KMH-NX4-0001').expect(200)).body;
    expect(v.status).toBe('SHIPPED');
    expect(v.checks.map((c: { decision: string }) => c.decision)).toEqual(['HOLD', 'REWORK', 'RELEASE']);
    expect((await app.http().get('/api/plants/eol/mismatches').expect(200)).body.summary.shippedWithMismatch).toBe(0);
  });

  it('인도 인수 — 정차 확인 가능 항목만 인수 수에 넣고 주행 조건 항목은 인도 후 확인 대기', async () => {
    const v = (await app.http().get('/api/plants/eol/vehicles/KMH-GN7-0001').expect(200)).body;
    expect(v.acceptance.items.length).toBeGreaterThan(0);
    expect(v.acceptance.items.filter((i: { group: string }) => i.group === 'DRIVING').every((i: { state: string }) => i.state === 'POST_DELIVERY')).toBe(true);
    expect(v.acceptance.summary.accepted).toBe(v.acceptance.items.filter((i: { state: string }) => i.state === 'CONFIRMED').length);
  });

  it('부품 누락은 지원 판정 HW 칸이 출고 구성 기록으로 본다(정책 ON으로 덮지 않음)', async () => {
    const d = (await app.http().get('/api/vehicles/KMH-NX4-0002/eligibility?catalogId=CAT-00019').expect(200)).body;
    expect(d.state).toBe('HW_MISSING');
    expect(d.reasons.find((r: { axis: string }) => r.axis === 'HW').basis).toContain('출고 구성 기록');
  });
});

const sign = (raw: string) => {
  const ts = String(Math.floor(Date.parse(AT) / 1000));
  return { 'x-ota-timestamp': ts, 'x-ota-signature': `sha256=${createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')}`, 'content-type': 'application/json' };
};
const post = (body: unknown) => {
  const raw = JSON.stringify(body);
  return app.http().post('/api/ota/v1/installs').set(sign(raw)).send(raw);
};

describe('OTA 설치 계약 (ADS-OTA01 · IF-05 설치 보고)', () => {
  it('서명 없는 보고는 받지 않고, 실패 보고에 failure_kind가 없으면 본문 거부', async () => {
    await app.http().post('/api/ota/v1/installs').send({}).expect(401);
    const r = await post({ specVersion: '1.0', eventId: 'EV-INSTALL-0001', type: 'install.report', occurredAt: AT, installs: [{ installId: 'INS-T1', vin: 'lead-01', stage: 'FAILED', at: AT }] }).expect(400);
    expect(JSON.stringify(r.body)).toContain('failure_kind');
  });

  it('보고를 저장하고 차량별 단계로 보인다 — 실패 원인은 전원·통신·검증을 따로 센다, 같은 이벤트 ID는 한 번만', async () => {
    const ev = { specVersion: '1.0', eventId: 'EV-INSTALL-0002', type: 'install.report', occurredAt: AT, installs: [{ installId: 'INS-T2', vin: 'lead-01', stage: 'READY', at: '2026-11-06T00:50:00.000Z' }, { installId: 'INS-T2', vin: 'lead-01', stage: 'FAILED', at: '2026-11-06T00:55:00.000Z', failureKind: 'LINK' }] };
    expect((await post(ev).expect(202)).body).toMatchObject({ accepted: 2, duplicate: false });
    expect((await post(ev).expect(202)).body).toMatchObject({ duplicate: true });
    const v = (await app.http().get('/api/vehicles/lead-01/installs').expect(200)).body;
    expect(v.view).toMatchObject({ step: 3, branch: { kind: 'FAILED', text: '실패 — 통신 오류' } });
    const all = (await app.http().get('/api/ota/installs').expect(200)).body;
    expect(all.failures.LINK).toBeGreaterThanOrEqual(1);
    expect(all.failures).toHaveProperty('POWER');
    expect(all.failures).toHaveProperty('VERIFY');
  });

  it('TC16 시뮬 차량 — 배터리 부족·정지 유지 상실이면 설치 보류(INSTALL_DEFERRED{reason})', async () => {
    const r = (await app.http().post('/api/ota/installs/simulate').set(OPS).send({ vin: 'ego-01', socPct: 12, parkHold: true, ddtActive: false, outcome: 'OK', reason: 'TC16' }).expect(201)).body;
    expect(r.records.map((x: { stage: string; deferredReason: string }) => `${x.stage}:${x.deferredReason}`)).toEqual(['DEFERRED:POWER']);
    expect((await app.http().get('/api/vehicles/ego-01/installs').expect(200)).body.view.branch.text).toBe('설치 보류 — 전원 부족(차량 보고)');
    const h = (await app.http().post('/api/ota/installs/simulate').set(OPS).send({ vin: 'ego-01', socPct: 80, parkHold: false, ddtActive: false, outcome: 'OK', reason: 'TC16 정지 유지' }).expect(201)).body;
    expect(h.records[0]).toMatchObject({ stage: 'DEFERRED', deferredReason: 'HOLD' });
  });

  it('TC18 이전 이미지 손상 — 정지 유지 진입과 안전 상태 도달 증거, 재시작해도 같은 상태', async () => {
    await app.http().post('/api/ota/installs/simulate').set(OPS).send({ vin: 'lead-01', socPct: 80, parkHold: true, ddtActive: false, outcome: 'VERIFY_FAIL_PREVIOUS_CORRUPT', reason: 'TC18' }).expect(201);
    const v = (await app.http().get('/api/vehicles/lead-01/installs').expect(200)).body;
    expect(v.view.branch).toMatchObject({ kind: 'SAFE_STATE_HELD' });
    expect(v.view.safeState).toMatchObject({ basis: '이전 이미지 손상 — 복구 불가, 정지 유지' });
    expect(v.view.safeState.reachedAt).toBeTruthy();
    expect(v.axis).toBe('RECOVERY_NEEDED');
    await app.app.close();
    app = await bootApp({ at: AT });
    // 메모리 DB라 재시작하면 시드만 남는다 — 시드의 정지 유지 차량(KMH-NX4-0001)이 같은 상태로 보인다
    const s = (await app.http().get('/api/vehicles/KMH-NX4-0001/installs').expect(200)).body;
    expect(s.view.branch.kind).toBe('SAFE_STATE_HELD');
    expect(s.view.safeState.basis).toBeTruthy();
  });

  it('다운로드됨은 호환·설치 확인으로 세지 않고, 설치됨 보고는 차량 형상이 매니페스트와 맞을 때만 설치 확인됨', async () => {
    const all = (await app.http().get('/api/ota/installs').expect(200)).body;
    const gn7 = all.items.find((x: { vin: string }) => x.vin === 'KMH-GN7-0001');
    expect(gn7).toMatchObject({ stage: 'INSTALLED', confirmed: true, axis: 'COMPATIBLE' });
    const nx2 = all.items.find((x: { vin: string }) => x.vin === 'KMH-NX4-0002');
    expect(nx2.axis).toBe('NOT_INSTALLED');
    expect(all.summary.confirmed).toBe(all.items.filter((x: { confirmed: boolean }) => x.confirmed).length);
  });

  it('복구 뒤 승인 조합 밖이면 활성 적격 조건 부족(사유: 승인 조합 밖, 복구 뒤 재검증)', async () => {
    const v = (await app.http().get('/api/vehicles/KMH-NX4-0002/installs').expect(200)).body;
    await app.http().post('/api/ota/installs/simulate').set(OPS).send({ vin: 'KMH-NX4-0002', socPct: 80, parkHold: true, ddtActive: false, outcome: 'VERIFY_FAIL', reason: '복구 시험' }).expect(201);
    const after = (await app.http().get('/api/vehicles/KMH-NX4-0002/installs').expect(200)).body;
    expect(v.vin).toBe('KMH-NX4-0002');
    expect(after.reactivation).toMatchObject({ eligible: false, reason: '조건 부족 — 승인 조합 밖(복구 뒤 재검증)' });
  });

  it('운행 제한 예약 — 고객 문구는 예상 소요만, 사용 가능 시각을 만들지 않는다', async () => {
    const v = (await app.http().get('/api/vehicles/KMH-NX4-0004/installs').expect(200)).body;
    expect(v.view.restriction).toBeNull();
    const ego = (await app.http().get('/api/vehicles/ego-01/installs').expect(200)).body;
    expect(ego.view.customerNotice).toBe('설치 중 운행 제한 약 25분(예상)');
    expect(JSON.stringify(ego)).not.toMatch(/사용 가능 시각|운행 가능/);
  });

  it('설치 기록이 있는 차량은 지원 판정이 설치 기록 연동으로 본다, 없는 차량은 그대로 연동 전', async () => {
    expect((await app.http().get('/api/vehicles/KMH-NX4-0004/eligibility?catalogId=CAT-00019').expect(200)).body.otaLinked).toBe(false);
    expect((await app.http().get('/api/vehicles/KMH-NX4-0002/eligibility?catalogId=CAT-00019').expect(200)).body.otaLinked).toBe(true);
  });
});
