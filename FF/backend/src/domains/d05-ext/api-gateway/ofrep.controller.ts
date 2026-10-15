// API Gateway (D05-01) — OpenFeature Remote Evaluation Protocol(OFREP) 창구, IF-10 OpenFeature SDK.
// 평가는 활성화 제어(D01-09)의 단일 평가기. 차량은 targetingKey(가명 또는 등록 VIN)로 식별한다.
// 오류 계약: 404 FLAG_NOT_FOUND(SDK는 기본값=Safe Default), 400 TARGETING_KEY_MISSING·INVALID_CONTEXT. bulk는 ETag/304.
// OpenFeature 경계(보고서 11장): F0·F1 flag만 값을 계산한다. F2 이상은 Safe Default + DISABLED(decided_by=vehicle_safety_guard),
// bulk에서는 아예 빠진다. 금지 문맥 속성은 INVALID_CONTEXT, 모든 평가는 가명 subject로 OTel span(IF-11)에 남는다.
// /vehicle/v1 차량 채널은 OpenFeature 백엔드가 아니라 차량 Safety Guard 경로라 이 경계를 적용하지 않는다.
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Headers, HttpCode, HttpException, Injectable, Param, Post, Res, UseFilters } from '@nestjs/common';
import { contextViolations, evaluationSpan, ignoredContext, OfrepBody, openFeatureAllowed, SAFETY_GUARD_METADATA, type FClass, type FlagResult, type OtelSpan } from '@ff/contracts';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { OtelExporter } from '../../../adapters/if-mocks/otel.exporter';
import { ReadOnlyEndpoint } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { PlatformComponent } from '../../../kernel/components';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { ActivationService } from '../../d01-policy/activation/activation.service';
import { DomainError } from '../../../kernel/errors';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';

/** 평가기 사유 → OpenFeature 표준 사유 */
const REASON: Record<FlagResult['reason'], string> = {
  POLICY_MATCH: 'TARGETING_MATCH',
  KILL_SWITCH: 'DISABLED',
  NOT_DEPLOYED: 'DISABLED',
  NOT_APPLICABLE: 'DEFAULT',
  NOT_SUPPORTED: 'DISABLED',
  NO_ENTITLEMENT: 'DEFAULT',
  TARGETING_MISS: 'DEFAULT',
  COHORT_MISS: 'SPLIT',
  CONTEXT_UNKNOWN: 'UNKNOWN',
  ERROR_SAFE_DEFAULT: 'ERROR',
};

export const ofrep = (r: FlagResult) => ({
  key: r.flagKey,
  value: r.value,
  variant: r.variant,
  reason: REASON[r.reason],
  metadata: { policyId: r.policyId, revision: r.revision, decision: r.decision, platformReason: r.reason },
});

@Injectable()
@PlatformComponent('D05-01')
export class OfrepService {
  constructor(
    private readonly activation: ActivationService,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly safety: SafetyProfileService,
    private readonly kills: KillRepo,
    private readonly otel: OtelExporter,
    private readonly clock: Clock,
  ) {}

  /** targetingKey → VIN — 가명(vehiclePseudonym) 또는 등록 VIN. 기록에는 가명만 남긴다 */
  private vin(body: OfrepBody, key?: string): string {
    const tk = body.context?.targetingKey;
    if (!tk) throw this.fail(key, null, 'TARGETING_KEY_MISSING', 'context.targetingKey(차량 가명 또는 VIN)가 필요합니다.', 400);
    const vin = this.fleet.vehicle(tk) ? tk : this.fleet.vehicles().find((v) => vehiclePseudonym(v.vin) === tk)?.vin;
    if (!vin) throw this.fail(key, null, 'INVALID_CONTEXT', '등록되지 않은 차량입니다.', 400);
    const bad = contextViolations(body.context as Record<string, unknown> | undefined);
    if (bad.length) throw this.fail(key, vin, 'INVALID_CONTEXT', `금지 문맥 속성 — ${bad.map((b) => `${b.key}(${b.kind})`).join(', ')} (FFG-OFT-003)`, 400);
    return vin;
  }

  /** @rule FFG-OFT-003 — 금지 속성은 INVALID_CONTEXT로 거부, 거부도 평가 1건으로 감사 기록(FFG-OFT-004)에 남긴다 */
  private fail(key: string | undefined, vin: string | null, errorCode: string, errorDetails: string, status: number) {
    this.audit([{ flagKey: key ?? '*', vin, fClass: null, variant: null, reason: 'ERROR', errorType: errorCode.toLowerCase() }]);
    return new HttpException({ key, errorCode, errorDetails }, status);
  }

  /** 등록 스냅샷 Version — 배포 정책(revision·해시)과 걸린 차단이 바뀌면 바뀐다 (@rule FFG-OFT-006 평가 결과 metadata에 스냅샷 Version) */
  snapshotVersion(): string {
    const parts = [
      ...this.policies.all().filter((p) => p.status === 'DEPLOYED').map((p) => `${p.policyId}:${p.revision}:${p.contentHash}`),
      ...this.kills.active().map((k) => `kill:${k.killId}`),
    ].sort();
    return 'snap-' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  }

  fClass(featureId: string, version: string): FClass {
    return this.safety.ensure(featureId, version).fClass;
  }

  /** OF-4 — 판단은 등록 정보로, SDK가 보낸 속성이 다르면 metadata로 알린다 */
  private context(body: OfrepBody, vin: string) {
    const ignored = ignoredContext(body.context as Record<string, unknown> | undefined, this.fleet.vehicle(vin)!);
    return { contextSource: 'REGISTRY', ...(ignored.length && { ignoredContext: ignored.join(',') }) };
  }

