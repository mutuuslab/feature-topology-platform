import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// 백엔드 포트 9101 (프론트 9001). 8000 금지(전역 규칙).
const PORT = Number(process.env.PORT) || 9101;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  app.enableCors({ origin: true });
  await app.listen(PORT);
  // eslint-disable-next-line no-console
  console.log(`Feature Topology backend → http://localhost:${PORT}/api/catalog`);
}
bootstrap();
