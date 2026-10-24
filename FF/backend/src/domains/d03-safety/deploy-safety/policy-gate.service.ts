// 플랫폼 정책 게이트 (D03-02, 보고서 v1.1 8장·부록 D) — kill_command v2를 서명·전달하기 전 마지막 플랫폼 검사와 명령 원장.
// Registry 스냅샷(D.6)은 따로 저장하지 않고 Feature Registry(수명주기)와 안전 분류(WP1)에서 만든다 — 판정 함수는 contracts gateVerdict(화면과 같은 함수).
// 원장: Feature별 마지막 명령 순번·직전 Kill 승인자, 이동 시간 창 누적(추가만). Kill·복원(D03-03·04)이 PASS 명령을 record()로 남긴다(WP4).
import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { approvalSigProblems, commandApprovalSubject, jcs, profileFinding, type ProfileFinding } from '@ff/contracts';
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
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';

/** 커밋된 원장 시드(보고서 예시 ledger) — repo 루트 기준 */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'safety', 'command-ledger.json');

/** Feature 수명주기 → 게이트 상태. 지원 종료·Retirement는 폐기로 본다(비활성화만 허용 — FFG-PLT-002·FFG-ADS-010) */
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
    private readonly hsm: HsmService,
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

  /**
   * 판정만 — 원장은 바꾸지 않는다. 보고서 패키지 게이트와 같은 규칙(gateVerdict, Python 대조) 뒤에 플랫폼 규칙 FFG-GEN-003(시장 Profile)을 붙인다.
   * 판정에 쓴 Compliance Profile 버전을 함께 돌려준다(FFG-GEN-001 — 명령 기록).
   * FFP-F059·D-RD-5 — 승인 서명은 길이만 보지 않는다(FFG-PLT-005 판정에 더한다): 정준 64바이트 표기·승인자별 다른 값에 더해,
   * 모든 승인 칸을 그 승인자의 등록된 공개키로 검증한다 — 서명 대상은 명령에서 다시 만든다(commandApprovalSubject: 기능·요청·사유·
   * 차량 집합·승인자·역할·서명 시각). 플랫폼이 발행한 명령이든 외부에서 낸 명령이든 같다. 키 미등록·검증 실패·대상 불일치·
   * 발행 시각과 동떨어진 서명 시각은 FAIL.
   */
  preview(cmd: unknown): GateVerdict & { profiles?: ProfileFinding['profiles'] } {
    const c = cmd as { feature?: { id?: unknown; version?: unknown }; target?: { market?: unknown }; request?: unknown } | null;
    const id = typeof c?.feature?.id === 'string' ? c.feature.id : '';
    const ver = typeof c?.feature?.version === 'string' ? c.feature.version : '';
    const registry = this.registryFor(id, ver);
    const v = gateVerdict(cmd, registry, this.clock.now());
    if (v.result === 'SCHEMA_FAIL') return v;
    const feat = registry.features[id];
    const p = profileFinding({ market: String(c?.target?.market ?? ''), request: String(c?.request ?? ''), fClass: feat?.f_class ?? null, adsFeature: !!feat?.ads_feature });
    const sig = this.approvalProblems(cmd as KillCommandV2);
    const base = v.findings.map((x) => (x.rule === 'FFG-PLT-005' && sig.length ? { ...x, ok: false, message: `${x.message} — ${sig.join('; ')}` } : x));
    const findings = [...base, { rule: p.rule, ok: p.ok, message: p.detail }];
    return { ...v, findings, result: findings.every((x) => x.ok) ? 'PASS' : 'FAIL', profiles: p.profiles };
  }

  /** 승인 서명 문제 — 형식(정준·승인자별), 등록된 승인자 키 검증(대상 집합 결속), 서명 시각(발행 시각 앞뒤 허용 범위) */
  private approvalProblems(cmd: KillCommandV2): string[] {
    const approvals = Array.isArray(cmd?.approvals) ? cmd.approvals : [];
    const out = approvalSigProblems(approvals);
    const issued = Date.parse(cmd.validity.not_before);
    const skewMs = DEFAULT_GATE_POLICY.max_clock_skew_seconds * 1000;
    const oldestMs = DEFAULT_GATE_POLICY.max_command_ttl_hours * 3600_000;
    for (const a of approvals) {
      if (!this.hsm.hasApproverKey(a.approver_id)) {
        out.push(`${a.approver_id}: 등록된 승인자 키가 없습니다 — 승인자 키를 먼저 등록해야 합니다`);
        continue;
      }
      if (!this.hsm.verifyApproval(a.approver_id, jcs(commandApprovalSubject(cmd, a)), a.approval_sig ?? ''))
        out.push(`${a.approver_id}: 승인 서명이 등록된 키로 검증되지 않거나 이 명령의 대상(기능·요청·사유·차량 ${cmd.scope.vehicle_ids.length}대·승인 칸)에 대한 서명이 아닙니다`);
      const signed = Date.parse(a.signed_at);
      if (signed > issued + skewMs) out.push(`${a.approver_id}: 승인 시각이 명령 발효 시각보다 뒤입니다`);
      else if (signed < issued - oldestMs) out.push(`${a.approver_id}: 승인 시각이 명령 발효 시각보다 ${DEFAULT_GATE_POLICY.max_command_ttl_hours}시간 넘게 앞섭니다(오래된 승인)`);
    }
    return out;
  }

  /**
   * PASS 명령을 원장에 남긴다 — 순번은 원장+1만, 같은 command_id는 한 번만. 판정을 다시 해 그사이 바뀐 원장으로도 PASS여야 한다.
   * @rule FFG-PLT-017, FFG-SEC-003 — 원장 갱신(서명 HSM 정책 엔진의 누적 상한 재집행은 WP4)
   */
  record(actor: Actor, cmd: KillCommandV2): GateVerdict {
    try {
      return this.db.tx(() => this.commit(actor, cmd));
    } catch (e) {
      if (!(e instanceof GateRejected)) throw e;
      // 거부 감사는 트랜잭션 밖에서(롤백돼도 남는다)
      const bad = e.verdict.findings.filter((x) => !x.ok);
      this.audit.failed(actor, 'GATE_RECORD', cmd.feature?.id ?? '-', bad.map((x) => x.rule).join(', '), 'D03-02');
      throw new DomainError('GUARD_FAILED', '정책 게이트를 통과하지 못한 명령은 원장에 남길 수 없습니다.', { findings: bad });
    }
  }

  /**
   * 호출자 트랜잭션 안에서 판정·원장 갱신 — 그사이 다른 명령이 원장을 바꿨어도 다시 판정한 결과로. 거부하면 GateRejected(감사는 호출자가 트랜잭션 밖에서)
   */
  commit(actor: Actor, cmd: KillCommandV2): GateVerdict {
    if (!this.db.inTransaction) throw new Error('commit()은 호출자의 트랜잭션 안에서 부른다');
    {
      const v = this.preview(cmd);
      if (v.result !== 'PASS') throw new GateRejected(v);
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
        after: { commandId: cmd.command_id, commandSeq: cmd.command_seq, request: cmd.request, vehicles: cmd.scope.vehicle_ids.length, approvers, complianceProfiles: v.profiles ?? [] },
        reason: `${cmd.reason.category}/${cmd.reason.code}`,
        componentId: 'D03-02',
      });
      this.events.publish(
        'gate.recorded',
        cmd.feature.id,
        { featureId: cmd.feature.id, commandId: cmd.command_id, commandSeq: cmd.command_seq, request: cmd.request, vehicles: cmd.scope.vehicle_ids.length, complianceProfiles: v.profiles ?? [] },
        { componentId: 'D03-02', correlationId: actor.correlationId },
      );
      return v;
    }
  }
}

/** 게이트 거부 — commit()이 던지고 호출자가 감사·상태를 남긴다 */
export class GateRejected extends Error {
  constructor(readonly verdict: GateVerdict) {
    super(`정책 게이트 거부: ${verdict.findings.filter((f) => !f.ok).map((f) => f.rule).join(', ')}`);
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
