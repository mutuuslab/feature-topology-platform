// 외부 시스템 API 키 관리(D05-01, FR-AGW-001-003~005) — 발급(원문 1회·해시 저장·키→역할)·목록(빈 목록·상태·마지막 사용)·삭제(폐기, 해시 지움).
// 인증 자체는 커널 역할 가드(kernel/auth/api-key.ts)가 한다. 원문은 발급 응답에만 있고 감사·이벤트·저장 문서에는 앞부분만 남긴다.
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { API_KEY_ADMIN_ROLES, apiKeyExpiry, apiKeyPrefix, apiKeyState, IssueApiKeyBody, RevokeApiKeyBody, type ApiKeyRole, type ApiKeyView, type IssuedApiKey } from '@ff/contracts';
import { randomBytes } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../../kernel/actor';
import { apiKeyHash } from '../../../../kernel/auth/api-key';
import { AuditService } from '../../../../kernel/audit.service';
import { Clock } from '../../../../kernel/clock';
import { PlatformComponent } from '../../../../kernel/components';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { EventService } from '../../../../kernel/event.service';
import { ZodPipe } from '../../../../kernel/zod.pipe';

interface KeyDoc {
  keyId: string;
  name: string;
  system: string;
  role: ApiKeyRole;
  prefix: string;
  createdBy: string;
  createdAt: string;
  expiresOn: string;
  issueReason: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

@Injectable()
@PlatformComponent('D05-01')
export class ApiKeyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  private view(doc: KeyDoc, lastUsedAt: string | null): ApiKeyView {
    const now = this.clock.iso();
    return {
      keyId: doc.keyId,
      name: doc.name,
      system: doc.system,
      role: doc.role,
      prefix: doc.prefix,
      state: apiKeyState(doc, now),
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      expiresOn: doc.expiresOn,
      lastUsedAt,
      revokedAt: doc.revokedAt,
      revokedBy: doc.revokedBy,
      revokeReason: doc.revokeReason,
    };
  }

  /**
   * 목록 — 최근 발급 순. 없으면 빈 목록
   * @req FR-AGW-001-004
   */
  list(): ApiKeyView[] {
    return this.db.all<{ doc: string; last_used_at: string | null }>('SELECT doc, last_used_at FROM api_key ORDER BY key_id DESC').map((r) => this.view(JSON.parse(r.doc), r.last_used_at));
  }

  /**
   * 발급 — 비밀 32바이트(base64url), 원문은 이 응답 한 번. 저장은 SHA-256 해시
   * @req FR-AGW-001-003
   */
  issue(actor: Actor, body: IssueApiKeyBody): IssuedApiKey {
    const now = this.clock.iso();
    const exp = apiKeyExpiry(body.expiresOn, now);
    if (exp.ok === false) throw new DomainError('VALIDATION', exp.reason);
    return this.db.tx(() => {
      const n = (this.db.get<{ n: number | null }>("SELECT max(CAST(substr(key_id, 4) AS INTEGER)) AS n FROM api_key")?.n ?? 0) + 1;
      const keyId = `AK-${String(n).padStart(4, '0')}`;
      const secret = `ffk_${keyId}_${randomBytes(32).toString('base64url')}`;
      const doc: KeyDoc = { keyId, name: body.name, system: body.system, role: body.role, prefix: apiKeyPrefix(secret), createdBy: actor.id, createdAt: now, expiresOn: exp.expiresOn, issueReason: body.reason, revokedAt: null, revokedBy: null, revokeReason: null };
      this.db.run("INSERT INTO api_key (key_id, hash, status, expires_on, last_used_at, doc) VALUES (?, ?, 'ACTIVE', ?, NULL, ?)", keyId, apiKeyHash(secret), doc.expiresOn, JSON.stringify(doc));
      const after = { name: doc.name, system: doc.system, role: doc.role, prefix: doc.prefix, expiresOn: doc.expiresOn };
      this.audit.record(actor, 'API_KEY_ISSUE', keyId, { after, reason: body.reason, componentId: 'D05-01' });
      this.events.publish('apikey.issued', keyId, { keyId, ...after, by: actor.id }, { componentId: 'D05-01', correlationId: actor.correlationId });
      return { ...this.view(doc, null), secret };
    });
  }

  /**
   * 삭제 — 폐기 상태·시각·사유를 남기고 해시를 지운다. 이후 이 키의 요청은 401(kernel/auth/api-key.ts)
   * @req FR-AGW-001-005
   */
  revoke(actor: Actor, keyId: string, body: RevokeApiKeyBody): ApiKeyView {
    return this.db.tx(() => {
      const row = this.db.get<{ doc: string; last_used_at: string | null; status: string }>('SELECT doc, last_used_at, status FROM api_key WHERE key_id = ?', keyId);
      if (!row) throw new DomainError('NOT_FOUND', `API 키 ${keyId}을(를) 찾을 수 없습니다.`);
      if (row.status === 'REVOKED') throw new DomainError('CONFLICT', `API 키 ${keyId}은(는) 이미 삭제(폐기)되었습니다.`);
      const before = JSON.parse(row.doc) as KeyDoc;
      const doc: KeyDoc = { ...before, revokedAt: this.clock.iso(), revokedBy: actor.id, revokeReason: body.reason };
      this.db.run("UPDATE api_key SET hash = NULL, status = 'REVOKED', doc = ? WHERE key_id = ?", JSON.stringify(doc), keyId);
      this.audit.record(actor, 'API_KEY_REVOKE', keyId, { before: { state: apiKeyState(before, doc.revokedAt!), system: before.system, role: before.role }, after: { state: 'REVOKED' }, reason: body.reason, componentId: 'D05-01' });
      this.events.publish('apikey.revoked', keyId, { keyId, system: doc.system, role: doc.role, by: actor.id, reason: body.reason }, { componentId: 'D05-01', correlationId: actor.correlationId });
      return this.view(doc, row.last_used_at);
    });
  }
}

@Controller('api/api-keys')
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  list() {
    return { items: this.keys.list() };
  }

  @Post()
  @Roles(...API_KEY_ADMIN_ROLES)
  @AuditAction('API_KEY_ISSUE')
  issue(@CurrentActor() actor: Actor, @Body(new ZodPipe(IssueApiKeyBody)) body: IssueApiKeyBody) {
    return this.keys.issue(actor, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles(...API_KEY_ADMIN_ROLES)
  @AuditAction('API_KEY_REVOKE')
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RevokeApiKeyBody)) body: RevokeApiKeyBody) {
    return this.keys.revoke(actor, id, body);
  }
}
