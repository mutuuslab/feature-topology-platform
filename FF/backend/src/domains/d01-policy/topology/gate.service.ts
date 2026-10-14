// Gate Record — Topology 소유(상세설계서 표 12). append-only: 재판정은 새 SIM-Gn-NNNNNN, 이전 레코드는 감사용으로 남는다.
// 증거 없는 PASS 금지, Gate 단계 순서(G1~3 → G4~7 → G8~9) 준수, RELEASED 이후 버전은 판정 불가(새 Version으로).
import { Inject, Injectable } from '@nestjs/common';
import { SafetyProfileService } from '../registry/safety-profile.service';
import {
  GATE_META,
  GATES,
  gateStatusOf,
  LIFECYCLE_RANK,
  type FeatureVersionRow,
  type GateId,
  type GateRecordRow,
  type JudgeGateBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { LifecycleService } from '../registry/lifecycle.service';
import { GateRepo } from '../repos';
import { GateDecisionService } from './gate-decision.service';
import { VirtualRunRepo } from '../../d06-qsec/scenario-validation/virtual-run.repo';

const STAGES: GateId[][] = [
  ['G1', 'G2', 'G3'],
  ['G4', 'G5', 'G6', 'G7'],
  ['G8', 'G9'],
];
const stageOf = (g: GateId) => STAGES.findIndex((s) => s.includes(g));

@Injectable()
@PlatformComponent('D01-02')
export class GateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gates: GateRepo,
    private readonly lifecycle: LifecycleService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly virtualRuns: VirtualRunRepo,
    private readonly safety: SafetyProfileService,
    private readonly decisions: GateDecisionService,
  ) {}

  view(featureId: string, version: string) {
    this.lifecycle.require(featureId, version);
    const history = this.gates.history(featureId, version);
    const latest = this.gates.latest(featureId, version);
    return {
      gates: GATES.map((g) => ({
        gate: g,
        name: GATE_META[g].name,
        judgeRole: GATE_META[g].judgeRole,
        stage: GATE_META[g].stage,
        latest: latest[g] ?? null,
        /** FFG-LCY-001 — 최신 기록의 Decision Record 서명 상태 */
        decision: latest[g] ? this.decisions.verify(latest[g]!) : null,
        /** 레코드 없음 = 미판정 (Registry 표시 '미발급') */
        status: latest[g]?.status ?? '미판정',
        evidence: latest[g] ? this.gates.evidence(latest[g]!.gateRecordId) ?? null : null,
        history: history.filter((h) => h.gate === g).map((h) => ({ ...h, decision: this.decisions.verify(h).state })),
      })),
    };
  }

  /** 판정 가능 여부 — 막히면 사유 */
  private check(actor: Actor, f: FeatureVersionRow, gate: GateId): string | null {
    if (LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.RELEASED) return `${f.lifecycle} 버전은 읽기 전용입니다. 새 Version을 만들어 판정하세요.`;
    if (actor.role === 'SAFETY_OFFICER' && gate !== 'G7') return '기능안전·보안 담당자는 G7만 판정할 수 있습니다.';
    const stage = stageOf(gate);
    const need: Record<number, number> = { 0: LIFECYCLE_RANK.PROPOSED, 1: LIFECYCLE_RANK.DEVELOPING, 2: LIFECYCLE_RANK.VERIFIED };
    if (LIFECYCLE_RANK[f.lifecycle] < need[stage]) return `${gate}은(는) ${GATE_META[gate].stage} 단계 Gate입니다 (현재 ${f.lifecycle}).`;
    const latest = this.gates.latest(f.featureId, f.version);
    for (const prev of STAGES.slice(0, stage).flat())
      if (latest[prev]?.status !== 'PASS') return `앞 단계 ${prev}이(가) PASS가 아닙니다 (${latest[prev]?.status ?? '미판정'}).`;
    return null;
  }

  /**
   * @rule FFG-LCY-002 — fail-closed: 근거 없는 PASS(입력 검사)·없는 가상검증 기록·vECU 미연결/도구 실패 결과·Gate 판정 FAIL인 실행은 PASS 근거가 아니다(판정 거부, 감사 FAILED). 강제 통과(덮어쓰기) 경로는 두지 않는다 — 재판정만
   * 증거가 vECU 가상검증(VV-NNNNN)을 가리키면 그 기록이 이 Feature Version의 것이어야 하고, PASS 판정의 근거라면
   * vECU가 실제로 돌린 Gate 판정 PASS여야 한다. G5 Verification Gate는 TMS(IF-09)에 제출된 Evidence만 인정한다.
   */
  private virtualEvidence(featureId: string, version: string, body: JudgeGateBody): string | null {
    for (const id of (body.evidenceRef ?? '').match(/\bVV-\d{5}\b/g) ?? []) {
      const r = this.virtualRuns.get(id);
      if (!r) return `${id}: 가상검증 기록이 없습니다.`;
      if (r.featureId !== featureId || r.featureVersion !== version) return `${id}: ${r.featureId} ${r.featureVersion}의 가상검증입니다 (판정 대상 ${featureId} ${version}).`;
      if (body.inputResult !== 'PASS') continue;
      if (r.source !== 'vecu' || r.gateResult !== 'PASS') return `${id}: PASS 근거가 될 수 없습니다 (${r.source === 'vecu' ? `가상검증 ${r.gateResult}` : 'vECU 미연결 결과'}).`;
      if (body.gate === 'G5' && !r.tms) return `${id}: TMS(IF-09)에 제출한 Evidence만 G5 근거가 됩니다 — 먼저 제출하세요.`;
    }
    return null;
  }

  judge(actor: Actor, featureId: string, version: string, body: JudgeGateBody): { record: GateRecordRow; feature: FeatureVersionRow } {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}#${body.gate}`;
    const blocked = this.check(actor, f, body.gate);
    if (blocked) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, blocked, 'D01-02');
      throw new DomainError(LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.RELEASED ? 'IMMUTABLE' : 'GUARD_FAILED', blocked);
    }
    // 보고서 v1.1: G1은 안전 분류 네 축·조합(FFG-CLS-001·009), 그 다음 Gate는 Safety Manager 확정(보고서 6.1 G2) — PASS 판정에만
    const pre = body.inputResult === 'PASS' ? this.safety.gatePrerequisite(featureId, version, body.gate) : null;
    if (pre) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, pre, 'D01-02');
      throw new DomainError('GUARD_FAILED', pre);
    }
    const vv = this.virtualEvidence(featureId, version, body);
    if (vv) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, vv, 'D01-02');
      throw new DomainError('GUARD_FAILED', vv);
    }
    return this.db.tx(() => {
      const prev = this.gates.latest(featureId, version)[body.gate];
      const record: GateRecordRow = {
        gateRecordId: this.gates.nextId(body.gate),
        featureId,
        featureVersion: version,
        country: f.country,
        gate: body.gate,
        gateName: GATE_META[body.gate].name,
        inputResult: body.inputResult,
        rationale: body.rationale,
        evidenceRef: body.evidenceRef,
        judgeRole: GATE_META[body.gate].judgeRole,
        judgedAt: this.clock.kst(),
        status: gateStatusOf(body.inputResult),
        gateStageLifecycle: GATE_META[body.gate].stage,
        currentLifecycle: f.lifecycle,
        transitionNote: prev ? `재판정 — 이전 ${prev.gateRecordId}(${prev.status}) 대체` : '최초 판정',
        _missing: {},
      };
      this.gates.insert(record);
      // 결정 기록 — 판정한 사람·그때의 역할로 서명(같은 트랜잭션)
      const decision = this.decisions.sign(record, { id: actor.id, role: actor.role }, 'PLATFORM');
      this.audit.record(actor, `GATE_JUDGE ${body.gate}`, target, {
        before: prev ? { gateRecordId: prev.gateRecordId, status: prev.status } : null,
        after: { gateRecordId: record.gateRecordId, status: record.status, evidenceRef: record.evidenceRef, decisionKid: decision.signature.kid },
        reason: body.rationale,
        componentId: 'D01-02',
      });
      this.events.publish('gate.judged', `${featureId}@${version}`, { gateRecordId: record.gateRecordId, gate: record.gate, status: record.status, by: actor.id }, {
        componentId: 'D01-02',
        correlationId: actor.correlationId,
      });
      // Gate 판정으로 자동 전이 조건(G4~G7 PASS 등)이 갖춰지면 같은 트랜잭션에서 전이한다.
      const feature = this.lifecycle.autoAdvance(f, actor.correlationId);
      return { record, feature };
    });
  }
}
