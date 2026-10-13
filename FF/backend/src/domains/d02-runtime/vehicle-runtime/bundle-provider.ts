// OF-6 차량 내장 OpenFeature provider — 차량 IVI 앱이 쓰는 provider. 차량이 받은 서명 정책 묶음(bundle)으로 로컬 평가한다(네트워크 없이).
// 경계: F2 이상 flag는 값을 계산하지 않고 호출자 기본값 + DISABLED(차량 Safety Guard 몫, FFG-OFT-001). 통신이 끊겨 묶음이 늦을 수 있으면 STALE(FFG-OFT-006).
// 표준 Hook 두 개를 붙인다: before 문맥 정책(FFG-OFT-003, 금지 속성 → INVALID_CONTEXT), finally 감사(FFG-OFT-004, 가명 span → IF-11).
// 차량 런타임의 Guard 평가기(evaluateFlag)는 F2 이상도 원래대로 평가한다 — 이 provider는 그 결과를 IVI 앱에 OpenFeature 형태로 나눠 줄 뿐이다.
import { Controller, Get, Injectable, Param } from '@nestjs/common';
import { contextViolations, evaluationSpan, openFeatureAllowed, SAFETY_GUARD_METADATA, type FClass, type FlagResult } from '@ff/contracts';
import { ErrorCode, InvalidContextError, OpenFeature, StandardResolutionReasons, type BeforeHookContext, type EvaluationContext, type EvaluationDetails, type FlagValue, type Hook, type HookContext, type JsonValue, type Provider, type ResolutionDetails } from '@openfeature/server-sdk';
import { OtelExporter } from '../../../adapters/if-mocks/otel.exporter';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { VehicleRuntimeService } from './vehicle-runtime.service';

export interface BundleEntry {
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: FClass;
  /** 차량 Guard 평가기의 로컬 결과(서명 정책 묶음 기준) */
  local: FlagResult;
  publicationId: string;
}

/** 차량 하나의 묶음 스냅샷 — provider는 이것만 본다(오프라인 평가) */
export interface BundleSnapshot {
  vin: string;
  stale: boolean;
  entries: Map<string, BundleEntry>;
}

export class VehicleBundleProvider implements Provider {
  readonly metadata = { name: 'ffp-vehicle-bundle' } as const;
  readonly runsOn = 'server' as const;
  constructor(private readonly snap: BundleSnapshot) {}

  async resolveBooleanEvaluation(flagKey: string, defaultValue: boolean): Promise<ResolutionDetails<boolean>> {
    const e = this.snap.entries.get(flagKey);
    if (!e) return { value: defaultValue, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.FLAG_NOT_FOUND, errorMessage: `${flagKey} — 차량에 받은 정책 묶음이 없습니다` };
    const flagMetadata = { featureId: e.featureId, feature_version: e.featureVersion, f_class: e.fClass, publicationId: e.publicationId };
    // @rule FFG-OFT-001 — F2 이상 키는 값을 계산하지 않고 호출자 기본값 + DISABLED
    if (!openFeatureAllowed(e.fClass)) return { value: defaultValue, variant: 'safe_default', reason: StandardResolutionReasons.DISABLED, flagMetadata: { ...flagMetadata, ...SAFETY_GUARD_METADATA } };
    // @rule FFG-OFT-006 — 동기화가 늦을 수 있으면(통신 단절) STALE
    const reason = this.snap.stale ? StandardResolutionReasons.STALE : e.local.value ? StandardResolutionReasons.TARGETING_MATCH : StandardResolutionReasons.DEFAULT;
    return { value: e.local.value, variant: e.local.variant, reason, flagMetadata: { ...flagMetadata, platformReason: e.local.reason } };
  }

  async resolveStringEvaluation(_k: string, d: string): Promise<ResolutionDetails<string>> {
    return { value: d, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.TYPE_MISMATCH, errorMessage: '차량 flag는 boolean만 (FP-VEHICLE-BOOL-1)' };
  }
  async resolveNumberEvaluation(_k: string, d: number): Promise<ResolutionDetails<number>> {
    return { value: d, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.TYPE_MISMATCH, errorMessage: '차량 flag는 boolean만 (FP-VEHICLE-BOOL-1)' };
  }
  async resolveObjectEvaluation<T extends JsonValue>(_k: string, d: T): Promise<ResolutionDetails<T>> {
    return { value: d, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.TYPE_MISMATCH, errorMessage: '차량 flag는 boolean만 (FP-VEHICLE-BOOL-1)' };
  }
}

