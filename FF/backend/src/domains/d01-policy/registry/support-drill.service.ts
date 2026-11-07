// 수명주기 격리 (D01-01·D01-07) — 규칙 contracts rules/lifecycle-isolation.ts
//  · 지원 종료·서버 교체 연습(ADS-LC02·FFP-F063): 지금 저장소의 승인·배포 기준선, 진행 중 차단, 서명 키, 차량 회신(검증 기준선)으로
//    서버를 새로 띄운 것처럼 차량 상태를 다시 계산해 기준선·차단·키 갱신·미승인 ON 네 칸을 판정하고 추가만 남긴다(Retirement 6단계의 사전 연습).
//  · Shadow 정책 봉투(ADS-LC01·FFP-F061): Shadow 실험이 차량에 줄 수 있는 것은 판단 기록뿐 — 출력·활성화·설치 권한은 늘 거짓.
import { Body, Controller, Get, Inject, Injectable, OnApplicationBootstrap, Param, Post } from '@nestjs/common';
import { shadowEnvelope, supportEndDrill, SupportDrillBody, type Experiment, type Publication, type SimVehicle } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo } from '../repos';

/** 시드 연습 대상 — 대표 Feature(배포 정책 2건) */
const SEED_DRILL = { featureId: 'FEAT-00022', version: '1.0.0' };

@Injectable()
@PlatformComponent('D01-01')
export class SupportDrillService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly kills: KillRepo,
  ) {}

  /** 정책 게시(부팅 동기화)가 끝난 뒤 시드 연습 1건 — 빈 화면을 두지 않는다 */
  onApplicationBootstrap() {
    if (isProduction() || seedOf() === 'none' || this.db.get('SELECT 1 FROM ads_support_drill LIMIT 1') || !this.features.get(SEED_DRILL.featureId, SEED_DRILL.version)) return;
    this.run({ id: 'system', role: 'SYSTEM', correlationId: 'seed-drill' }, SEED_DRILL.featureId, SEED_DRILL.version, 90, '시드 — 서버 교체 연습');
  }

  list(featureId: string, version: string) {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_support_drill WHERE feature_id = ? AND version = ? ORDER BY id', featureId, version).map((r) => JSON.parse(r.doc) as Record<string, unknown>);
  }

  run(actor: Actor, featureId: string, version: string, horizonDays: number, reason: string) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const deployed = this.policies.forFeature(featureId, version).filter((p) => p.status === 'DEPLOYED');
    const policy = deployed.at(-1) ?? null;
    const pubs = this.db.all<{ doc: string }>("SELECT doc FROM publication WHERE kind = 'POLICY' ORDER BY publication_id").map((r) => JSON.parse(r.doc) as Publication);
    const pub = policy ? [...pubs].reverse().find((p) => p.payload.policy?.policyId === policy.policyId) ?? null : null;
    const kill = this.kills.active().find((k) => k.featureIds.includes(featureId)) ?? null;
    const keys = this.db.all<{ key_id: string; purpose: string; status: string; not_after: string }>('SELECT key_id, purpose, status, not_after FROM pki_key ORDER BY key_id').map((k) => ({ keyId: k.key_id, purpose: k.purpose, status: k.status, notAfter: k.not_after }));
    const vehicles: SimVehicle[] = (pub?.payload.targets ?? []).map((vin) => {
      const node = pub!.nodes.find((n) => n.nodeId === vin);
      const verified = node?.state === 'CONFIRMED';
      return {
        vin,
        actuator: 'IDLE',
        acceptedPolicyHash: verified ? pub!.payload.desired : null,
        installedSw: null,
        flagValue: verified && !kill,
        shadowLog: [],
        trustedKeys: [pub!.signature.keyId],
        lastVerified: verified ? { policyHash: pub!.payload.desired, value: !kill, keyId: pub!.signature.keyId } : null,
      };
    });
    const result = supportEndDrill({ featureId, version, lifecycle: f.lifecycle, baseline: policy ? { policyId: policy.policyId, contentHash: policy.contentHash, safeDefault: policy.safeDefault } : null, kill: kill ? { active: true, killId: kill.killId } : null, keys, vehicles, now: this.clock.now().getTime(), horizonDays });
    const n = Number(this.db.get<{ n: number }>('SELECT count(*) AS n FROM ads_support_drill')!.n);
    const doc = { drillId: `DRL-${String(n + 1).padStart(5, '0')}`, featureId, version, lifecycle: f.lifecycle, horizonDays, runBy: actor.id, runAt: this.clock.iso(), publicationId: pub?.publicationId ?? null, reason, ...result };
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_support_drill (drill_id, feature_id, version, passed, run_by, run_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', doc.drillId, featureId, version, result.passed ? 1 : 0, actor.id, doc.runAt, JSON.stringify(doc));
      this.audit.record(actor, 'SUPPORT_END_DRILL', `${featureId}@${version}`, { after: { drillId: doc.drillId, passed: result.passed, failed: result.checks.filter((c) => c.result === 'FAIL').map((c) => c.id) }, reason, componentId: 'D01-01' });
      return doc;
    });
  }

  /** Shadow 정책 봉투 — Shadow 실험만(A/B는 차량 동작을 가르므로 봉투가 없다) */
  shadow(experimentId: string) {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM experiment WHERE experiment_id = ?', experimentId);
    if (!r) throw new DomainError('NOT_FOUND', `실험 ${experimentId}을(를) 찾을 수 없습니다.`);
    const e = JSON.parse(r.doc) as Experiment;
    if (e.type !== 'SHADOW') throw new DomainError('CONFLICT', `${experimentId}은(는) ${e.type} 실험이라 Shadow 봉투가 없습니다.`);
    return shadowEnvelope({ experimentId: e.experimentId, featureId: e.featureId, flagKey: e.flagKey });
  }
}

@Controller('api')
export class SupportDrillController {
  constructor(private readonly svc: SupportDrillService) {}

  @Get('features/:id/versions/:ver/support-drills')
  list(@Param('id') id: string, @Param('ver') ver: string) {
    return { items: this.svc.list(id, ver) };
  }

  @Post('features/:id/versions/:ver/support-drills')
  @Roles('RELEASE_MANAGER', 'SAFETY_OFFICER')
  @AuditAction('SUPPORT_END_DRILL')
  run(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(SupportDrillBody)) body: SupportDrillBody) {
    return this.svc.run(actor, id, ver, body.horizonDays, body.reason);
  }

  @Get('experiments/:id/shadow-envelope')
  shadow(@Param('id') id: string) {
    return this.svc.shadow(id);
  }
}
