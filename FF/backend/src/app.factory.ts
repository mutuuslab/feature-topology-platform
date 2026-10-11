import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/** main.ts와 테스트가 같은 방식으로 앱을 조립한다.
 *  어댑터를 명시 주입한다 — workspaces 호이스팅 위치와 무관하게 platform-express를 찾도록. */
export async function createApp(opts: { logger?: false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    logger: opts.logger ?? ['log', 'error', 'warn'],
  });
  app.enableCors({ origin: true });
  return app;
}
