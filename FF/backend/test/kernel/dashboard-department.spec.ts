import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';
import { dashboardContext } from '../../src/dashboards/dashboard-context';
import type { AuthService } from '../../src/kernel/auth/auth.service';
import type { Request } from 'express';
import { DashboardCreateBody } from '@ff/contracts';

const ADMIN = actor('usr-sysadmin', 'SYSTEM_ADMIN');
const MEMBER = actor('usr-author', 'FEATURE_AUTHOR');
const OUTSIDE = actor('usr-operator', 'OPERATOR');
const BOARD = { v: 2, layout: '1', columns: [['tasks']], gadgets: { tasks: { id: 'tasks', type: 'assigned', config: {}, configured: true, refresh: 0, minimized: false } } };

describe('부서 공통 대시보드와 기본 배정', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  let id: string;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  it('관리자가 부서 공통판을 저장하고 같은 부서가 다른 계정에서 조회한다', async () => {
    expect(DashboardCreateBody.safeParse({ name: '기획팀 공통 현황', board: BOARD, departmentId: 'DEP-PDP' }).success).toBe(true);
    const created = await http().post('/api/dashboards').set(ADMIN).send({ name: '기획팀 공통 현황', board: BOARD, departmentId: 'DEP-PDP' }).expect(201);
    id = created.body.id;
    expect(created.body.departmentId).toBe('DEP-PDP');
    const member = await http().get('/api/dashboards').query({ department: 'DEP-PDP' }).set(MEMBER).expect(200);
    expect(member.body.items.find((d: { id: string }) => d.id === id)).toMatchObject({ mine: false, departmentId: 'DEP-PDP' });
    await http().get(`/api/dashboards/${id}`).set(OUTSIDE).expect(404);
  });
  it('부서 선택이나 역할 공유로 다른 부서의 판을 열 수 없다', async () => {
    await http().get('/api/dashboards').query({ department: 'DEP-PDP' }).set(OUTSIDE).expect(403);
    await http().post('/api/dashboards').set(MEMBER).send({ name: '임의 공통판', board: BOARD, departmentId: 'DEP-PDP' }).expect(403);
    await http().put(`/api/dashboards/${id}`).set(ADMIN).set('If-Match', '1').send({ sharedRoles: ['OPERATOR'] }).expect(400);
    await http().put(`/api/dashboards/${id}`).set(MEMBER).set('If-Match', '1').send({ name: '가로채기' }).expect(403);
  });
  it('버전이 맞는 관리자 배정만 저장되며 일반 구성원은 기본판을 읽는다', async () => {
    const url = '/api/dashboard-departments/DEP-PDP';
    expect((await http().get(url).set(MEMBER).expect(200)).body).toMatchObject({ mode: 'ROLE', version: 0 });
    await http().put(url).set(ADMIN).send({ mode: 'DEPARTMENT', dashboardId: id, version: 0 }).expect(200);
    expect((await http().get(url).set(MEMBER).expect(200)).body).toMatchObject({ mode: 'DEPARTMENT', dashboardId: id, version: 1 });
    await http().put(url).set(ADMIN).send({ mode: 'ROLE', dashboardId: null, version: 0 }).expect(412);
    await http().put(url).set(MEMBER).send({ mode: 'ROLE', dashboardId: null, version: 1 }).expect(403);
    await http().get(url).set(OUTSIDE).expect(403);
  });
  it('개인판·다른 부서 판을 기본판에 지정할 수 없고 사용 중 기본판은 삭제하지 않는다', async () => {
    const personal = (await http().post('/api/dashboards').set(ADMIN).send({ name: '관리자 개인판', board: BOARD }).expect(201)).body.id;
    await http().put('/api/dashboard-departments/DEP-PDP').set(ADMIN).send({ mode: 'DEPARTMENT', dashboardId: personal, version: 1 }).expect(400);
    await http().delete(`/api/dashboards/${id}`).set(ADMIN).set('If-Match', '1').send({}).expect(409);
    await http().put('/api/dashboard-departments/DEP-PDP').set(ADMIN).send({ mode: 'ROLE', dashboardId: null, version: 1 }).expect(200);
    await http().delete(`/api/dashboards/${id}`).set(ADMIN).set('If-Match', '1').send({}).expect(200);
  });
  it('공통판 구성원도 자기 개인판을 저장하며 역할이나 부서 권한은 얻지 않는다', async () => {
    const personal = (await http().post('/api/dashboards').set(MEMBER).send({ name: '내 작업판', board: BOARD }).expect(201)).body;
    expect(personal).toMatchObject({ mine: true, ownerId: 'usr-author' });
    expect(personal.departmentId).toBeUndefined();
    await http().get(`/api/dashboards/${personal.id}`).set(OUTSIDE).expect(404);
  });
});

it('OIDC의 부서는 검증 신원만 사용하고 질의·헤더로 교체하지 않는다', async () => {
  const auth = { mode: 'oidc', identify: async () => ({ id: 'real-user', department: 'DEP-PDP' }) } as unknown as AuthService;
  const req = { headers: { 'x-department': 'DEP-OPS' } } as unknown as Request;
  const user = { id: 'real-user', role: 'FEATURE_AUTHOR' as const, roles: ['FEATURE_AUTHOR' as const], correlationId: 'dept-test' };
  expect((await dashboardContext(auth, req, user)).departmentId).toBe('DEP-PDP');
  await expect(dashboardContext(auth, req, user, 'DEP-OPS')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await dashboardContext({ mode: 'oidc', identify: async () => null } as unknown as AuthService, req, user)).departmentId).toBeUndefined();
});
