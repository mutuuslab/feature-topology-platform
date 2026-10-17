// 인증서·키 관리 PKI/KMS (D06-10) — 게시본 서명 키(Ed25519, node:crypto). 개인키는 데모용으로 DB에 두며
// 실제 KMS/HSM 연동은 이 서비스 뒤로 숨긴다. 차량은 공개키(신뢰 앵커)로만 검증한다.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Post } from '@nestjs/common';
import { canonicalJson, COMMAND_KEY_PURPOSE, KeyRotateBody, type KeyPurpose, type Signature } from '@ff/contracts';
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
  /** 키 용도 — 다른 용도로 서명한 명령은 검증 실패(FFG-SEC-002) */
  purpose: KeyPurpose;
  epoch: number;
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
    this.ensure('policy');
  }

  /** 용도별 활성 키를 보장 — 정책 키는 부팅 때, 나머지 용도는 처음 쓸 때 만든다(기존 키 번호를 바꾸지 않게) */
  private ensure(purpose: KeyPurpose) {
    if (!this.db.get("SELECT key_id FROM pki_key WHERE status = 'ACTIVE' AND purpose = ?", purpose)) {
      if (this.db.inTransaction) this.generate(purpose);
      else this.db.tx(() => this.generate(purpose));
    }
  }

  private generate(purpose: KeyPurpose = 'policy'): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM pki_key')!.n + 1;
    const keyId = `KEY-${String(n).padStart(4, '0')}`;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const now = this.clock.now();
    this.db.run(
      "INSERT INTO pki_key (key_id, status, created_at, not_after, public_pem, private_pem, purpose) VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?)",
      keyId,
      now.toISOString(),
      new Date(now.getTime() + KEY_LIFETIME_DAYS * 86400_000).toISOString(),
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      purpose,
    );
    return keyId;
  }

  keys(): KeyInfo[] {
    return this.db
      .all<{ key_id: string; status: KeyInfo['status']; created_at: string; not_after: string; retired_at: string | null; public_pem: string; purpose: KeyPurpose; epoch: number }>('SELECT key_id, status, created_at, not_after, retired_at, public_pem, purpose, epoch FROM pki_key ORDER BY key_id')
      .map((r) => ({
        keyId: r.key_id,
        alg: 'Ed25519',
        purpose: r.purpose,
        epoch: r.epoch,
        status: r.status,
        createdAt: r.created_at,
        notAfter: r.not_after,
        retiredAt: r.retired_at,
        publicKeyPem: r.public_pem,
        fingerprint: 'sha256:' + createHash('sha256').update(createPublicKey(r.public_pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16),
      }));
  }

  /**
   * 차량 신뢰 저장소 프로비저닝(모의 공장) — 차량 명령 용도 키(kill·restore·activate·sync)를 모두 보장하고 그 공개키를 돌려준다.
   * 용도 키는 처음 쓸 때 만들어지므로, 차량에 넣을 신뢰 앵커는 이 묶음으로 미리 받는다(모르는 kid의 봉투는 Guard가 SIGNATURE_INVALID).
   */
  vehicleTrust(): KeyInfo[] {
    const purposes = new Set<KeyPurpose>(Object.values(COMMAND_KEY_PURPOSE));
    for (const p of purposes) this.ensure(p);
    return this.keys().filter((k) => k.status === 'ACTIVE' && purposes.has(k.purpose));
  }

  /** 게시본 서명 — 정규 JSON의 sha256을 그 용도의 활성 키로 서명 */
  sign(payload: unknown, purpose: KeyPurpose = 'policy'): Signature {
    this.ensure(purpose); // 부팅 순서와 무관하게 활성 키를 보장한다
    const k = this.db.get<{ key_id: string; private_pem: string; not_after: string }>("SELECT key_id, private_pem, not_after FROM pki_key WHERE status = 'ACTIVE' AND purpose = ?", purpose);
    if (!k) throw new DomainError('INTERNAL', '활성 서명 키가 없습니다.');
    // 만료된 키로는 서명하지 않는다 — 차량 검증(같은 규칙)이 KEY_EXPIRED로 거부할 게시본을 만들지 않는다(5년 운영 재생에서 발견: 1년 뒤 배포가 전부 TIMEOUT)
    if (Date.parse(k.not_after) < this.clock.now().getTime())
      throw new DomainError('GUARD_FAILED', `${purpose} 서명 키 ${k.key_id}가 ${k.not_after.slice(0, 10)}에 만료되었습니다 — 키를 교체한 뒤 다시 시도하세요(POST /api/pki/rotate).`, { keyId: k.key_id, purpose, notAfter: k.not_after });
    const hash = payloadHash(payload);
    const signature = sign(null, Buffer.from(hash), createPrivateKey(k.private_pem)).toString('base64');
    return { keyId: k.key_id, alg: 'Ed25519', payloadHash: hash, signature };
  }

  /**
   * 차량 측 검증과 같은 규칙 — 공개키(신뢰 앵커)·유효기간·본문 해시·서명.
   * 교체된(RETIRED) 키의 서명은 유효기간 안이면 계속 검증된다(이미 배포된 게시본 보호).
   */
  /**
   * expected — 이 명령이 요구하는 키 용도. 다른 용도의 키로 서명했으면 무효.
   * @rule FFG-SEC-002 — kid 용도 고정. 키 계층(Root M-of-N)·유출 대응 1시간·폐기 훈련은 운영 절차(WP10)
   */
  verify(payload: unknown, sig: Signature, trust: KeyInfo[] = this.keys(), expected?: KeyPurpose): { valid: boolean; reason: string } {
    const key = trust.find((k) => k.keyId === sig.keyId);
    if (!key) return { valid: false, reason: 'UNKNOWN_KEY' };
    if (expected && key.purpose !== expected) return { valid: false, reason: 'WRONG_KEY_PURPOSE' };
    if (new Date(key.notAfter).getTime() < this.clock.now().getTime()) return { valid: false, reason: 'KEY_EXPIRED' };
    if (payloadHash(payload) !== sig.payloadHash) return { valid: false, reason: 'PAYLOAD_TAMPERED' };
    const ok = verify(null, Buffer.from(sig.payloadHash), createPublicKey(key.publicKeyPem), Buffer.from(sig.signature, 'base64'));
    return ok ? { valid: true, reason: 'SIGNATURE_VALID' } : { valid: false, reason: 'BAD_SIGNATURE' };
  }

/** 분리 서명용 원시 서명(Ed25519 64바이트) — 소프트웨어 HSM(hsm.service.ts)만 쓴다. 개인키는 이 서비스 밖으로 나가지 않는다 */
  signRaw(purpose: KeyPurpose, bytes: Buffer): { kid: string; sig: Buffer } {
    this.ensure(purpose);
    const k = this.db.get<{ key_id: string; private_pem: string; not_after: string }>("SELECT key_id, private_pem, not_after FROM pki_key WHERE status = 'ACTIVE' AND purpose = ?", purpose)!;
    if (Date.parse(k.not_after) < this.clock.now().getTime())
      throw new DomainError('GUARD_FAILED', `${purpose} 서명 키 ${k.key_id}가 ${k.not_after.slice(0, 10)}에 만료되었습니다 — 키를 교체한 뒤 다시 시도하세요(POST /api/pki/rotate).`, { keyId: k.key_id, purpose, notAfter: k.not_after });
    return { kid: k.key_id, sig: sign(null, bytes, createPrivateKey(k.private_pem)) };
  }

  /** kid의 공개키·용도 — 교체된 키도 검증용으로 남는다 */
  publicKey(kid: string): { pem: string; purpose: KeyPurpose; notAfter: string } | null {
    const r = this.db.get<{ public_pem: string; purpose: KeyPurpose; not_after: string }>('SELECT public_pem, purpose, not_after FROM pki_key WHERE key_id = ?', kid);
    return r ? { pem: r.public_pem, purpose: r.purpose, notAfter: r.not_after } : null;
  }

  rotate(actor: Actor, reason: string, purpose: KeyPurpose = 'policy') {
    return this.db.tx(() => {
      const prev = this.db.get<{ key_id: string }>("SELECT key_id FROM pki_key WHERE status = 'ACTIVE' AND purpose = ?", purpose);
      if (prev) this.db.run("UPDATE pki_key SET status = 'RETIRED', retired_at = ? WHERE key_id = ?", this.clock.iso(), prev.key_id);
      const keyId = this.generate(purpose);
      this.audit.record(actor, 'PKI_ROTATE', keyId, { before: { active: prev?.key_id ?? null }, after: { active: keyId, purpose }, reason, componentId: 'D06-10' });
      this.events.publish('pki.key.rotated', keyId, { keyId, purpose, retired: prev?.key_id ?? null }, { componentId: 'D06-10', correlationId: actor.correlationId });
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
    return this.pki.rotate(actor, body.reason, body.purpose);
  }
}
