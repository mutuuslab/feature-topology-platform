// AC — 승인 조합 제안→승인(B14, 작성자 ≠ 승인자)·보안 최소 버전 표(C4, 사이버보안 담당 승인)·미분류 채운 뒤 출시 전이 거부 전체 적용(B10).
// 시드 data/fixtures/ads/config.json(조합·보안 최소 버전 표)·change.json(분류). 확정 결정 2026-11-07.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigSet, SecurityMinEntry, UnclassifiedView } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { AdsPublishGate } from '../../src/domains/d02-runtime/variant-conditions/ads-publish-gate';
import { adsTransitionBlockers } from '../../src/domains/d01-policy/registry/ads-release-guard';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
const VARIANT = actor('usr-variant', 'VARIANT_OWNER');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const SECURITY = actor('usr-csm', 'SECURITY_OFFICER');
const OPS = actor('usr-ops', 'OPERATOR');
const AUDITOR = actor('usr-auditor', 'AUDITOR');

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  await app.app.close();
});

const lastAudit = (action: string) => app.get<Db>(DB).get<{ result: string; reason: string; actor_id: string }>('SELECT result, reason, actor_id FROM audit WHERE action = ? ORDER BY id DESC LIMIT 1', action);
const setBody = (sw: { swId: string; version: string; ecuPno?: string }[], extra: object = {}) => ({
  featureId: 'FEAT-00022', featureVersion: '1.0.0',
  hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }],
  ecuSw: sw.map((s) => ({ ecuPno: s.ecuPno ?? '99211-NX400', swId: s.swId, version: s.version })),
  reason: '보정 개정 조합',
  ...extra,
});

describe('승인 조합 제안 → 승인 (B14)', () => {
  it('시드 — 승인 조합은 제안자와 다른 계정이 승인, 승인 대기 조합은 목록에만 있고 대조 요약·발행 후보에 넣지 않는다', async () => {
    const r = (await app.http().get('/api/config-sets').expect(200)).body;
    const by = Object.fromEntries(r.items.map((s: ConfigSet) => [s.setId, s]));
    expect(by['CFG-FEAT-00004-01']).toMatchObject({ status: 'APPROVED', proposedBy: 'usr-steward', approvedBy: 'usr-quality' });
    expect(by['CFG-FEAT-00022-01'].proposedBy).not.toBe(by['CFG-FEAT-00022-01'].approvedBy);
    expect(by['CFG-FEAT-00004-02']).toMatchObject({ status: 'PROPOSED', proposedBy: 'usr-steward', approvedBy: null });
    expect(r.pending).toBe(1);
    // 대조 요약은 승인 조합 기준 그대로(승인 대기 조합이 차량을 부합으로 바꾸지 않는다)
    expect(r.summary).toMatchObject({ outside: 3, partial: 1, unconfirmed: 1, match: 3, total: 7 });
    const gate = app.get(AdsPublishGate);
    expect(gate.sets('FEAT-00004', '4.1.0').map((s) => s.setId)).toEqual(['CFG-FEAT-00004-01']);
  });

  it('등록은 제안 — 제안자 본인은 기능안전 역할로도 승인할 수 없다(직무 분리·DENIED), 작성자 역할 403, 다른 담당자가 승인, 다시 승인 409', async () => {
    const created = (await app.http().post('/api/config-sets').set(VARIANT).send(setBody([{ swId: 'SW-CARE-SDIST-APP', version: '1.2.4' }], { oddProfileId: 'ODD-FEAT-00022-v1' })).expect(201)).body as ConfigSet;
    expect(created).toMatchObject({ status: 'PROPOSED', proposedBy: 'usr-variant', approvedBy: null });
    expect(app.get(AdsPublishGate).sets('FEAT-00022', '1.0.0').map((s) => s.setId)).not.toContain(created.setId);
    await app.http().post(`/api/config-sets/${created.setId}/approve`).set(AUTHOR).send({ reason: '승인' }).expect(403);
    const self = await app.http().post(`/api/config-sets/${created.setId}/approve`).set(actor('usr-variant', 'SAFETY_OFFICER')).send({ reason: '자기 조합 승인' }).expect(403);
    expect(self.body.error.code).toBe('SEPARATION_OF_DUTY');
    expect(lastAudit('CONFIG_SET_APPROVE')).toMatchObject({ result: 'DENIED', actor_id: 'usr-variant' });
    const ok = (await app.http().post(`/api/config-sets/${created.setId}/approve`).set(SAFETY).send({ reason: '형상 확인 — 독립 승인' }).expect(201)).body as ConfigSet;
    expect(ok).toMatchObject({ status: 'APPROVED', approvedBy: 'usr-safety', proposedBy: 'usr-variant', approvalReason: '형상 확인 — 독립 승인' });
    expect(app.get(AdsPublishGate).sets('FEAT-00022', '1.0.0').map((s) => s.setId)).toContain(created.setId);
    await app.http().post(`/api/config-sets/${created.setId}/approve`).set(actor('usr-safety2', 'SAFETY_OFFICER')).send({ reason: '다시' }).expect(409);
    // 승인 기록은 추가만
    expect(() => app.get<Db>(DB).run('DELETE FROM ads_config_set_approval WHERE set_id = ?', created.setId)).toThrow(/추가만/);
  });

  it('승인 대기 조합은 복구 결정의 기준이 될 수 없다', async () => {
    const r = await app.http().post('/api/config-sets/recovery-decisions').set(SAFETY).send({ vin: 'ego-01', path: 'SAFE_STATE', rationale: '안전 상태 유지', configSetRef: 'CFG-FEAT-00004-02', candidatePublicationId: null }).expect(422);
    expect(r.body.error.message).toContain('승인 전');
  });
});

