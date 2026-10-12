// IF-04 Policy Tool 연계 (D01-06 정책 저장·버전 관리) — 배포된 정책을 Unleash 정의로 내보내고, 차량별 판단을 대조하고, 서버 쪽 변경(drift)을 찾는다.
// hfp-feature-lifecycle js/unleash.js deploy()의 TS 이식: flag 생성(없으면 생성, 보관됐으면 복구) → 태그 → REQUIRES 의존 → 전략 교체 → 환경 on/off,
// 첫 실패 단계에서 멈춘다. 결과는 외부 연계 호출 기록(IF-04)·감사·이벤트에 남는다. FP가 원천이고 Unleash는 사본이다(UL-OSS).
import { Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, planUnleash, unleashContext, unleashDrift, UNLEASH_ENVIRONMENT, UNLEASH_PROJECT, type Policy, type UnleashPlan } from '@ff/contracts';
import { IfCallRepo } from '../../../adapters/if-call/if-call.repo';
import { UnleashGateway, type UnleashResult } from '../../../adapters/unleash/unleash.client';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ActivationService } from '../activation/activation.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { FeatureRepo, TopologyRepo } from '../repos';

export interface SyncStep {
  name: string;
  state: string;
  code: number;
  why: string | null;
  detail?: string;
}

const P = UNLEASH_PROJECT;
const ENV = UNLEASH_ENVIRONMENT;

