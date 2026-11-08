// 차량 요청 인증(출시 준비 RD-SEC-08) — 차량 창구(@VehicleEndpoint)의 신원을 머리글 주장만으로 받지 않는다.
//  · CMAC: 차량 키에서 파생한 요청 키로 (메서드·경로·VIN·epoch·시각·nonce·본문 해시)에 서명(contracts/rules/vehicle-auth.ts).
//    시각은 플랫폼 시계 ±5분, nonce는 창 안에서 VIN마다 한 번 — 재전송·늦은 재생을 막는다.
//  · mTLS: TLS를 끝내는 게이트웨이가 검증한 클라이언트 인증서 주체를 FF_VEHICLE_CERT_HEADER 머리글로 넘기면 그 주체(CN)가 차량 신원이다.
//    그 머리글은 신뢰 프록시(FF_TRUST_PROXY, express trust proxy)에서 온 요청에서만 믿는다 — 다른 곳에서 온 머리글은 거부한다.
//    인증서 주체와 X-Vehicle-Id가 다르면 거부. 둘 다(mTLS + CMAC) 오면 둘 다 확인한다.
//  · 방식(FF_VEHICLE_AUTH): required(운영 모드 기본·고정) — CMAC 또는 mTLS가 있어야 한다. demo(그 밖 기본) — 머리글만 와도 받되,
//    서명 머리글이 있으면 똑같이 엄격하게 확인한다(데모·시험 호환).
//  · 실패는 401 VEHICLE_UNAUTHENTICATED + 감사 DENIED + 보안 이벤트(14.4 진위 실패·재전송, D06-12가 onRejected로 받는다).
// 차량 키는 소프트웨어 HSM(D06-10)이 useKeySource로 알려 준다(커널이 도메인에 의존하지 않게).
import { Inject, Injectable } from '@nestjs/common';
import { VEHICLE_AUTH_FAILURES, VEHICLE_AUTH_FORMAT, VEHICLE_AUTH_HEADERS, VEHICLE_AUTH_SKEW_MS, vehicleRequestCanonical, type VehicleAuthFailure } from '@ff/contracts';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { Actor } from './actor';
import { AuditService } from './audit.service';
import { Clock } from './clock';
import { aesCmac, equalBytes } from './crypto';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { vehicleAuthModeOf, type VehicleAuthMode } from './vehicle-auth-config';
import { requestKeyOf, sha256Hex } from './vehicle-auth-client';

/** 차량 키 공급자 — 소프트웨어 HSM(D06-10), 나중에 HSM/KMS */
export interface VehicleKeySource {
  currentEpoch(): number;
  /** 그 epoch의 차량 키(16바이트) — epoch가 없으면 null */
  vehicleKey(vin: string, epoch: number): Buffer | null;
}

export interface VehicleAuthRejection {
  code: VehicleAuthFailure;
  /** 주장된 VIN(검증 전) — 보안 이벤트는 가명으로 남긴다 */
  vin: string | null;
  method: string;
  path: string;
  keyEpoch: number | null;
}

export interface VehicleIdentity {
  vin: string;
  via: 'mac' | 'mtls' | 'mtls+mac' | 'header';
}

const H = VEHICLE_AUTH_HEADERS;
const NONCE_PRUNE_EVERY = 200;

@Injectable()
export class VehicleAuthService {
  readonly mode: VehicleAuthMode = vehicleAuthModeOf();
  readonly certHeader: string | null = process.env.FF_VEHICLE_CERT_HEADER?.toLowerCase() || null;
  private keys: VehicleKeySource | null = null;
  private readonly listeners: ((r: VehicleAuthRejection) => void)[] = [];
  private calls = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  useKeySource(src: VehicleKeySource) {
    this.keys = src;
  }

  /** 거부 알림 — 보안 이벤트 모니터링(D06-12)이 등록한다 */
  onRejected(fn: (r: VehicleAuthRejection) => void) {
    this.listeners.push(fn);
  }

