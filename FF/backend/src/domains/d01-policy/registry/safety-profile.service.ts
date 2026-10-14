// 안전 분류 Registry (D01-01) — 보고서 v1.1 5장의 Feature Version별 안전 속성(F·DC·R·Flag 유형·시간값·Safe State …).
// 초안(DRAFT)은 데이터셋에서 추정하거나 작성자가 고치고, Safety Manager(SAFETY_OFFICER)가 개인 서명으로 확정(CONFIRMED)하면 원천이 된다.
// 확정 뒤에는 등급·시간값을 바꿀 수 없다 — 새 Version을 만든다(FFG-CLS-004). Gate는 G1에서 네 축·조합을, G2에서 확정 여부를 본다.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Put, Query } from '@nestjs/common';
import { asilInheritance, blocking, checkProfile, checkToolClassification, COMPONENTS, inferFClass, jcs, LOCKED_AFTER_CONFIRM, SafetyConfirmBody, SafetyProfile, SafetyProfilePatch, fRank, type AsilInheritance, type ClassFinding } from '@ff/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { FeatureRepo } from '../repos';

/** 커밋된 초안 픽스처(tools/dataset/safety-infer.ts) — repo 루트 기준 */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'safety', 'profiles.json');

/** 도구 신뢰성 분류(FFG-PLT-013)에 규칙 위반이 없는가 — ASIL 상속 예외 조건(생성 경로 도구 신뢰도) */
const TOOL_CONFIDENCE = checkToolClassification(COMPONENTS.map((c) => c.id)).every((p) => p.severity !== 'FAIL');

export interface ProfileView {
  /** FFG-CLS-002 — 안전 관련 Flag의 ASIL 상속·예외 */
  asil?: AsilInheritance;
  profile: SafetyProfile;
  findings: ClassFinding[];
}