@Injectable()
@PlatformComponent('D01-06')
export class UnleashSyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly gateway: UnleashGateway,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly fleet: FleetRepo,
    private readonly entitlements: EntitlementService,
    private readonly activation: ActivationService,
    private readonly ifCalls: IfCallRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  private get u() {
    return this.gateway.client;
  }

  async status() {
    const h = await this.u.health();
    return { mode: this.u.mode, url: this.u.url, state: h.state, version: h.data?.version ?? null, why: h.why };
  }

  private require(id: string): Policy {
    const p = this.policies.get(id);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${id}을(를) 찾을 수 없습니다.`);
    return p;
  }

  async plan(p: Policy): Promise<UnleashPlan> {
    const f = this.features.get(p.featureId, p.featureVersion);
    if (!f) throw new DomainError('NOT_FOUND', `정책 대상 ${p.featureId} ${p.featureVersion}이(가) 없습니다.`);
    const deployedFlags = (featureId: string) => [...new Set(this.policies.all().filter((x) => x.featureId === featureId && x.status === 'DEPLOYED').map((x) => x.flagKey))].sort();
    const out = this.topology.outgoing(f.featureId, f.version);
    const requires = out.filter((d) => d.type === 'REQUIRES').map((d) => ({ featureId: d.targetFeatureId, flagKeys: deployedFlags(d.targetFeatureId) }));
    const excludes = [...new Set([...out.filter((d) => d.type === 'EXCLUDES').map((d) => d.targetFeatureId), ...this.topology.incoming(f.featureId).filter((d) => d.type === 'EXCLUDES').map((d) => d.sourceFeatureId)])];
    let cohortMembers: string[] | null = null;
    if (p.rollout.mode === 'COHORT') {
      // FP-COHORT-1 서명 코호트 목록 — 등록 Fleet 중 효과 비율 안에 드는 차량
      const bp = effectiveBasisPoints(p);
      cohortMembers = [];
      for (const v of this.fleet.vehicles()) if ((await cohortBucket('1', p.flagKey, p.rollout.salt, v.vin)) < bp) cohortMembers.push(v.vin);
    }
    return planUnleash({ policy: p, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, requires, excludes, cohortMembers });
  }

  /** 서버에 있는 정의 (없으면 null) */
  private async server(plan: UnleashPlan) {
    const r = await this.u.admin<any>('GET', `projects/${P}/features/${plan.flagName}`);
    if (r.state !== 'OK' || !r.data) return { result: r, server: null };
    const env = (r.data.environments ?? []).find((e: any) => e.name === ENV);
    const tags = await this.u.admin<any>('GET', `features/${plan.flagName}/tags`);
    return { result: r, server: { enabled: env ? !!env.enabled : null, strategies: env?.strategies ?? [], tags: tags.data?.tags ?? [] } };
  }

  async view(id: string) {
    const p = this.require(id);
    const plan = await this.plan(p);
    const { result, server } = await this.server(plan);
    const lastSync = this.ifCalls.list({ ifId: 'IF-04' }).find((c) => (c.request as any)?.policyId === id) ?? null;
    return {
      status: await this.status(),
      plan,
      server: result.state === 'OK' || result.state === 'NOT_FOUND' ? server : null,
      drift: result.state === 'OK' || result.state === 'NOT_FOUND' ? unleashDrift(plan, server) : null,
      serverError: result.state === 'OK' || result.state === 'NOT_FOUND' ? null : result.why,
      lastSync,
    };
  }

  async sync(actor: Actor, id: string) {
    const p = this.require(id);
    const plan = await this.plan(p);
    const steps: SyncStep[] = [];
    const record = (name: string, r: UnleashResult, detail?: string, okStates = ['OK']) => {
      steps.push({ name, state: r.state, code: r.code, why: r.why, detail });
      return okStates.includes(r.state);
    };
    let outcome: 'SYNCED' | 'BLOCKED' | 'FAILED' = 'SYNCED';
    if (!plan.ready) outcome = 'BLOCKED';
    else if (this.u.mode === 'off') {
      outcome = 'FAILED';
      steps.push({ name: 'health', state: 'UNKNOWN', code: 0, why: 'UNLEASH_MODE=off' });
    } else outcome = (await this.deploy(plan, record)) ? 'SYNCED' : 'FAILED';

    // 외부 연계 호출 기록 — 실행마다 새 키(동기화는 재실행 가능한 upsert)
    const key = `${p.policyId}@r${p.revision}#${this.ifCalls.next('IF-04')}`;
    this.ifCalls.call('IF-04', key, { policyId: p.policyId, revision: p.revision, flagName: plan.flagName, mode: this.u.mode }, () => ({ outcome, steps }));
    // 실패·차단 감사는 트랜잭션 밖에서(커널 규칙), 성공 감사는 이벤트와 같은 트랜잭션에서
    if (outcome !== 'SYNCED') this.audit.failed(actor, 'UNLEASH_SYNC', p.policyId, outcome === 'BLOCKED' ? plan.blockers.join(' / ') : (steps.at(-1)?.why ?? 'Unleash 동기화 실패'), 'D01-06');
    this.db.tx(() => {
      if (outcome === 'SYNCED') this.audit.record(actor, 'UNLEASH_SYNC', p.policyId, { after: { flagName: plan.flagName, enabled: plan.enabled, strategies: plan.strategies.length, mode: this.u.mode }, componentId: 'D01-06' });
      this.events.publish(`unleash.${outcome.toLowerCase()}`, p.policyId, { policyId: p.policyId, flagName: plan.flagName, outcome, mode: this.u.mode, failedStep: outcome === 'FAILED' ? (steps.at(-1)?.name ?? null) : null }, { componentId: 'D01-06', correlationId: actor.correlationId });
    });
    return { outcome, plan, steps };
  }

  /** hfp deploy() 순서. 첫 실패 단계에서 멈춘다(태그 부착·의존 등록 응답은 기록만 — hfp와 같다). */
  private async deploy(plan: UnleashPlan, record: (name: string, r: UnleashResult, detail?: string, ok?: string[]) => boolean): Promise<boolean> {
    const flag = plan.flagName;
    const base = `projects/${P}/features/${flag}`;
    // 1. flag 보장: 있으면 재사용, 없으면 생성, 생성이 막히면(보관됨) 복구
    const got = await this.u.admin('GET', base);
    if (got.state === 'OK') record('ensureFlag', got, 'REUSED');
    else if (got.state === 'NOT_FOUND' || got.state === 'FAILED') {
      const made = await this.u.admin('POST', `projects/${P}/features`, { name: flag, type: 'release', description: plan.description, impressionData: false });
      if (made.state === 'OK') record('ensureFlag', made, 'CREATED');
      else {
        const revived = await this.u.admin('POST', `archive/revive/${flag}`, {});
        if (!record('ensureFlag', revived, 'REVIVED')) return false;
      }
    } else return record('ensureFlag', got);
    // 2. 태그 (유형·값이 없으면 먼저 만든다)
    const types = await this.u.admin<{ tagTypes: { name: string }[] }>('GET', 'tag-types');
    if (!record('tagTypes', types)) return false;
    const tags = await this.u.admin<{ tags: { type: string; value: string }[] }>('GET', 'tags?limit=1000');
    if (!record('tags', tags)) return false;
    for (const t of plan.tags) {
      if (!types.data?.tagTypes.some((x) => x.name === t.type)) {
        const r = await this.u.admin('POST', 'tag-types', { name: t.type, description: 'FF Platform 추적 태그' });
        if (!record(`tagType ${t.type}`, r)) return false;
        types.data?.tagTypes.push({ name: t.type });
      }
      if (!tags.data?.tags.some((x) => x.type === t.type && x.value === t.value)) {
        const r = await this.u.admin('POST', 'tags', t);
        if (!record(`tag ${t.type}=${t.value}`, r)) return false;
      }
      record(`attach ${t.type}`, await this.u.admin('POST', `features/${flag}/tags`, t), t.value, ['OK', 'INVALID', 'FAILED']);
    }
    // 3. REQUIRES 의존 — 상위 flag가 Unleash에 먼저 있어야 한다
    for (const parent of plan.dependencies) {
      const pr = await this.u.admin('GET', `projects/${P}/features/${parent}`);
      if (!record(`parent ${parent}`, pr, pr.state === 'OK' ? undefined : '상위 flag를 먼저 동기화하세요')) return false;
      record(`dependency ${parent}`, await this.u.admin('POST', `${base}/dependencies`, { feature: parent }), undefined, ['OK', 'INVALID', 'FAILED']);
    }
    // 4. 전략 교체 — 하나 대 하나면 PUT, 아니면 새로 만들고 예전 것 삭제
    const env = `${base}/environments/${ENV}/strategies`;
    const cur = await this.u.admin<any>('GET', env);
    if (!record('strategies', cur)) return false;
    // 응답 목록을 복사해 둔다 — 새 전략을 만든 뒤 '예전 전략'만 지워야 한다
    const existing: { id: string }[] = [...(Array.isArray(cur.data) ? cur.data : (cur.data?.strategies ?? []))];
    if (existing.length === 1 && plan.strategies.length === 1) {
      if (!record('strategy PUT', await this.u.admin('PUT', `${env}/${existing[0].id}`, { id: existing[0].id, ...plan.strategies[0] }), 'UPDATED')) return false;
    } else {
      for (const s of plan.strategies) if (!record('strategy POST', await this.u.admin('POST', env, s), s.title)) return false;
      for (const old of existing) if (!record('strategy DELETE', await this.u.admin('DELETE', `${env}/${old.id}`), old.id)) return false;
    }
    // 5. 환경 on/off
    return record(`environment ${plan.enabled ? 'on' : 'off'}`, await this.u.admin('POST', `${base}/environments/${ENV}/${plan.enabled ? 'on' : 'off'}`, { environment: ENV }));
  }

  /** 차량별 대조 — Unleash playground 판단 vs 서버 활성화 판단(D01-09). 문맥 품질이 TRUSTED가 아닌 차량은 비교 제외(P0는 HOLD, Unleash는 3치 논리가 없다). */
  async evaluate(id: string) {
    const p = this.require(id);
    const plan = await this.plan(p);
    const rows: { vin: string; label: string; unleash: boolean | null; platform: boolean | null; platformReason: string | null; verdict: 'AGREE' | 'MISMATCH' | 'NO_CONTEXT' | 'ERROR'; why: string | null }[] = [];
    for (const v of this.fleet.vehicles()) {
      const trial = p.entitlementCatalogId ? this.entitlements.activeFor(v.vin, p.featureId).active : null;
      const server = await this.activation.decide(v.vin, p.flagKey).then((d) => d.result, () => null);
      if (v.quality !== 'TRUSTED') {
        rows.push({ vin: v.vin, label: v.label, unleash: null, platform: server?.value ?? null, platformReason: server?.reason ?? null, verdict: 'NO_CONTEXT', why: `문맥 ${v.quality} — 플랫폼은 HOLD(Safe Default)` });
        continue;
      }
      const r = await this.u.admin<any>('POST', 'playground/advanced', { projects: [P], environments: [ENV], context: unleashContext(v, trial) });
      const row = r.data?.features?.find((x: any) => x.name === plan.flagName)?.environments?.[ENV]?.[0];
      if (r.state !== 'OK' || !row) {
        rows.push({ vin: v.vin, label: v.label, unleash: null, platform: server?.value ?? null, platformReason: server?.reason ?? null, verdict: 'ERROR', why: r.why ?? 'Unleash에 flag가 없습니다 — 먼저 동기화하세요' });
        continue;
      }
      const unleash = !!row.isEnabled;
      const platform = server?.value ?? null;
      rows.push({
        vin: v.vin,
        label: v.label,
        unleash,
        platform,
        platformReason: server?.reason ?? null,
        verdict: unleash === platform ? 'AGREE' : 'MISMATCH',
        why: unleash === platform ? null : server?.reason === 'KILL_SWITCH' ? '긴급 차단은 FP에서만 — Unleash 정의는 그대로' : row.hasUnsatisfiedDependency ? '상위 flag 미충족' : null,
      });
    }
    const n = (k: string) => rows.filter((r) => r.verdict === k).length;
    return { flagName: plan.flagName, summary: { vehicles: rows.length, agree: n('AGREE'), mismatch: n('MISMATCH'), noContext: n('NO_CONTEXT'), error: n('ERROR') }, rows };
  }
}

@Controller('api')
export class UnleashController {
  constructor(private readonly sync: UnleashSyncService) {}

  @Get('unleash/status')
  status() {
    return this.sync.status();
  }

  @Get('policies/:id/unleash')
  view(@Param('id') id: string) {
    return this.sync.view(id);
  }

  @Post('policies/:id/unleash/sync')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPERATOR')
  @AuditAction('UNLEASH_SYNC')
  run(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sync.sync(actor, id);
  }

  @Get('policies/:id/unleash/evaluation')
  evaluate(@Param('id') id: string) {
    return this.sync.evaluate(id);
  }
}
