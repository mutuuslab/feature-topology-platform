// AI 생성 코드 변경 기록 (D04-01·D01-02, 보고서 v1.1 · FFG-CODE-030) — 합격: AI 생성 표시가 있는 변경 100%에 검토·분석·시험 기록이 있다.
// CI/CD(IF-13)가 SW Version마다 변경 기록을 등록하고, 근거가 빠진 변경이 있는 SW Version을 쓰는 Feature는 G5 PASS가 판정되지 않는다(사람이 쓴 변경과 같은 기준).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, confirmSafety } from '../helpers';

const CI = actor('ci-bot', 'SYSTEM');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const base = { changeId: 'CHG-AI-0001', swId: 'SW-CARE-SDIST-APP', swVersion: '1.2.1', commit: 'a1b2c3d4', summary: '거리 추정 필터 수정' };
const AI = { tool: 'Claude Code', toolVersion: 'test-only-1.0', scope: 'src/filter/distance.c 함수 2개' };

describe('AI 생성 코드 변경 기록 (FFG-CODE-030)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  let ver: string;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
    const http = b.http;
    const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '거리 추정 필터 수정', changes: { description: 'AI 보조 수정' } }).expect(201);
    ver = v.body.feature.version;
    await confirmSafety(http, 'FEAT-00022', ver);
    for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
  });
  afterAll(async () => b.app.close());
  const g5 = () => b.http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G5', inputResult: 'PASS', rationale: '확인', evidenceRef: 'EV-G5' });

  it('FFG-CODE-030 AI 생성 변경에 시험 기록·커버리지가 없으면 감사 발견, 그 SW를 쓰는 Feature의 G5 PASS 불가(감사 FAILED)', async () => {
    const http = b.http;
    const r = (await http().post('/api/change-records').set(CI).send({ ...base, aiGenerated: AI, evidence: { review: 'PR-1201', staticAnalysis: 'MISRA-RUN-88', tests: null, coverage: null } }).expect(201)).body;
    expect(r).toMatchObject({ rev: 1, findings: ['시험 기록 없음', '커버리지 기록 없음'] });
    const audit = (await http().get('/api/change-records?swId=SW-CARE-SDIST-APP').expect(200)).body;
    expect(audit.summary).toMatchObject({ aiGenerated: 1, aiComplete: 0, withFindings: 1 });
    expect(audit.items[0]).toMatchObject({ aiGenerated: AI });
    const g = await g5().expect(422);
    expect(g.body.error).toMatchObject({ details: { rule: 'FFG-CODE-030' } });
    expect(g.body.error.message).toContain('CHG-AI-0001(AI Claude Code): 시험 기록 없음');
  });

  it('FFG-CODE-030 같은 변경 ID의 개정으로 근거를 보완하면 최신 개정으로 판정 — 커버리지 미달은 사람 변경과 같은 기준으로 막힌다', async () => {
    const http = b.http;
    await http().post('/api/change-records').set(CI).send({ ...base, aiGenerated: AI, evidence: { review: 'PR-1201', staticAnalysis: 'MISRA-RUN-88', tests: 'HIL-RUN-301', coverage: { achieved: 72, required: 80 } } }).expect(201);
    expect((await g5().expect(422)).body.error.message).toContain('커버리지 72% < 기준 80%');
    await http().post('/api/change-records').set(CI).send({ ...base, aiGenerated: AI, evidence: { review: 'PR-1201', staticAnalysis: 'MISRA-RUN-88', tests: 'HIL-RUN-302', coverage: { achieved: 86, required: 80 } } }).expect(201);
    expect((await http().get('/api/change-records?swId=SW-CARE-SDIST-APP').expect(200)).body.summary).toMatchObject({ aiGenerated: 1, aiComplete: 1, withFindings: 0 });
    // 근거가 갖춰지면 변경 기록은 더 이상 막지 않는다
    await g5().expect(201);
    // 다른 SW Version으로 옮기는 개정은 거부, 기록은 고칠 수 없다
    await http().post('/api/change-records').set(CI).send({ ...base, swVersion: '1.2.2', aiGenerated: AI, evidence: { review: 'x1', staticAnalysis: 'x2', tests: 'x3', coverage: { achieved: 90, required: 80 } } }).expect(409);
    expect(() => b.get<Db>(DB).run('DELETE FROM change_record')).toThrow(/추가만/);
    await http().post('/api/change-records').set(AUTHOR).send({ ...base, changeId: 'CHG-AI-0002', aiGenerated: null, evidence: { review: null, staticAnalysis: null, tests: null, coverage: null } }).expect(403);
  });
});
