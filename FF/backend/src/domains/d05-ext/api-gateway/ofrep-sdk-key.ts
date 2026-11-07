// OFREP SDK 키(D05-01, 2026-11-07 결정 C8 (b)) — 평가 결과는 Feature 구성을 드러내므로 OFREP 경로는 SDK 키가 필수다.
//  · 가드: Authorization: Bearer <키>(OFREP 표준) 또는 X-Api-Key. 검증은 외부 API 키(kernel/auth/api-key.ts — 해시·폐기·만료)와 같다.
//    틀리면 401, 본문은 OFREP 오류 규격({errorCode, errorDetails}). 통과하면 행위자 apikey:<키 ID>
//  · 데모 기본 키: 데모 인증 방식(contracts demoSdkKeyEnabled)에서만 예약 ID AK-0000을 부팅 때 둔다(원문은 공개 상수 DEMO_SDK_KEY).
//    폐기하면 되살리지 않는다. 회사 SSO 설치에는 만들지 않는다 — 보안 담당이 발급한 키만 받는다
import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { API_KEY_MAX_DAYS, apiKeyPrefix, DEMO_SDK_KEY, DEMO_SDK_KEY_ID, demoSdkKeyEnabled } from '@ff/contracts';
import type { Request } from 'express';
import type { Actor } from '../../../kernel/actor';
import { apiKeyHash, ApiKeyAuth } from '../../../kernel/auth/api-key';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';

const SEEDER: Actor = { id: 'system:demo-sdk-key', role: 'SYSTEM', correlationId: 'seed-demo-sdk-key' };

@Injectable()
export class OfrepSdkKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeyAuth) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    try {
      req.actor = this.keys.authenticateSdk(req, `OFREP ${req.path}`);
    } catch (err) {
      if (err instanceof DomainError) throw new HttpException({ errorCode: 'UNAUTHENTICATED', errorDetails: err.message }, 401);
      throw err;
    }
    return true;
  }
}

@Injectable()
export class DemoSdkKeySeeder implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** 데모 기본 키 — 없으면 만들고, 살아 있으면 만료일을 오늘부터 상한(365일)으로 늘린다. 폐기된 키는 그대로 둔다 */
  onApplicationBootstrap() {
    if (!demoSdkKeyEnabled(process.env)) return;
    const now = this.clock.iso();
    const expiresOn = new Date(Date.parse(`${now.slice(0, 10)}T00:00:00Z`) + API_KEY_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
    this.db.tx(() => {
      const row = this.db.get<{ status: string }>('SELECT status FROM api_key WHERE key_id = ?', DEMO_SDK_KEY_ID);
      if (row?.status === 'REVOKED') return;
      if (row) {
        this.db.run('UPDATE api_key SET expires_on = ? WHERE key_id = ?', expiresOn, DEMO_SDK_KEY_ID);
        return;
      }
      const doc = { keyId: DEMO_SDK_KEY_ID, name: '데모 기본 SDK 키', system: 'OpenFeature SDK(데모)', role: 'AUDITOR', prefix: apiKeyPrefix(DEMO_SDK_KEY), createdBy: SEEDER.id, createdAt: now, expiresOn, issueReason: '데모 설치 기본 키 — OFREP 평가는 SDK 키 필수(공개 데모 값)', revokedAt: null, revokedBy: null, revokeReason: null };
      this.db.run("INSERT INTO api_key (key_id, hash, status, expires_on, last_used_at, doc) VALUES (?, ?, 'ACTIVE', ?, NULL, ?)", DEMO_SDK_KEY_ID, apiKeyHash(DEMO_SDK_KEY), expiresOn, JSON.stringify(doc));
      this.audit.record(SEEDER, 'API_KEY_ISSUE', DEMO_SDK_KEY_ID, { after: { name: doc.name, system: doc.system, role: doc.role, prefix: doc.prefix, expiresOn }, reason: doc.issueReason, componentId: 'D05-01' });
    });
  }
}
