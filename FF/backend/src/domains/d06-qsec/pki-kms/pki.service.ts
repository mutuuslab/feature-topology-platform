// 인증서·키 관리 PKI/KMS (D06-10) — 게시본 서명 키(Ed25519, node:crypto). 개인키는 데모용으로 DB에 두며
// 실제 KMS/HSM 연동은 이 서비스 뒤로 숨긴다. 차량은 공개키(신뢰 앵커)로만 검증한다.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Post } from '@nestjs/common';
import { canonicalJson, KeyRotateBody, type Signature } from '@ff/contracts';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';

const KEY_LIFETIME_DAYS = 365;

export interface KeyInfo {
  keyId: string;
  alg: 'Ed25519';
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  notAfter: string;
  retiredAt: string | null;
  publicKeyPem: string;
  fingerprint: string;
}

export const payloadHash = (payload: unknown) => 'sha256:' + createHash('sha256').update(canonicalJson(payload)).digest('hex');

@Injectable()
@PlatformComponent('D06-10')
export class PkiService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  onModuleInit() {
    if (!this.db.get("SELECT key_id FROM pki_key WHERE status = 'ACTIVE'")) this.db.tx(() => this.generate());
  }

  private generate(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM pki_key')!.n + 1;
    const keyId = `KEY-${String(n).padStart(4, '0')}`;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const now = this.clock.now();
    this.db.run(
      "INSERT INTO pki_key (key_id, status, created_at, not_after, public_pem, private_pem) VALUES (?, 'ACTIVE', ?, ?, ?, ?)",
      keyId,
      now.toISOString(),
      new Date(now.getTime() + KEY_LIFETIME_DAYS * 86400_000).toISOString(),
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    return keyId;
  }

  keys(): KeyInfo[] {
    return this.db
      .all<{ key_id: string; status: KeyInfo['status']; created_at: string; not_after: string; retired_at: string | null; public_pem: string }>('SELECT key_id, status, created_at, not_after, retired_at, public_pem FROM pki_key ORDER BY key_id')
      .map((r) => ({
        keyId: r.key_id,
        alg: 'Ed25519',
        status: r.status,
        createdAt: r.created_at,
        notAfter: r.not_after,
        retiredAt: r.retired_at,
        publicKeyPem: r.public_pem,
        fingerprint: 'sha256:' + createHash('sha256').update(createPublicKey(r.public_pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16),
      }));
  }

  /** 게시본 서명 — 정규 JSON의 sha256을 활성 키로 서명 */
  sign(payload: unknown): Signature {
    this.onModuleInit(); // 부팅 순서와 무관하게 활성 키를 보장한다
    const k = this.db.get<{ key_id: string; private_pem: string }>("SELECT key_id, private_pem FROM pki_key WHERE status = 'ACTIVE'");
    if (!k) throw new DomainError('INTERNAL', '활성 서명 키가 없습니다.');
    const hash = payloadHash(payload);
    const signature = sign(null, Buffer.from(hash), createPrivateKey(k.private_pem)).toString('base64');
    return { keyId: k.key_id, alg: 'Ed25519', payloadHash: hash, signature };
  }

  /**
   * 차량 측 검증과 같은 규칙 — 공개키(신뢰 앵커)·유효기간·본문 해시·서명.
   * 교체된(RETIRED) 키의 서명은 유효기간 안이면 계속 검증된다(이미 배포된 게시본 보호).
   */
  verify(payload: unknown, sig: Signature, trust: KeyInfo[] = this.keys()): { valid: boolean; reason: string } {
    const key = trust.find((k) => k.keyId === sig.keyId);
    if (!key) return { valid: false, reason: 'UNKNOWN_KEY' };
    if (new Date(key.notAfter).getTime() < this.clock.now().getTime()) return { valid: false, reason: 'KEY_EXPIRED' };
    if (payloadHash(payload) !== sig.payloadHash) return { valid: false, reason: 'PAYLOAD_TAMPERED' };
    const ok = verify(null, Buffer.from(sig.payloadHash), createPublicKey(key.publicKeyPem), Buffer.from(sig.signature, 'base64'));
    return ok ? { valid: true, reason: 'SIGNATURE_VALID' } : { valid: false, reason: 'BAD_SIGNATURE' };
  }

  rotate(actor: Actor, reason: string) {
    return this.db.tx(() => {
      const prev = this.db.get<{ key_id: string }>("SELECT key_id FROM pki_key WHERE status = 'ACTIVE'");
      if (prev) this.db.run("UPDATE pki_key SET status = 'RETIRED', retired_at = ? WHERE key_id = ?", this.clock.iso(), prev.key_id);
      const keyId = this.generate();
      this.audit.record(actor, 'PKI_ROTATE', keyId, { before: { active: prev?.key_id ?? null }, after: { active: keyId }, reason, componentId: 'D06-10' });
      this.events.publish('pki.key.rotated', keyId, { keyId, retired: prev?.key_id ?? null }, { componentId: 'D06-10', correlationId: actor.correlationId });
      return this.keys().find((k) => k.keyId === keyId)!;
    });
  }
}

@Controller('api/pki')
export class PkiController {
  constructor(private readonly pki: PkiService) {}

  @Get('keys')
  keys() {
    return { items: this.pki.keys() };
  }

  @Post('rotate')
  @Roles('SAFETY_OFFICER')
  @AuditAction('PKI_ROTATE')
  rotate(@CurrentActor() actor: Actor, @Body(new ZodPipe(KeyRotateBody)) body: KeyRotateBody) {
    return this.pki.rotate(actor, body.reason);
  }
}
