// Release Sign-off(출시 책임 확인, D01-01) — 보고서 6.1 G7(출시·활성화) 승인자 중 Feature Owner의 승인 수단(사용자 결정 2026-10-18).
// Safety Manager·판정자가 G8·G9를 PASS로 판정한 뒤, Feature Owner(FEATURE_AUTHOR)가 개인 서명으로 출시 책임을 확인해야 출시(VERIFIED→RELEASED)할 수 있다.
// 서명은 그 시점의 G8·G9 판정 기록에 묶인다 — 다시 판정되면 이전 서명은 효력이 없다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');

describe('Release Sign-off (보고서 6.1 G7 — Feature Owner 승인)', () => {
  let app: INestApplication;
  let http: () => any;
  const base = (ver: string) => `/api/features/FEAT-00001/versions/${ver}`;
  const judge = (ver: string, gate: string) =>
    http().post(`${base(ver)}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
  const sign = (ver: string, who = AUTHOR) => http().post(`${base(ver)}/release-signoff`).set(who).send({ reason: '출시 책임 확인 — SOTIF 출시 근거·Canary 기준 검토' });
  const release = (ver: string) => http().post(`${base(ver)}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-18T01:00:00.000Z' }));
    for (const v of ['2.1.0', '2.2.0']) await confirmSafety(http, 'FEAT-00001', v);
  });
  afterAll(async () => app?.close());

  it('G8·G9 PASS 전에는 서명할 수 없다 (422)', async () => {
    const r = await sign('2.1.0').expect(422);
    expect(r.body.error.message).toMatch(/G8|G9/);
  });

  it('서명 없이 출시하면 RELEASE_SIGNOFF_MISSING으로 막히고 실패가 감사에 남는다', async () => {
    await judge('2.1.0', 'G8');
    await judge('2.1.0', 'G9');
    const r = await release('2.1.0').expect(422);
    expect(r.body.error.details.blockers).toContainEqual(expect.objectContaining({ code: 'RELEASE_SIGNOFF_MISSING' }));
  });

  it('Feature Owner(FEATURE_AUTHOR)만 서명한다 — 판정자는 403', async () => {
    await sign('2.1.0', JUDGE).expect(403);
  });

  it('Feature Owner가 개인 서명하면 출시할 수 있다 — 서명은 소유 조직과 G8·G9 판정 기록에 묶인다', async () => {
    const s = (await sign('2.1.0').expect(201)).body;
    expect(s.signoff).toMatchObject({ signedBy: 'usr-author', signedRole: 'FEATURE_AUTHOR', ownerId: 'Parking기획팀' });
    expect(s.signoff.sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(s.signoff.gateRecords.G8).toMatch(/^SIM-G8-\d{6}$/);
    expect(s).toMatchObject({ valid: true, stale: false });
    await sign('2.1.0').expect(409); // 같은 판정에 두 번 서명하지 않는다
    expect((await http().get(`${base('2.1.0')}/release-signoff`).expect(200)).body.valid).toBe(true);
    const r = await release('2.1.0').expect(200);
    expect(r.body.feature?.lifecycle ?? r.body.lifecycle).toBe('RELEASED');
  });

  it('서명 뒤 G9를 다시 판정하면 이전 서명은 효력이 없다 — 다시 서명해야 출시', async () => {
    await judge('2.2.0', 'G8');
    await judge('2.2.0', 'G9');
    await sign('2.2.0').expect(201);
    await judge('2.2.0', 'G9');
    const v = (await http().get(`${base('2.2.0')}/release-signoff`).expect(200)).body;
    expect(v).toMatchObject({ valid: false, stale: true });
    const r = await release('2.2.0').expect(422);
    expect(r.body.error.details.blockers).toContainEqual(expect.objectContaining({ code: 'RELEASE_SIGNOFF_MISSING' }));
    await sign('2.2.0').expect(201);
    await release('2.2.0').expect(200);
  });
});

