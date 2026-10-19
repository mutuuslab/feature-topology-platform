// 업무 절차 실행(C3) — 활동 완료 서버 저장·Evidence·개인 서명·감사·인계 알림·SLA 초과.
// 준비 조건(앞 활동 완료)과 역할(R·A) 검사를 실제 모델(FPW.1)로 확인한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { ProcedureService } from '../../src/workflows/procedure.service';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const STEWARD = actor('usr-steward', 'BOM_APPROVER');
const OPERATOR = actor('usr-operator', 'OPERATOR');
const A01 = 'FPW.1-A01';
const A02 = 'FPW.1-A02';

describe('업무 절차 활동 완료 (서버 저장·검토함)', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let clock: Clock;
  const state = () => http().get('/api/procedures/state');
  const inbox = (who: Record<string, string>) => http().get('/api/procedures/inbox').set(who);
  const complete = (id: string, who: Record<string, string>, body: Record<string, unknown> = {}) => http().post(`/api/procedures/activities/${id}/complete`).set(who).send(body);
  const undo = (id: string, who: Record<string, string>) => http().delete(`/api/procedures/activities/${id}/complete`).set(who);

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-19T00:00:00.000Z' }));
    db = app.get(DB);
    clock = app.get(Clock);
  });
  afterAll(async () => app?.close());

  it('처음에는 완료가 없고 Feature Owner의 할 일에 FPW.1-A01이 보인다', async () => {
    expect((await state().expect(200)).body).toMatchObject({ items: [], done: [], updatedAt: null });
    const r = (await inbox(AUTHOR).expect(200)).body;
    expect(r.roleIds).toEqual(['R-FO']);
    expect(r.items).toContainEqual(expect.objectContaining({ activityId: A01, kind: 'TODO', processId: 'FPW.1' }));
    expect(r.summary).toMatchObject({ todo: expect.any(Number), review: expect.any(Number), done: 0 });
    // 메인 화면 절차 지도 — 13개 프로세스의 완료/내 차례 수
    expect(r.summary.processes).toHaveLength(13);
    expect(r.summary.processes.find((p: any) => p.id === 'FPW.1')).toMatchObject({ total: 5, done: 0, todo: 1 });
  });

  it('앞 활동이 끝나기 전에는 다음 활동을 완료할 수 없다 (422 GUARD_FAILED)', async () => {
    const r = await complete(A02, STEWARD).expect(422);
    expect(r.body.error.code).toBe('GUARD_FAILED');
    expect(r.body.error.details.blockers.join(' ')).toContain(A01);
    expect((await http().get(`/api/audit?target=${A02}&result=FAILED`).expect(200)).body.items.length).toBeGreaterThan(0);
  });

  it('내 역할(R·A)이 아니면 403이고 감사에 DENIED로 남는다', async () => {
    const r = await complete(A01, OPERATOR).expect(403);
    expect(r.body.error.message).toMatch(/내 역할/);
    expect((await http().get(`/api/audit?target=${A01}&result=DENIED`).expect(200)).body.items.length).toBeGreaterThan(0);
  });

  it('Evidence·개인 서명과 함께 완료하면 상태·감사·이벤트·다음 역할 알림이 남는다', async () => {
    const r = await complete(A01, AUTHOR, {
      note: '등록 초안과 Flag 유형 확인',
      evidence: [{ kind: 'LINK', name: 'Feature Registry', ref: '/features/FEAT-00001/1.0.0' }],
      sign: true,
    }).expect(201);
    expect(r.body.completion).toMatchObject({ activityId: A01, processId: 'FPW.1', roleId: 'R-FO', completedBy: 'usr-author', note: '등록 초안과 Flag 유형 확인' });
    expect(r.body.completion.evidence).toHaveLength(1);
    expect(r.body.completion.signature.value).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(r.body.completion.signature.digest).toMatch(/^[0-9a-f]{64}$/);

    const s = (await state().expect(200)).body;
    expect(s.done).toEqual([A01]);
    expect(s.items[0].signatureValid).toBe(true);

    const audit = (await http().get(`/api/audit?target=${A01}`).expect(200)).body.items;
    expect(audit[0]).toMatchObject({ action: 'PROCEDURE_ACTIVITY_COMPLETE', result: 'ALLOWED' });

    const ev = (await http().get('/api/events?type=procedure.activity.completed').expect(200)).body.items;
    expect(ev.at(-1).payload.next.map((n: { id: string }) => n.id)).toEqual([A02, 'FPW.1-A03']);

    // A02의 수행(R-PLM=VARIANT_OWNER·BOM_APPROVER)과 책임(R-FO=FEATURE_AUTHOR)에게 인계 알림
    const ntf = (await http().get('/api/notifications').set(STEWARD).expect(200)).body;
    expect(ntf.items.some((n: any) => n.category === 'PROCEDURE' && n.link.includes(`a=${A02}`))).toBe(true);
  });

  it('같은 활동을 두 번 완료할 수 없다 (409)', async () => {
    await complete(A01, AUTHOR, {}).expect(409);
  });

  it('완료 뒤 검토함은 준비된 다음 활동을 수행/검토로 나눈다', async () => {
    const steward = (await inbox(STEWARD).expect(200)).body;
    expect(steward.items).toContainEqual(expect.objectContaining({ activityId: A02, kind: 'TODO', roleId: 'R-PLM', roleName: '기준정보 담당' }));
    const author = (await inbox(AUTHOR).expect(200)).body;
    expect(author.items).toContainEqual(expect.objectContaining({ activityId: A02, kind: 'REVIEW', roleId: 'R-FO' }));
    expect(author.summary).toMatchObject({ done: 1 });
    expect(author.summary.processes.find((p: any) => p.id === 'FPW.1')).toMatchObject({ total: 5, done: 1, review: 1 });
  });

  it('SLA 기한이 지나면 한 번만 알리고 기한 초과로 표시한다', async () => {
    clock.set('2026-10-20T01:00:00.000Z'); // A01 완료 + 25h > A02 sla 24h
    const service = app.get(ProcedureService);
    expect(service.sweep()).toBe(1);
    expect(service.sweep()).toBe(0);
    const steward = (await inbox(STEWARD).expect(200)).body;
    expect(steward.items.find((i: any) => i.activityId === A02)).toMatchObject({ overdue: true });
    expect(steward.summary.overdue).toBe(1);
    const ntf = (await http().get('/api/notifications').set(STEWARD).expect(200)).body;
    expect(ntf.items.some((n: any) => n.category === 'PROCEDURE' && n.severity === 'WARNING' && n.title.includes('기한 초과'))).toBe(true);
    expect((await http().get('/api/events?type=procedure.activity.overdue').expect(200)).body.items.length).toBe(1);
  });

  it('서명 대상 본문이 바뀌면 서명이 무효로 검증된다', async () => {
    db.run('UPDATE procedure_completion SET note = ? WHERE activity_id = ? AND undone_at IS NULL', '변조된 메모', A01);
    const s = (await state().expect(200)).body;
    expect(s.items.find((i: any) => i.activityId === A01).signatureValid).toBe(false);
  });

  it('완료를 취소하면 상태·검토함이 되돌아가고 감사·이벤트가 남는다', async () => {
    const s = (await undo(A01, AUTHOR).expect(200)).body;
    expect(s.done).toEqual([]);
    const audit = (await http().get(`/api/audit?target=${A01}`).expect(200)).body.items;
    expect(audit[0]).toMatchObject({ action: 'PROCEDURE_ACTIVITY_UNDO', result: 'ALLOWED' });
    expect((await http().get('/api/events?type=procedure.activity.reopened').expect(200)).body.items.length).toBe(1);
    const r = (await inbox(AUTHOR).expect(200)).body;
    expect(r.items).toContainEqual(expect.objectContaining({ activityId: A01, kind: 'TODO' }));
    expect(r.summary.done).toBe(0);
  });
});