/** @rule FFG-OFT-003 — before Hook: 금지 문맥 속성(위치·운전자 식별·연락처·동적 상태)은 INVALID_CONTEXT */
export const contextPolicyHook: Hook = {
  before(hc: BeforeHookContext) {
    const bad = contextViolations(hc.context as Record<string, unknown>);
    if (bad.length) throw new InvalidContextError(`금지 문맥 속성 — ${bad.map((b) => `${b.key}(${b.kind})`).join(', ')}`);
  },
};

/** @rule FFG-OFT-004 — finally Hook: 성공·오류 모든 평가를 가명 subject로 기록(원본 targeting key 없음) */
export function auditHook(otel: OtelExporter, at: () => string, fClassOf: (flagKey: string) => FClass | null): Hook {
  return {
    finally(hc: HookContext, details: EvaluationDetails<FlagValue>) {
      const tk = String(hc.context.targetingKey ?? '');
      const time = at();
      otel.export([
        evaluationSpan({
          flagKey: hc.flagKey,
          provider: hc.providerMetadata.name,
          subject: tk.length === 16 && /^[0-9a-f]+$/.test(tk) ? tk : tk ? vehiclePseudonym(tk) : 'unknown',
          fClass: fClassOf(hc.flagKey),
          variant: details.variant ?? null,
          reason: details.reason ?? 'UNKNOWN',
          errorType: details.errorCode ? String(details.errorCode).toLowerCase() : null,
          snapshotVersion: null,
          at: time,
          traceSeed: `${time}:${hc.flagKey}`,
        }),
      ]);
    },
  };
}

@Injectable()
@PlatformComponent('D02-03')
export class VehicleOpenFeatureService {
  constructor(
    private readonly runtime: VehicleRuntimeService,
    private readonly safety: SafetyProfileService,
    private readonly otel: OtelExporter,
    private readonly clock: Clock,
  ) {}

  async snapshot(vin: string): Promise<BundleSnapshot & { serverOf: Map<string, FlagResult | null> }> {
    const v = await this.runtime.view(vin);
    const entries = new Map<string, BundleEntry>();
    const serverOf = new Map<string, FlagResult | null>();
    for (const e of v.evaluations) {
      const b = v.runtime.bundles[e.flagKey];
      entries.set(e.flagKey, { flagKey: e.flagKey, featureId: b.policy.featureId, featureVersion: b.policy.featureVersion, fClass: this.safety.ensure(b.policy.featureId, b.policy.featureVersion).fClass, local: e.local, publicationId: b.publicationId });
      serverOf.set(e.flagKey, e.server);
    }
    return { vin, stale: v.vehicle.link === 'OFFLINE', entries, serverOf };
  }

  /** IVI 앱처럼 공식 SDK client로 묶음의 flag를 모두 평가 — 기본값은 Safe State(false), targetingKey는 가명 */
  async evaluate(vin: string, extraContext: EvaluationContext = {}) {
    const snap = await this.snapshot(vin);
    const domain = `vehicle:${vin}`;
    await OpenFeature.setProviderAndWait(domain, new VehicleBundleProvider(snap));
    const client = OpenFeature.getClient(domain);
    client.addHooks(contextPolicyHook, auditHook(this.otel, () => this.clock.iso(), (k) => snap.entries.get(k)?.fClass ?? null));
    const pseudonym = vehiclePseudonym(vin);
    const items = [];
    for (const [flagKey, e] of [...snap.entries].sort(([a], [b]) => a.localeCompare(b))) {
      const sdk = await client.getBooleanDetails(flagKey, false, { targetingKey: pseudonym, ...extraContext });
      const server = snap.serverOf.get(flagKey) ?? null;
      const ofAllowed = openFeatureAllowed(e.fClass);
      items.push({
        flagKey,
        featureId: e.featureId,
        fClass: e.fClass,
        openFeature: ofAllowed,
        sdk: { value: sdk.value, reason: sdk.reason ?? null, variant: sdk.variant ?? null, errorCode: sdk.errorCode ?? null, flagMetadata: sdk.flagMetadata },
        guard: { value: e.local.value, reason: e.local.reason },
        server: server && { value: server.value, reason: server.reason },
        // F0·F1: SDK 값 = 차량 Guard 로컬 평가. F2 이상: SDK는 기본값·DISABLED이고 값은 Guard만 쓴다
        agrees: ofAllowed ? sdk.value === e.local.value : sdk.reason === 'DISABLED' && sdk.value === false,
      });
    }
    return { vin, pseudonym, provider: 'ffp-vehicle-bundle', stale: snap.stale, items };
  }
}

@Controller('api/vehicles')
export class VehicleOpenFeatureController {
  constructor(private readonly svc: VehicleOpenFeatureService) {}

  @Get(':vin/openfeature')
  evaluate(@Param('vin') vin: string) {
    return this.svc.evaluate(vin);
  }
}