// 사용자 결정(2026-11-04, 하네스 리뷰 ② #9) — 승인 뒤 기준 행이 폐기 예정·폐기여도 출시·서명은 막지 않고 경고(대체 행)와 감사 기록
describe('Release Sign-off·출시 — 연결된 기준 행이 폐기 예정·폐기면 경고만', () => {
  let app: INestApplication;
  let http: () => any;
  let repo: RefdbRepository;
  const base = (ver: string) => `/api/features/FEAT-00001/versions/${ver}`;
  const judge = (ver: string, gate: string) =>
    http().post(`${base(ver)}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
  const sign = (ver: string) => http().post(`${base(ver)}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인 — 기준 행 상태 확인' });
  const release = (ver: string) => http().post(`${base(ver)}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' });
  const auditOf = async (target: string, action: string) => (await http().get(`/api/audit?target=${encodeURIComponent(target)}`).expect(200)).body.items.find((a: any) => a.action === action);
  const AT = '2026-10-18T01:00:00.000Z';

  beforeAll(async () => {
    const b = await bootApp({ at: AT });
    ({ app, http } = b);
    repo = b.get(RefdbRepository);
    for (const v of ['2.1.0', '2.2.0']) await confirmSafety(http, 'FEAT-00001', v);
  });
  afterAll(async () => app?.close());

  it('폐기 예정(DEPRECATED) 행 — 서명·출시 응답 warnings에 대체 행, 감사 after.refWarnings', async () => {
    // FEAT-00001은 시드 대응표로 AD-PRK-007(대표)에 연결돼 있다
    expect((await http().get(base('2.1.0')).expect(200)).body.feature.featureRefs[0].refId).toBe('AD-PRK-007');
    repo.updateRef({ ...repo.getRef('AD-PRK-007')!, status: 'DEPRECATED', replacedBy: 'AD-PRK-001' }, AT);
    await judge('2.1.0', 'G8');
    await judge('2.1.0', 'G9');
    const s = (await sign('2.1.0').expect(201)).body;
    expect(s).toMatchObject({ valid: true, warnings: [expect.objectContaining({ code: 'REF_STATUS', refId: 'AD-PRK-007', status: 'DEPRECATED', replacedBy: 'AD-PRK-001' })] });
    expect((await auditOf('FEAT-00001@2.1.0#release-signoff', 'RELEASE_SIGNOFF')).after.refWarnings).toEqual([expect.objectContaining({ refId: 'AD-PRK-007', replacedBy: 'AD-PRK-001' })]);
    const r = (await release('2.1.0').expect(200)).body;
    expect(r.lifecycle).toBe('RELEASED');
    expect(r.warnings).toEqual([expect.objectContaining({ refId: 'AD-PRK-007', status: 'DEPRECATED', replacedBy: 'AD-PRK-001', message: expect.stringContaining('AD-PRK-001') })]);
    expect((await auditOf('FEAT-00001@2.1.0', 'FEATURE_TRANSITION VERIFIED→RELEASED')).after.refWarnings).toEqual([expect.objectContaining({ refId: 'AD-PRK-007' })]);
  });

  it('폐기(RETIRED) 행도 출시를 막지 않는다 — 경고만', async () => {
    repo.updateRef({ ...repo.getRef('AD-PRK-007')!, status: 'RETIRED' }, AT);
    await judge('2.2.0', 'G8');
    await judge('2.2.0', 'G9');
    expect((await sign('2.2.0').expect(201)).body.warnings).toEqual([expect.objectContaining({ refId: 'AD-PRK-007', status: 'RETIRED' })]);
    const r = (await release('2.2.0').expect(200)).body;
    expect(r).toMatchObject({ lifecycle: 'RELEASED', warnings: [expect.objectContaining({ refId: 'AD-PRK-007', status: 'RETIRED' })] });
  });
});
