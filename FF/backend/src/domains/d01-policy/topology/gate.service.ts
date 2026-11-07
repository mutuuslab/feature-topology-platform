// Gate Record — Topology 소유(상세설계서 표 12). append-only: 재판정은 새 SIM-Gn-NNNNNN, 이전 레코드는 감사용으로 남는다.
// 증거 없는 PASS 금지, Gate 단계 순서(G1~3 → G4~7 → G8~9) 준수, RELEASED 이후 버전은 판정 불가(새 Version으로).
// 단계 가드·분석 근거 조건(G2 HARA·TARA·ASIL 사유 검토, G7 SM·CSM 서명)은 contracts gate-evidence — 화면이 판정 전에 같은 함수로 막는다(P3-3·P3-10).
// Evidence Ref가 있는 판정은 Evidence 원장(evidence)에 행을 남긴다 — 원장·딥링크가 플랫폼 판정도 보인다(P3-4).
import { Inject, Injectable } from '@nestjs/common';
import { SafetyProfileService } from '../registry/safety-profile.service';
import {
  GATE_META,
  GATES,
  gateStageBlocker,
  gateStatusOf,
  procedureGatesFor,
  type EvidenceRow,
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
import { ReharaRepo } from './rehara.repo';
import { changeRecordFindings, REHARA_BLOCKED_GATES, REHARA_LABEL, type ChangeRecordBody } from '@ff/contracts';
import { VirtualRunRepo } from '../../d06-qsec/scenario-validation/virtual-run.repo';
import { AnalysisEvidenceService } from './analysis-evidence.service';
import { GateCheckService } from './gate-check.service';
import { GATE_STATUS_SPEC, goNoGo, type GateStatus } from '@ff/contracts';

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
    private readonly rehara: ReharaRepo,
    private readonly analysis: AnalysisEvidenceService,
    private readonly checks: GateCheckService,
  ) {}

  view(featureId: string, version: string) {
    const f = this.lifecycle.require(featureId, version);
    const history = this.gates.history(featureId, version);
    const latest = this.gates.latest(featureId, version);
    // P10 — 자동 검사(전이 때 다시 본다)·최종 Go/No-Go·해당 없음 요청
    const checks = this.checks.checks(f);
    return {
      // @req FR-REG-005-009 FR-REG-005-016 — 9 Gate 현재 상태·최종 Go/No-Go·Gate별 Evidence를 한 번에
      goNoGo: goNoGo(Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r?.status ?? null]))),
      checks,
      naRequests: this.db.all<{ doc: string }>('SELECT doc FROM gate_na_request WHERE feature_id = ? AND version = ? ORDER BY request_id', featureId, version).map((r) => JSON.parse(r.doc)),
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
        /** 명세 4상태(PASS·PENDING·FAIL·N/A), 미판정은 null — FR-REG-005-008 */
        specStatus: latest[g] ? GATE_STATUS_SPEC[latest[g]!.status as GateStatus] : null,
        checks: checks.filter((x) => x.gate === g),
        evidence: latest[g] ? this.gates.evidence(latest[g]!.gateRecordId) ?? null : null,
        history: history.filter((h) => h.gate === g).map((h) => ({ ...h, decision: this.decisions.verify(h).state })),
        /** 이 플랫폼 Gate가 대응하는 절차 Gate(P3-9) */
        procedureGates: procedureGatesFor(g).map((m) => m.procedureGate),
      })),
      /** 판정 폼 단계 가드(P3-10) — 화면이 contracts gateStageBlocker로 미리 막는다 */
      lifecycle: f.lifecycle,
      /** FFG-LCY-003 — 이 Version의 재-HARA 요청(열린 것이 있으면 G3 이후 PASS 막힘) */
      rehara: this.rehara.list({ featureId, featureVersion: version }),
    };
  }

  /** 판정 가능 여부 — 막히면 사유(contracts gateStageBlocker, 화면과 같은 판정) */
  private check(actor: Actor, f: FeatureVersionRow, gate: GateId): { reason: string; readOnly: boolean } | null {
    const latest = this.gates.latest(f.featureId, f.version);
    return gateStageBlocker({ lifecycle: f.lifecycle, gate, role: actor.role, latest: Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r?.status ?? null])) });
  }

  /** Evidence 원장 행 — Evidence Ref가 있는 플랫폼 판정(이관 기록과 같은 모양) */
  private evidenceRow(f: FeatureVersionRow, record: GateRecordRow): EvidenceRow {
    return {
      evidenceRef: record.evidenceRef!,
      gate: record.gate,
      gateRecordId: record.gateRecordId,
      featureId: f.featureId,
      featureVersion: f.version,
      featureName: f.name,
      featureDescription: f.description,
      scope: [f.country, f.vehicleModel, f.trim].filter(Boolean).join(' · '),
      owner: f.ownerId,
      lifecycle: f.lifecycle,
      // 판정(judge)에서만 부른다 — N/A 기록은 해당 없음 요청이 근거라 원장 행을 만들지 않는다
      inputResult: record.inputResult as EvidenceRow['inputResult'],
      resultReason: `${record.inputResult} — ${record.rationale}`,
      additionalEvidence: null,
      _missing: {},
    };
  }

  /**
   * @rule FFG-LCY-002 — fail-closed: 근거 없는 PASS(입력 검사)·없는 가상검증 기록·실행기 미연결/도구 실패/이전 실행기(vECU) 결과·Gate 판정 FAIL인 실행은 PASS 근거가 아니다(판정 거부, 감사 FAILED). 강제 통과(덮어쓰기) 경로는 두지 않는다 — 재판정만
   * 증거가 가상검증(VV-NNNNN)을 가리키면 그 기록이 이 Feature Version의 것이어야 하고, PASS 판정의 근거라면
   * CARLA 실행기가 실제로 돌린 Gate 판정 PASS여야 한다. G5 Verification Gate는 TMS(IF-09)에 제출된 Evidence만 인정한다.
   */
  private virtualEvidence(featureId: string, version: string, body: JudgeGateBody): string | null {
    for (const id of (body.evidenceRef ?? '').match(/\bVV-\d{5}\b/g) ?? []) {
      const r = this.virtualRuns.get(id);
      if (!r) return `${id}: 가상검증 기록이 없습니다.`;
      if (r.featureId !== featureId || r.featureVersion !== version) return `${id}: ${r.featureId} ${r.featureVersion}의 가상검증입니다 (판정 대상 ${featureId} ${version}).`;
      if (body.inputResult !== 'PASS') continue;
      if (r.source !== 'carla' || r.gateResult !== 'PASS') return `${id}: PASS 근거가 될 수 없습니다 (${r.source === 'carla' ? `가상검증 ${r.gateResult}` : r.source === 'vecu' ? '이전 실행기 기록 — CARLA로 다시 실행' : '실행기 미연결 결과'}).`;
      if (body.gate === 'G5' && !r.tms) return `${id}: TMS(IF-09)에 제출한 Evidence만 G5 근거가 됩니다 — 먼저 제출하세요.`;
    }
    return null;
  }

  /**
   * G5 Verification — 이 Version이 쓰는 SW Version의 변경 기록에 근거 누락·커버리지 미달이 있으면 PASS 불가(AI 생성 변경도 같은 기준).
   * @rule FFG-CODE-030 — 변경 기록의 검토·정적 분석·시험·커버리지 근거를 Gate가 확인
   */
  private changeRecordBlocker(f: FeatureVersionRow): string | null {
    const bad: string[] = [];
    f.swIds.forEach((swId, i) => {
      const ver = f.swVersions[i];
      if (!ver) return;
      for (const r of this.db.all<{ change_id: string; doc: string }>('SELECT c.change_id, c.doc FROM change_record c WHERE c.sw_id = ? AND c.sw_version = ? AND c.rev = (SELECT MAX(rev) FROM change_record x WHERE x.change_id = c.change_id) ORDER BY c.change_id', swId, ver)) {
        const d = JSON.parse(r.doc) as ChangeRecordBody;
        const fs = changeRecordFindings(d);
        if (fs.length) bad.push(`${r.change_id}(${d.aiGenerated ? `AI ${d.aiGenerated.tool}` : '사람'}): ${fs.join(', ')}`);
      }
    });
    return bad.length ? `변경 기록 근거가 부족합니다 — ${bad.join(' / ')} (FFG-CODE-030)` : null;
  }

  judge(actor: Actor, featureId: string, version: string, body: JudgeGateBody): { record: GateRecordRow; feature: FeatureVersionRow } {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}#${body.gate}`;
    const blocked = this.check(actor, f, body.gate);
    if (blocked) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, blocked.reason, 'D01-02');
      throw new DomainError(blocked.readOnly ? 'IMMUTABLE' : 'GUARD_FAILED', blocked.reason);
    }
    // 보고서 v1.1: G1은 안전 분류 네 축·조합(FFG-CLS-001·009), 그 다음 Gate는 Safety Manager 확정(보고서 6.1 G2) — PASS 판정에만
    const pre = body.inputResult === 'PASS' ? this.safety.gatePrerequisite(featureId, version, body.gate) : null;
    if (pre) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, pre, 'D01-02');
      throw new DomainError('GUARD_FAILED', pre);
    }
    // FFG-LCY-003 — 재-HARA 요청이 열려 있으면 G3 이후 PASS는 G2(위험 분석) 재판정 뒤에
    const rh = body.inputResult === 'PASS' && (REHARA_BLOCKED_GATES as readonly string[]).includes(body.gate) ? this.rehara.open(featureId, version) : [];
    if (rh.length) {
      const msg = `재-HARA 요청 ${rh.map((x) => `${x.requestId}(${REHARA_LABEL[x.condition]})`).join(', ')}이(가) 열려 있습니다 — G2를 다시 판정한 뒤 ${body.gate}을(를) PASS로 판정할 수 있습니다.`;
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, msg, 'D01-02');
      // ADS-BE06 — 출시 전이·서명과 같은 사유 코드
      throw new DomainError('GUARD_FAILED', msg, { blockers: rh.map((x) => ({ code: 'REHARA_OPEN', message: msg, ref: x.requestId })) });
    }
    const cr = body.inputResult === 'PASS' && body.gate === 'G5' ? this.changeRecordBlocker(f) : null;
    if (cr) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, cr, 'D01-02');
      throw new DomainError('GUARD_FAILED', cr, { rule: 'FFG-CODE-030' });
    }
    const vv = this.virtualEvidence(featureId, version, body) ?? this.analysis.unknownRefs(featureId, version, body.evidenceRef);
    if (vv) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, vv, 'D01-02');
      throw new DomainError('GUARD_FAILED', vv);
    }
    // 분석 근거(P3-3) — G2: 이 Version의 HARA(+보안 관련이면 TARA)·대표 ASIL 변경 사유 검토, G7: SM·CSM 두 사람 서명
    const evidence = this.analysis.gateBlockers(f, body);
    if (evidence.length) {
      this.audit.failed(actor, `GATE_JUDGE ${body.gate}`, target, evidence.join(' / '), 'D01-02');
      throw new DomainError('GUARD_FAILED', `${body.gate}을(를) PASS로 판정할 근거가 부족합니다.`, { blockers: evidence.map((message) => ({ code: 'ANALYSIS_EVIDENCE', message, ref: body.gate })) });
    }
    const deviation = body.gate === 'G2' && body.inputResult === 'PASS' && body.asilReasonReviewed ? this.analysis.asilDeviation(f) : null;
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
        transitionNote: `${prev ? `재판정 — 이전 ${prev.gateRecordId}(${prev.status}) 대체` : '최초 판정'}${deviation ? ` · ASIL 사유 검토함(대표 ${deviation.from} → ${deviation.to})` : ''}`,
        _missing: {},
      };
      this.gates.insert(record);
      if (record.evidenceRef) this.gates.insertEvidence(this.evidenceRow(f, record));
      // 결정 기록 — 판정한 사람·그때의 역할로 서명(같은 트랜잭션)
      const decision = this.decisions.sign(record, { id: actor.id, role: actor.role }, 'PLATFORM');
      // G2 재판정 PASS가 열린 재-HARA 요청을 닫는다
      if (body.gate === 'G2' && record.status === 'PASS')
        for (const x of this.rehara.resolve(featureId, version, record.gateRecordId, this.clock.iso()))
          this.audit.record(actor, 'REHARA_RESOLVE', `${featureId}@${version}`, { before: { requestId: x.requestId, status: 'OPEN' }, after: { status: 'RESOLVED', gateRecordId: record.gateRecordId }, componentId: 'D01-02' });
      this.audit.record(actor, `GATE_JUDGE ${body.gate}`, target, {
        before: prev ? { gateRecordId: prev.gateRecordId, status: prev.status } : null,
        after: { gateRecordId: record.gateRecordId, status: record.status, evidenceRef: record.evidenceRef, decisionKid: decision.signature.kid, ...(deviation ? { asilReasonReviewed: { from: deviation.from, to: deviation.to } } : {}) },
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