@Injectable()
@PlatformComponent('D01-01')
export class SafetyProfileService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly features: FeatureRepo,
    private readonly hsm: HsmService,
  ) {}

  /** 빈 DB면 커밋된 초안을 싣는다(데이터셋 시드와 같은 때) */
  onModuleInit() {
    if (this.db.get('SELECT 1 FROM safety_profile LIMIT 1') || !existsSync(FIXTURE) || process.env.FF_SEED === 'none') return;
    const rows = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown[];
    this.db.tx(() => {
      for (const r of rows) {
        const p = SafetyProfile.parse(r);
        if (this.features.get(p.featureId, p.version)) this.put(p);
      }
    });
  }

  private put(p: SafetyProfile) {
    this.db.run('INSERT INTO safety_profile (feature_id, version, status, doc) VALUES (?, ?, ?, ?) ON CONFLICT(feature_id, version) DO UPDATE SET status = excluded.status, doc = excluded.doc', p.featureId, p.version, p.status, JSON.stringify(p));
  }

  private row(featureId: string, version: string): SafetyProfile | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? SafetyProfile.parse(JSON.parse(r.doc)) : null;
  }

  /** Feature Version을 만들면 초안이 생긴다 — 앞 Version이 있으면 그 값을 이어받고(DRAFT), 없으면 ASIL·SW 등급으로 추정 */
  ensure(featureId: string, version: string): SafetyProfile {
    const have = this.row(featureId, version);
    if (have) return have;
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const prev = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? ORDER BY version DESC LIMIT 1', featureId);
    const sw = this.db.all<{ doc: string }>('SELECT doc FROM sw_master').map((r) => JSON.parse(r.doc));
    const swClasses = (f.swIds ?? []).map((id) => sw.find((s) => s.swId === id)?.safetyClass).filter(Boolean) as string[];
    const base: SafetyProfile = prev ? { ...SafetyProfile.parse(JSON.parse(prev.doc)) } : this.infer(f.asil, swClasses, f.country);
    const p: SafetyProfile = { ...base, featureId, version, status: 'DRAFT', source: prev ? 'MANUAL' : 'INFERRED', confirmedBy: null, confirmedAt: null, confirmSig: null };
    const write = () => this.put(p);
    if (this.db.inTransaction) write();
    else this.db.tx(write);
    return p;
  }

  private infer(asil: string, swClasses: string[], country: string): SafetyProfile {
    const fClass = inferFClass(asil, swClasses);
    const r = fRank(fClass);
    const dc = r === 0 ? 'DC0' : r === 1 ? 'DC1' : 'DC2';
    return SafetyProfile.parse({
      featureId: 'FEAT-00000', version: '0.0.0', status: 'DRAFT', source: 'INFERRED',
      fClass, deactClass: dc, regClass: r >= 2 ? 'R1' : 'R0', flagType: r >= 2 ? 'OPS' : 'RELEASE',
      adsFeature: false, adsfType: null, gsrMandatory: false, itemIds: [], haraRef: null,
      asilRef: ['QM', 'A', 'B', 'C', 'D'].includes(asil) ? asil : 'QM', safetyGoalIds: [],
      safeState: r >= 2 ? 'BASE_ONLY' : null, endState: r >= 2 ? 'DISABLED' : null,
      takeoverMs: dc === 'DC2' ? 4000 : 0, rampMs: dc === 'DC2' ? 3000 : 0, faultRampMs: r >= 2 ? 1500 : 0, faultTolerantTimeMs: r >= 2 ? 5000 : 0,
      maxPendingMs: dc === 'DC1' ? 600000 : 0, maxCycleWaitMs: dc === 'DC0' ? 0 : 28800000,
      maxActivationScope: { vehicles: 50000, perWindow: 5000 }, markets: [country], rxswin: [],
      approvalProfile: null, evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null,
      confirmedBy: null, confirmedAt: null, confirmSig: null,
    });
  }

  view(featureId: string, version: string): ProfileView {
    const profile = this.ensure(featureId, version);
    return { profile, findings: checkProfile(profile), asil: this.asil(featureId, version, profile) };
  }

  list(featureId?: string): SafetyProfile[] {
    const rows = featureId ? this.db.all<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? ORDER BY version', featureId) : this.db.all<{ doc: string }>('SELECT doc FROM safety_profile ORDER BY feature_id, version');
    return rows.map((r) => SafetyProfile.parse(JSON.parse(r.doc)));
  }

  /**
   * 초안 수정 — 확정된 프로파일은 고칠 수 없다(새 Version).
   * @rule FFG-CLS-004 — 등급·시간값·Safe State는 Version의 승인된 속성. G2~G5 재수행은 새 Version 흐름이 맡는다
   */
  update(actor: Actor, featureId: string, version: string, patch: SafetyProfilePatch): ProfileView {
    const cur = this.ensure(featureId, version);
    const target = `${featureId}@${version}#safety`;
    if (cur.status === 'CONFIRMED') {
      const touched = (Object.keys(patch) as (keyof SafetyProfile)[]).filter((k) => LOCKED_AFTER_CONFIRM.includes(k));
      const msg = `확정된 안전 분류는 바꿀 수 없습니다(${touched.join(', ') || '확정 후 수정'}) — 새 Version을 만드세요 (FFG-CLS-004).`;
      this.audit.failed(actor, 'SAFETY_PROFILE_UPDATE', target, msg, 'D01-01');
      throw new DomainError('IMMUTABLE', msg);
    }
    const next = SafetyProfile.parse({ ...cur, ...patch, source: 'MANUAL' });
    return this.db.tx(() => {
      this.put(next);
      this.audit.record(actor, 'SAFETY_PROFILE_UPDATE', target, { before: cur, after: next, componentId: 'D01-01' });
      this.events.publish('safety.profile.updated', target, { featureId, version, fClass: next.fClass, deactClass: next.deactClass }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return { profile: next, findings: checkProfile(next) };
    });
  }

  /**
   * Safety Manager 확정 — 차단급 조합 위반이 없어야 하고, 확정 값의 JCS 바이트에 개인 서명을 남긴다.
   * @rule FFG-CLS-009 — Registry 등록 검사에서 위반 조합 차단(게이트·Guard 검사는 WP3·WP5)
   */
  confirm(actor: Actor, featureId: string, version: string, reason: string): ProfileView {
    const cur = this.ensure(featureId, version);
    const target = `${featureId}@${version}#safety`;
    const fail = (msg: string, code: 'GUARD_FAILED' | 'CONFLICT') => {
      this.audit.failed(actor, 'SAFETY_PROFILE_CONFIRM', target, msg, 'D01-01');
      throw new DomainError(code, msg);
    };
    if (cur.status === 'CONFIRMED') fail('이미 확정된 안전 분류입니다.', 'CONFLICT');
    const bad = blocking(checkProfile(cur));
    if (bad.length) {
      this.audit.failed(actor, 'SAFETY_PROFILE_CONFIRM', target, bad.map((b) => `${b.rule} ${b.message}`).join(' / '), 'D01-01');
      throw new DomainError('GUARD_FAILED', '안전 분류 조합 위반이 있어 확정할 수 없습니다.', { blockers: bad.map((b) => ({ code: b.rule, message: b.message, ref: b.field })) });
    }
    const confirmedAt = this.clock.iso();
    const signed = { ...cur, status: 'CONFIRMED' as const, confirmedBy: actor.id, confirmedAt, confirmSig: null };
    const sig = this.hsm.approve(actor.id, jcs(signed));
    const next = SafetyProfile.parse({ ...signed, confirmSig: sig.value });
    return this.db.tx(() => {
      this.put(next);
      this.audit.record(actor, 'SAFETY_PROFILE_CONFIRM', target, { before: { status: cur.status }, after: { status: 'CONFIRMED', fClass: next.fClass, deactClass: next.deactClass, regClass: next.regClass, kid: sig.kid }, reason, componentId: 'D01-01' });
      this.events.publish('safety.profile.confirmed', target, { featureId, version, fClass: next.fClass, deactClass: next.deactClass, regClass: next.regClass }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return { profile: next, findings: checkProfile(next) };
    });
  }

  /** 확정 서명 검증 — 서명 뒤 값이 바뀌면(DB 조작 등) 무효 */
  verifyConfirmation(p: SafetyProfile): boolean {
    if (p.status !== 'CONFIRMED' || !p.confirmSig || !p.confirmedBy) return false;
    return this.hsm.verifyApproval(p.confirmedBy, jcs({ ...p, confirmSig: null }), p.confirmSig);
  }

  /**
   * Flag ID 결합 — 한 flagKey는 한 Feature에만. 다른 Feature에 묶였던(은퇴 포함) 키는 다시 쓰지 않는다.
   * @rule FFG-CODE-020 — Flag ID 재사용 금지(플랫폼 몫). 은퇴 Flag 코드 제거 기한은 은퇴 절차(WP2)
   */
  bindFlag(flagKey: string, featureId: string): string | null {
    const bound = this.db.get<{ feature_id: string; retired_at: string | null }>('SELECT feature_id, retired_at FROM flag_registry WHERE flag_key = ?', flagKey);
    const other = bound?.feature_id ?? this.db.get<{ feature_id: string }>('SELECT feature_id FROM policy WHERE flag_key = ? AND feature_id <> ? LIMIT 1', flagKey, featureId)?.feature_id;
    if (other && other !== featureId) return `flagKey ${flagKey}는 ${other}에 ${bound?.retired_at ? '쓰였다가 은퇴한' : '묶인'} 키입니다 — Flag ID는 다른 Feature에 다시 쓰지 않습니다 (FFG-CODE-020).`;
    if (!bound) this.db.run('INSERT INTO flag_registry (flag_key, feature_id, bound_at) VALUES (?, ?, ?)', flagKey, featureId, this.clock.iso());
    return null;
  }

  /**
   * Gate 판정 전제 — G1: 네 축과 차단급 조합, G2 이후: Safety Manager 확정.
   * @rule FFG-CLS-001 — 네 축이 비어 있거나 조합이 위반이면 G1 PASS 불가
   */
  private asil(featureId: string, version: string, p: SafetyProfile): AsilInheritance {
    const f = this.features.get(featureId, version);
    return asilInheritance({ asil: f?.asil ?? (null as never), controlPoints: f?.controlPoints ?? [] }, p, { toolConfidence: TOOL_CONFIDENCE });
  }

  gatePrerequisite(featureId: string, version: string, gate: string): string | null {
    const p = this.ensure(featureId, version);
    if (gate === 'G1') {
      const bad = blocking(checkProfile(p));
      return bad.length ? `안전 분류 조합 위반 — ${bad.map((b) => `${b.rule} ${b.message}`).join(' / ')}` : null;
    }
    if (p.status !== 'CONFIRMED') return `안전 분류(F·DC·R·유형)가 Safety Manager 확정 전입니다 — G1 다음 Gate는 확정된 분류가 필요합니다 (FFG-CLS-001·보고서 6.1 G2).`;
    // G7 Safety/Security Gate — 안전 관련 Flag 경로의 ASIL(상속 또는 다섯 조건 예외)이 정해져 있어야 한다
    if (gate === 'G7') return this.asil(featureId, version, p).blocker;
    return null;
  }
}

@Controller('api')
export class SafetyProfileController {
  constructor(private readonly profiles: SafetyProfileService) {}

  @Get('safety-profiles')
  list(@Query('featureId') featureId?: string) {
    return { items: this.profiles.list(featureId) };
  }

  @Get('features/:id/versions/:ver/safety')
  get(@Param('id') id: string, @Param('ver') ver: string) {
    return this.profiles.view(id, ver);
  }

  @Put('features/:id/versions/:ver/safety')
  @Roles('FEATURE_AUTHOR', 'SAFETY_OFFICER')
  @AuditAction('SAFETY_PROFILE_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(SafetyProfilePatch)) body: SafetyProfilePatch) {
    return this.profiles.update(actor, id, ver, body);
  }

  @Post('features/:id/versions/:ver/safety/confirm')
  @Roles('SAFETY_OFFICER')
  @AuditAction('SAFETY_PROFILE_CONFIRM')
  confirm(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(SafetyConfirmBody)) body: SafetyConfirmBody) {
    return this.profiles.confirm(actor, id, ver, body.reason);
  }
}
