// 회귀: 5년 운영 — 권한 번호가 5자리(ENT-99999)를 넘어도 다음 번호가 겹치지 않는다.
// 이전 구현은 grant_id 문자열 max를 써서 'ENT-99999' > 'ENT-100000'으로 골라 이미 있는 번호를 다시 냈다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { bootApp } from '../helpers';

describe('권한 번호 — 5자리를 넘을 때', () => {
  let app: INestApplication;
  let get: <T>(t: unknown) => T;
  beforeAll(async () => {
    ({ app, get } = (await bootApp({ at: '2026-10-12T01:00:00.000Z' })) as any);
  });
  afterAll(() => app.close());

  it('ENT-99999 다음은 ENT-100000, 그다음은 ENT-100001', () => {
    const fleet = get<FleetRepo>(FleetRepo);
    const base = fleet.grants('KMH-NX4-0001')[0];
    fleet.insertGrant({ ...base, grantId: 'ENT-99999' });
    fleet.insertGrant({ ...base, grantId: fleet.nextGrantId() });
    expect(fleet.grant('ENT-100000')).toBeDefined();
    expect(fleet.nextGrantId()).toBe('ENT-100001');
  });
});