  /**
   * F2 이상 flag는 값을 계산하지 않는다 — Safe Default(= 호출자 기본값, FFG-OFT-002)와 DISABLED
   * @rule FFG-OFT-001 — Provider 경계: F2 이상 키는 기본값과 reason DISABLED
   * @rule FFG-PLT-011 — OpenFeature는 QM(F0·F1) 평가 API로만
   */
  private guarded(key: string, safeDefault: boolean, fClass: FClass, featureVersion: string, snapshot: string) {
    return { key, value: safeDefault, variant: 'safe_default', reason: 'DISABLED', metadata: { ...SAFETY_GUARD_METADATA, f_class: fClass, feature_version: featureVersion, snapshot_version: snapshot } };
  }

  async one(key: string, body: OfrepBody) {
    const vin = this.vin(body, key);
    const p = this.policies.deployed(key);
    if (!p) throw this.fail(key, vin, 'FLAG_NOT_FOUND', '배포된 flag가 없습니다 — SDK는 기본값(Safe Default)을 쓰세요.', 404);
    const fClass = this.fClass(p.featureId, p.featureVersion);
    const snapshot = this.snapshotVersion();
    if (!openFeatureAllowed(fClass)) {
      const g = this.guarded(key, p.safeDefault, fClass, p.featureVersion, snapshot);
      this.audit([{ flagKey: key, vin, fClass, variant: g.variant, reason: g.reason, errorType: null, snapshot }]);
      return g;
    }
    const r = ofrep((await this.activation.decide(vin, key)).result);
    this.audit([{ flagKey: key, vin, fClass, variant: r.variant, reason: r.reason, errorType: null, snapshot }]);
    return { ...r, metadata: { ...r.metadata, f_class: fClass, feature_version: p.featureVersion, snapshot_version: snapshot, ...this.context(body, vin) } };
  }

  /** bulk — F0·F1 flag만 내보낸다 (@rule FFG-OFT-005 OFREP 응답에 F2 이상 키 0건) */
  async bulk(body: OfrepBody) {
    const vin = this.vin(body);
    const ctx = this.context(body, vin);
    const snapshot = this.snapshotVersion();
    const flags = [];
    for (const r of await this.activation.decideAll(vin)) {
      const p = r.policyId ? this.policies.get(r.policyId) : undefined;
      if (!p) continue;
      const fClass = this.fClass(p.featureId, p.featureVersion);
      if (!openFeatureAllowed(fClass)) continue;
      const o = ofrep(r);
      flags.push({ ...o, metadata: { ...o.metadata, f_class: fClass, feature_version: p.featureVersion, snapshot_version: snapshot, ...ctx } });
    }
    this.audit(flags.map((f) => ({ flagKey: f.key, vin, fClass: f.metadata.f_class, variant: f.variant, reason: f.reason, errorType: null, snapshot })));
    return { flags };
  }

  /** 감사 Hook — 평가마다 span 하나(가명 subject, 원본 VIN 없음) → IF-11 (@rule FFG-OFT-004 기록 수 = 평가 수) */
  private audit(rows: { flagKey: string; vin: string | null; fClass: FClass | null; variant: string | null; reason: string; errorType: string | null; snapshot?: string }[]) {
    const at = this.clock.iso();
    const spans: OtelSpan[] = rows.map((r, i) =>
      evaluationSpan({ flagKey: r.flagKey, provider: 'ffp-ofrep', subject: r.vin ? vehiclePseudonym(r.vin) : 'unknown', fClass: r.fClass, variant: r.variant, reason: r.reason, errorType: r.errorType, snapshotVersion: r.snapshot ?? null, at, traceSeed: `${at}:${r.flagKey}:${i}` }),
    );
    this.otel.export(spans);
  }
}

/** OFREP 오류 본문은 플랫폼 오류 봉투가 아니라 OFREP 규격({key, errorCode, errorDetails}) 그대로 */
@Catch()
class OfrepErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) return res.status(err.getStatus()).json(err.getResponse());
    if (err instanceof DomainError) return res.status(err.status === 404 ? 404 : 400).json({ errorCode: err.status === 404 ? 'FLAG_NOT_FOUND' : 'INVALID_CONTEXT', errorDetails: err.message });
    return res.status(500).json({ errorCode: 'GENERAL', errorDetails: '평가 오류 — SDK는 기본값(Safe Default)을 쓰세요.' });
  }
}

@Controller('ofrep/v1/evaluate')
@UseFilters(OfrepErrorFilter)
@ReadOnlyEndpoint() // 평가 요청은 상태를 바꾸지 않는다 — 차량 SDK는 행위자 헤더가 없다
export class OfrepController {
  constructor(private readonly svc: OfrepService) {}

  @Post('flags/:key')
  @HttpCode(200)
  one(@Param('key') key: string, @Body(new ZodPipe(OfrepBody)) body: OfrepBody) {
    return this.svc.one(key, body);
  }

  @Post('flags')
  @HttpCode(200)
  async bulk(@Body(new ZodPipe(OfrepBody)) body: OfrepBody, @Headers('if-none-match') inm: string | undefined, @Res({ passthrough: true }) res: Response) {
    const out = await this.svc.bulk(body);
    const etag = '"' + createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 32) + '"';
    res.setHeader('ETag', etag);
    if (inm === etag) {
      res.status(304);
      return undefined;
    }
    return out;
  }
}
