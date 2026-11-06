// 화면(프론트 빌드) 같은 출처 제공 — 출시 준비 RD-OPS-05 (단독 설치 이미지 docker/app/Dockerfile).
// FF_WEB_DIR(vite build 결과 폴더)를 주면 백엔드가 화면 파일을 함께 낸다. 같은 출처라 SSO 세션 쿠키·CSRF Origin 검사가 그대로 맞는다.
//   · 보안 헤더는 빌드에 들어 있는 _headers('/*' 묶음 — 공개 데모·vite preview와 같은 CSP)를 화면 응답에만 건다. API 응답은 http-hardening 그대로
//   · 해시 붙은 /assets/* 는 1년 캐시(immutable), index.html·SPA 대체 응답은 no-store(배포 직후 옛 화면이 남지 않게)
//   · SPA 대체: API 경로(/api, /ofrep, /vehicle)가 아닌 GET·HEAD는 index.html — 화면 주소를 새로 고쳐도 열린다
// FF_WEB_DIR가 없으면 아무것도 하지 않는다(개발은 vite dev 서버, 공개 데모는 정적 호스팅).
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Env = Record<string, string | undefined>;

/** 화면이 아닌 경로 — 백엔드 컨트롤러가 받는다 */
export const API_PREFIXES = ['/api/', '/ofrep/', '/vehicle/'] as const;
const ASSET_EXT = /\.(js|mjs|css|map|json|html|txt|xml|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|glb|gltf|bin|hdr|ktx2|wasm|mp4|webm)$/i;
export const isApiPath = (p: string) => p === '/api' || p === '/ofrep' || p === '/vehicle' || API_PREFIXES.some((x) => p.startsWith(x));

/** Cloudflare/_headers 형식에서 '/*' 묶음만 읽는다(vite.config.ts deployHeaders와 같은 규칙) */
export function deployHeadersOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) inAll = line.trim() === '/*';
    else if (inAll) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

/** 화면 폴더 — 설정이 없으면 null, 있는데 index.html이 없으면 부팅을 멈춘다(빈 화면으로 뜨지 않게) */
export function webDirOf(env: Env = process.env): string | null {
  const raw = env.FF_WEB_DIR?.trim();
  if (!raw) return null;
  const dir = resolve(raw);
  if (!existsSync(join(dir, 'index.html'))) throw new Error(`FF_WEB_DIR '${raw}'에 index.html이 없습니다 — 프론트 빌드(vite build) 결과 폴더를 가리키세요`);
  return dir;
}

/** hardenHttp가 보안 헤더 뒤, 요청 제한 앞에 부른다 — 화면 파일 요청은 API 요청 제한에 세지 않는다 */
export function serveWeb(app: NestExpressApplication, env: Env = process.env): string | null {
  const dir = webDirOf(env);
  if (!dir) return null;
  const headersFile = join(dir, '_headers');
  const headers = existsSync(headersFile) ? deployHeadersOf(readFileSync(headersFile, 'utf8')) : {};
  const index = join(dir, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req.path)) return next();
    // 배포 메타 파일(_headers·_redirects)은 내지 않는다
    if (/^\/_(headers|redirects)$/.test(req.path)) return res.status(404).end();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    next();
  });
  app.useStaticAssets(dir, {
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res, path) => {
      if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path)) return next();
    // 자산 확장자 주소(없는 자산)는 화면으로 바꾸지 않는다 — 404가 맞다. 화면 주소의 버전(…/1.0.0)·절차 ID(FPW.7)는 화면이다
    if (ASSET_EXT.test(req.path)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(index);
  });
  return dir;
}
