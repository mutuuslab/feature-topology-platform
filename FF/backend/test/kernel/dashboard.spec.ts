// 대시보드 저장 API — 소유자만 바꾸고 지운다, 역할 공유는 보기만, 겹친 저장은 412(If-Match), 재전송은 Idempotency-Key로 한 번만.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const VIEWER = actor('usr-viewer', 'AUDITOR');
const OTHER = actor('usr-approver', 'FEATURE_APPROVER');

const board = (ids: string[] = ['g1']) => ({
  v: 2,
  layout: '2L',
  columns: [ids, []],
  gadgets: Object.fromEntries(ids.map((id) => [id, { id, type: 'filter', config: { source: 'features', rows: 10 }, configured: true, refresh: 0, minimized: false }])),
});

describe('대시보드 API', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  const create = (name: string, who = AUTHOR, extra: Record<string, unknown> = {}) => http().post('/api/dashboards').set(who).send({ name, board: board(), ...extra });

  it('만들면 소유자는 요청자, 버전 1, ETag "1" — 목록에는 내 판만(남의 공유 안 된 판은 안 보인다)', async () => {
    const r = await create('릴리스 현황').expect(201);
    expect(r.body).toMatchObject({ name: '릴리스 현황', ownerId: 'usr-author', version: 1, mine: true, favourite: false, sharedRoles: [] });
    expect(r.headers.etag).toBe('"1"');
    const mine = await http().get('/api/dashboards').set(AUTHOR).expect(200);
    expect(mine.body.items.map((d: { id: string }) => d.id)).toContain(r.body.id);
    const other = await http().get('/api/dashboards').set(OTHER).expect(200);
    expect(other.body.items.map((d: { id: string }) => d.id)).not.toContain(r.body.id);
    await http().get(`/api/dashboards/${r.body.id}`).set(OTHER).expect(404);
  });

  it('판 모양이 맞지 않으면 400 — 레이아웃 열 수·놓이지 않은 가젯 설정·없는 가젯', async () => {
    await http().post('/api/dashboards').set(AUTHOR).send({ name: 'x', board: { ...board(), layout: '3' } }).expect(400);
    await http().post('/api/dashboards').set(AUTHOR).send({ name: 'x', board: { ...board(), columns: [[], []] } }).expect(400);
    await http().post('/api/dashboards').set(AUTHOR).send({ name: 'x', board: { ...board(), columns: [['g1', 'g2'], []] } }).expect(400);
    await http().post('/api/dashboards').set(AUTHOR).send({ name: ' ', board: board() }).expect(400);
  });

  it('역할 공유는 보기만 — 공유받은 사람은 목록·조회는 되고 바꾸기·지우기·공유 변경은 403', async () => {
    const d = (await create('품질 현황', AUTHOR, { sharedRoles: ['AUDITOR'] }).expect(201)).body;
    const seen = await http().get('/api/dashboards').set(VIEWER).expect(200);
    const row = seen.body.items.find((x: { id: string }) => x.id === d.id);
    expect(row).toMatchObject({ mine: false, ownerId: 'usr-author' });
    await http().get(`/api/dashboards/${d.id}`).set(VIEWER).expect(200);
    await http().put(`/api/dashboards/${d.id}`).set(VIEWER).set('If-Match', '"1"').send({ name: '가로채기' }).expect(403);
    await http().delete(`/api/dashboards/${d.id}`).set(VIEWER).set('If-Match', '"1"').send({}).expect(403);
    // 공유를 풀면 더는 보이지 않는다
    await http().put(`/api/dashboards/${d.id}`).set(AUTHOR).set('If-Match', '"1"').send({ sharedRoles: [] }).expect(200);
    await http().get(`/api/dashboards/${d.id}`).set(VIEWER).expect(404);
  });

  it('겹친 저장 — 본 버전이 지금 버전이 아니면 412, 버전 없이 바꾸면 412, 맞으면 버전이 오른다', async () => {
    const d = (await create('운영 판').expect(201)).body;
    const ok = await http().put(`/api/dashboards/${d.id}`).set(AUTHOR).set('If-Match', '"1"').send({ board: board(['g1', 'g2']) }).expect(200);
    expect(ok.body.version).toBe(2);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.body.board.columns[0]).toEqual(['g1', 'g2']);
    // 다른 탭이 버전 1을 보고 저장 — 덮어쓰지 않는다
    const stale = await http().put(`/api/dashboards/${d.id}`).set(AUTHOR).set('If-Match', '"1"').send({ name: '옛 화면' }).expect(412);
    expect(stale.body.error.code).toBe('PRECONDITION_FAILED');
    expect(stale.body.error.details.version).toBe(2);
    await http().put(`/api/dashboards/${d.id}`).set(AUTHOR).send({ name: '버전 없음' }).expect(412);
    // 본문 version도 받는다(머리글을 못 붙이는 호출자)
    await http().put(`/api/dashboards/${d.id}`).set(AUTHOR).send({ name: '본문 버전', version: 2 }).expect(200);
    await http().delete(`/api/dashboards/${d.id}`).set(AUTHOR).set('If-Match', 'W/"2"').send({}).expect(412);
    await http().delete(`/api/dashboards/${d.id}`).set(AUTHOR).set('If-Match', '"3"').send({}).expect(200);
    await http().get(`/api/dashboards/${d.id}`).set(AUTHOR).expect(404);
  });

  it('재전송 — 같은 Idempotency-Key·같은 본문은 하나만 만들고 처음 응답을 돌려준다, 다른 본문이면 422', async () => {
    const key = 'dash-create-once';
    const body = { name: '한 번만', board: board() };
    const a = await http().post('/api/dashboards').set(AUTHOR).set('Idempotency-Key', key).send(body).expect(201);
    const b = await http().post('/api/dashboards').set(AUTHOR).set('Idempotency-Key', key).send(body).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    const list = await http().get('/api/dashboards').set(AUTHOR).expect(200);
    expect(list.body.items.filter((d: { name: string }) => d.name === '한 번만')).toHaveLength(1);
    await http().post('/api/dashboards').set(AUTHOR).set('Idempotency-Key', key).send({ ...body, name: '다른 본문' }).expect(422);
  });

  it('즐겨찾기는 보는 사람별 — 공유받은 사람이 별을 달아도 소유자의 별은 그대로, 버전도 그대로', async () => {
    const d = (await create('같이 보는 판', AUTHOR, { sharedRoles: ['AUDITOR'] }).expect(201)).body;
    const starred = await http().put(`/api/dashboards/${d.id}/favourite`).set(VIEWER).send({ favourite: true }).expect(200);
    expect(starred.body).toMatchObject({ favourite: true, version: 1 });
    expect((await http().get(`/api/dashboards/${d.id}`).set(AUTHOR).expect(200)).body.favourite).toBe(false);
    await http().put(`/api/dashboards/${d.id}/favourite`).set(AUTHOR).send({ favourite: true }).expect(200);
    expect((await http().get(`/api/dashboards/${d.id}`).set(AUTHOR).expect(200)).body.favourite).toBe(true);
    await http().put(`/api/dashboards/${d.id}/favourite`).set(VIEWER).send({ favourite: false }).expect(200);
    expect((await http().get(`/api/dashboards/${d.id}`).set(VIEWER).expect(200)).body.favourite).toBe(false);
  });

  it('쓰기는 사람 역할만, 감사에 남는다 — 행위자 없이 만들면 401', async () => {
    await http().post('/api/dashboards').send({ name: '익명', board: board() }).expect(401);
    const d = (await create('감사 판').expect(201)).body;
    const audit = await http().get('/api/audit').query({ target: d.id }).expect(200);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toContain('DASHBOARD_CREATE');
  });
});
