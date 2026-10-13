// 플랫폼 정책 게이트 (D03-02, 보고서 v1.1 8장·부록 D) — kill_command v2를 서명·전달하기 전 마지막 플랫폼 검사와 명령 원장.
// Registry 스냅샷(D.6)은 따로 저장하지 않고 Feature Registry(수명주기)와 안전 분류(WP1)에서 만든다 — 판정 함수는 contracts gateVerdict(화면과 같은 함수).
// 원장: Feature별 마지막 명령 순번·직전 Kill 승인자, 이동 시간 창 누적(추가만). Kill·복원(D03-03·04)이 PASS 명령을 record()로 남긴다(WP4).
import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GATE_POLICY, gateVerdict, type GateFeature, type GateLedger, type GateRegistry, type GateVerdict, type KillCommandV2 } from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FeatureRepo } from '../../d01-policy/repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';

/** 커밋된 원장 시드(보고서 예시 ledger) — repo 루트 기준 */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'safety', 'command-ledger.json');

/** Feature 수명주기 → 게이트 상태. 지원 종료·은퇴는 폐기로 본다(비활성화만 허용 — FFG-PLT-002·FFG-ADS-010) */
export function gateStatusOf(lifecycle: string): string {
  if (lifecycle === 'RELEASED') return 'RELEASED';
  if (lifecycle === 'DEPRECATED' || lifecycle === 'RETIRED') return 'DECOMMISSIONED';
  return lifecycle;
}

export interface GateSnapshot {
  featureId: string;
  version: string;
  feature: GateFeature | null;
  ledger: GateLedger;
  policy: typeof DEFAULT_GATE_POLICY;
  nextSeq: number;
  /** 이동 시간 창 누적(비활성화) — 화면 게이지용 */
  window: { hours: number; deactivate: number; restore: number; cap: number };
}

