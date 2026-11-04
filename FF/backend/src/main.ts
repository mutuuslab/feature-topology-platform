import { createApp } from './app.factory';
import { DESKTOP_READY, isDesktop, portOf } from './kernel/desktop';

// 백엔드 포트 9101 (프론트 9012). 8000 금지(전역 규칙). 데스크톱 배포본은 PORT=0 — 루프백 임의 포트
const desktop = isDesktop();
const PORT = portOf();

async function bootstrap() {
  const app = await createApp();
  // 종료 신호(SIGTERM·SIGINT)에 예약 작업을 정리하고 DB를 닫는다(출시 준비 RD-OPS-07)
  app.enableShutdownHooks();
  await app.listen(PORT, desktop ? '127.0.0.1' : undefined);
  if (desktop) {
    // 데스크톱 앱(src-tauri main.rs)이 이 줄로 포트를 알고 창을 연다
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('데스크톱 서버 포트를 알 수 없다');
    // eslint-disable-next-line no-console
    console.log(`${DESKTOP_READY}${address.port}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Feature Platform backend → http://localhost:${PORT}/api/health`);
}
bootstrap();
