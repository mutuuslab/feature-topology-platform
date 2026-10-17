// 안전 분류 Registry (보고서 v1.1 5장) — FFG-CLS-001·004·009, FFG-CODE-020, TC-FF-23
import { afterEach, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { SafetyProfileService } from '../../src/domains/d01-policy/registry/safety-profile.service';
import { actor, bootApp, confirmSafety } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => close?.());
async function boot() {
  const b = await bootApp({ at: '2026-10-13T00:00:00Z' });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB), svc: b.get(SafetyProfileService) };
}
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const JUDGE = actor('usr-judge', 'GATE_JUDGE');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');

async function newFeature(http: () => any, asil = 'B') {
  const r = await http()
    .post('/api/features')
    .set(AUTHOR)
    .send({ name: `분류 시험 ${Math.random().toString(36).slice(2, 7)}`, description: '안전 분류 시험용', requirementIds: ['REQ-T-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'QA팀', tags: ['adas'], asil, upgVc: ['F111A114001'], controlPoints: ['Flag'] })
    .expect(201);
  return r.body.featureId as string;
}
const judge = (http: () => any, id: string, gate: string) => http().post(`/api/features/${id}/versions/0.1.0/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` });

describe('시드 — 데이터셋 80개 초안, 보고서 예시(FEAT-00022)는 확정', () => {
  it('Feature Version마다 프로파일, FEAT-00022@1.0.0은 F3·DC2·R1(보고서 5.6·D.6)', async () => {
    const { http } = await boot();
    const all = (await http().get('/api/safety-profiles').expect(200)).body.items;
    expect(all.length).toBe(80);
    const f = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body;
    expect(f.profile).toMatchObject({ status: 'CONFIRMED', source: 'REPORT_EXAMPLE', fClass: 'F3', deactClass: 'DC2', regClass: 'R1', takeoverMs: 4000, rampMs: 3000 });
    expect(f.findings.filter((x: any) => x.severity === 'block')).toEqual([]);
  });
});

describe('Gate 전제 (FFG-CLS-001)', () => {
  it('새 Feature는 추정 초안이 생겨 G1은 통과, G2는 Safety Manager 확정 전 422 — 확정하면 통과', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    const p = (await http().get(`/api/features/${id}/versions/0.1.0/safety`).expect(200)).body.profile;
    expect(p).toMatchObject({ status: 'DRAFT', source: 'INFERRED', fClass: 'F2', deactClass: 'DC2' });
    await judge(http, id, 'G1').expect(201);
    const r = await judge(http, id, 'G2').expect(422);
    expect(r.body.error.message).toContain('Safety Manager 확정 전');
    await confirmSafety(http, id, '0.1.0');
    await judge(http, id, 'G2').expect(201);
  });

  it('조합 위반(F2에 DC0)이면 G1 PASS도 막힌다 — 판정 실패는 감사 FAILED', async () => {
    const { http, db } = await boot();
    const id = await newFeature(http);
    await http().put(`/api/features/${id}/versions/0.1.0/safety`).set(AUTHOR).send({ deactClass: 'DC0' }).expect(200);
    const r = await judge(http, id, 'G1').expect(422);
    expect(r.body.error.message).toContain('FFG-CLS-009');
    expect(db.get<any>("SELECT result FROM audit WHERE action = 'GATE_JUDGE G1' ORDER BY id DESC LIMIT 1").result).toBe('FAILED');
  });
});

describe('확정 (FFG-CLS-009 · TC-FF-23) · Version 고정 (FFG-CLS-004)', () => {
  it('위반 조합은 확정 거부(422, 규칙별 blockers)', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    await http().put(`/api/features/${id}/versions/0.1.0/safety`).set(AUTHOR).send({ takeoverMs: 0, faultRampMs: 0 }).expect(200);
    const r = await http().post(`/api/features/${id}/versions/0.1.0/safety/confirm`).set(SAFETY).send({ reason: '확정 시도' }).expect(422);
    expect(r.body.error.details.blockers.map((b: any) => `${b.code}:${b.ref}`)).toEqual(['FFG-CLS-009:takeoverMs', 'FFG-CLS-009:faultRampMs']);
  });

  it('확정은 Safety Manager만 — 개인 서명이 남고, 확정 뒤 수정은 409(새 Version)', async () => {
    const { http, svc } = await boot();
    const id = await newFeature(http);
    await http().post(`/api/features/${id}/versions/0.1.0/safety/confirm`).set(AUTHOR).send({ reason: '시도' }).expect(403);
    const c = (await http().post(`/api/features/${id}/versions/0.1.0/safety/confirm`).set(SAFETY).send({ reason: 'HARA 검토 완료' }).expect(201)).body.profile;
    expect(c).toMatchObject({ status: 'CONFIRMED', confirmedBy: 'usr-safety' });
    expect(c.confirmSig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(svc.verifyConfirmation(c)).toBe(true);
    expect(svc.verifyConfirmation({ ...c, takeoverMs: 1 })).toBe(false); // 서명 뒤 값 변조
    const r = await http().put(`/api/features/${id}/versions/0.1.0/safety`).set(AUTHOR).send({ rampMs: 1000 }).expect(409);
    expect(r.body.error.message).toContain('새 Version');
  });

  it('새 Version은 앞 Version 분류를 이어받되 초안(DRAFT)으로 — 다시 확정해야 한다', async () => {
    const { http } = await boot();
    const r = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', bump: 'minor', reason: '램프 시간 변경 검토', changes: { description: '전방 안전거리 — 램프 시간 조정' } }).expect(201);
    const ver = r.body.feature.version as string;
    const p = (await http().get(`/api/features/FEAT-00022/versions/${ver}/safety`).expect(200)).body.profile;
    expect(p).toMatchObject({ status: 'DRAFT', fClass: 'F3', deactClass: 'DC2', takeoverMs: 4000, confirmSig: null });
  });
});

describe('Flag ID 재사용 금지 (FFG-CODE-020)', () => {
  it('다른 Feature에 묶인 flagKey로 정책을 만들면 409', async () => {
    const { svc } = await boot();
    expect(svc.bindFlag('care_00022_param', 'FEAT-00099')).toContain('FFG-CODE-020');
    expect(svc.bindFlag('care_00022_param', 'FEAT-00022')).toBeNull();
    expect(svc.bindFlag('brand_new_flag', 'FEAT-00001')).toBeNull();
    expect(svc.bindFlag('brand_new_flag', 'FEAT-00002')).toContain('묶인 키');
  });
});

describe('ASIL 상속 (FFG-CLS-002)', () => {
  it('FEAT-00022(F3, Parameter)는 보정 데이터 Flag라 예외 불가 — 사용 SW ASIL B를 상속, 조건별 판정과 Evidence', async () => {
    const { http } = await boot();
    const v = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body;
    expect(v.asil).toMatchObject({ safetyRelated: true, inherits: 'B', exception: false, blocker: null });
    const by = Object.fromEntries(v.asil.conditions.map((c: any) => [c.id, c.met]));
    expect(by).toMatchObject({ NOT_CALIBRATION: false, CONFIG_SET_ONLY: false, GUARD_VERIFIES: true, TOOL_CONFIDENCE: true });
  });
});

describe('새 Version 안전 분류 초안의 기준 (회귀)', () => {
  it('FFG-CLS-004 새 Version은 기준 Version의 분류를 잇는다 — 사이에 등급을 낮춘 다른 갈래 Version이 있어도 그 값을 잇지 않는다(재확정 전 DRAFT)', async () => {
    const { http } = await boot();
    const mk = async (reason: string) => (await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason, changes: { description: reason } }).expect(201)).body.feature.version as string;
    const low = await mk('등급 낮춘 갈래');
    await http().put(`/api/features/FEAT-00022/versions/${low}/safety`).set(AUTHOR).send({ fClass: 'F2' }).expect(200);
    await confirmSafety(http, 'FEAT-00022', low);
    const next = await mk('1.0.0 기준 새 Version');
    const p = (await http().get(`/api/features/FEAT-00022/versions/${next}/safety`).expect(200)).body.profile;
    expect(p).toMatchObject({ fClass: 'F3', status: 'DRAFT' });
  });
});
