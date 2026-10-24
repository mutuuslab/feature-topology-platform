// 소프트웨어 HSM (D06-10) — 보고서 v1.1 8.2·8.3·9.6의 서명·인증 연산을 한곳에 둔다. 실제 HSM/KMS 연동은 이 서비스 뒤로 숨긴다.
//  · 분리 서명(JWS detached, EdDSA): 용도별 kid로 JCS 정규화 바이트에 서명 — 64바이트 원시 서명을 base64url(86자)로
//  · 승인자 개인 서명(approval_sig): 사람마다 키 — 데모에서는 FIDO2·스마트카드 대신 이 서비스가 보관.
//    oidc(운영)에서는 승인 중에 키를 즉석으로 만들지 않는다 — SSO 로그인(세션 생성) 때 검증된 주체의 키를 등록하고(감사 APPROVER_KEY_ENROLLED),
//    등록되지 않은 주체의 승인은 거부한다. 헤더로 사용자 ID를 바꿔 승인자 둘을 흉내 내던 길을 막는다(출시 준비 RD-SEC-05).
//  · 차량 키(epoch별 HKDF 파생)와 AES-CMAC-128 — 봉투 cmd_auth·상태 증명 state_auth(16바이트 → base64url 22자)
//  · 저장하는 개인키·차량 루트 비밀은 KEK로 봉인한다(출시 준비 RD-SEC-06, kernel/kms) — DB에는 봉인본만 있다
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Post } from '@nestjs/common';
import { b64url, EpochBumpBody, fromB64url, type KeyPurpose } from '@ff/contracts';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { AuthService, type AuthUser } from '../../../kernel/auth/auth.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { aesCmac, equalBytes, hkdf16 } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { SecretVault } from '../../../kernel/kms/key-protection';
import { openFor, sealFor } from '../../../kernel/kms/secret-columns';
import { EventService } from '../../../kernel/event.service';
import { VehicleAuthService, type VehicleKeySource } from '../../../kernel/vehicle-auth';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PkiService } from './pki.service';

export interface DetachedSig {
  alg: 'EdDSA';
  kid: string;
  /** base64url 64바이트 원시 서명(86자) — DER 아님 */
  value: string;
}

const VEHICLE_ROOT = 'vehicle_root';

