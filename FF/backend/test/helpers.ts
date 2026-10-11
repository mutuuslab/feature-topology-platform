import { INestApplication, Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/** 메모리 DB + v0.81 시드로 앱을 띄운다. 테스트마다 독립 DB. */
export async function bootApp(opts: { controllers?: Type<unknown>[]; providers?: Type<unknown>[] } = {}) {
  process.env.FF_DB = ':memory:';
  process.env.FF_SEED = 'v0.81';
  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
    providers: opts.providers ?? [],
  }).compile();
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  const http = () => request(app.getHttpServer());
  return { app, http, get: <T>(t: Type<T> | symbol) => app.get<T>(t as any) };
}

export const actor = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
