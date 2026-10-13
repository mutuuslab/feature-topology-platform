// 차량 런타임 실행 모듈 (D02-03) — 데모 Fleet의 차량 측 에이전트 시뮬레이터 (IF-07 전개 → 적용 → IF-06 회신).
// 차량은 서명(신뢰 앵커 공개키)·순번(재전송)을 확인한 게시본만 적용하고, 적용한 값을 되읽어 회신한다(P0 BD-12 readback).
// 차량 측 평가는 서버와 같은 단일 평가기(evaluateFlag)를 캐시된 서명 정책으로 돌린다 — 서버 판단과 어긋나면 drift.
import { Controller, Get, Inject, Injectable, Param } from '@nestjs/common';
import { evaluateFlag, PUBLICATION_KEY_PURPOSE, type FlagResult, type Publication } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { Scheduler } from '../../../kernel/scheduler';
import { ActivationService } from '../../d01-policy/activation/activation.service';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { TelemetryService } from '../../d04-ops/telemetry-ingest/telemetry.service';
import { PkiService } from '../../d06-qsec/pki-kms/pki.service';
import { RuntimeRepo, type VehicleRuntimeState } from '../../d06-qsec/secure-deploy/publication.repo';
import { GleoAdapter } from '../../../adapters/gleo/gleo.adapter';

/** 차량 회신 지연(ms) — 차량마다 조금씩 늦게 돌아와 시연 화면에서 집계가 차오르는 모습이 보인다 */
const LATENCY = Number(process.env.FLEET_SIM_LATENCY_MS ?? 350);
const STAGGER = Number(process.env.FLEET_SIM_STAGGER_MS ?? 120);

export const scopeKeyOf = (p: Publication['payload']) => (p.kind === 'POLICY' ? `flag:${p.flagKey}` : `feature:${p.featureId}`);

@Injectable()
@PlatformComponent('D02-03')
export class VehicleRuntimeService {
  constructor(
    private readonly runtime: RuntimeRepo,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly entitlements: EntitlementService,
    private readonly activation: ActivationService,
    private readonly pki: PkiService,
    private readonly telemetry: TelemetryService,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
    @Inject(GleoAdapter) private readonly gleo: GleoAdapter,
  ) {}

  /** IF-07 전개 — 연결된 차량만 받는다. GLEO 실연동 차량은 GLEO 어댑터가 맡는다. 회신 의무가 없는 차량 목록을 돌려준다. */
  deliver(pub: Publication): { ackOnly: string[]; unreachable: string[] } {
    const unreachable: string[] = [];
    const viaGleo: string[] = [];
    const sim: string[] = [];
    for (const vin of pub.payload.targets) {
      const v = this.fleet.vehicle(vin);
      if (!v || v.link === 'OFFLINE' || (v.gleo && this.gleo.mode === 'off')) unreachable.push(vin);
      else if (v.gleo && this.gleo.mode === 'ws') viaGleo.push(vin);
      else sim.push(vin);
    }
    const ackOnly = viaGleo.length ? this.gleo.send(pub, viaGleo) : [];
    sim.forEach((vin, i) => this.scheduler.after(LATENCY + i * STAGGER, () => this.receive(vin, pub)));
    return { ackOnly, unreachable };
  }

  /** 차량 측 수신 — 서명·재전송 확인 → 적용 → 회신 */
  receive(vin: string, pub: Pick<Publication, 'payload' | 'signature' | 'publicationId' | 'kind'>) {
    const s = this.runtime.get(vin);
    const p = pub.payload;
    const key = scopeKeyOf(p);
    const reject = (reason: string) => {
      s.log.push({ at: this.clock.iso(), publicationId: pub.publicationId, kind: pub.kind, result: 'REJECTED', detail: reason });
      this.runtime.save(s);
      this.report(s, pub, 'REJECTED', reason);
    };
    // 게시본 종류의 용도 키로 서명된 것만(FFG-SEC-002) — 정책 키로 서명한 차단 명령은 WRONG_KEY_PURPOSE
    const check = this.pki.verify(p, pub.signature, undefined, PUBLICATION_KEY_PURPOSE[pub.kind]);
    if (!check.valid) return reject(check.reason);
    if (p.sequence <= (s.highest[key] ?? 0)) return reject('REPLAY');
    s.highest[key] = p.sequence;
    let observed: string;
    if (p.kind === 'POLICY' && p.policy) {
      s.bundles[p.policy.flagKey] = { publicationId: pub.publicationId, sequence: p.sequence, payloadHash: pub.signature.payloadHash, policy: p.policy };
      observed = p.policy.contentHash;
    } else if (p.kind === 'KILL' && p.kill) {
      for (const f of p.kill.featureIds) {
        s.kills[f] = { killId: p.kill.killId, safeMode: p.kill.safeMode, publicationId: pub.publicationId };
        s.featureState[f] = p.kill.safeMode;
      }
      observed = p.kill.safeMode;
    } else if (p.kind === 'RESTORE' && p.kill) {
      for (const f of p.kill.featureIds) {
        delete s.kills[f];
        s.featureState[f] = 'ACTIVE';
      }
      observed = 'ACTIVE';
    } else return reject('MALFORMED');
    s.log.push({ at: this.clock.iso(), publicationId: pub.publicationId, kind: pub.kind, result: 'APPLIED', detail: observed });
    this.runtime.save(s);
    this.report(s, pub, observed);
  }