@Injectable()
@PlatformComponent('D03-02')
export class PolicyGateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly profiles: SafetyProfileService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  onModuleInit() {
    if (this.db.get('SELECT 1 FROM command_ledger LIMIT 1') || !existsSync(FIXTURE) || process.env.FF_SEED === 'none') return;
    const seed = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      items: { featureId: string; lastSeq: number; lastKillApprovers: string[]; recent: { commandId: string; request: string; vehicles: number; at: string }[] }[];
    };
    this.db.tx(() => {
      for (const l of seed.items) {
        if (!this.features.versions(l.featureId).length) continue;
        this.db.run(
          'INSERT INTO command_ledger (feature_id, last_seq, last_kill_approvers, updated_at) VALUES (?, ?, ?, ?)',
          l.featureId,
          l.lastSeq,
          JSON.stringify(l.lastKillApprovers),
          this.clock.iso(),
        );
        for (const r of l.recent)
          this.db.run('INSERT INTO command_window (feature_id, command_id, request, vehicles, at) VALUES (?, ?, ?, ?, ?)', l.featureId, r.commandId, r.request, r.vehicles, r.at);
      }
    });
  }

  /** Registry 스냅샷 항목(보고서 D.6) — Feature Registry + 안전 분류. 없는 Version이면 null(FFG-PLT-002에서 걸린다) */
  registryEntry(featureId: string, version: string): GateFeature | null {
    const f = this.features.get(featureId, version);
    if (!f) return null;
    const p = this.profiles.ensure(featureId, version);
    return {
      name: f.name,
      version: f.version,
      status: gateStatusOf(f.lifecycle),
      f_class: p.fClass,
      deact_class: p.deactClass,
      gsr_mandatory: p.gsrMandatory,
      max_vehicles: p.maxActivationScope?.vehicles ?? 0,
      max_per_window: p.maxActivationScope?.perWindow ?? 0,
      markets_approved: [...p.markets],
      type_approval_relevant: p.regClass !== 'R0',
      ads_feature: p.adsFeature,
      profile: { takeover_ms: p.takeoverMs, ramp_ms: p.rampMs, fault_ramp_ms: p.faultRampMs, max_pending_ms: p.maxPendingMs, max_cycle_wait_ms: p.maxCycleWaitMs },
    };
  }

  ledger(featureId: string): GateLedger {
    const l = this.db.get<{ last_seq: number; last_kill_approvers: string }>('SELECT last_seq, last_kill_approvers FROM command_ledger WHERE feature_id = ?', featureId);
    const since = new Date(this.clock.now().getTime() - DEFAULT_GATE_POLICY.kill_window_hours * 3600_000).toISOString();
    const recent = this.db.all<{ request: string; vehicles: number; at: string }>('SELECT request, vehicles, at FROM command_window WHERE feature_id = ? AND at >= ? ORDER BY id', featureId, since);
    return { last_order_seq: l?.last_seq ?? 0, last_kill_approvers: l ? (JSON.parse(l.last_kill_approvers) as string[]) : [], recent };
  }

  snapshot(featureId: string, version: string): GateSnapshot {
    const feature = this.registryEntry(featureId, version);
    if (!feature) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const ledger = this.ledger(featureId);
    const sum = (req: string) => (ledger.recent ?? []).filter((r) => r.request === req).reduce((a, r) => a + r.vehicles, 0);
    return {
      featureId,
      version,
      feature,
      ledger,
      policy: DEFAULT_GATE_POLICY,
      nextSeq: (ledger.last_order_seq ?? 0) + 1,
      window: { hours: DEFAULT_GATE_POLICY.kill_window_hours, deactivate: sum('deactivate'), restore: sum('restore'), cap: feature.max_per_window },
    };
  }

  private registryFor(featureId: string, version: string): GateRegistry {
    const entry = this.registryEntry(featureId, version);
    return { features: entry ? { [featureId]: entry } : {}, policy: DEFAULT_GATE_POLICY, ledger: { [featureId]: this.ledger(featureId) } };
  }

  /** 판정만 — 원장은 바꾸지 않는다 */
  preview(cmd: unknown): GateVerdict {
    const f = (cmd as { feature?: { id?: unknown; version?: unknown } } | null)?.feature;
    const id = typeof f?.id === 'string' ? f.id : '';
    const ver = typeof f?.version === 'string' ? f.version : '';
    return gateVerdict(cmd, this.registryFor(id, ver), this.clock.now());
  }

  /**
   * PASS 명령을 원장에 남긴다 — 순번은 원장+1만, 같은 command_id는 한 번만. 판정을 다시 해 그사이 바뀐 원장으로도 PASS여야 한다.
   * @rule FFG-PLT-017, FFG-SEC-003 — 원장 갱신(서명 HSM 정책 엔진의 누적 상한 재집행은 WP4)
   */
  record(actor: Actor, cmd: KillCommandV2): GateVerdict {
    let rejected: GateVerdict | null = null;
    try {
      return this.writeLedger(actor, cmd, (v) => (rejected = v));
    } catch (e) {
      if (!rejected) throw e;
      // 거부 감사는 트랜잭션 밖에서(롤백돼도 남는다)
      const bad = (rejected as GateVerdict).findings.filter((x) => !x.ok);
      this.audit.failed(actor, 'GATE_RECORD', cmd.feature?.id ?? '-', bad.map((x) => x.rule).join(', '), 'D03-02');
      throw new DomainError('GUARD_FAILED', '정책 게이트를 통과하지 못한 명령은 원장에 남길 수 없습니다.', { findings: bad });
    }
  }

  /** 판정과 원장 갱신을 한 트랜잭션에서 — 그사이 다른 명령이 원장을 바꿨어도 다시 판정한 결과로 */
  private writeLedger(actor: Actor, cmd: KillCommandV2, reject: (v: GateVerdict) => void): GateVerdict {
    return this.db.tx(() => {
      const v = this.preview(cmd);
      if (v.result !== 'PASS') {
        reject(v);
        throw new Error('gate rejected');
      }
      const approvers = cmd.approvals.map((a) => a.approver_id);
      const prev = this.ledger(cmd.feature.id).last_kill_approvers ?? [];
      const killApprovers = cmd.request === 'deactivate' ? approvers : prev;
      this.db.run(
        'INSERT INTO command_ledger (feature_id, last_seq, last_kill_approvers, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(feature_id) DO UPDATE SET last_seq = excluded.last_seq, last_kill_approvers = excluded.last_kill_approvers, updated_at = excluded.updated_at',
        cmd.feature.id,
        cmd.command_seq,
        JSON.stringify(killApprovers),
        this.clock.iso(),
      );
      if (cmd.request === 'deactivate' || cmd.request === 'restore')
        this.db.run(
          'INSERT INTO command_window (feature_id, command_id, request, vehicles, at) VALUES (?, ?, ?, ?, ?)',
          cmd.feature.id,
          cmd.command_id,
          cmd.request,
          cmd.scope.vehicle_ids.length,
          this.clock.iso(),
        );
      this.audit.record(actor, 'GATE_RECORD', cmd.feature.id, {
        after: { commandId: cmd.command_id, commandSeq: cmd.command_seq, request: cmd.request, vehicles: cmd.scope.vehicle_ids.length, approvers },
        reason: `${cmd.reason.category}/${cmd.reason.code}`,
        componentId: 'D03-02',
      });
      this.events.publish(
        'gate.recorded',
        cmd.feature.id,
        { featureId: cmd.feature.id, commandId: cmd.command_id, commandSeq: cmd.command_seq, request: cmd.request, vehicles: cmd.scope.vehicle_ids.length },
        { componentId: 'D03-02', correlationId: actor.correlationId },
      );
      return v;
    });
  }
}

@Controller('api/gate')
export class PolicyGateController {
  constructor(private readonly gate: PolicyGateService) {}

  /** 게이트 미리보기 — 원장을 바꾸지 않는다. 본문은 kill_command v2 JSON(스키마 오류도 판정 결과로 돌려준다) */
  @Post('preview')
  @Roles('OPERATOR', 'SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD')
  preview(@CurrentActor() _actor: Actor, @Body() body: unknown) {
    return this.gate.preview(body);
  }

  /** 게이트가 보는 이 Feature Version — Registry 항목(D.6)·원장·다음 순번·이동 시간 창 누적 */
  @Get('features/:id/versions/:ver')
  snapshot(@Param('id') id: string, @Param('ver') ver: string) {
    return this.gate.snapshot(id, ver);
  }
}
