// 외부 시스템 API 키 인증(D05-01, FR-AGW-001-003~005) — X-Api-Key 머리글이 오면 행위자 머리글 대신 키 신원으로 처리한다.
// 저장소에는 원문의 SHA-256만 있다(api_key, migration 161). 키 ID로 행을 찾고 해시를 상수 시간으로 비교한다.
// 틀린·폐기·만료 키는 401 UNAUTHENTICATED(감사 DENIED). 통과하면 행위자 `apikey:<키 ID>`, 역할은 키에 묶인 역할(SYSTEM·AUDITOR).
import { Inject, Injectable } from '@nestjs/common';
import { API_KEY_HEADER, apiKeyState, parseApiKey, type ApiKeyRole } from '@ff/contracts';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Actor } from '../actor';
import { AuditService } from '../audit.service';
import { Clock } from '../clock';
import { DB, type Db } from '../db';
import { DomainError } from '../errors';

export const apiKeyHash = (raw: string) => createHash('sha256').update(raw.trim(), 'utf8').digest('hex');

interface KeyRow {
  key_id: string;
  hash: string | null;
  status: 'ACTIVE' | 'REVOKED';
  expires_on: string;
  doc: string;
}

@Injectable()
export class ApiKeyAuth {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** 요청에 API 키가 없으면 null. 있으면 키 신원 — 틀리면 401(감사 DENIED) */
  authenticate(req: Request, action: string): Actor | null {
    const raw = (req.header(API_KEY_HEADER) ?? '').trim();
    if (!raw) return null;
    const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
    const parsed = parseApiKey(raw);
    const reject = (keyId: string, why: string, message: string): never => {
      this.audit.denied({ id: `apikey:${keyId}`, role: 'SYSTEM', correlationId }, action, req.path, why, 'D05-01');
      throw new DomainError('UNAUTHENTICATED', message);
    };
    if (!parsed) return reject('invalid', 'API 키 모양이 아님', 'API 키가 올바르지 않습니다. 발급받은 키 원문을 X-Api-Key 머리글에 넣으세요.');
    const row = this.db.get<KeyRow>('SELECT key_id, hash, status, expires_on, doc FROM api_key WHERE key_id = ?', parsed.keyId);
    if (row?.status === 'REVOKED') return reject(parsed.keyId, '폐기된 API 키', '폐기된 API 키입니다. 보안 담당에게 새 키 발급을 요청하세요.');
    const want = Buffer.from(row?.hash ?? '0'.repeat(64), 'hex');
    const got = Buffer.from(apiKeyHash(raw), 'hex');
    if (!row?.hash || !timingSafeEqual(want, got)) return reject(parsed.keyId, 'API 키 해시 불일치·없는 키', 'API 키가 올바르지 않습니다. 발급받은 키 원문을 X-Api-Key 머리글에 넣으세요.');
    const now = this.clock.iso();
    if (apiKeyState({ revokedAt: null, expiresOn: row.expires_on }, now) === 'EXPIRED') return reject(parsed.keyId, `만료된 API 키(${row.expires_on})`, `만료된 API 키입니다(만료일 ${row.expires_on}). 보안 담당에게 새 키 발급을 요청하세요.`);
    const doc = JSON.parse(row.doc) as { role: ApiKeyRole };
    // 마지막 사용 — 변경 트랜잭션 밖(요청 처리 전)에서 기록한다
    this.db.run('UPDATE api_key SET last_used_at = ? WHERE key_id = ?', now, row.key_id);
    return { id: `apikey:${row.key_id}`, role: doc.role, roles: [doc.role], correlationId };
  }
}
