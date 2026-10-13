import { INestApplication, Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/** 메모리 DB + v0.81 시드로 앱을 띄운다. 테스트마다 독립 DB. */
export async function bootApp(opts: { controllers?: Type<unknown>[]; providers?: Type<unknown>[]; at?: string } = {}) {
  process.env.FF_DB = ':memory:';
  process.env.FF_SEED = 'v0.81';
  // at — 부팅 전에 시계를 고정한다. 부팅 때 잡히는 일정(부팅 동기화 게시본의 회신 기한)이 실제 날짜에 따라 달라지지 않게.
  if (opts.at) process.env.FF_CLOCK_AT = opts.at;
  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
    providers: opts.providers ?? [],
  }).compile();
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  delete process.env.FF_CLOCK_AT;
  const http = () => request(app.getHttpServer());
  return { app, http, get: <T>(t: Type<T> | symbol) => app.get<T>(t as any) };
}

export const actor = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

/** 안전 분류 확정(보고서 v1.1 G2 선행 — Safety Manager 개인 서명). G1 다음 Gate를 PASS로 판정하는 시험 흐름이 먼저 부른다 */
export const confirmSafety = (http: () => request.Agent | ReturnType<typeof request>, featureId: string, version: string) =>
  (http() as ReturnType<typeof request>).post(`/api/features/${featureId}/versions/${version}/safety/confirm`).set(actor('usr-safety', 'SAFETY_OFFICER')).send({ reason: '안전 분류 확정(HARA 검토)' }).expect(201);
