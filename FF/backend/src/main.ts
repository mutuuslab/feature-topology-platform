import { createApp } from './app.factory';

// 백엔드 포트 9101 (프론트 9012). 8000 금지(전역 규칙).
const PORT = Number(process.env.PORT) || 9101;

async function bootstrap() {
  const app = await createApp();
  // 종료 신호(SIGTERM·SIGINT)에 예약 작업을 정리하고 DB를 닫는다(출시 준비 RD-OPS-07)
  app.enableShutdownHooks();
  await app.listen(PORT);
  // eslint-disable-next-line no-console
  console.log(`Feature Platform backend → http://localhost:${PORT}/api/health`);
}
bootstrap();
