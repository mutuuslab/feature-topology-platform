// IAM 직무 분리·긴급 권한 사후 검토 (D06-09, 보고서 v1.1 · FFG-PLT-016) — 발행된 Kill마다 24시간 안 사후 독립 검토, 요청자·승인자는 검토 불가.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, KILL_APPROVERS, KILL_REQUESTER, killV2 } from '../helpers';

const CSM = actor('usr-csm', 'SECURITY_OFFICER');

describe('긴급 권한 사후 검토 (FFG-PLT-016)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  let killId: string;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
    killId = (await killV2(b.http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '사후 검토 시험', confirm: 'FEAT-00022' })).killId;
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const review = (who: Record<string, string>) => b.http().post(`/api/kill-requests/${killId}/post-review`).set(who).send({ summary: '발령 사유·범위·승인 적정 확인' });

  it('FFG-PLT-016 발행된 Kill은 24시간 사후 검토 대기 → 기한이 지나면 OVERDUE로 드러난다', async () => {
    const pending = (await b.http().get('/api/kill-post-reviews').expect(200)).body.items.find((x: any) => x.killId === killId);
    expect(pending).toMatchObject({ status: 'PENDING', requestedBy: 'usr-ops', approvers: ['usr-safety', 'usr-opslead'] });
    expect(Date.parse(pending.due) - Date.parse(pending.issuedAt)).toBe(24 * 3_600_000);
    const clock = b.get(Clock);
    clock.set(new Date(clock.now().getTime() + 25 * 3_600_000));
    expect((await b.http().get('/api/iam/sod-audit').expect(200)).body.postReviews).toMatchObject({ issued: 1, reviewed: 0, overdue: 1 });
  });

  it('FFG-PLT-016 요청자·승인자는 사후 검토 불가(감사 FAILED), 관여하지 않은 CSM이 한 번 기록 — 늦은 검토는 late로 남는다', async () => {
    await review({ ...KILL_REQUESTER, 'X-Actor-Role': 'SAFETY_OFFICER' }).expect(403);
    const r = await review(KILL_APPROVERS[0]).expect(403);
    expect(r.body.error).toMatchObject({ code: 'SEPARATION_OF_DUTY', details: { rule: 'FFG-PLT-016' } });
    const ok = (await review(CSM).expect(201)).body;
    expect(ok).toMatchObject({ status: 'REVIEWED', review: { reviewer: 'usr-csm', role: 'SECURITY_OFFICER', late: true } });
    await review(actor('usr-reg', 'REGULATORY_OWNER')).expect(409);
    expect((await b.http().get('/api/iam/sod-audit').expect(200)).body.postReviews).toMatchObject({ issued: 1, reviewed: 1, overdue: 0 });
    expect(() => b.get<Db>(DB).run('DELETE FROM kill_post_review')).toThrow(/추가만/);
  });

  it('FFG-PLT-016 직무 분리 감사는 데모 계정의 겸직을 발견으로 보인다', async () => {
    const a = (await b.http().get('/api/iam/sod-audit').expect(200)).body;
    expect(a.conflicts.map((c: any) => c.account)).toEqual(['approver', 'steward', 'coordinator']);
  });
});
