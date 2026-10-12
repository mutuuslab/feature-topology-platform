// 긴급 기능 차단 (D03-03, PoC ⑥) — 검증·승인 단계를 거치지 않는 운영 경로(PoC 가정).
// IAM 역할 확인(운영자·안전 담당) → Topology 영향 범위(REQUIRES 의존 Feature·배포 flag·대상 차량) → 복구 방식 선택(Safe Default/Safe Stop)
// → type-to-confirm → 서명(D06-10) → 긴급 채널(IF-05) → 차량 회신 집계(CONFIRMED/TIMEOUT). 서버 판단은 요청 즉시 차단된다.
import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { KillCreateBody, type KillRequest } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { Inject } from '@nestjs/common';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { PublicationRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { KillRepo } from './kill.repo';

export const KILL_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;

@Injectable()
@PlatformComponent('D03-03')
export class KillService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly kills: KillRepo,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly deploy: SecureDeployService,
    private readonly publications: PublicationRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 차단 영향 범위 — 대상 Feature + 이를 REQUIRES하는 Feature(전이), 그 배포 flag, 적용 범위에 드는 차량 */
  preview(featureId: string, featureVersion: string, vins?: string[]) {
    const f = this.features.get(featureId, featureVersion);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${featureVersion}을(를) 찾을 수 없습니다.`);
    const ids = [featureId];
    for (let i = 0; i < ids.length; i++) {
      for (const d of this.topology.incoming(ids[i])) if (d.type === 'REQUIRES' && !ids.includes(d.sourceFeatureId)) ids.push(d.sourceFeatureId);
    }
    const dependents = ids.slice(1).map((id) => {
      const v = this.features.versions(id).at(-1);
      return { featureId: id, version: v?.version ?? null, name: v?.name ?? id, lifecycle: v?.lifecycle ?? null };
    });
    const deployed = this.policies.all().filter((p) => p.status === 'DEPLOYED' && ids.includes(p.featureId));
    // 차량 범위: 배포 정책이 있으면 그 Feature들의 적용 범위, 없으면 대상 Feature의 적용 범위
    const scopes = deployed.length ? deployed.map((p) => this.features.get(p.featureId, p.featureVersion)).filter((x) => !!x) : [f];
    const inScope = this.fleet.vehicles().filter((v) => scopes.some((s) => s!.country === v.country && s!.vehicleModel === v.vehicleModel && s!.trim === v.trim));
    const unknown = (vins ?? []).filter((v) => !inScope.some((x) => x.vin === v));
    const vehicles = vins?.length ? inScope.filter((v) => vins.includes(v.vin)) : inScope;
    return {
      feature: { featureId, version: featureVersion, name: f.name, lifecycle: f.lifecycle, asil: f.asil },
      featureIds: ids,
      dependents,
      flagKeys: [...new Set(deployed.map((p) => p.flagKey))].sort(),
      vehicles: vehicles.map((v) => ({ vin: v.vin, label: v.label, link: v.link, gleo: v.gleo })),
      unknownVins: unknown,
      activeKill: this.kills.active().find((k) => k.featureId === featureId)?.killId ?? null,
    };
  }

  issue(actor: Actor, body: KillCreateBody) {
    if (body.confirm.trim() !== body.featureId) {
      this.audit.failed(actor, 'KILL_ISSUE', body.featureId, 'type-to-confirm 불일치', 'D03-03');
      throw new DomainError('VALIDATION', `확인 입력이 차단 대상 Feature ID(${body.featureId})와 다릅니다.`);
    }
    const pv = this.preview(body.featureId, body.featureVersion, body.vins);
    if (pv.activeKill) throw new DomainError('CONFLICT', `${body.featureId}은(는) 이미 차단 중입니다 (${pv.activeKill}).`, { killId: pv.activeKill });
    if (pv.unknownVins.length) throw new DomainError('VALIDATION', `영향 범위 밖의 차량이 있습니다: ${pv.unknownVins.join(', ')}`, { unknownVins: pv.unknownVins });
    if (!pv.vehicles.length) throw new DomainError('GUARD_FAILED', '차단할 대상 차량이 없습니다.');
    return this.db.tx(() => {
      const k: KillRequest = {
        killId: this.kills.nextId(),
        featureId: body.featureId,
        featureVersion: body.featureVersion,
        featureIds: pv.featureIds,
        flagKeys: pv.flagKeys,
        vins: pv.vehicles.map((v) => v.vin),
        safeMode: body.safeMode,
        reason: body.reason,
        status: 'ACTIVE',
        requestedBy: actor.id,
        requestedAt: this.clock.iso(),
        publicationId: null,
        releasedBy: null,
        releasedAt: null,
        releaseReason: null,
        restorePublicationId: null,
        anomalyId: body.anomalyId ?? null,
      };
      const pub = this.deploy.publishKill(k, actor);
      k.publicationId = pub.publicationId;
      this.kills.insert(k);
      this.audit.record(actor, 'KILL_ISSUE', k.killId, { after: { featureIds: k.featureIds, vins: k.vins.length, safeMode: k.safeMode, publicationId: pub.publicationId }, reason: body.reason, componentId: 'D03-03' });
      this.events.publish('kill.issued', k.killId, { killId: k.killId, featureId: k.featureId, featureIds: k.featureIds, flagKeys: k.flagKeys, vins: k.vins.length, safeMode: k.safeMode, publicationId: pub.publicationId, anomalyId: k.anomalyId }, { componentId: 'D03-03', correlationId: actor.correlationId });
      return k;
    });
  }

  list(status?: string) {
    return this.kills.list(status).map((k) => this.withProgress(k));
  }

  detail(id: string) {
    const k = this.kills.get(id);
    if (!k) throw new DomainError('NOT_FOUND', `차단 요청 ${id}을(를) 찾을 수 없습니다.`);
    return this.withProgress(k);
  }

  /** 차단·복구 게시본의 회신 집계를 함께 붙인다 */
  private withProgress(k: KillRequest) {
    const summary = (id: string | null) => {
      const p = id ? this.publications.get(id) : undefined;
      return p ? { publicationId: p.publicationId, status: p.status, confirmed: p.confirmed, denominator: p.denominator, deadlineAt: p.deadlineAt, closedAt: p.closedAt, nodes: p.nodes, ackOnly: p.ackOnly } : null;
    };
    return { ...k, delivery: summary(k.publicationId), restore: summary(k.restorePublicationId) };
  }
}

@Controller('api/kill-requests')
export class KillController {
  constructor(private readonly kills: KillService) {}

  @Get()
  list(@Query('status') status?: string) {
    return { items: this.kills.list(status) };
  }

  /** 영향 범위 미리보기 — 변경 없음 */
  @Get('preview')
  preview(@Query('featureId') featureId = '', @Query('featureVersion') featureVersion = '', @Query('vins') vins?: string) {
    return this.kills.preview(featureId, featureVersion, vins ? vins.split(',').map((v) => v.trim()).filter(Boolean) : undefined);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.kills.detail(id);
  }

  @Post()
  @Roles(...KILL_ROLES)
  @AuditAction('KILL_ISSUE')
  issue(@CurrentActor() actor: Actor, @Body(new ZodPipe(KillCreateBody)) body: KillCreateBody) {
    return this.kills.issue(actor, body);
  }
}
