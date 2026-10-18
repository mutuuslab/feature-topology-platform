// Release Sign-off(출시 책임 확인, D01-01) — 보고서 6.1 G7(출시·활성화) 승인자 중 Feature Owner의 승인 수단(사용자 결정 2026-10-18).
// Safety Manager·판정자가 G8·G9를 PASS로 판정한 뒤 Feature Owner(FEATURE_AUTHOR)가 개인 서명으로 출시 책임을 확인한다.
// 서명은 그 시점의 G8·G9 판정 기록 ID에 묶인다 — 다시 판정되면 이전 서명은 효력이 없고(stale) 새로 서명해야 출시할 수 있다.
// Feature Registry의 ownerId는 사람이 아니라 소유 조직이므로, 서명자는 그 조직을 대표하는 Feature Owner로 기록한다.
import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { jcs, ReleaseSignoff, ReleaseSignoffBody, type ReleaseSignoffView } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { FeatureRepo, GateRepo } from '../repos';

const ACTION = 'RELEASE_SIGNOFF';

@Injectable()
@PlatformComponent('D01-01')
export class ReleaseSignoffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly hsm: HsmService,
  ) {}

  /** 현재 G8·G9 최신 판정 기록 ID — 둘 다 PASS일 때만 */
  private passedGates(featureId: string, version: string): { G8: string; G9: string } | string {
    const latest = this.gates.latest(featureId, version);
    const missing = (['G8', 'G9'] as const).filter((g) => latest[g]?.status !== 'PASS');
    if (missing.length) return `${missing.join('·')} 최신 판정이 PASS가 아닙니다 — G8·G9 PASS 뒤에 서명합니다.`;
    return { G8: latest.G8!.gateRecordId, G9: latest.G9!.gateRecordId };
  }

  private latestRow(featureId: string, version: string): ReleaseSignoff | null {
    const r = this.db.get<{ doc: string }>(
      'SELECT doc FROM release_signoff WHERE feature_id = ? AND feature_version = ? ORDER BY signoff_id DESC LIMIT 1',
      featureId,
      version,
    );
    return r ? ReleaseSignoff.parse(JSON.parse(r.doc)) : null;
  }

  private verify(s: ReleaseSignoff): boolean {
    return !!s.sig && this.hsm.verifyApproval(s.signedBy, jcs({ ...s, kid: '', sig: null }), s.sig);
  }

  /** 서명 기록과 현재 효력 — 현재 G8·G9 판정에 묶여 있고 서명이 검증될 때만 유효 */
  view(featureId: string, version: string): ReleaseSignoffView {
    const s = this.latestRow(featureId, version);
    if (!s) return { signoff: null, valid: false, stale: false };
    const now = this.passedGates(featureId, version);
    const current = typeof now !== 'string' && now.G8 === s.gateRecords.G8 && now.G9 === s.gateRecords.G9;
    const valid = current && this.verify(s);
    return { signoff: s, valid, stale: !current };
  }

  /** 수명주기 전이 문맥용 — 유효한 서명만 */
  current(featureId: string, version: string): { signedBy: string; signedAt: string } | null {
    const v = this.view(featureId, version);
    return v.valid && v.signoff ? { signedBy: v.signoff.signedBy, signedAt: v.signoff.signedAt } : null;
  }

  sign(actor: Actor, featureId: string, version: string, reason: string): ReleaseSignoffView {
    const target = `${featureId}@${version}#release-signoff`;
    const fail = (msg: string, code: 'NOT_FOUND' | 'GUARD_FAILED' | 'CONFLICT'): never => {
      this.audit.failed(actor, ACTION, target, msg, 'D01-01');
      throw new DomainError(code, msg);
    };
    const f = this.features.get(featureId, version);
    if (!f) return fail(`${featureId} ${version}을(를) 찾을 수 없습니다.`, 'NOT_FOUND');
    if (f.lifecycle !== 'VERIFIED') return fail(`${f.lifecycle} 상태에서는 Release Sign-off를 할 수 없습니다 — VERIFIED에서 출시 전에 서명합니다.`, 'GUARD_FAILED');
    const gates = this.passedGates(featureId, version);
    if (typeof gates === 'string') return fail(gates, 'GUARD_FAILED');
    if (this.view(featureId, version).valid) return fail('현재 G8·G9 판정에 대한 Release Sign-off가 이미 있습니다.', 'CONFLICT');
    const unsigned: ReleaseSignoff = {
      featureId,
      version,
      ownerId: f.ownerId,
      signedBy: actor.id,
      signedRole: 'FEATURE_AUTHOR',
      signedAt: this.clock.iso(),
      gateRecords: gates,
      reason,
      kid: '',
      sig: null,
    };
    const approval = this.hsm.approve(actor.id, jcs(unsigned));
    // kid는 서명 뒤에 알 수 있으므로, 서명 대상 본문은 kid=''·sig=null로 고정하고 검증도 같은 본문으로 한다
    const signed = ReleaseSignoff.parse({ ...unsigned, sig: approval.value });
    const stored = { ...signed, kid: approval.kid };
    return this.db.tx(() => {
      this.db.run(
        'INSERT INTO release_signoff (feature_id, feature_version, g8_record, g9_record, signed_by, signed_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)',
        featureId,
        version,
        gates.G8,
        gates.G9,
        actor.id,
        signed.signedAt,
        JSON.stringify(stored),
      );
      this.audit.record(actor, ACTION, target, { after: { ownerId: f.ownerId, gateRecords: gates, kid: approval.kid }, reason, componentId: 'D01-01' });
      this.events.publish('release.signed', target, { featureId, version, ownerId: f.ownerId, signedBy: actor.id }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return { signoff: stored, valid: true, stale: false };
    });
  }
}

@Controller('api')
export class ReleaseSignoffController {
  constructor(private readonly signoffs: ReleaseSignoffService) {}

  @Get('features/:id/versions/:ver/release-signoff')
  get(@Param('id') id: string, @Param('ver') ver: string) {
    return this.signoffs.view(id, ver);
  }

  @Post('features/:id/versions/:ver/release-signoff')
  @Roles('FEATURE_AUTHOR')
  @AuditAction(ACTION)
  sign(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(ReleaseSignoffBody)) body: ReleaseSignoffBody) {
    return this.signoffs.sign(actor, id, ver, body.reason);
  }
}
