// HTTP 기본 방어 — 출시 준비 RD-SEC-10·RD-SEC-11. 외부 의존성 없이 express 미들웨어로.
//   · 보안 헤더: nosniff·frame-ancestors none·Referrer-Policy (운영 모드는 HSTS도 — TLS는 앞단 프록시가 끝낸다)
//   · 요청 제한: 출처(IP)별 1분 창. 운영 모드 기본 1200/분, 그 밖에는 FF_RATE_LIMIT를 줄 때만. 상태 점검은 세지 않는다
//   · 본문 크기: FF_BODY_LIMIT(기본 100kb — express 기본값과 같다) — 넘으면 413(errors.ts가 봉투로 바꾼다)
import type { NextFunction, Request, Response } from 'express';
import { isProduction } from './runtime-config';

type Env = Record<string, string | undefined>;

export function securityHeaders(env: Env = process.env) {
  const hsts = isProduction(env);
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // API는 문서를 그리지 않는다 — HTML 증거를 내는 응답은 자기 CSP로 덮어쓴다(virtual-validation)
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export const rateLimitOf = (env: Env = process.env): number => {
  const n = Number(env.FF_RATE_LIMIT);
  if (Number.isFinite(n) && n > 0) return n;
  return isProduction(env) ? 1200 : 0;
};

/** 고정 1분 창 요청 제한. 0이면 끈다 */
export function rateLimit(limit: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; n: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limit || req.path.startsWith('/api/health')) return next();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, n: 0 };
      windows.set(key, w);
      // 오래된 창 정리 — 출처가 많아도 메모리가 늘어나지 않게
      if (windows.size > 10_000) for (const [k, v] of windows) if (t - v.start >= 60_000) windows.delete(k);
    }
    if (++w.n > limit) {
      const retry = Math.max(1, Math.ceil((w.start + 60_000 - t) / 1000));
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: `요청이 너무 잦습니다. ${retry}초 뒤에 다시 시도하세요.`, details: { retryAfterSec: retry, limit } } });
      return;
    }
    next();
  };
}

export const bodyLimitOf = (env: Env = process.env) => env.FF_BODY_LIMIT?.trim() || '100kb';
