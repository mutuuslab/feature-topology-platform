// 80-50 A6 §4.7 — JIRA 안의 FF 앱이 부르는 API. 앱 자격(client credentials → Bearer) + 요청마다 JIRA 사용자(X-FF-Jira-User)를
// ext-identities로 매핑해 권한을 본다. Feature DB 검색(listRefs와 같은 질의)·기준 값·Feature 현황(작업 중·출시 버전·게이트·산출물).
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';

describe('JIRA 앱 API (80-50 A6)', () => {
  let app: INestApplication;
  let http: () => any;
  let token = '';
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-11-07T01:00:00.000Z' }));
  });
  afterAll(() => app.close());
  const as = (user: string) => ({ authorization: `Bearer ${token}`, 'x-ff-jira-user': user });

  it('앱 자격 — client credentials로 토큰, 틀린 비밀값은 401', async () => {
    await http().post('/api/alm/app/token').send({ grant_type: 'client_credentials', client_id: 'ff-jira-app', client_secret: 'nope' }).expect(401);
    const r = await http().post('/api/alm/app/token').send({ grant_type: 'client_credentials', client_id: 'ff-jira-app', client_secret: 'ff-mock-app-secret' }).expect(200);
    expect(r.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, access_token: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/) });
    token = r.body.access_token;
  });

  it('토큰 없거나 틀리면 401, 매핑되지 않은 JIRA 사용자는 403', async () => {
    await http().get('/api/alm/app/refdb/refs?q=brake').expect(401);
    await http().get('/api/alm/app/refdb/refs?q=brake').set({ authorization: 'Bearer wrong', 'x-ff-jira-user': 'kim.author' }).expect(401);
    await http().get('/api/alm/app/refdb/refs?q=brake').set(as('stranger')).expect(403);
  });

  it('Feature DB 검색은 플랫폼 검색과 같은 결과 — 대표·포함 고르기용', async () => {
    const mine = (await http().get('/api/alm/app/refdb/refs?q=brake&limit=5').set(as('kim.author')).expect(200)).body;
    const platform = (await http().get('/api/refdb/refs?q=brake&limit=5').set({ 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' }).expect(200)).body;
    expect(mine.items.map((r: any) => r.refId)).toEqual(platform.items.map((r: any) => r.refId));
    expect(mine.total).toBe(platform.total);
  });

  it('기준 값(판매국·차종·트림) — 사용 중인 것만', async () => {
    const v = (await http().get('/api/alm/app/reference-values').set(as('kim.author')).expect(200)).body;
    expect(v.country.length).toBeGreaterThan(0);
    expect(v.vehicleModel.length).toBeGreaterThan(0);
    expect(v.trim[0]).toMatchObject({ code: expect.any(String), parent: expect.any(String), label: expect.any(String) });
  });

  it('Feature 현황 — Epic 보기 패널(작업 중·출시 버전·수명주기·게이트·산출물 작성률·링크)', async () => {
    const s = (await http().get('/api/alm/app/features/FEAT-00022/summary').set(as('park.release')).expect(200)).body;
    expect(s).toMatchObject({ featureId: 'FEAT-00022', releaseVersion: '1.0.0', lifecycle: 'RELEASED', epicStatus: 'Released', link: '/features/FEAT-00022/1.0.0' });
    expect(s.gates).toMatch(/^G1 /);
    expect(s.workProducts).toMatchObject({ rate: 100, missing: [] });
    await http().get('/api/alm/app/features/FEAT-99999/summary').set(as('park.release')).expect(404);
  });
});