  /** 차량 요청의 신원 — 실패면 감사·보안 이벤트를 남기고 401 */
  authenticate(req: Request & { rawBody?: Buffer }): VehicleIdentity {
    const claimed = (req.header(H.vin) ?? '').trim() || null;
    const path = req.originalUrl ?? req.url;
    const ctx = { method: req.method, path, keyEpoch: null as number | null, correlationId: (req.header('x-correlation-id') ?? '').trim() || randomUUID() };
    const fail = (code: VehicleAuthFailure, vin: string | null, details: Record<string, unknown> = {}): never => {
      const actor: Actor = { id: `vehicle:${vin ?? 'unknown'}`, role: 'VEHICLE', correlationId: ctx.correlationId };
      this.audit.denied(actor, 'VEHICLE_REQUEST_AUTH', path, `${code}: ${VEHICLE_AUTH_FAILURES[code]}`);
      for (const l of this.listeners) {
        try {
          l({ code, vin, method: ctx.method, path, keyEpoch: ctx.keyEpoch });
        } catch {
          /* 보안 이벤트 기록 실패가 거부 응답을 바꾸지 않는다 */
        }
      }
      throw new DomainError('VEHICLE_UNAUTHENTICATED', `차량 요청 인증 실패 — ${VEHICLE_AUTH_FAILURES[code]}.`, { code, ...details });
    };

    // mTLS — 신뢰 프록시가 넘긴 인증서 주체
    let certVin: string | null = null;
    if (this.certHeader) {
      const raw = req.header(this.certHeader);
      if (raw !== undefined) {
        const trust = req.app?.get?.('trust proxy fn') as ((addr: string | undefined, i: number) => boolean) | undefined;
        if (!trust || !trust(req.socket?.remoteAddress, 0)) fail('REQUEST_PROXY_UNTRUSTED', claimed);
        certVin = subjectVin(raw);
        if (!certVin) fail('REQUEST_AUTH_MALFORMED', claimed, { header: this.certHeader });
        if (claimed && claimed !== certVin) fail('REQUEST_IDENTITY_MISMATCH', claimed);
      }
    }
    const vin = certVin ?? claimed;
    const signed = [H.epoch, H.timestamp, H.nonce, H.mac].some((h) => req.header(h) !== undefined);
    if (signed) {
      if (!vin) fail('REQUEST_AUTH_MALFORMED', null);
      this.verifyMac(req, vin!, ctx, fail);
      return { vin: vin!, via: certVin ? 'mtls+mac' : 'mac' };
    }
    if (certVin) return { vin: certVin, via: 'mtls' };
    if (this.mode === 'required') fail('REQUEST_AUTH_MISSING', claimed);
    if (!claimed) {
      this.audit.denied({ id: 'vehicle:unknown', role: 'VEHICLE', correlationId: ctx.correlationId }, 'VEHICLE_REQUEST', path, '차량 신원 없음');
      throw new DomainError('VEHICLE_UNAUTHENTICATED', '차량 요청에는 차량 신원(X-Vehicle-Id)이 필요합니다.');
    }
    return { vin: claimed!, via: 'header' };
  }

  private verifyMac(req: Request & { rawBody?: Buffer }, vin: string, ctx: { method: string; path: string; keyEpoch: number | null }, fail: (code: VehicleAuthFailure, vin: string | null, d?: Record<string, unknown>) => never) {
    const epochS = req.header(H.epoch) ?? '';
    const ts = req.header(H.timestamp) ?? '';
    const nonce = req.header(H.nonce) ?? '';
    const mac = req.header(H.mac) ?? '';
    const F = VEHICLE_AUTH_FORMAT;
    if (!F.vin.test(vin) || !F.epoch.test(epochS) || !F.timestamp.test(ts) || !F.nonce.test(nonce) || !F.mac.test(mac)) fail('REQUEST_AUTH_MALFORMED', vin);
    const epoch = Number(epochS);
    ctx.keyEpoch = epoch;
    if (!this.keys) throw new Error('차량 키 공급자가 없습니다(소프트웨어 HSM 미등록)');
    const current = this.keys.currentEpoch();
    if (epoch !== current) fail('REQUEST_KEY_EPOCH', vin, { currentEpoch: current });
    const now = this.clock.now().getTime();
    if (Math.abs(now - Number(ts)) > VEHICLE_AUTH_SKEW_MS) fail('REQUEST_TIME_SKEW', vin, { serverTime: now, skewMs: VEHICLE_AUTH_SKEW_MS });
    // 본문은 파싱 전 원문 바이트로 — 원문이 없으면(본문 있는 요청인데 rawBody 꺼짐) 확인할 수 없으니 거부
    const raw = req.rawBody;
    const hasBody = !!req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
    if (!raw && hasBody) fail('REQUEST_AUTH_MALFORMED', vin, { reason: 'RAW_BODY_UNAVAILABLE' });
    const vehicleKey = this.keys.vehicleKey(vin, epoch);
    if (!vehicleKey) fail('REQUEST_KEY_EPOCH', vin, { currentEpoch: current });
    const expected = aesCmac(requestKeyOf(vehicleKey!), Buffer.from(vehicleRequestCanonical({ method: req.method, path: ctx.path, vin, keyEpoch: epoch, timestamp: ts, nonce, bodySha256: sha256Hex(raw ?? '') }), 'utf8'));
    if (!equalBytes(expected, Buffer.from(mac, 'base64url'))) fail('REQUEST_MAC_INVALID', vin);
    // 서명이 맞는 요청만 nonce를 쓴다(위조 요청이 진짜 차량의 nonce를 먼저 태우지 못하게)
    const at = new Date(now).toISOString();
    if (++this.calls % NONCE_PRUNE_EVERY === 0) this.db.run('DELETE FROM vehicle_request_nonce WHERE at < ?', new Date(now - 2 * VEHICLE_AUTH_SKEW_MS).toISOString());
    const inserted = this.db.run('INSERT OR IGNORE INTO vehicle_request_nonce (vin, nonce, at) VALUES (?, ?, ?)', vin, nonce, at).changes;
    if (!inserted) fail('REQUEST_REPLAY', vin);
  }
}

/** 인증서 주체 → VIN — "CN=<VIN>,O=…"(RFC 2253)·"/CN=<VIN>/O=…"(OpenSSL)·URL 인코딩, CN이 없으면 값 전체 */
export function subjectVin(raw: string): string | null {
  let v = raw.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    /* 인코딩되지 않은 값 */
  }
  const cn = /(?:^|[,/])\s*CN\s*=\s*([^,/+]+)/i.exec(v);
  const id = (cn ? cn[1] : v).trim();
  return VEHICLE_AUTH_FORMAT.vin.test(id) ? id : null;
}
