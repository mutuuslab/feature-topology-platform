import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { bodyLimitOf, rateLimit, rateLimitOf, securityHeaders } from './kernel/http-hardening';
import { correlation, JsonLogger, logFormat, Metrics, requestLogOn, requestObserver } from './kernel/observability';
import { assertRuntimeConfig, corsOrigins, isProduction } from './kernel/runtime-config';
import { serveWeb } from './kernel/web-static';

/** main.ts와 테스트가 같은 방식으로 앱을 조립한다.
 *  어댑터를 명시 주입한다 — workspaces 호이스팅 위치와 무관하게 platform-express를 찾도록. */
export async function createApp(opts: { logger?: false } = {}): Promise<NestExpressApplication> {
  // 운영 모드(FF_ENV=production)는 위험한 기본값이면 앱을 만들기 전에 멈춘다(출시 준비 RD-OPS-01·12)
  assertRuntimeConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(), {
    // 운영 모드는 JSON 한 줄 로그(RD-OPS-11) — 수집기가 그대로 읽는다
    logger: opts.logger ?? (logFormat() === 'json' ? new JsonLogger() : ['log', 'error', 'warn']),
    // 원문 본문 보관 — 외부 webhook HMAC 서명은 파싱 전 바이트로 확인한다(ext-sync)
    rawBody: true,
  });
  hardenHttp(app);
  return app;
}

/** 보안 헤더·CORS 허용 목록·요청 제한·본문 크기 — 시험(helpers.bootApp)도 같은 함수를 쓴다 */
export function hardenHttp(app: NestExpressApplication, env: Record<string, string | undefined> = process.env) {
  app.disable('x-powered-by');
  // TLS는 앞단 프록시가 끝낸다 — 운영 모드는 프록시가 준 출처 IP를 믿는다(요청 제한·감사)
  if (isProduction(env)) app.set('trust proxy', env.FF_TRUST_PROXY ?? 'loopback');
  app.use(securityHeaders(env));
  // 상관 ID를 먼저 — 요청 로그·감사·오류 로그가 같은 값을 쓴다
  app.use(correlation());
  const json = new JsonLogger();
  app.use(requestObserver(app.get(Metrics), requestLogOn(env) ? (line) => json.event(line) : null));
  // 화면 파일(FF_WEB_DIR, 단독 설치 이미지) — 같은 출처 제공. 요청 제한 앞이라 화면 자산은 세지 않는다(RD-OPS-05)
  serveWeb(app, env);
  app.use(rateLimit(rateLimitOf(env)));
  app.useBodyParser('json', { limit: bodyLimitOf(env) });
  app.useBodyParser('urlencoded', { limit: bodyLimitOf(env), extended: true });
  // 운영 모드는 FF_CORS_ORIGINS 허용 목록만(비었으면 다른 출처 불허), 그 밖에는 모두 허용
  const origins = corsOrigins(env);
  app.enableCors({ origin: origins === true ? true : origins.length ? origins : false });
}