  private report(s: VehicleRuntimeState, pub: Pick<Publication, 'payload' | 'signature' | 'publicationId'>, observed: string, rejectReason?: string) {
    this.telemetry.ingest({
      vin: s.vin,
      publicationId: pub.publicationId,
      metricType: 'READBACK',
      policyHash: pub.signature.payloadHash,
      featureVersion: pub.payload.featureVersion,
      bootId: s.bootId,
      sequence: pub.payload.sequence,
      observed,
      ...(rejectReason && { rejectReason }),
    });
  }

  bootId(vin: string) {
    return this.runtime.get(vin).bootId;
  }

  /** 차량 상태 + 차량 측 평가(캐시된 서명 정책) + 서버 판단 비교 */
  async view(vin: string) {
    const vehicle = this.fleet.vehicle(vin);
    if (!vehicle) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const s = this.runtime.get(vin);
    const evaluations: { flagKey: string; local: FlagResult; server: FlagResult | null; drift: boolean }[] = [];
    for (const [flagKey, b] of Object.entries(s.bundles).sort(([a], [z]) => a.localeCompare(z))) {
      const f = this.features.get(b.policy.featureId, b.policy.featureVersion);
      if (!f) continue;
      const local = await evaluateFlag({
        policy: b.policy,
        scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim },
        killed: !!s.kills[b.policy.featureId],
        vehicle,
        entitlementActive: b.policy.entitlementCatalogId ? this.entitlements.activeFor(vin, b.policy.featureId).active : null,
      });
      const server = await this.activation.decide(vin, flagKey).then((d) => d.result, () => null);
      evaluations.push({ flagKey, local, server, drift: !!server && server.value !== local.value });
    }
    return { vehicle, runtime: s, evaluations, gleo: vehicle.gleo ? this.gleo.mode : null };
  }

  /** Fleet 실시간 적용 현황 — 차량마다 적용 게시본·Feature 상태·차량 측 값과 서버 판단(어긋남 표시) */
  async fleetStatus() {
    const items = [];
    for (const v of this.fleet.vehicles()) {
      const { runtime: s, evaluations } = await this.view(v.vin);
      items.push({
        vin: v.vin,
        label: v.label,
        scope: `${v.country}/${v.vehicleModel}/${v.trim}`,
        link: v.link,
        quality: v.quality,
        gleo: v.gleo,
        featureState: s.featureState,
        kills: Object.keys(s.kills),
        flags: evaluations.map((e) => ({
          flagKey: e.flagKey,
          publicationId: s.bundles[e.flagKey]?.publicationId ?? null,
          sequence: s.bundles[e.flagKey]?.sequence ?? null,
          local: { value: e.local.value, reason: e.local.reason },
          server: e.server && { value: e.server.value, reason: e.server.reason },
          drift: e.drift,
        })),
        last: s.log.at(-1) ?? null,
      });
    }
    return { items, gleo: this.gleo.mode };
  }
}

@Controller('api')
export class VehicleRuntimeController {
  constructor(private readonly runtime: VehicleRuntimeService) {}

  @Get('fleet/runtime')
  fleet() {
    return this.runtime.fleetStatus();
  }

  @Get('vehicles/:vin/runtime')
  view(@Param('vin') vin: string) {
    return this.runtime.view(vin);
  }
}
