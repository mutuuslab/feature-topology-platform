// Windows 데스크톱 배포본(Tauri, FF/src-tauri) — 백엔드 하나가 루프백 임의 포트에서 화면(FF_WEB_DIR)·API를 함께 낸다.
// 데스크톱 앱(main.rs)이 FF_DESKTOP=1·PORT=0으로 띄우고, 표준 출력의 'FF_DESKTOP_READY:<포트>' 줄을 기다려 창을 연다.
// 같은 PC의 다른 웹 페이지가 이 서버를 부르지 못하게 루프백 Host·같은 출처만 받는다(DNS rebinding·교차 출처 요청 거부).
import type { NextFunction, Request, Response } from 'express';

type Env = Record<string, string | undefined>;

export const DESKTOP_READY = 'FF_DESKTOP_READY:';

export const isDesktop = (env: Env = process.env): boolean => env.FF_DESKTOP === '1';

/** 데스크톱은 PORT=0(임의 포트)을 그대로 쓴다 — 웹·시험은 0이면 기본 포트 */
export function portOf(env: Env = process.env, fallback = 9101): number {
  if (isDesktop(env) && env.PORT === '0') return 0;
  return Number(env.PORT) || fallback;
}

/** 루프백 Host·같은 출처 요청만 — 어긋나면 403. 출처가 없는 요청(창 안의 화면 이동)은 받는다 */
export function desktopGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? '';
    const origin = req.headers.origin;
    if (!/^127\.0\.0\.1:\d+$/.test(host) || (origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).end();
      return;
    }
    next();
  };
}
