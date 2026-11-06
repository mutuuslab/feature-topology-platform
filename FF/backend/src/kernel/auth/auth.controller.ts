// BFF 로그인 창구 — /api/auth/* (신원 없이 연다: @PublicEndpoint). 브라우저는 토큰을 보지 않고 httpOnly 세션 쿠키만 가진다.
//   config → 화면이 데모·SSO 중 무엇을 그릴지 · login → IdP 인가(PKCE) · callback → 세션 · logout · me
//   demo-login → 공개 데모 게이트(FF_DEMO_GATE=on) 세션 — 데모 ID·비밀번호, 출처 확인, 실패 제한(demo-gate.ts)
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { DemoLoginBody } from '@ff/contracts';
import type { Request, Response } from 'express';
import { PublicEndpoint } from '../actor';
import { ZodPipe } from '../zod.pipe';
import { DomainError } from '../errors';
import { AuthFailure, AuthService, LOGIN_COOKIE, LOGIN_TTL_SEC, SESSION_COOKIE } from './auth.service';
import { clearCookie, readCookie, setCookie } from './cookies';
import { DEMO_LOGIN_LIMIT, LoginThrottle } from './demo-gate';

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
  /** 데모 게이트 로그인 실패 제한(출처 IP별) */
  private readonly throttle = new LoginThrottle();
  /** 데모 게이트 로그인 성공(세션 생성) 한도(출처 IP별) */
  private readonly created = new LoginThrottle(DEMO_LOGIN_LIMIT);

  constructor(private readonly auth: AuthService) {}

  private cookieOpts() {
    return { secure: this.auth.sessions?.secure ?? false };
  }

  @Get('config')
  @PublicEndpoint()
  config() {
    return this.auth.gate ? { mode: this.auth.mode, gate: true } : { mode: this.auth.mode };
  }

  /** 공개 데모 게이트 로그인 — 맞으면 httpOnly 세션 쿠키(이 브라우저의 이전 세션은 지운다). 다른 사이트에서 보낸 로그인은 거부 */
  @Post('demo-login')
  @PublicEndpoint()
  @HttpCode(200)
  demoLogin(@Body(new ZodPipe(DemoLoginBody)) body: DemoLoginBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.auth.gate) throw new DomainError('NOT_FOUND', '데모 게이트가 켜져 있지 않습니다.');
    res.setHeader('Cache-Control', 'no-store');
    if (!this.auth.originAllowed(req)) throw new DomainError('FORBIDDEN', '요청 출처를 확인할 수 없습니다. 플랫폼 화면에서 다시 시도하세요.');
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const wait = this.throttle.blocked(key) || this.created.blocked(key);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      throw new DomainError('RATE_LIMITED', `로그인 시도가 많습니다. ${wait}초 뒤에 다시 시도하세요.`, { retryAfterSec: wait });
    }
    const cookie = this.auth.demoLogin(body.id, body.password);
    if (!cookie) {
      this.throttle.fail(key);
      throw new DomainError('UNAUTHENTICATED', 'ID 또는 비밀번호가 맞지 않습니다.');
    }
    this.throttle.reset(key);
    this.created.fail(key);
    this.auth.dropSession(req, 'AUTH_SESSION_REPLACED');
    setCookie(res, SESSION_COOKIE, cookie, { ...this.cookieOpts(), path: '/', maxAgeSec: this.auth.gate.sessionTtlMin * 60 });
    return { authenticated: true, mode: 'demo' as const, gate: true };
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
    if (this.auth.mode !== 'oidc' && !this.auth.gate) return {};
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
    if (this.auth.gate) return { authenticated: !!this.auth.sessionUser(req), mode: 'demo' as const, gate: true };
    if (this.auth.mode !== 'oidc') return { authenticated: false, mode: 'demo' as const };
    const who = await this.auth.identify(req);
    if (!who) return { authenticated: false, mode: 'oidc' as const };
    return { authenticated: true, mode: 'oidc' as const, user: { id: who.id, name: who.name, email: who.email, roles: who.roles } };
  }
}
