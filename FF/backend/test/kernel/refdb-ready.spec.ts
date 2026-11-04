// 준비 점검의 Feature DB 항목(health/ready checks.refdb, 하네스 리뷰 H2) — 패키지에 가져오기 자료가 빠져 빈 Feature DB로 뜨면 503.
// 기대 행 수 = 가져오기 기록 행 수 + 발행된 추가 요청, 실제 = 요청 중(PENDING) 제외 기준 행. FF_REFDB_SEED=off면 빈 Feature DB 허용.
// 운영 모드에서 가져오기 자료가 없으면(NO_DATA) 오류 로그.
import { INestApplication, Logger } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RefdbSeed } from '../../src/domains/d01-policy/refdb/refdb-seed';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');

describe('준비 점검 — Feature DB(가져온 설치)', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('가져온 v1.3 — checks.refdb ok, 행 수 = 가져오기 기록', async () => {
    const r = (await http().get('/api/health/ready').expect(200)).body;
    expect(r.status).toBe('ready');
    expect(r.checks.refdb).toEqual({ ok: true, detail: '기준 행 1052개 · v1.3', rows: 1052, expected: 1052, release: 'v1.3', seedOff: false });
  });

  it('추가 요청(요청 중 행)과 그 발행은 맞춰 센다 — 발행 뒤에도 ok', async () => {
    const req = (await http().post('/api/refdb/requests').set(AUTHOR).send({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Brake ready probe', nameKo: '준비 점검 확인 기능', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'] }).expect(201)).body;
    expect((await http().get('/api/health/ready').expect(200)).body.checks.refdb).toMatchObject({ ok: true, rows: 1052 }); // 요청 중 행은 세지 않는다
    await http().post(`/api/refdb/changes/${req.change.changeId}/reviews`).set(REVIEWER).send({ opinion: 'AGREE', comment: '동의' }).expect(201);
    await http().post(`/api/refdb/changes/${req.change.changeId}/decision`).set(ADMIN).send({ decision: 'APPROVE', reason: '승인' }).expect(201);
    await http().post('/api/refdb/releases').set(ADMIN).send({ changeIds: [req.change.changeId] }).expect(201);
    expect((await http().get('/api/health/ready').expect(200)).body.checks.refdb).toMatchObject({ ok: true, rows: 1053, expected: 1053, release: 'v1.4' });
  });

  it('고의로 망가뜨리면 잡는다 — 이력 없이 들어온 기준 행은 행 수 불일치로 503', async () => {
    const repo = ctx.get(RefdbRepository);
    repo.insertRef({ ...repo.getRef('CH-CVC-007')!, refId: 'CH-CVC-050' }, '2026-11-04T00:00:00.000Z');
    const r = await http().get('/api/health/ready').expect(503);
    expect(r.body.status).toBe('not_ready');
    expect(r.body.checks.refdb).toMatchObject({ ok: false, rows: 1054, expected: 1053 });
  });
});

describe('준비 점검 — 빈 Feature DB', () => {
  let app: INestApplication;
  let dir: string;
  const saved = { ...process.env };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    Object.assign(process.env, { FF_SEED: 'none', FF_DB: ':memory:', FF_REFDB_SEED: 'off' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new ExpressAdapter(), { logger: false });
    await app.init();
    dir = mkdtempSync(join(tmpdir(), 'ff-refdb-nodata-'));
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('FF_REFDB_SEED=off면 빈 Feature DB도 ready', async () => {
    const r = (await http().get('/api/health/ready').expect(200)).body;
    expect(r.checks.refdb).toMatchObject({ ok: true, rows: 0, expected: null, release: null, seedOff: true });
  });

  it('가져오기를 켠 설치의 빈 Feature DB는 503 — 패키지에 자료가 빠진 것', async () => {
    delete process.env.FF_REFDB_SEED;
    const r = await http().get('/api/health/ready').expect(503);
    expect(r.body.checks.refdb.ok).toBe(false);
    expect(r.body.checks.refdb.detail).toContain('data/reference/feature-db');
    process.env.FF_REFDB_SEED = 'off';
  });

  it('가져오기 자료가 없으면(NO_DATA) 운영 모드는 오류 로그, 데모는 경고', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const seed = app.get(RefdbSeed);
      process.env.FF_ENV = 'production';
      expect(seed.run({ dir })).toEqual({ seeded: false, skipped: 'NO_DATA' });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain('data/reference/feature-db');
      delete process.env.FF_ENV;
      seed.run({ dir });
      expect(error).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      delete process.env.FF_ENV;
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
