// 권한 범위(ADS-BE15 · FFP-F057 · TC20) — 역할 권한 위에 계정별 시장·Feature·환경 범위. 종료·해제·발행 명령은 범위 밖이면 403 SCOPE_DENIED·감사 DENIED.
// 분석 전용(감사 조회자)은 종료·해제·발행을 할 수 없다. 시드 data/fixtures/ads/config.json roleScopes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoleScope } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const SECURITY = actor('usr-csm', 'SECURITY_OFFICER');
const VIEWER = actor('usr-viewer', 'AUDITOR');
const KILL = {
  featureVersion: '1.0.0',
  reasonCategory: 'SAFETY',
  reasonCode: 'FIELD_FAULT',
  reason: '현장 결함',
  containmentJustification: '원인 분석 전 봉쇄',
};

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  app = await bootApp({ at: '2026-10-13T00:30:00Z' });
});
afterAll(async () => {
  await app.app.close();
});
const lastDenied = () => app.get<Db>(DB).get<{ result: string; reason: string; actor_id: string; action: string }>("SELECT result, reason, actor_id, action FROM audit WHERE result = 'DENIED' ORDER BY id DESC LIMIT 1");

describe('권한 범위 (ADS-BE15)', () => {
  it('목록 — 계정별 지금 범위와 이 설치의 환경', async () => {
    const r = (await app.http().get('/api/iam/scopes').expect(200)).body;
    expect(r.environment).toBe('demo');
    expect(r.commands).toEqual(expect.arrayContaining(['issueKill', 'requestRestore', 'deployPolicy']));
    const op = r.items.find((s: RoleScope) => s.accountId === 'usr-operator');
    expect(op).toMatchObject({ markets: ['KR', 'EU', 'US', 'CA', 'AU', 'ME'], environments: ['demo', 'staging'], featureIds: null });
  });

  it('시장 범위 밖 — 일본 시장 Feature 긴급 차단 요청은 403 SCOPE_DENIED·감사 DENIED, 범위 안 시장은 범위 검사를 지나간다', async () => {
    const r = await app.http().post('/api/kill-requests').set(actor('usr-operator', 'OPERATOR')).send({ ...KILL, featureId: 'FEAT-00014', confirm: 'FEAT-00014' }).expect(403);
    expect(r.body.error.details).toMatchObject({ code: 'SCOPE_DENIED', axis: 'markets' });
    expect(r.body.error.message).toContain('JP');
    expect(lastDenied()).toMatchObject({ actor_id: 'usr-operator', action: 'issueKill' });
    const ok = await app.http().post('/api/kill-requests').set(actor('usr-operator', 'OPERATOR')).send({ ...KILL, featureId: 'FEAT-00022', confirm: 'FEAT-00022', vins: ['ego-01'] });
    expect(ok.body?.error?.details?.code).not.toBe('SCOPE_DENIED');
  });

  it('지정 — 사이버보안 담당만(운영자 403), 이력은 추가만. Feature 범위·환경 범위 밖 명령 거부', async () => {
    await app.http().put('/api/iam/scopes/usr-ops9').set(actor('usr-ops', 'OPERATOR')).send({ featureIds: ['FEAT-00022'], reason: '시험' }).expect(403);
    const put = (await app.http().put('/api/iam/scopes/usr-ops9').set(SECURITY).send({ featureIds: ['FEAT-00022'], reason: 'FEAT-00022 운영 담당' }).expect(200)).body as RoleScope;
    expect(put).toMatchObject({ accountId: 'usr-ops9', featureIds: ['FEAT-00022'], markets: null, environments: null, assignedBy: 'usr-csm' });
    const f = await app.http().post('/api/kill-requests').set(actor('usr-ops9', 'OPERATOR')).send({ ...KILL, featureId: 'FEAT-00004', featureVersion: '4.1.0', confirm: 'FEAT-00004' }).expect(403);
    expect(f.body.error.details.axis).toBe('featureIds');
    await app.http().put('/api/iam/scopes/usr-ops9').set(SECURITY).send({ environments: ['staging'], reason: '시험 환경만' }).expect(200);
    const e = await app.http().post('/api/kill-requests').set(actor('usr-ops9', 'OPERATOR')).send({ ...KILL, featureId: 'FEAT-00022', confirm: 'FEAT-00022', vins: ['ego-01'] }).expect(403);
    expect(e.body.error.details.axis).toBe('environments');
    expect(app.get<Db>(DB).all('SELECT id FROM role_scope WHERE account_id = ?', 'usr-ops9')).toHaveLength(2);
    expect(() => app.get<Db>(DB).run("DELETE FROM role_scope WHERE account_id = 'usr-ops9'")).toThrow(/추가만/);
  });

  it('발행 — 환경 범위 밖 계정의 정책 배포는 거부', async () => {
    const pol = (await app.http().get('/api/policies').expect(200)).body.items.find((p: { status: string }) => p.status === 'APPROVED' || p.status === 'DEPLOYED');
    await app.http().put('/api/iam/scopes/usr-rm9').set(SECURITY).send({ environments: ['production'], reason: '운영 환경 전용' }).expect(200);
    const r = await app.http().post(`/api/policies/${pol.policyId}/deploy`).set(actor('usr-rm9', 'RELEASE_MANAGER')).send({ reason: '배포' }).expect(403);
    expect(r.body.error.details).toMatchObject({ code: 'SCOPE_DENIED', axis: 'environments' });
  });
});

describe('TC20 분석 전용 — 종료·해제·발행 거부', () => {
  it('감사 조회자는 긴급 차단·승인·복원·해제·정책 배포를 할 수 없다(모두 403·DENIED)', async () => {
    const pol = (await app.http().get('/api/policies').expect(200)).body.items[0];
    const calls: [string, string, object][] = [
      ['post', '/api/kill-requests', { ...KILL, featureId: 'FEAT-00022', confirm: 'FEAT-00022' }],
      ['post', '/api/kill-requests/KILL-X/approvals', { reason: '승인', signature: 'x' }],
      ['post', '/api/kill-requests/KILL-X/restore', { reason: '복원' }],
      ['post', '/api/kill-requests/KILL-X/restore/approvals', { reason: '승인' }],
      ['post', '/api/kill-requests/KILL-X/release', { reason: '해제' }],
      ['post', `/api/policies/${pol.policyId}/deploy`, { reason: '배포' }],
    ];
    for (const [, path, body] of calls) {
      const r = await app.http().post(path).set(VIEWER).send(body);
      expect(r.status, path).toBe(403);
      expect(lastDenied()).toMatchObject({ actor_id: 'usr-viewer', result: 'DENIED' });
    }
  });
});
