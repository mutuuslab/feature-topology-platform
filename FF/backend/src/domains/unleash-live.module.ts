import { Body, Controller, HttpCode, Inject, Injectable, Module, Param, Post, Res } from '@nestjs/common';
import { canonicalJson, OfrepBody, UNLEASH_SNAPSHOT_TTL_MS, unleashContext, unleashDrift, type SignedUnleashSnapshot, type UnleashPlan } from '@ff/contracts';
import type { Response } from 'express';
import { UnleashEdgeClient, type EdgeFeatures } from '../adapters/unleash/edge.client';
import { CurrentActor, VehicleEndpoint, type Actor } from '../kernel/actor';
import { Clock } from '../kernel/clock';
import { DomainError } from '../kernel/errors';
import { ZodPipe } from '../kernel/zod.pipe';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { ActivationService } from './d01-policy/activation/activation.service';
import { KILL_STATE, type KillState } from './d01-policy/activation/kill-state';
import { FleetRepo, PolicyRepo } from './d01-policy/policy-repos';
import { SafetyProfileService } from './d01-policy/registry/safety-profile.service';
import { PolicyModule } from './d01-policy/policy-store/policy.module';
import { UnleashSyncService } from './d01-policy/policy-store/unleash-sync.service';
import { DeliveryModule } from './delivery.module';
import { VehicleRequestService } from './d02-runtime/vehicle-requests/vehicle-request.service';
import { HsmService } from './d06-qsec/pki-kms/hsm.service';
import { TrustModule } from './d06-qsec/pki-kms/trust.module';
import { PkiService } from './d06-qsec/pki-kms/pki.service';
import { DB, type Db } from '../kernel/db';
import { PlatformComponent } from '../kernel/components';

@Injectable()
@PlatformComponent('D02-03')
export class VehicleUnleashService {
  constructor(private readonly requests: VehicleRequestService, private readonly policies: PolicyRepo, private readonly fleet: FleetRepo, private readonly sync: UnleashSyncService, private readonly edge: UnleashEdgeClient, private readonly activation: ActivationService, private readonly safety: SafetyProfileService, private readonly hsm: HsmService, private readonly clock: Clock, private readonly pki: PkiService, @Inject(KILL_STATE) private readonly kill: KillState, @Inject(DB) private readonly db: Db) {}

  private checkEdge(plans: UnleashPlan[], cache: EdgeFeatures) {
    for (const plan of plans) {
      const f = cache.features.find((x) => x.name === plan.flagName);
      if (!f || unleashDrift({ ...plan, tags: [] }, { enabled: f.enabled, strategies: f.strategies, tags: [], dependencies: f.dependencies ?? [], variants: f.variants ?? [] }).length)
        throw new DomainError('GUARD_FAILED', 'Edge 사본이 FF 배포 정책과 다릅니다. 동기화 후 다시 요청하세요.', { code: 'EDGE_DRIFT', flagKey: plan.flagName });
    }
  }

