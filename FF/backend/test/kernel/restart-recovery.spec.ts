// 재시작 복구 — 회신 기한·차단 지연 감시는 프로세스 타이머라, 고치기 전에는 재시작하면 영영 닫히지 않았다(출시 준비 RD-OPS-06).
// 파일 DB로 앱을 띄워 일을 걸어 두고(manual 스케줄러 — 기한이 오기 전에) 닫은 뒤, 같은 DB로 다시 띄워 기한이 다시 걸리는지 본다.
// readiness: RD-OPS-06
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { Scheduler } from '../../src/kernel/scheduler';
import { killV2 } from '../helpers';

const dir = mkdtempSync(join(tmpdir(), 'ff-restart-'));
const DB = join(dir, 'ff.db');

async function boot(at: string, seed: string) {
  Object.assign(process.env, { FF_DB: DB, FF_SEED: seed, FF_CLOCK_AT: at });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  delete process.env.FF_CLOCK_AT;
  return { app, http: () => request(app.getHttpServer()), scheduler: app.get(Scheduler) };
}

afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'FF_DB', 'FF_SEED']) delete process.env[k];
  // Windows는 실패한 시험이 연 DB 파일을 잠근다 — 정리 실패로 결과를 가리지 않는다
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 임시 폴더 */
  }
});

describe('재시작 복구', () => {
  it('열린 게시본의 회신 기한과 걸린 차단의 지연 감시를 부팅 때 다시 건다 — 지난 기한은 바로 처리', async () => {
    // 1) 첫 실행: 데모 데이터 + 부팅 동기화 게시(전달 중) + v2 긴급 차단 발급 — 스케줄러를 돌리지 않고 닫는다(기한 전 재시작)
    const one = await boot('2026-10-12T01:00:00.000Z', 'v0.81');
    const open = (await one.http().get('/api/publications').expect(200)).body.items.filter((p: { status: string; closedAt: string | null }) => p.status === 'DISPATCHED' && !p.closedAt);
    expect(open.length).toBeGreaterThan(0);
    const k = await killV2(one.http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '재시작 시험', confirm: 'FEAT-00022' });
    await one.app.close();

    // 2) 10분 뒤 같은 DB로 다시 띄운다 — 회신 기한·지연 기한이 모두 지났다
    const two = await boot('2026-10-12T01:10:00.000Z', 'none');
    two.scheduler.flush(0);
    for (const p of open) {
      const after = (await two.http().get(`/api/publications/${p.publicationId}`).expect(200)).body.publication;
      expect(after.closedAt, `${p.publicationId}는 재시작 뒤 회신 기한에 닫혀야 한다`).toBeTruthy();
    }
    const delivery = (await two.http().get('/api/anomalies?kind=DELIVERY&featureId=FEAT-00022').expect(200)).body.items;
    const overdue = delivery.flatMap((a: { signals: { code: string; ref: string | null; vin: string | null }[] }) => a.signals).filter((s: { code: string; ref: string | null }) => s.code === 'PENDING_OVERDUE' && s.ref === k.killId);
    expect(overdue.map((s: { vin: string | null }) => s.vin).sort()).toEqual(['ego-01', 'lead-01']);
    await two.app.close();

    // 3) 또 재시작해도 이미 알린 지연은 다시 알리지 않는다
    const three = await boot('2026-10-12T01:20:00.000Z', 'none');
    three.scheduler.flush(0);
    const again = (await three.http().get('/api/anomalies?kind=DELIVERY&featureId=FEAT-00022').expect(200)).body.items;
    const n = again.flatMap((a: { signals: { code: string; ref: string | null }[] }) => a.signals).filter((s: { code: string; ref: string | null }) => s.code === 'PENDING_OVERDUE' && s.ref === k.killId).length;
    expect(n).toBe(2);
    await three.app.close();
  }, 60_000);
});
