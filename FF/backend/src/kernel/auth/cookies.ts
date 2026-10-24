// 쿠키 — 의존성 없이 Cookie 머리글을 읽고, HMAC-SHA256으로 서명한 값만 받는다.
// 서명 비교는 상수 시간(timingSafeEqual). 값 자체는 로그·오류·감사에 남기지 않는다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/** Cookie 머리글 — 이름이 같으면 처음 값(브라우저는 더 구체적인 경로를 먼저 보낸다). 머리글이 너무 크면 읽지 않는다 */
export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.cookie;
  if (typeof h !== 'string' || h.length > 8192) return null;
  for (const kv of h.split(';')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    if (kv.slice(0, i).trim() !== name) continue;
    const v = kv.slice(i + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  return null;
}

const mac = (secret: string, purpose: string, value: string) => createHmac('sha256', secret).update(`${purpose}\n${value}`).digest('base64url');

/** 용도별 서명 — 같은 비밀로 서명한 다른 쿠키를 바꿔 끼울 수 없다 */
export function signValue(secret: string, purpose: string, value: string): string {
  return `${value}.${mac(secret, purpose, value)}`;
}

/** 서명이 맞으면 값, 아니면 null */
export function unsignValue(secret: string, purpose: string, signed: string | null): string | null {
  if (!signed || signed.length > 4096) return null;
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  const got = Buffer.from(signed.slice(i + 1));
  const want = Buffer.from(mac(secret, purpose, value));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return value;
}

export interface CookieOpts {
  maxAgeSec?: number;
  path?: string;
  secure: boolean;
  sameSite?: 'Lax' | 'Strict';
}

export function setCookie(res: Response, name: string, value: string, o: CookieOpts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSec))}`);
  if (o.secure) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

export function clearCookie(res: Response, name: string, o: Omit<CookieOpts, 'maxAgeSec'>) {
  setCookie(res, name, '', { ...o, maxAgeSec: 0 });
}

function appendSetCookie(res: Response, line: string) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev === undefined ? [] : Array.isArray(prev) ? prev.map(String) : [String(prev)];
  res.setHeader('Set-Cookie', [...list, line]);
}

/** 상수 시간 문자열 비교 — 길이가 다르면 false */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
