// BFF 로그인 창구 — /api/auth/* (신원 없이 연다: @PublicEndpoint). 브라우저는 토큰을 보지 않고 httpOnly 세션 쿠키만 가진다.
//   config → 화면이 데모·SSO 중 무엇을 그릴지 · login → IdP 인가(PKCE) · callback → 세션 · logout · me
import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicEndpoint } from '../actor';
import { DomainError } from '../errors';
import { AuthFailure, AuthService, LOGIN_COOKIE, LOGIN_TTL_SEC, SESSION_COOKIE } from './auth.service';
import { clearCookie, readCookie, setCookie } from './cookies';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 로그인 실패 안내 — 브라우저 이동이면 짧은 HTML, API 호출이면 오류 봉투 */
function fail(req: Request, res: Response, e: AuthFailure) {
  res.status(e.status);
  res.setHeader('Cache-Control', 'no-store');
  if (req.accepts(['json', 'html']) === 'html') {
    res
      .type('html')
      .send(
        `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>로그인할 수 없습니다 — Feature Platform</title></head>` +
          `<body><main><h1>로그인할 수 없습니다</h1><p data-auth-error="${esc(e.code)}">${esc(e.message)}</p><p><a href="/login">로그인 화면으로 돌아가기</a></p></main></body></html>`,
      );
    return;
  }
  res.json({ error: { code: e.code === 'NO_ROLE' ? 'FORBIDDEN' : 'UNAUTHENTICATED', message: e.message, details: { reason: e.code } } });
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private cookieOpts() {
    return { secure: this.auth.cfg?.secureCookies ?? false };
  }

  @Get('config')
  @PublicEndpoint()
  config() {
    return { mode: this.auth.mode };
  }

  @Get('login')
  @PublicEndpoint()
  async login(@Query('returnTo') returnTo: unknown, @Query('login_hint') loginHint: unknown, @Req() req: Request, @Res() res: Response) {
    if (this.auth.mode !== 'oidc') throw new DomainError('NOT_FOUND', '데모 모드에는 SSO 로그인이 없습니다.');
    try {
      const { url, cookie } = await this.auth.beginLogin(returnTo, loginHint);
      setCookie(res, LOGIN_COOKIE, cookie, { ...this.cookieOpts(), path: '/api/auth', maxAgeSec: LOGIN_TTL_SEC });
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, url);
    } catch (e) {
      if (e instanceof AuthFailure) return fail(req, res, e);
      throw e;
    }
  }

  @Get('callback')
  @PublicEndpoint()
  async callback(@Query() q: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    if (this.auth.mode !== 'oidc') throw new DomainError('NOT_FOUND', '데모 모드에는 SSO 로그인이 없습니다.');
    // 로그인 상태 쿠키는 한 번만 쓴다 — 성공·실패와 관계없이 지운다(재사용 방지)
    const loginCookie = readCookie(req, LOGIN_COOKIE);
    clearCookie(res, LOGIN_COOKIE, { ...this.cookieOpts(), path: '/api/auth' });
    try {
      const { sessionCookie, returnTo } = await this.auth.finishLogin(q, loginCookie);
      // 이 브라우저에 남은 이전 세션은 지운다 — 로그인마다 새 세션 ID(세션 고정 방지)
      this.auth.dropSession(req, 'AUTH_SESSION_REPLACED');
      setCookie(res, SESSION_COOKIE, sessionCookie, { ...this.cookieOpts(), path: '/', maxAgeSec: this.auth.cfg!.sessionTtlMin * 60 });
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, returnTo);
    } catch (e) {
      if (e instanceof AuthFailure) return fail(req, res, e);
      throw e;
    }
  }

  @Post('logout')
  @PublicEndpoint()
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (this.auth.mode !== 'oidc') return {};
    // 다른 사이트가 사용자를 강제로 로그아웃시키지 못하게 — 쿠키가 있으면 출처 확인
    if (readCookie(req, SESSION_COOKIE) && !this.auth.originAllowed(req)) throw new DomainError('FORBIDDEN', '요청 출처를 확인할 수 없습니다. 플랫폼 화면에서 다시 시도하세요.');
    const out = await this.auth.logout(req);
    clearCookie(res, SESSION_COOKIE, { ...this.cookieOpts(), path: '/' });
    res.setHeader('Cache-Control', 'no-store');
    return out;
  }

  @Get('me')
  @PublicEndpoint()
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (this.auth.mode !== 'oidc') return { authenticated: false, mode: 'demo' as const };
    const who = await this.auth.identify(req);
    if (!who) return { authenticated: false, mode: 'oidc' as const };
    return { authenticated: true, mode: 'oidc' as const, user: { id: who.id, name: who.name, email: who.email, roles: who.roles } };
  }
}
