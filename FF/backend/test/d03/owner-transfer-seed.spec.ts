// 소유자 이관 데모 시드(F0, B13) — 룰 시드 뒤에 한 번: 떠난 법규 담당의 승인 대기 룰 둘(이관 이력 1, 소유자 없음 1). 다시 부팅해도 한 번만
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnerTransferSeeder } from '../../src/domains/d03-safety/compliance-checker/owner-transfer.seed';
import { bootApp } from '../helpers';

afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
});

describe('소유자 이관 데모 시드', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: '2026-11-07T01:00:00.000Z', demoActivity: true, showcaseFill: false })));
  afterAll(() => app.close());

  it('룰 시드(CR-SAF-001 등)는 그대로이고, 이관 이력이 있는 룰과 소유자가 없는 룰이 하나씩 있다', async () => {
    const list = (await http().get('/api/compliance-rules').expect(200)).body.items.map((r: any) => r.ruleId);
    expect(list).toEqual(expect.arrayContaining(['CR-SAF-001', 'CR-PRV-090', 'CR-PRV-091']));
    const moved = (await http().get('/api/compliance-rules/CR-PRV-090').expect(200)).body;
    expect(moved).toMatchObject({ rule: { ownerId: 'usr-steward', status: 'PROPOSED' }, ownerState: 'ACTIVE', ownerTransfers: [expect.objectContaining({ fromOwnerId: 'usr-reg-former', fromState: 'ABSENT', toOwnerId: 'usr-steward', by: 'usr-sysadmin' })] });
    const orphan = (await http().get('/api/compliance-rules/CR-PRV-091').expect(200)).body;
    expect(orphan).toMatchObject({ rule: { ownerId: 'usr-reg-former' }, ownerState: 'ABSENT', ownerTransfers: [] });
  });

  it('다시 돌려도 한 번만', () => {
    expect(app.get(OwnerTransferSeeder).run()).toBe(0);
  });
});
