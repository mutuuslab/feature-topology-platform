// 긴급 기능 차단 (D03-03, PoC ⑥) — 보고서 v1.1 7·8장: 긴급 상황에도 사전 2인 승인을 생략하지 않는다.
// 요청(영향 범위·사유 분류·type-to-confirm) → 2인 승인(개인 서명, 요청자 제외, F2 이상 안전·보안은 FSM) → 정책 게이트 최종 판정(D03-02)
// → 명령 원장 +1 → kill_command v2(JCS + JWS EdDSA, kill 용도 키) → 차량별 봉투(차량 키 AES-CMAC, vehicle_seq) → 보안 배포 긴급 채널(D06-08) → 차량 회신.
// 비활성화 방식은 운영자가 고르지 않는다 — Registry 등급(deactClass). DC4·법규 의무 기능은 요청 단계에서 거부하고 기록한다.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  approvalCheck,
  approvalPlan,
  approvalSubject,
  approverRef,
  authBlock,
  jcs,
  KillApproveBody,
  KillCreateBody,
  KillRejectBody,
  MARKETS,
  reportRolesOf,
  wireErrors,
  KillCommandV2,
  type GateFinding,
  type KillApprovalRecord,
  type KillRequest,
  type KillRequestType,
  type Market,
  type ReasonCategory,
  type Role,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { sha256hex } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { PublicationRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { GateRejected, PolicyGateService } from '../deploy-safety/policy-gate.service';
import { KillRepo } from './kill.repo';

export const KILL_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;
/** 승인 대기 기한 — 넘기면 EXPIRED(다시 요청) */
export const APPROVAL_TTL_MS = 2 * 3600_000;
/** 명령 유효기간 — 게이트 상한(24 h) 안 */
const COMMAND_TTL_MS = 12 * 3600_000;
/** 서명 전 자리표시(게이트는 서명 형식만 본다 — 판정 뒤 실제 서명으로 바꾼다) */
const UNSIGNED = 'A'.repeat(86);

const marketOf = (country: string): Market => ((MARKETS as readonly string[]).includes(country) ? (country as Market) : 'OTHER');
/** 대상 식별 해시 — SHA-256(VIN ‖ ECU 부품 번호 ‖ SW 버전) 앞 4바이트(9.2절 ICD 예제) */
export const targetHashOf = (vin: string, ecu: string, sw: string) => parseInt(sha256hex(`${vin}${ecu}${sw}`).slice(0, 8), 16);

export interface IssuedCommand {
  command: KillCommandV2;
  envelopes: number;
}

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
    private readonly gate: PolicyGateService,
    private readonly hsm: HsmService,
    private readonly profiles: SafetyProfileService,
  ) {}

  /** 차단 영향 범위 — 대상 Feature + 이를 REQUIRES하는 Feature(전이), 그 배포 flag, 적용 범위에 드는 차량. 게이트가 보는 등급·24시간 누적도 함께 */
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
    const snap = this.gate.snapshot(featureId, featureVersion);
    return {
      feature: { featureId, version: featureVersion, name: f.name, lifecycle: f.lifecycle, asil: f.asil },
      featureIds: ids,
      dependents,
      flagKeys: [...new Set(deployed.map((p) => p.flagKey))].sort(),
      vehicles: vehicles.map((v) => ({ vin: v.vin, label: v.label, link: v.link, gleo: v.gleo })),
      unknownVins: unknown,
      activeKill: this.kills.list().find((k) => k.featureId === featureId && (k.status === 'ACTIVE' || this.effective(k).status === 'REQUESTED'))?.killId ?? null,
      // 게이트가 보는 이 Version(D.6) — 화면 체크리스트·누적 게이지
      registry: snap.feature,
      window: snap.window,
      nextSeq: snap.nextSeq,
      lastKillApprovers: snap.ledger.last_kill_approvers ?? [],
    };
  }

  /** 요청 시점 사전 점검 — 승인 칸(PLT-005)을 제외한 게이트 규칙을 자리표시 승인으로 미리 판정한다(원장 변경 없음) */
  dryRun(featureId: string, featureVersion: string, vins: string[], reasonCategory: ReasonCategory, opts: { recallCampaignId?: string; containmentJustification?: string } = {}): GateFinding[] {
    const draft = this.draft(featureId, featureVersion, vins, reasonCategory, 'FIELD_FAULT', opts);
    const placeholder: KillApprovalRecord[] = [
      { approverId: '(승인 1)', platformRole: 'SAFETY_OFFICER', role: 'FSM', signedAt: this.clock.iso(), kid: '-', sig: UNSIGNED, comment: null },
      { approverId: '(승인 2)', platformRole: 'OPS_LEAD', role: 'OPS_LEAD', signedAt: this.clock.iso(), kid: '-', sig: UNSIGNED, comment: null },
    ];
    const cmd = this.buildCommand(draft, 'deactivate', placeholder);
    return this.gate.preview(cmd).findings.filter((x) => x.rule !== 'FFG-PLT-005');
  }

  private draft(
    featureId: string,
    featureVersion: string,
    vins: string[],
    reasonCategory: ReasonCategory,
    reasonCode: string,
    opts: { recallCampaignId?: string; containmentJustification?: string; anomalyId?: string | null; killId?: string },
  ) {
    return {
      killId: opts.killId ?? 'KILL-00000',
      featureId,
      featureVersion,
      vins,
      reasonCategory,
      reasonCode,
      anomalyId: opts.anomalyId ?? null,
      recallCampaignId: opts.recallCampaignId ?? null,
      containmentJustification: opts.containmentJustification ?? null,
    };
  }

  /**
   * 차단 요청 — 승인 대기(REQUESTED). DC4·의무 기능은 받지 않고 거부를 기록한다.
   * @rule FFG-DEAC-011, FFG-PLT-003 — 요청 단계: DC4 거부 기록, 비활성화 방식은 Registry 등급(운영자 선택 없음)
   */
  issue(actor: Actor, body: KillCreateBody): KillRequest {
    if (body.confirm.trim() !== body.featureId) {
      this.audit.failed(actor, 'KILL_REQUEST', body.featureId, 'type-to-confirm 불일치', 'D03-03');
      throw new DomainError('VALIDATION', `확인 입력이 차단 대상 Feature ID(${body.featureId})와 다릅니다.`);
    }
    const pv = this.preview(body.featureId, body.featureVersion, body.vins);
    if (pv.activeKill) throw new DomainError('CONFLICT', `${body.featureId}은(는) 이미 차단 중이거나 승인 대기 중입니다 (${pv.activeKill}).`, { killId: pv.activeKill });
    if (pv.unknownVins.length) throw new DomainError('VALIDATION', `영향 범위 밖의 차량이 있습니다: ${pv.unknownVins.join(', ')}`, { unknownVins: pv.unknownVins });
    if (!pv.vehicles.length) throw new DomainError('GUARD_FAILED', '차단할 대상 차량이 없습니다.');
    const reg = pv.registry;
    if (!reg) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.featureVersion}이(가) Registry에 없습니다.`);
    if (reg.deact_class === 'DC4' || reg.gsr_mandatory) {
      // 거부도 기록한다(FFG-DEAC-011) — 트랜잭션 밖 감사
      this.audit.failed(actor, 'KILL_REQUEST', body.featureId, `FFG-PLT-004 DC4·법규 의무 기능 원격 비활성화 거부 (${reg.deact_class}${reg.gsr_mandatory ? ', GSR' : ''})`, 'D03-03');
      throw new DomainError('GUARD_FAILED', 'DC4·법규 의무 기능은 원격으로 비활성화하지 않습니다 — 정비·리콜 절차로 처리합니다 (FFG-PLT-004·FFG-DEAC-011).', { rule: 'FFG-PLT-004' });
    }
    const plan = approvalPlan(reg.f_class, 'deactivate', body.reasonCategory);
    if (body.reasonCategory === 'SAFETY' && ['F2', 'F3', 'F4'].includes(reg.f_class) && !body.recallCampaignId && !body.containmentJustification)
      throw new DomainError('VALIDATION', 'F2 이상 안전 차단은 리콜 캠페인 ID나 봉쇄 결정 근거가 필요합니다 (FFG-PLT-009·FFG-DEAC-010).');
    const now = this.clock.now();
    return this.db.tx(() => {
      const k: KillRequest = {
        killId: this.kills.nextId(),
        featureId: body.featureId,
        featureVersion: body.featureVersion,
        featureIds: pv.featureIds,
        flagKeys: pv.flagKeys,
        vins: pv.vehicles.map((v) => v.vin),
        reason: body.reason,
        status: 'REQUESTED',
        requestedBy: actor.id,
        requestedAt: now.toISOString(),
        publicationId: null,
        releasedBy: null,
        releasedAt: null,
        releaseReason: null,
        restorePublicationId: null,
        anomalyId: body.anomalyId ?? null,
        version: 2,
        reasonCategory: body.reasonCategory,
        reasonCode: body.reasonCode,
        fClass: reg.f_class,
        deactClass: reg.deact_class,
        fsmRequired: plan.fsm,
        approvals: [],
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
        recallCampaignId: body.recallCampaignId ?? null,
        containmentJustification: body.containmentJustification ?? null,
        gate: null,
        command: null,
        rejectedBy: null,
        rejectReason: null,
        restoreRequest: null,
      };
      this.kills.insert(k);
      this.audit.record(actor, 'KILL_REQUEST', k.killId, {
        after: { featureId: k.featureId, vins: k.vins.length, reason: `${k.reasonCategory}/${k.reasonCode}`, deactClass: k.deactClass, fsmRequired: plan.fsm },
        reason: body.reason,
        componentId: 'D03-03',
      });
      this.events.publish(
        'kill.requested',
        k.killId,
        { killId: k.killId, featureId: k.featureId, vins: k.vins.length, reasonCategory: k.reasonCategory, fsmRequired: plan.fsm, anomalyId: k.anomalyId },
        { componentId: 'D03-03', correlationId: actor.correlationId },
      );
      return this.withProgress(k);
    });
  }

  /** 승인 대기가 기한을 넘겼으면 EXPIRED로 본다(저장은 다음 변경 때) */
  effective(k: KillRequest): KillRequest {
    return k.status === 'REQUESTED' && k.expiresAt && Date.parse(k.expiresAt) <= this.clock.now().getTime() ? { ...k, status: 'EXPIRED' } : k;
  }

  private load(id: string): KillRequest {
    const k = this.kills.get(id);
    if (!k) throw new DomainError('NOT_FOUND', `차단 요청 ${id}을(를) 찾을 수 없습니다.`);
    return k;
  }

  /** 승인 1건 서명 — 보고서 승인 역할로 개인 키 서명(HSM). 실패는 트랜잭션 밖에서 감사 */
  signApproval(
    actor: Actor,
    subject: { killId: string; featureId: string; featureVersion: string; vins: string[]; reasonCategory: ReasonCategory },
    request: KillRequestType,
    state: { requestedBy: string; approvals: KillApprovalRecord[]; plan: ReturnType<typeof approvalPlan>; excluded?: string[] },
    action: string,
    comment?: string,
  ): KillApprovalRecord {
    const check = approvalCheck(state, { id: actor.id, roles: reportRolesOf([actor.role as Role]) });
    if ('code' in check) {
      this.audit.failed(actor, action, subject.killId, `${check.code}: ${check.message}`, request === 'restore' ? 'D03-04' : 'D03-03');
      throw new DomainError(check.code === 'SELF_APPROVAL' || check.code === 'NO_APPROVER_ROLE' ? 'FORBIDDEN' : 'CONFLICT', check.message, { code: check.code });
    }
    const sig = this.hsm.approve(actor.id, jcs(approvalSubject({ ...subject, request })));
    return { approverId: actor.id, platformRole: actor.role, role: check.role, signedAt: this.clock.iso(), kid: sig.kid, sig: sig.value, comment: comment?.trim() || null };
  }

  /**
   * 승인 — 두 번째 승인이면 게이트 최종 판정 후 발행(ACTIVE), 게이트 실패면 REJECTED.
   * @rule FFG-PLT-005, FFG-SEC-008 — 요청자 승인 금지·서로 다른 2인·FSM, 긴급 경로도 승인 생략 없음
   */
  approve(actor: Actor, id: string, body: KillApproveBody): KillRequest {
    const k = this.effective(this.load(id));
    if (k.status !== 'REQUESTED') {
      this.audit.failed(actor, 'KILL_APPROVE', id, `${k.status} 상태 승인 시도`, 'D03-03');
      throw new DomainError('CONFLICT', k.status === 'EXPIRED' ? '승인 기한이 지났습니다 — 다시 요청하세요.' : `승인 대기 중인 요청이 아닙니다 (${k.status}).`);
    }
    const approvals = k.approvals ?? [];
    const plan = approvalPlan(k.fClass!, 'deactivate', k.reasonCategory!);
    const a = this.signApproval(actor, { ...k, reasonCategory: k.reasonCategory! }, 'deactivate', { requestedBy: k.requestedBy, approvals, plan }, 'KILL_APPROVE', body.comment);
    const next: KillRequest = { ...k, approvals: [...approvals, a] };
    if (next.approvals!.length < plan.count) {
      return this.db.tx(() => {
        this.kills.update(next);
        this.audit.record(actor, 'KILL_APPROVE', id, { after: { approvals: next.approvals!.length, role: a.role, kid: a.kid }, componentId: 'D03-03' });
        this.events.publish(
          'kill.approved',
          id,
          { killId: id, featureId: k.featureId, approvals: next.approvals!.length, role: a.role },
          { componentId: 'D03-03', correlationId: actor.correlationId },
        );
        return this.withProgress(next);
      });
    }
    // 두 번째 승인 — 게이트 최종 판정(원장 +1)·서명·차량별 봉투·긴급 채널
    const cmd = this.buildCommand(next, 'deactivate', next.approvals!);
    try {
      return this.db.tx(() => {
        const issued = this.issueCommand(actor, next, cmd);
        const pub = this.deploy.publishKill({ ...next, safeMode: next.safeMode }, actor);
        const done: KillRequest = { ...next, status: 'ACTIVE', publicationId: pub.publicationId, gate: { result: 'PASS', failed: [], at: this.clock.iso() }, command: this.commandRef(issued) };
        this.kills.update(done);
        this.audit.record(actor, 'KILL_APPROVE', id, { after: { approvals: 2, role: a.role, kid: a.kid }, componentId: 'D03-03' });
        this.audit.record(actor, 'KILL_ISSUE', id, {
          after: {
            featureIds: done.featureIds,
            vins: done.vins.length,
            deactClass: done.deactClass,
            commandId: cmd.command_id,
            commandSeq: cmd.command_seq,
            envelopes: issued.envelopes,
            publicationId: pub.publicationId,
          },
          reason: done.reason,
          componentId: 'D03-03',
        });
        this.events.publish(
          'kill.issued',
          id,
          {
            killId: id,
            featureId: done.featureId,
            featureIds: done.featureIds,
            flagKeys: done.flagKeys,
            vins: done.vins.length,
            deactClass: done.deactClass,
            commandId: cmd.command_id,
            publicationId: pub.publicationId,
            anomalyId: done.anomalyId,
          },
          { componentId: 'D03-03', correlationId: actor.correlationId },
        );
        return this.withProgress(done);
      });
    } catch (e) {
      if (!(e instanceof GateRejected)) throw e;
      return this.gateRejected(actor, next, e, 'KILL_ISSUE');
    }
  }

  /** 게이트 거부 — 거부 감사(트랜잭션 밖) 뒤 상태를 REJECTED로, 걸린 규칙을 남긴다 */
  private gateRejected(actor: Actor, k: KillRequest, e: GateRejected, action: string): KillRequest {
    const failed = e.verdict.findings.filter((x) => !x.ok).map((x) => x.rule);
    this.audit.failed(actor, action, k.killId, `정책 게이트 거부: ${failed.join(', ')}`, 'D03-02');
    const done: KillRequest = {
      ...k,
      status: 'REJECTED',
      gate: { result: e.verdict.result, failed, at: this.clock.iso() },
      rejectedBy: 'policy-gate',
      rejectReason: e.verdict.findings
        .filter((x) => !x.ok)
        .map((x) => `${x.rule} ${x.message}`)
        .join(' / '),
    };
    return this.db.tx(() => {
      this.kills.update(done);
      this.events.publish('kill.rejected', k.killId, { killId: k.killId, featureId: k.featureId, by: 'policy-gate', failed }, { componentId: 'D03-03', correlationId: actor.correlationId });
      return this.withProgress(done);
    });
  }

  reject(actor: Actor, id: string, body: KillRejectBody): KillRequest {
    const k = this.effective(this.load(id));
    if (k.status !== 'REQUESTED') {
      this.audit.failed(actor, 'KILL_REJECT', id, `${k.status} 상태 거절 시도`, 'D03-03');
      throw new DomainError('CONFLICT', `승인 대기 중인 요청이 아닙니다 (${k.status}).`);
    }
    return this.db.tx(() => {
      const done: KillRequest = { ...k, status: 'REJECTED', rejectedBy: actor.id, rejectReason: body.reason };
      this.kills.update(done);
      this.audit.record(actor, 'KILL_REJECT', id, { before: { status: 'REQUESTED' }, after: { status: 'REJECTED' }, reason: body.reason, componentId: 'D03-03' });
      this.events.publish('kill.rejected', id, { killId: id, featureId: k.featureId, by: actor.id }, { componentId: 'D03-03', correlationId: actor.correlationId });
      return this.withProgress(done);
    });
  }

  /** kill_command v2 초안 — 등급은 Registry 값, 대상·시장·Evidence는 Feature Registry와 안전 분류에서 */
  buildCommand(
    k: {
      killId: string;
      featureId: string;
      featureVersion: string;
      vins: string[];
      reasonCategory?: ReasonCategory;
      reasonCode?: string;
      anomalyId?: string | null;
      recallCampaignId?: string | null;
      containmentJustification?: string | null;
    },
    request: KillRequestType,
    approvals: KillApprovalRecord[],
  ): KillCommandV2 {
    const f = this.features.get(k.featureId, k.featureVersion);
    const reg = this.gate.registryEntry(k.featureId, k.featureVersion);
    if (!f || !reg) throw new DomainError('NOT_FOUND', `${k.featureId} ${k.featureVersion}을(를) 찾을 수 없습니다.`);
    const p = this.profiles.ensure(k.featureId, k.featureVersion);
    const now = this.clock.now();
    // F2 이상은 FSM이 첫 승인자(approver_ref 순서와 같게)
    const ordered = [...approvals].sort((a, b) => Number(b.role === 'FSM') - Number(a.role === 'FSM'));
    return {
      type: 'kill_command',
      schema_version: '2.0',
      command_id: randomUUID(),
      command_seq: (this.gate.ledger(k.featureId).last_order_seq ?? 0) + 1,
      request,
      feature: { id: k.featureId, version: k.featureVersion, f_class: reg.f_class, deact_class: reg.deact_class },
      reason: { category: k.reasonCategory ?? 'SAFETY', code: k.reasonCode ?? 'FIELD_FAULT', ...(k.anomalyId ? { incident_id: k.anomalyId } : {}) },
      scope: { vehicle_ids: [...k.vins], max_vehicles: k.vins.length },
      target: {
        market: marketOf(f.country),
        ecu_id: f.ecuPnos?.[0] ?? 'UNSPECIFIED',
        sw_id: f.swIds?.[0] ?? 'UNSPECIFIED',
        sw_version: f.swVersions?.[0] ?? f.version,
        rxswin: p.rxswin?.[0] ?? 'NONE',
      },
      validity: { not_before: now.toISOString(), expires_at: new Date(now.getTime() + COMMAND_TTL_MS).toISOString() },
      approvals: ordered.map((a) => ({ approver_id: a.approverId, role: a.role, signed_at: a.signedAt, approval_sig: a.sig })),
      regulatory: {
        type_approval_impact: 'NONE',
        r156_assessment_id: `SUMS-IA-${k.featureId}-${k.featureVersion}`,
        ...(k.recallCampaignId ? { recall_campaign_id: k.recallCampaignId } : {}),
        ...(k.containmentJustification ? { containment_justification: k.containmentJustification } : {}),
      },
      user_notice: { required: true, text_ref: `HMI-TXT-${k.featureId.replace('-', '')}-${request === 'restore' ? 'RESTORE' : 'DEACT'}` },
      evidence: { evidence_manifest_id: `EVM-${k.featureId}-${k.featureVersion}`, ...(f.baselineId ? { bom_baseline_id: f.baselineId } : {}), ...(p.sbomRef ? { sbom_ref: p.sbomRef } : {}) },
      issued_by: 'ff-platform',
      issued_at: now.toISOString(),
      signature: { alg: 'EdDSA', kid: 'unsigned', value: UNSIGNED },
    };
  }

  /**
   * 호출자 트랜잭션 안에서 — 게이트 최종 판정·원장(+1) → JWS 서명(용도별 kid) → 차량별 봉투. 게이트가 거부하면 GateRejected.
   * @rule FFG-VEH-002, FFG-VEH-013 — 플랫폼 쪽: 차량 키 CMAC 봉투·차량·Feature별 순번 발급(epoch 갱신·재동기 절차는 WP5)
   */
  issueCommand(actor: Actor, k: { killId: string; vins: string[] }, draft: KillCommandV2): IssuedCommand {
    this.gate.commit(actor, draft);
    const purpose = draft.request === 'restore' ? 'restore' : 'kill';
    const { signature: _unsigned, ...body } = draft;
    const sig = this.hsm.signDetached(purpose, jcs(body));
    const command: KillCommandV2 = { ...body, signature: { alg: 'EdDSA', kid: sig.kid, value: sig.value } };
    const schema = wireErrors(KillCommandV2, command);
    if (schema.length) throw new Error(`kill_command v2 스키마 위반: ${schema.join('; ')}`);
    const at = this.clock.iso();
    this.db.run('INSERT INTO kill_command (command_id, kill_id, request, doc, created_at) VALUES (?, ?, ?, ?, ?)', command.command_id, k.killId, command.request, JSON.stringify(command), at);
    const epoch = this.hsm.epoch();
    const refs = [approverRef(command.approvals[0].approver_id), approverRef(command.approvals[1].approver_id)] as const;
    for (const vin of k.vins) {
      const last = this.db.get<{ s: number | null }>('SELECT max(vehicle_seq) AS s FROM vehicle_envelope WHERE vin = ? AND feature_id = ? AND key_epoch = ?', vin, command.feature.id, epoch)?.s ?? 0;
      const vehicleSeq = last + 1;
      const block = authBlock({
        featureId: command.feature.id,
        version: command.feature.version,
        request: command.request,
        reason: command.reason.category,
        deactClass: command.feature.deact_class,
        keyEpoch: epoch,
        vehicleSeq,
        notBefore: command.validity.not_before,
        expiresAt: command.validity.expires_at,
        targetHash: targetHashOf(vin, command.target.ecu_id, command.target.sw_version),
        approverRefs: refs,
      });
      const cmdAuth = this.hsm.cmac(vin, epoch, Buffer.from(block));
      const envelope: KillCommandV2 = {
        ...command,
        scope: { vehicle_ids: [vin], max_vehicles: 1 },
        vehicle_auth: { key_epoch: epoch, vehicle_seq: vehicleSeq, approver_refs: [refs[0], refs[1]], cmd_auth: cmdAuth },
      };
      this.db.run(
        'INSERT INTO vehicle_envelope (command_id, kill_id, vin, feature_id, request, key_epoch, vehicle_seq, cmd_auth, doc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        command.command_id,
        k.killId,
        vin,
        command.feature.id,
        command.request,
        epoch,
        vehicleSeq,
        cmdAuth,
        JSON.stringify(envelope),
        at,
      );
    }
    return { command, envelopes: k.vins.length };
  }

  commandRef(i: IssuedCommand) {
    return {
      commandId: i.command.command_id,
      commandSeq: i.command.command_seq,
      kid: i.command.signature.kid,
      signature: i.command.signature.value,
      issuedAt: i.command.issued_at,
      envelopes: i.envelopes,
    };
  }

  /** 발행된 명령(kill_command v2)과 차량별 봉투 */
  envelopes(id: string) {
    this.load(id);
    const commands = this.db.all<{ doc: string }>('SELECT doc FROM kill_command WHERE kill_id = ? ORDER BY created_at', id).map((r) => JSON.parse(r.doc) as KillCommandV2);
    const envelopes = this.db.all<{ doc: string }>('SELECT doc FROM vehicle_envelope WHERE kill_id = ? ORDER BY created_at, vin', id).map((r) => JSON.parse(r.doc) as KillCommandV2);
    return { commands, envelopes };
  }

  list(status?: string) {
    return this.kills
      .list()
      .map((k) => this.effective(k))
      .filter((k) => !status || k.status === status)
      .map((k) => this.withProgress(k));
  }

  detail(id: string) {
    return this.withProgress(this.effective(this.load(id)));
  }

  /** 차단·복구 게시본의 회신 집계를 함께 붙인다 */
  private withProgress(k: KillRequest) {
    const summary = (id: string | null) => {
      const p = id ? this.publications.get(id) : undefined;
      return p
        ? { publicationId: p.publicationId, status: p.status, confirmed: p.confirmed, denominator: p.denominator, deadlineAt: p.deadlineAt, closedAt: p.closedAt, nodes: p.nodes, ackOnly: p.ackOnly }
        : null;
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

  /** 영향 범위 미리보기 — 변경 없음. reasonCategory를 주면 게이트 사전 점검(승인 칸 제외)도 함께 */
  @Get('preview')
  preview(
    @Query('featureId') featureId = '',
    @Query('featureVersion') featureVersion = '',
    @Query('vins') vins?: string,
    @Query('reasonCategory') reasonCategory?: ReasonCategory,
    @Query('recallCampaignId') recallCampaignId?: string,
    @Query('containmentJustification') containmentJustification?: string,
  ) {
    // 차량 목록은 항상 영향 범위 전체(선택을 바꿔도 다시 고를 수 있게), 사전 점검·범위 밖 판정만 고른 차량으로
    const list = vins
      ? vins
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : undefined;
    const pv = this.kills.preview(featureId, featureVersion);
    const unknownVins = (list ?? []).filter((v) => !pv.vehicles.some((x) => x.vin === v));
    const picked = list?.length ? pv.vehicles.map((v) => v.vin).filter((v) => list.includes(v)) : pv.vehicles.map((v) => v.vin);
    const checks = reasonCategory && picked.length && pv.registry ? this.kills.dryRun(featureId, featureVersion, picked, reasonCategory, { recallCampaignId, containmentJustification }) : [];
    return { ...pv, unknownVins, checks };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.kills.detail(id);
  }

  @Get(':id/envelopes')
  envelopes(@Param('id') id: string) {
    return this.kills.envelopes(id);
  }

  @Post()
  @Roles(...KILL_ROLES)
  @AuditAction('KILL_REQUEST')
  issue(@CurrentActor() actor: Actor, @Body(new ZodPipe(KillCreateBody)) body: KillCreateBody) {
    return this.kills.issue(actor, body);
  }

  @Post(':id/approvals')
  @Roles('SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD', 'PRODUCT_APPROVER', 'GATE_JUDGE', 'REGULATORY_OWNER')
  @AuditAction('KILL_APPROVE')
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillApproveBody)) body: KillApproveBody) {
    return this.kills.approve(actor, id, body);
  }

  @Post(':id/reject')
  @Roles('SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD', 'PRODUCT_APPROVER', 'GATE_JUDGE', 'REGULATORY_OWNER')
  @AuditAction('KILL_REJECT')
  reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillRejectBody)) body: KillRejectBody) {
    return this.kills.reject(actor, id, body);
  }
}