  async signed(actor: Actor, vin: string, body: OfrepBody, res: Response): Promise<SignedUnleashSnapshot> {
    // Reuse the existing admission, self-VIN, rate limit and durable query audit. This is not a second authentication path.
    await this.requests.query(actor, vin, body, res);
    const vehicle = this.fleet.vehicle(vin)!;
    const policies = [...new Set(this.policies.all().filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))].sort().map((k) => this.policies.deployed(k)!);
    const plans: UnleashPlan[] = [];
    for (const p of policies) {
      const v = await this.sync.view(p.policyId);
      if (v.status.mode !== 'live' || v.status.state !== 'OK' || v.status.version !== '8.3.1' || !v.plan.ready || v.serverError || v.drift?.length || v.drift === null)
        throw new DomainError('GUARD_FAILED', 'Unleash 사본이 FF 배포 정책과 다르거나 확인할 수 없습니다.', { code: 'UNLEASH_DRIFT', policyId: p.policyId });
      plans.push(v.plan);
    }
    const cache = await this.edge.features();
    this.checkEdge(plans, cache);
    // Caller-supplied targeting properties are ignored; only registered Fleet and current FF entitlements are used.
    // trialSessionValid is policy-specific. Evaluate separately where entitlement differs, never share a grant across Features.
    const evaluated = new Map<string, boolean>();
    for (const p of policies) {
      const d = await this.activation.decide(vin, p.flagKey);
      const r = await this.edge.evaluate(unleashContext(vehicle, p.entitlementCatalogId ? d.entitlement.active : null));
      evaluated.set(p.flagKey, r.toggles.find((x) => x.name === p.flagKey)?.enabled === true);
    }
    const after = await this.edge.features();
    this.checkEdge(plans, after);
    if (canonicalJson(cache) !== canonicalJson(after)) throw new DomainError('GUARD_FAILED', '평가 중 Edge 사본이 바뀌었습니다. 다시 요청하세요.', { code: 'EDGE_CHANGED' });
    const flags = [];
    for (const p of policies) {
      const d = await this.activation.decide(vin, p.flagKey);
      if (canonicalJson(d.policy) !== canonicalJson(p))
        throw new DomainError('PRECONDITION_FAILED', '평가 중 배포 정책이 바뀌었습니다.', { code: 'POLICY_CHANGED' });
      const fClass = this.safety.ensure(p.featureId, p.featureVersion).fClass;
      const enabled = evaluated.get(p.flagKey) === true;
      flags.push({ flagKey: p.flagKey, featureId: p.featureId, policyId: p.policyId, revision: p.revision, contentHash: p.contentHash, fClass, guardRequired: !['F0', 'F1'].includes(fClass), value: enabled && d.result.value, reason: !d.result.value ? d.result.reason : enabled ? d.result.reason : 'UNLEASH_DISABLED' });
    }
    // A later flag's await can invalidate an earlier flag after its per-policy check. Recheck the whole captured set without yielding.
    for (const policy of policies) {
      if (canonicalJson(this.policies.deployed(policy.flagKey)) !== canonicalJson(policy))
        throw new DomainError('PRECONDITION_FAILED', '평가 중 배포 정책이 바뀌었습니다.', { code: 'POLICY_CHANGED' });
    }
    // Synchronous final kill read immediately before signing: an await above cannot hide a newly committed kill.
    for (const f of flags) if (this.kill.killed(f.featureId, vin)) { f.value = false; f.reason = 'KILL_SWITCH'; }
    res.setHeader('Cache-Control', 'no-store');
    return this.db.tx(() => {
      const sequence = this.db.get<{ value: number }>('INSERT INTO vehicle_unleash_sequence (vin, value) VALUES (?, 1) ON CONFLICT(vin) DO UPDATE SET value = vehicle_unleash_sequence.value + 1 RETURNING value', vin)!.value;
      const now = this.clock.now().getTime();
      const payload: SignedUnleashSnapshot['payload'] = { schema: 'FF-UNLEASH-SNAPSHOT/1', source: 'UNLEASH_EDGE', vin, sequence, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + UNLEASH_SNAPSHOT_TTL_MS).toISOString(), flags };
      let signature = this.hsm.signDetached('activate', canonicalJson(payload));
      const key = this.pki.publicKey(signature.kid)!;
      if (Date.parse(key.notAfter) < Date.parse(payload.expiresAt)) { payload.expiresAt = key.notAfter; signature = this.hsm.signDetached('activate', canonicalJson(payload)); }
      return { payload, signature };
    });
  }
}

@Controller('vehicle/v1/:vin')
@VehicleEndpoint()
export class VehicleUnleashController {
  constructor(private readonly service: VehicleUnleashService) {}
  @Post('signed-flags') @HttpCode(200)
  signed(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Body(new ZodPipe(OfrepBody)) body: OfrepBody, @Res({ passthrough: true }) res: Response) { return this.service.signed(actor, vin, body, res); }
}

@Module({ imports: [D01PolicyModule, PolicyModule, DeliveryModule, TrustModule], controllers: [VehicleUnleashController], providers: [UnleashEdgeClient, VehicleUnleashService] })
export class UnleashLiveModule {}
