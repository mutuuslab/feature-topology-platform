// 보안 배포 관리 (D06-08) — 정책 배포·긴급 차단·복구를 서명된 게시본으로 만들고(PKI D06-10), 파이프라인(D04-01)으로 내보내고,
// 차량 회신을 P0 aggregate로 집계한다: 대상 전부 readback 일치 → CONFIRMED, 불일치 → DIVERGED, 기한 초과 → PARTIAL/TIMEOUT (BD-12).
import { Controller, Get, Inject, Injectable, OnApplicationBootstrap, OnModuleInit, Param, Query } from '@nestjs/common';
import { aggregate, type KillRequest, type Policy, type Publication, type PublicationKind, type ReadbackReport } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { Scheduler } from '../../../kernel/scheduler';
import { scopeKeyOf, VehicleRuntimeService } from '../../d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { PipelineService } from '../../d04-ops/pipeline-link/pipeline.service';
import { ReadbackBus } from '../../d04-ops/telemetry-ingest/telemetry.service';
import { PkiService } from '../pki-kms/pki.service';
import { PublicationRepo } from './publication.repo';

const OTA_TIMEOUT_MS = Number(process.env.PUBLICATION_TIMEOUT_MS ?? 8000);
const EMERGENCY_TIMEOUT_MS = Number(process.env.KILL_TIMEOUT_MS ?? 5000);
const MAX_REPORT_AGE_MS = 24 * 3600_000;

interface Draft {
  featureId: string;
  featureVersion: string;
  flagKey: string | null;
  policy: Policy | null;
  kill: { killId: string; safeMode: KillRequest['safeMode']; featureIds: string[] } | null;
  targets: string[];
  desired: string;
}

