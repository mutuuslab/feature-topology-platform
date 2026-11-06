// 외부 연계 업무 절차(FPW.3-A06 연계 동기화·충돌 해결, FPW.4-A06 정책 근거 CR 연결)가 기존 흐름에 끼어 들어도
// 막다른 길이 되지 않는다 — 앞 활동이 끝나면 그 역할 계정이 완료할 수 있고, 완료하면 G3 판정·정책 승인 활동이 준비된다.
// 업무 절차 완료는 플랫폼 동작(G3 판정·Feature 정의 승인·정책 승인)의 조건이 아니다 — 절차 없이 하는 승인은 e2e policy·lifecycle 시험이 본다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { predecessorsOf } from '@ff/contracts';
import { WORKFLOW_INDEX } from '../../src/generated/workflow-index';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const INTEGRATOR = actor('usr-integrator', 'IMPLEMENTER');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const PREDS = predecessorsOf(WORKFLOW_INDEX);

describe('외부 연계 업무 절차 — 기존 흐름을 막지 않는다', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  const complete = (id: string, who: Record<string, string>) => http().post(`/api/procedures/activities/${id}/complete`).set(who).send({ note: '확인' });
  const inbox = (who: Record<string, string>) => http().get('/api/procedures/inbox').set(who);
  /** 앞 활동은 시험 준비로 완료 기록만 넣는다(다른 역할 계정 흐름은 procedure.spec이 본다) */
  const seedDone = (ids: string[]) => {
    for (const id of ids) {
      const a = WORKFLOW_INDEX.activities.find((x) => x.id === id)!;
      db.run(
        'INSERT INTO procedure_completion (activity_id, process_id, role_id, completed_by, completed_role, completed_at, note, evidence_doc, signature_doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, a.processId, a.raci.R[0], 'usr-seed', 'SYSTEM', '2026-11-06T00:00:00.000Z', null, '[]', null,
      );
    }
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-11-06T01:00:00.000Z' }));
    db = app.get(DB);
  });
  afterAll(async () => app?.close());

  it.each([
    ['FPW.3-A06', 'FPW.3-A04', INTEGRATOR, 'R-INT'],
    ['FPW.4-A06', 'FPW.4-A04', AUTHOR, 'R-FO'],
  ] as const)('%s — 앞 활동이 끝나면 담당 계정 할 일로 오고, 완료하면 %s가 준비된다', async (added, gate, who, role) => {
    expect(PREDS.get(gate)).toContain(added);
    // 새 활동 말고 G3 판정·정책 승인 활동의 다른 앞 활동과 새 활동의 앞 활동은 끝났다
    seedDone([...new Set([...(PREDS.get(added) ?? []), ...(PREDS.get(gate) ?? []).filter((x) => x !== added)])]);
    // G3 판정·정책 승인 활동 담당은 새 활동이 끝나기 전에는 완료할 수 없다(앞 활동 미완료)
    const g = WORKFLOW_INDEX.activities.find((a) => a.id === gate)!;
    const persona = Object.entries(WORKFLOW_INDEX.personas).find(([, roles]) => roles.includes(g.raci.R[0]))![0];
    const judge = actor(`usr-${persona}`, WORKFLOW_INDEX.roles.find((r) => r.id === g.raci.R[0])!.platformRoles[0]);
    const blocked = await complete(gate, judge).expect(422);
    expect(blocked.body.error.details.blockers.join(' ')).toContain(added);
    const mine = (await inbox(who).expect(200)).body;
    expect(mine.items).toContainEqual(expect.objectContaining({ activityId: added, kind: 'TODO', roleId: role }));
    await complete(added, who).expect(201);
    await complete(gate, judge).expect(201);
  });
});
