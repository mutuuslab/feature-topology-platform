// 플랫폼 인증·권한(D06-09) · Variant 조건(D02-01) · 기능 지원 조건(D02-02)
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

describe('IAM · Variant · 기능 지원 조건', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp());
  });
  afterAll(() => app.close());

  it('권한표는 ROUTES에서 — 차량 기기 신원은 사람 역할 목록에 없다', async () => {
    const r = (await http().get('/api/iam/roles').expect(200)).body;
    expect(r.humanRoles).not.toContain('VEHICLE');
    expect(r.roles.find((x: any) => x.role === 'OPERATOR').allowed).toEqual(expect.arrayContaining(['issueKill', 'releaseKill']));
    expect(r.permissions.find((p: any) => p.name === 'decidePolicy').roles).toEqual(['FEATURE_APPROVER']);
    expect(r.sod.map((x: any) => x.id)).toContain('SOD-05');
  });

  it('거부 이력은 역할 밖 시도(DENIED)를 역할별로 모은다, me는 현재 행위자의 허용 작업', async () => {
    await http().post('/api/kill-requests').set(actor('a', 'AUDITOR')).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', safeMode: 'SAFE_DEFAULT', reason: 'x', confirm: 'FEAT-00022' }).expect(403);
    const d = (await http().get('/api/iam/denials').expect(200)).body;
    expect(d.byRole.AUDITOR).toBeGreaterThanOrEqual(1);
    expect(d.items[0]).toMatchObject({ actorRole: 'AUDITOR', result: 'DENIED' });
    const me = (await http().get('/api/iam/me').set(actor('seo.ops', 'OPERATOR')).expect(200)).body;
    expect(me).toMatchObject({ id: 'seo.ops', role: 'OPERATOR' });
    expect(me.allowed).toContain('issueKill');
  });

  it('Variant 매트릭스: FEAT-00022 범위·UPG-VC·기능 앱 SW 1.2.1 — 지원 미달 2대, 문맥 불명은 따로', async () => {
    const m = (await http().get('/api/variants/FEAT-00022/1.0.0').expect(200)).body;
    expect(m.conditions).toMatchObject({ scope: 'KR/NX4 PE/Premium', upgVc: ['F111A114001'], requiredSw: '1.2.1', ecu: '99211-NX400', swId: 'SW-CARE-SDIST-APP' });
    expect(m.rows.filter((r: any) => r.verdict === 'NOT_SUPPORTED').map((r: any) => r.vin).sort()).toEqual(['KMH-NX4-0002', 'KMH-NX4-0004']);
    expect(m.rows.find((r: any) => r.vin === 'KMH-NX4-0003').verdict).toBe('UNKNOWN');
    expect(m.summary.applicable + m.summary.notSupported + m.summary.notApplicable + m.summary.unknown).toBe(12);
    await http().get('/api/variants/FEAT-09999/1.0.0').expect(404);
  });

  it('차량별 지원: KMH-NX4-0004는 배포된 FEAT-00022를 지원하지 않는다', async () => {
    const s = (await http().get('/api/support/KMH-NX4-0004').expect(200)).body;
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ featureId: 'FEAT-00022', verdict: 'NOT_SUPPORTED', actual: '1.1.9', required: '1.2.1' });
    expect(s.items[0].flagKeys.sort()).toEqual(['care_00022_param', 'care_00022_signal']);
    expect((await http().get('/api/support/ego-01').expect(200)).body.items[0].verdict).toBe('APPLICABLE');
  });
});