@Injectable()
@PlatformComponent('D06-08')
export class SecureDeployService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly pki: PkiService,
    private readonly repo: PublicationRepo,
    private readonly pipeline: PipelineService,
    private readonly runtime: VehicleRuntimeService,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly events: EventService,
    private readonly bus: ReadbackBus,
    private readonly policies: PolicyRepo,
  ) {}

  onModuleInit() {
    this.bus.subscribe((id) => this.recompute(id));
  }

  /** 모든 모듈 초기화(정책 시드 포함)가 끝난 뒤 */
  onApplicationBootstrap() {
    // 부팅 동기화 — 배포(DEPLOYED) 상태인데 게시본이 없는 정책(시드·이전 버전 데이터)을 서명해 차량에 보낸다.
    // 이게 없으면 서버는 배포 중이라고 판단하는데 차량은 정책을 받은 적이 없다. FF_BOOT_PUBLISH=0 으로 끈다.
    if (process.env.FF_BOOT_PUBLISH === '0') return;
    const published = new Set(this.repo.list({ kind: 'POLICY' }).map((x) => x.payload.policy?.policyId));
    const system: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'boot-sync' };
    for (const p of this.policies.all().filter((x) => x.status === 'DEPLOYED' && !published.has(x.policyId))) this.db.tx(() => this.publishPolicy(p, system));
  }

  /** Feature 적용 범위(국가·차종·트림)에 드는 등록 차량 — 정책 게시 대상. 코호트·권한은 차량이 받은 뒤 스스로 평가한다. */
  targetsFor(featureId: string, version: string): string[] {
    const f = this.features.get(featureId, version);
    if (!f) return [];
    return this.fleet
      .vehicles()
      .filter((v) => v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim)
      .map((v) => v.vin);
  }

  publishPolicy(policy: Policy, actor: Actor) {
    return this.create('POLICY', actor, {
      featureId: policy.featureId,
      featureVersion: policy.featureVersion,
      flagKey: policy.flagKey,
      policy,
      kill: null,
      targets: this.targetsFor(policy.featureId, policy.featureVersion),
      desired: policy.contentHash,
    });
  }

  publishKill(k: KillRequest, actor: Actor) {
    return this.create('KILL', actor, { featureId: k.featureId, featureVersion: k.featureVersion, flagKey: null, policy: null, kill: { killId: k.killId, safeMode: k.safeMode, featureIds: k.featureIds }, targets: k.vins, desired: k.safeMode });
  }

  publishRestore(k: KillRequest, actor: Actor) {
    return this.create('RESTORE', actor, { featureId: k.featureId, featureVersion: k.featureVersion, flagKey: null, policy: null, kill: { killId: k.killId, safeMode: k.safeMode, featureIds: k.featureIds }, targets: k.vins, desired: 'ACTIVE' });
  }

  /** 서명된 게시본 생성 — 호출자의 트랜잭션 안에서 기록하고, 커밋된 뒤에만 내보낸다 */
  private create(kind: PublicationKind, actor: Actor, d: Draft): Publication {
    if (!this.db.inTransaction) throw new Error('게시본은 원 변경과 같은 트랜잭션 안에서 만든다');
    const publicationId = this.repo.nextId();
    const payload = { publicationId, kind, sequence: 0, issuedAt: this.clock.iso(), ...d };
    const scopeKey = scopeKeyOf(payload);
    payload.sequence = this.repo.nextSequence(scopeKey);
    const emergency = kind !== 'POLICY';
    const now = this.clock.now();
    const pub: Publication = {
      publicationId,
      kind,
      status: 'SIGNED',
      payload,
      signature: this.pki.sign(payload),
      campaignId: null,
      channel: emergency ? 'EMERGENCY' : 'OTA',
      createdBy: actor.id,
      createdAt: now.toISOString(),
      deadlineAt: new Date(now.getTime() + (emergency ? EMERGENCY_TIMEOUT_MS : OTA_TIMEOUT_MS)).toISOString(),
      confirmed: 0,
      denominator: d.targets.length,
      nodes: [],
      ackOnly: [],
      closedAt: null,
    };
    this.repo.insert(pub, scopeKey);
    this.events.publish('publication.signed', publicationId, { publicationId, kind, keyId: pub.signature.keyId, payloadHash: pub.signature.payloadHash, targets: d.targets.length }, { componentId: 'D06-08', correlationId: actor.correlationId });
    this.db.afterCommit(() => this.dispatch(publicationId));
    return pub;
  }

  private dispatch(id: string) {
    const pub = this.repo.get(id)!;
    this.db.tx(() => {
      const r = this.pipeline.dispatch(pub);
      const next: Publication = { ...pub, status: 'DISPATCHED', campaignId: r.campaignId, ackOnly: r.ackOnly };
      this.repo.update(next);
      this.events.publish('publication.dispatched', id, { publicationId: id, kind: pub.kind, campaignId: r.campaignId, channel: pub.channel, unreachable: r.unreachable, ackOnly: r.ackOnly }, { componentId: 'D04-01' });
    });
    this.scheduler.after(Math.max(0, new Date(pub.deadlineAt).getTime() - this.clock.now().getTime()), () => this.close(id));
    this.recompute(id);
  }

  private evaluate(pub: Publication) {
    const required = pub.payload.targets.filter((v) => !pub.ackOnly.includes(v));
    const latest = new Map<string, ReturnType<PublicationRepo['readbacks']>[number]>();
    for (const r of this.repo.readbacks({ publicationId: pub.publicationId })) latest.set(r.vin, r); // 차량별 최신 회신으로 줄인다
    const now = this.clock.now().getTime();
    const reports: ReadbackReport[] = [...latest.values()].map((r) => ({
      nodeId: r.vin,
      metricType: r.metricType,
      publication: r.publicationId,
      policyHash: r.policyHash,
      featureVersion: r.featureVersion,
      bootId: r.bootId,
      sequence: r.sequence,
      ageMs: now - new Date(r.at).getTime(),
      observed: r.observed,
    }));
    const agg = aggregate(required, reports, {
      publication: pub.publicationId,
      policyHash: pub.signature.payloadHash,
      featureVersion: pub.payload.featureVersion,
      bootIds: Object.fromEntries(required.map((v) => [v, this.runtime.bootId(v)])),
      minSequence: Object.fromEntries(required.map((v) => [v, pub.payload.sequence])),
      maxAgeMs: MAX_REPORT_AGE_MS,
      desired: pub.payload.desired,
    });
    // 차량이 거부한 회신은 거부 사유를 그대로 보인다 (서명 불일치·재전송)
    const nodes = agg.nodes.map((n) => ({ ...n, reason: latest.get(n.nodeId)?.rejectReason ? `REJECTED:${latest.get(n.nodeId)!.rejectReason}` : n.reason }));
    return { required, agg: { ...agg, nodes } };
  }

  /** 회신이 들어올 때마다 — 전부 일치하거나 불일치가 확정되면 닫는다 */
  recompute(id: string) {
    const pub = this.repo.get(id);
    if (!pub || pub.closedAt || pub.status === 'SIGNED') return;
    const { required, agg } = this.evaluate(pub);
    const final = !required.length ? 'CONFIRMED' : agg.state === 'CONFIRMED' || agg.state === 'DIVERGED' ? agg.state : null;
    this.save(pub, agg, final);
  }

  /** 회신 기한 — 일부만 확인되면 PARTIAL, 하나도 없으면 TIMEOUT */
  close(id: string) {
    const pub = this.repo.get(id);
    if (!pub || pub.closedAt) return;
    const { agg } = this.evaluate(pub);
    this.save(pub, agg, agg.state === 'PARTIAL' ? 'PARTIAL' : agg.state === 'UNKNOWN' ? 'TIMEOUT' : (agg.state as 'CONFIRMED' | 'DIVERGED'));
  }

  private save(pub: Publication, agg: { confirmed: number; denominator: number; nodes: { nodeId: string; state: string; reason: string }[] }, final: Publication['status'] | null) {
    this.db.tx(() => {
      const next: Publication = { ...pub, confirmed: agg.confirmed, denominator: agg.denominator, nodes: agg.nodes, ...(final && { status: final, closedAt: this.clock.iso() }) };
      this.repo.update(next);
      if (final) this.events.publish('publication.closed', pub.publicationId, { publicationId: pub.publicationId, kind: pub.kind, status: final, confirmed: agg.confirmed, denominator: agg.denominator, killId: pub.payload.kill?.killId ?? null }, { componentId: 'D06-08' });
    });
  }

  list(q: { kind?: string; status?: string }) {
    return this.repo.list(q);
  }

  detail(id: string) {
    const publication = this.repo.get(id);
    if (!publication) throw new DomainError('NOT_FOUND', `게시본 ${id}을(를) 찾을 수 없습니다.`);
    return {
      publication,
      verification: this.pki.verify(publication.payload, publication.signature),
      readbacks: this.repo.readbacks({ publicationId: id }),
      calls: this.pipeline.calls({ key: id }),
    };
  }
}

@Controller('api/publications')
export class PublicationController {
  constructor(private readonly deploy: SecureDeployService) {}

  @Get()
  list(@Query('kind') kind?: string, @Query('status') status?: string) {
    return { items: this.deploy.list({ kind, status }) };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.deploy.detail(id);
  }
}