describe('보안 최소 버전 표 (C4)', () => {
  it('표 — SW별 지금 하한(승인 값만), 승인 대기 1건, 조합에 쓰인 SW는 모두 표에 있다', async () => {
    const t = (await app.http().get('/api/security-mins').expect(200)).body;
    expect(t.current).toContainEqual({ swId: 'SW-CAMERA-FW', version: '8.0.0' });
    expect(t.current).toContainEqual({ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' });
    expect(t.pending).toBe(1);
    expect(t.unregistered).toEqual([]);
    expect(t.items.find((e: SecurityMinEntry) => e.entryId === 'SMV-0007')).toMatchObject({ status: 'PROPOSED', swId: 'SW-CAMERA-FW', version: '8.1.0' });
  });

  it('조합 등록 — 표의 하한이 정본(본문으로 낮추거나 빼도 표 값), 표에 없는 SW는 등록 거부', async () => {
    const low = await app.http().post('/api/config-sets').set(VARIANT).send(setBody([{ swId: 'SW-CARE-SDIST-APP', version: '1.1.9' }], { securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.0.0' }] })).expect(422);
    expect(low.body.error.message).toBe('ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.');
    const none = await app.http().post('/api/config-sets').set(VARIANT).send(setBody([{ swId: 'SW-NEW-UNLISTED', version: '1.0.0' }])).expect(422);
    expect(none.body.error.details.blockers[0]).toMatchObject({ code: 'SECURITY_MIN_UNREGISTERED' });
    expect(none.body.error.message).toContain('SW-NEW-UNLISTED');
    const ok = (await app.http().post('/api/config-sets').set(VARIANT).send(setBody([{ swId: 'SW-CARE-SDIST-APP', version: '1.3.0' }], { securityMin: [] })).expect(201)).body as ConfigSet;
    expect(ok.securityMin).toEqual([{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }]);
  });

  it('제안 — 같거나 낮은 값 거부(올리기만), 앞자리 0 버전 400, 운영자 403', async () => {
    const same = await app.http().post('/api/security-mins').set(SECURITY).send({ swId: 'SW-CARE-SDIST-APP', version: '1.2.0', rationale: '같은 값' }).expect(422);
    expect(same.body.error.details.blockers[0].code).toBe('SECURITY_MIN_LOWERING');
    await app.http().post('/api/security-mins').set(SECURITY).send({ swId: 'SW-CARE-SDIST-APP', version: '1.1.0', rationale: '낮추기' }).expect(422);
    await app.http().post('/api/security-mins').set(SECURITY).send({ swId: 'SW-CARE-SDIST-APP', version: '01.3.0', rationale: '형식' }).expect(400);
    await app.http().post('/api/security-mins').set(OPS).send({ swId: 'SW-CARE-SDIST-APP', version: '1.3.0', rationale: '운영자' }).expect(403);
  });

  it('승인 — 사이버보안 담당만, 제안자 본인 거부(DENIED), 승인 뒤 하한이 오르고 그 아래 SW가 든 승인 대기 조합은 승인 거부', async () => {
    // 하한 오르기 전 제안 — 카메라 FW 8.0.5(지금 하한 8.0.0 이상)
    const pending = (await app.http().post('/api/config-sets').set(VARIANT).send(setBody([{ ecuPno: '95790-NX300', swId: 'SW-CAMERA-FW', version: '8.0.5' }])).expect(201)).body as ConfigSet;
    await app.http().post('/api/security-mins/SMV-0007/approve').set(SAFETY).send({ reason: '승인' }).expect(403);
    const self = await app.http().post('/api/security-mins/SMV-0007/approve').set(actor('usr-steward', 'SECURITY_OFFICER')).send({ reason: '자기 제안 승인' }).expect(403);
    expect(self.body.error.code).toBe('SEPARATION_OF_DUTY');
    expect(lastAudit('SECURITY_MIN_APPROVE')).toMatchObject({ result: 'DENIED' });
    const ok = (await app.http().post('/api/security-mins/SMV-0007/approve').set(SECURITY).send({ reason: '취약점 대응 확인' }).expect(201)).body as SecurityMinEntry;
    expect(ok).toMatchObject({ status: 'APPROVED', approvedBy: 'usr-csm' });
    expect((await app.http().get('/api/security-mins').expect(200)).body.current).toContainEqual({ swId: 'SW-CAMERA-FW', version: '8.1.0' });
    await app.http().post('/api/security-mins/SMV-0007/approve').set(actor('usr-csm2', 'SECURITY_OFFICER')).send({ reason: '다시' }).expect(409);
    // 승인 시점 표로 다시 검사 — 8.0.5 < 8.1.0
    const r = await app.http().post(`/api/config-sets/${pending.setId}/approve`).set(SAFETY).send({ reason: '승인' }).expect(422);
    expect(r.body.error.details.blockers[0].code).toBe('SECURITY_MIN_VIOLATION');
    // 제안 → 다른 담당 승인 흐름
    const p = (await app.http().post('/api/security-mins').set(VARIANT).send({ swId: 'SW-CARE-SCC-ADP', version: '2.4.0', rationale: '서명 검증 보강' }).expect(201)).body as SecurityMinEntry;
    expect(p).toMatchObject({ status: 'PROPOSED', proposedBy: 'usr-variant' });
    expect(() => app.get<Db>(DB).run("UPDATE ads_security_min SET version = '0.0.1' WHERE entry_id = ?", p.entryId)).toThrow(/추가만/);
  });
});

describe('미분류 채운 뒤 출시 전이 거부 전체 적용 (B10)', () => {
  it('미분류 목록 — 분류 시드를 채워 확정 전 초안만 남고, 규칙은 켜져 있다', async () => {
    const u = (await app.http().get('/api/classification/unclassified').set(AUDITOR).expect(200)).body as UnclassifiedView;
    expect(u.ruleEnabled).toBe(true);
    expect(u.items.map((x) => x.featureId).sort()).toEqual(['FEAT-00010', 'FEAT-00012', 'FEAT-00015', 'FEAT-00019']);
    const v = (await app.http().get('/api/features/FEAT-00013/versions/0.3.0/classification').expect(200)).body;
    expect(v).toMatchObject({ ruleEnabled: true, completeness: { classified: true } });
  });

  it('분류 행이 없는 Version도 출시 전이는 CLS_UNREGISTERED로 거부, 중단·폐기 전이는 행이 없으면 막지 않는다', () => {
    const db = app.get<Db>(DB);
    const b = adsTransitionBlockers(db, { featureId: 'FEAT-00013', version: '9.9.9' }, 'RELEASED');
    expect(b).toEqual([expect.objectContaining({ code: 'CLS_UNREGISTERED', ref: 'FEAT-00013@9.9.9' })]);
    expect(adsTransitionBlockers(db, { featureId: 'FEAT-00013', version: '9.9.9' }, 'DEPRECATED')).toEqual([]);
    expect(adsTransitionBlockers(db, { featureId: 'FEAT-00001', version: '2.1.0' }, 'RELEASED')).toEqual([]);
  });
});
