// 회귀: 5년 운영 — 보존 sweep(30일)이 오래된 차량 발신 기록을 지운 뒤에도 새 기록 번호가 남은 기록과 겹치지 않는다.
// 이전 구현은 행 수 + 1로 번호를 매겨, 앞쪽 행이 지워지면 이미 있는 VREQ 번호를 다시 내서 PRIMARY KEY 충돌이 났다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { VehicleRequestRepo } from '../../src/domains/d02-runtime/vehicle-requests/vehicle-request.repo';
import { bootApp } from '../helpers';

describe('차량 발신 기록 번호 — 보존 삭제 뒤', () => {
  let app: INestApplication;
  let get: <T>(t: unknown) => T;
  beforeAll(async () => {
    ({ app, get } = (await bootApp({ at: '2026-10-12T01:00:00.000Z' })) as any);
  });
  afterAll(() => app.close());

  it('앞쪽 기록이 지워져도 다음 번호는 남은 최대 번호 다음', () => {
    const repo = get<VehicleRequestRepo>(VehicleRequestRepo);
    const db = get<Db>(DB);
    const rec = (requestId: string) => ({ requestId, vin: 'ego-01', at: '2026-10-12T01:00:00.000Z', kind: 'REPORT', bodyHash: null, response: null }) as any;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = repo.nextId();
      repo.insert(rec(id), false);
      ids.push(id);
    }
    db.run('DELETE FROM vehicle_request WHERE request_id = ?', ids[0]); // 보존 sweep
    const next = repo.nextId();
    expect(ids).not.toContain(next);
    expect(() => repo.insert(rec(next), false)).not.toThrow();
  });
});
