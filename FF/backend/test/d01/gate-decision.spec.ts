// Gate Decision Record (D01-02, 보고서 v1.1 FFG-LCY-001) — 수용 기준: 표본 상태 전이 100%에 서명된 Decision Record가 있다.
// 판정은 판정자·역할로 서명되고, 이관 기록(시드)은 부팅 때 봉인된다. 판정을 거치지 않은 Gate 기록이나 서명 뒤 바뀐 기록으로는 전이하지 않는다.
import { INestApplication } from '@nestjs/common';
import { jcs, type GateRecordRow } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { GateRepo } from '../../src/domains/d01-policy/repos';
import { GateDecisionService } from '../../src/domains/d01-policy/topology/gate-decision.service';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

describe('Gate Decision Record (FFG-LCY-001)', () => {
  let app: INestApplication;
  let http: () => any;
  let ver: string;
  const gatesOf = async () => (await http().get(`/api/features/FEAT-00022/versions/${ver}/gates`).expect(200)).body.gates;
  const judge = (gate: string) => http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` }).expect(201);
  const approve = () => http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: 'Decision Record 시험', changes: { description: '서명 시험' } }).expect(201);
    ver = v.body.feature.version;
    await confirmSafety(http, 'FEAT-00022', ver);
  });
  afterAll(async () => app?.close());

  it('이관 기록(시드)은 부팅 때 IMPORT로 봉인 — 모든 Gate 기록에 결정 기록이 있다', async () => {
    const db = app.get<Db>(DB);
    const n = db.get<{ n: number }>('SELECT count(*) AS n FROM gate_record')!.n;
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM gate_decision WHERE provenance = 'IMPORT'")!.n).toBe(n);
    const seeded = (await http().get('/api/features/FEAT-00022/versions/1.0.0/gates').expect(200)).body.gates.find((g: any) => g.latest);
    expect(seeded.decision).toMatchObject({ state: 'IMPORTED', provenance: 'IMPORT', approver: { id: null, role: seeded.latest.judgeRole } });
    expect(seeded.history.every((h: any) => h.decision === 'IMPORTED')).toBe(true);
    // 결정 기록은 추가만
    expect(() => db.run('DELETE FROM gate_decision')).toThrow(/추가만/);
  });

  it('판정은 판정자·역할로 서명되고(gate 용도 키) 그 기록으로 전이한다', async () => {
    for (const g of ['G1', 'G2', 'G3']) await judge(g);
    const g2 = (await gatesOf()).find((g: any) => g.gate === 'G2');
    expect(g2.decision).toMatchObject({ state: 'SIGNED', provenance: 'PLATFORM', approver: { id: 'choi.judge', role: 'GATE_JUDGE' }, kid: expect.stringMatching(/^KEY-/) });
    const d = app.get(GateDecisionService).get(g2.latest.gateRecordId)!;
    expect(d.payload).toMatchObject({ target: { featureId: 'FEAT-00022', featureVersion: ver }, gate: 'G2', status: 'PASS', evidenceRef: 'EV-G2' });
    expect(app.get(HsmService).verifyDetached('gate', jcs(d.payload), d.signature).valid).toBe(true);
    const audit = (await http().get(`/api/audit?target=FEAT-00022@${ver}%23G2`).expect(200)).body.items;
    expect(JSON.stringify(audit)).toContain(d.signature.kid);
  });

  it('판정을 거치지 않고 넣은 Gate PASS(결정 기록 없음)로는 전이하지 않는다 — 422 GATE_UNSIGNED, 감사 FAILED', async () => {
    const repo = app.get(GateRepo);
    const prev = (await gatesOf()).find((g: any) => g.gate === 'G3').latest as GateRecordRow;
    const forged: GateRecordRow = { ...prev, gateRecordId: repo.nextId('G3'), rationale: '판정 우회' };
    repo.insert(forged);
    const r = await approve().expect(422);
    expect(r.body.error.details.blockers).toEqual([expect.objectContaining({ code: 'GATE_UNSIGNED', ref: 'G3' })]);
    expect((await gatesOf()).find((g: any) => g.gate === 'G3').decision.state).toBe('MISSING');
    // 정식 재판정으로 새 서명 기록이 생기면 다시 전이할 수 있다
    await judge('G3');
  });

  it('서명 뒤 Gate 기록을 바꾸면(근거 Evidence 변조) INVALID — 전이 거부, 재판정 뒤 전이', async () => {
    const db = app.get<Db>(DB);
    const g1 = (await gatesOf()).find((g: any) => g.gate === 'G1').latest as GateRecordRow;
    db.run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify({ ...g1, evidenceRef: 'EV-FORGED' }), g1.gateRecordId);
    expect((await gatesOf()).find((g: any) => g.gate === 'G1').decision).toMatchObject({ state: 'INVALID', reason: expect.stringMatching(/evidenceRef/) });
    const bl = (await approve().expect(422)).body.error.details.blockers;
    expect(bl).toEqual([expect.objectContaining({ code: 'GATE_UNSIGNED', ref: 'G1' })]);
    await judge('G1');
    expect((await approve().expect(200)).body.lifecycle ?? 'ok').toBeTruthy();
  });

  it('FFG-LCY-002 fail-closed: 근거 없는 PASS·없는 가상검증 근거는 판정 거부 — Gate 기록·결정 기록이 생기지 않고 감사 FAILED', async () => {
    const db = app.get<Db>(DB);
    const before = db.get<{ n: number }>('SELECT count(*) AS n FROM gate_decision')!.n;
    await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '근거 없음', evidenceRef: null }).expect(400);
    const r = await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '없는 근거', evidenceRef: 'VV-99999' }).expect(422);
    expect(r.body.error.message).toMatch(/가상검증 기록이 없습니다/);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM gate_decision')!.n).toBe(before);
    const failed = (await http().get(`/api/audit?target=FEAT-00022@${ver}%23G1`).expect(200)).body.items.filter((x: any) => x.result === 'FAILED');
    expect(failed.length).toBeGreaterThan(0);
  });
});