@Injectable()
@PlatformComponent('D06-10')
export class HsmService implements OnModuleInit, VehicleKeySource {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly pki: PkiService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly auth: AuthService,
    private readonly vault: SecretVault,
    private readonly vehicleAuth: VehicleAuthService,
  ) {}

  onModuleInit() {
    // 차량 요청 CMAC(RD-SEC-08) — 요청 키는 이 HSM의 차량 키에서 파생한다
    this.vehicleAuth.useKeySource(this);
    // oidc — 로그인(세션 생성 트랜잭션 안)에서 승인자 키를 등록한다
    if (this.auth.mode === 'oidc') this.auth.onSessionCreated((u) => this.enrollApprover(u));
  }

  // ── 분리 서명 ─────────────────────────────────────────
  /**
   * 용도별 kid로 정규화 바이트에 서명한다.
   * @rule FFG-SEC-002 — 용도별 서명 키 분리. M-of-N 루트·유출 대응 절차는 운영(WP10)
   */
  signDetached(purpose: KeyPurpose, canonical: string): DetachedSig {
    const { kid, sig } = this.pki.signRaw(purpose, Buffer.from(canonical));
    return { alg: 'EdDSA', kid, value: b64url(sig) };
  }

  /** 검증 — kid가 기대한 용도가 아니거나, 서명이 64바이트 원시 형식이 아니면 무효 */
  verifyDetached(purpose: KeyPurpose, canonical: string, s: DetachedSig): { valid: boolean; reason: string } {
    const k = this.pki.publicKey(s.kid);
    if (!k) return { valid: false, reason: 'UNKNOWN_KEY' };
    if (k.purpose !== purpose) return { valid: false, reason: 'WRONG_KEY_PURPOSE' };
    if (s.alg !== 'EdDSA' || !/^[A-Za-z0-9_-]{86}$/.test(s.value)) return { valid: false, reason: 'SIGNATURE_FORMAT' };
    if (new Date(k.notAfter).getTime() < this.clock.now().getTime()) return { valid: false, reason: 'KEY_EXPIRED' };
    const ok = verify(null, Buffer.from(canonical), createPublicKey(k.pem), Buffer.from(fromB64url(s.value)));
    return ok ? { valid: true, reason: 'SIGNATURE_VALID' } : { valid: false, reason: 'SIGNATURE_INVALID' };
  }

  // ── 승인자 개인 서명 ─────────────────────────────────
  private activeKey(userId: string) {
    return this.db.get<{ kid: string; private_pem: string; public_pem: string }>("SELECT kid, private_pem, public_pem FROM approver_key WHERE user_id = ? AND status = 'ACTIVE'", userId);
  }

  /** 검증된 주체(SSO 로그인)의 승인자 키 등록 — 이미 있으면 그대로. 새로 만들면 감사 */
  enrollApprover(user: AuthUser): { kid: string; created: boolean } {
    const had = this.activeKey(user.id);
    if (had) return { kid: had.kid, created: false };
    const k = this.generateApproverKey(user.id);
    const put = () =>
      this.audit.record({ id: user.id, role: user.roles[0] ?? 'AUDITOR', roles: user.roles, correlationId: randomBytes(8).toString('hex') }, 'APPROVER_KEY_ENROLLED', k.kid, { after: { kid: k.kid, alg: 'EdDSA' }, componentId: 'D06-10' });
    if (this.db.inTransaction) put();
    else this.db.tx(put);
    return { kid: k.kid, created: true };
  }

  private approverKey(userId: string): { kid: string; private_pem: string; public_pem: string } {
    const k = this.activeKey(userId);
    if (k) return k;
    // oidc — 승인 중 즉석 생성 금지(주장된 ID마다 키가 생기면 한 사람이 두 승인자를 흉내 낸다)
    if (this.auth.mode === 'oidc') {
      throw new DomainError('FORBIDDEN', '승인 서명 키가 등록되지 않은 계정입니다. 회사 계정(SSO)으로 플랫폼에 로그인하면 키가 등록됩니다 — 그 뒤 다시 승인하세요.', { code: 'APPROVER_KEY_NOT_ENROLLED' });
    }
    return this.generateApproverKey(userId);
  }

  private generateApproverKey(userId: string): { kid: string; private_pem: string; public_pem: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const row = { kid: `APR-${userId}`, private_pem: sealFor(this.vault, 'approver_key', 'private_pem', userId, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), public_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    const put = () => this.db.run("INSERT INTO approver_key (user_id, kid, status, created_at, public_pem, private_pem) VALUES (?, ?, 'ACTIVE', ?, ?, ?)", userId, row.kid, this.clock.iso(), row.public_pem, row.private_pem);
    if (this.db.inTransaction) put();
    else this.db.tx(put);
    return row;
  }

  /**
   * 승인자 개인 서명 — approval_sig(보고서 8.3, FIDO2·스마트카드의 데모 대역).
   * @rule FFG-PLT-005 — 승인마다 개인 서명. 2인·FSM 조건 판정은 정책 게이트(WP3)·Kill 승인(WP4)
   */
  approve(userId: string, canonical: string): { kid: string; value: string } {
    const k = this.approverKey(userId);
    const pem = openFor(this.vault, 'approver_key', 'private_pem', userId, k.private_pem);
    return { kid: k.kid, value: b64url(sign(null, Buffer.from(canonical), createPrivateKey(pem))) };
  }

  verifyApproval(userId: string, canonical: string, value: string): boolean {
    const k = this.db.get<{ public_pem: string }>('SELECT public_pem FROM approver_key WHERE user_id = ?', userId);
    if (!k || !/^[A-Za-z0-9_-]{64,}$/.test(value)) return false;
    return verify(null, Buffer.from(canonical), createPublicKey(k.public_pem), Buffer.from(fromB64url(value)));
  }

  // ── 차량 키 epoch와 CMAC ─────────────────────────────
  /** 현재 차량 키 epoch — 처음 부르면 epoch 1의 루트 비밀을 만든다 */
  epoch(): number {
    const r = this.db.get<{ e: number | null }>('SELECT max(epoch) AS e FROM hsm_secret WHERE name = ?', VEHICLE_ROOT);
    if (r?.e) return r.e;
    this.putRoot(1);
    return 1;
  }

  /**
   * epoch 루트 비밀 — 시험·시연용 모의 공장 주입: FF_HSM_VEHICLE_ROOT(base64 32바이트)가 있으면 epoch 1 루트로 쓴다(FF_IMP 모의 차량이 같은 차량 키를 파생).
   * epoch를 올리면(키 유출 대응) 항상 새 무작위 비밀.
   */
  private putRoot(epoch: number) {
    const injected = process.env.FF_HSM_VEHICLE_ROOT;
    if (injected && epoch === 1 && Buffer.from(injected, 'base64').length !== 32) throw new Error('FF_HSM_VEHICLE_ROOT는 base64 32바이트여야 합니다');
    const secret = injected && epoch === 1 ? injected : randomBytes(32).toString('base64');
    const sealed = sealFor(this.vault, 'hsm_secret', 'secret', `${VEHICLE_ROOT}:${epoch}`, secret);
    const put = () => this.db.run('INSERT INTO hsm_secret (name, epoch, secret, created_at) VALUES (?, ?, ?, ?)', VEHICLE_ROOT, epoch, sealed, this.clock.iso());
    if (this.db.inTransaction) put();
    else this.db.tx(put);
  }

  /** 차량 요청 인증용(VehicleKeySource) — 지금 epoch */
  currentEpoch(): number {
    return this.epoch();
  }

  /** 차량 요청 인증용(VehicleKeySource) — 그 epoch가 없으면 null. 키는 이 프로세스 밖으로 내보내지 않는다(요청 키 파생에만) */
  vehicleKey(vin: string, epoch: number): Buffer | null {
    if (!this.db.get('SELECT 1 FROM hsm_secret WHERE name = ? AND epoch = ?', VEHICLE_ROOT, epoch)) return null;
    return this.deriveVehicleKey(vin, epoch);
  }

  /**
   * 모의 공장 주입 — 생산 라인이 차량 보안 저장소에 넣는 차량 키(지금 epoch). 내부 시뮬레이터·5년 재생·시험의 차량 쪽만 쓴다.
   * HTTP로 내보내는 창구는 없다(실제 차량 키 주입은 공장 키 관리 시스템의 일).
   */
  factoryProvision(vin: string): { epoch: number; vehicleKey: Buffer } {
    const epoch = this.epoch();
    return { epoch, vehicleKey: this.deriveVehicleKey(vin, epoch) };
  }

  private deriveVehicleKey(vin: string, epoch: number): Buffer {
    const r = this.db.get<{ secret: string }>('SELECT secret FROM hsm_secret WHERE name = ? AND epoch = ?', VEHICLE_ROOT, epoch);
    if (!r) throw new Error(`차량 키 epoch ${epoch}가 없습니다`);
    return hkdf16(Buffer.from(openFor(this.vault, 'hsm_secret', 'secret', `${VEHICLE_ROOT}:${epoch}`, r.secret), 'base64'), `epoch:${epoch}`, `ffp-vehicle-key|${vin}`);
  }

  /**
   * 차량별 AES-CMAC-128 — 봉투 cmd_auth(요청 프레임 4..35바이트)·상태 증명 state_auth에 같은 키를 쓴다.
   * @rule FFG-VEH-013 — 차량 단위 키 epoch(파생·상향). 순번 창 검사는 차량 쪽(WP5 시뮬레이터)
   */
  cmac(vin: string, epoch: number, frame: Buffer): string {
    return b64url(aesCmac(this.deriveVehicleKey(vin, epoch), frame));
  }

  verifyCmac(vin: string, epoch: number, frame: Buffer, tag: string): boolean {
    if (!/^[A-Za-z0-9_-]{22}$/.test(tag)) return false;
    let key: Buffer;
    try {
      key = this.deriveVehicleKey(vin, epoch);
    } catch {
      return false;
    }
    return equalBytes(aesCmac(key, frame), Buffer.from(fromB64url(tag)));
  }

  /** epoch 상향 — 키 유출 대응(보고서 14.3: 24시간 안에 epoch 상향). 이전 epoch 비밀은 검증용으로 남긴다 */
  bumpEpoch(actor: Actor, reason: string) {
    return this.db.tx(() => {
      const prev = this.epoch();
      this.putRoot(prev + 1);
      this.audit.record(actor, 'HSM_EPOCH_BUMP', VEHICLE_ROOT, { before: { epoch: prev }, after: { epoch: prev + 1 }, reason, componentId: 'D06-10' });
      this.events.publish('pki.epoch.bumped', VEHICLE_ROOT, { epoch: prev + 1 }, { componentId: 'D06-10', correlationId: actor.correlationId });
      return { epoch: prev + 1 };
    });
  }

  view() {
    return { epoch: this.epoch(), approverKeys: this.db.get<{ n: number }>("SELECT count(*) AS n FROM approver_key WHERE status = 'ACTIVE'")!.n };
  }
}

@Controller('api/pki')
export class HsmController {
  constructor(private readonly hsm: HsmService) {}

  @Get('hsm')
  view() {
    return this.hsm.view();
  }

  @Post('epoch')
  @Roles('SECURITY_OFFICER', 'SAFETY_OFFICER')
  @AuditAction('HSM_EPOCH_BUMP')
  bump(@CurrentActor() actor: Actor, @Body(new ZodPipe(EpochBumpBody)) body: EpochBumpBody) {
    return this.hsm.bumpEpoch(actor, body.reason);
  }
}
