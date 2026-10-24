// 차량 런타임 실행 모듈 (D02-03) — 데모 Fleet의 차량 측 에이전트 시뮬레이터 (IF-07 전개 → 적용 → IF-06 회신).
// 차량은 서명(신뢰 앵커 공개키)·순번(재전송)을 확인한 게시본만 적용하고, 적용한 값을 되읽어 회신한다(P0 BD-12 readback).
// 차량 측 평가는 서버와 같은 단일 평가기(evaluateFlag)를 캐시된 서명 정책으로 돌린다 — 서버 판단과 어긋나면 drift.
// v2 차단·복원(보고서 v1.1 9장): 게시본과 함께 이 차량의 봉투를 받아 Guard 검증 순서(서명 → cmd_auth → epoch → 순번 창 → 시각 → 등급 → 승인자)를 거치고,
// DC 단계 상태 기계(DC2: 경고 → 인계 → 램프 → DISABLED, 복원: RESTORE_PENDING → 다음 시동 → INACTIVE, 활성화는 따로 — FFP-F036)로 진행하며 단계마다 서명된 status_report v2를 보낸다.
import { Controller, Get, Inject, Injectable, Param } from '@nestjs/common';
import {
  authBlock,
  COMMAND_KEY_PURPOSE,
  effectiveClass,
  endState,
  evaluateFlag,
  guardCheck,
  jcs,
  PUBLICATION_KEY_PURPOSE,
  reportSeqOf,
  statusAuthCanonical,
  type EdrState,
  type FlagResult,
  type GuardState,
  type HmiState,
  type KillCommandV2,
  type Publication,
  type RejectCode,
  type StatusReportV2,
  variantRow,
} from '@ff/contracts';
import { sha256hex, targetHashOf, vehiclePseudonym } from '../../../kernel/crypto';
import { EnvelopeRepo } from '../../d03-safety/kill-switch/envelope.repo';
import { PolicyGateService } from '../../d03-safety/deploy-safety/policy-gate.service';
import { StatusIngestService } from '../../d04-ops/telemetry-ingest/status-ingest.service';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
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
import { VehicleChannelRegistry } from '../vehicle-channel/vehicle-channel';

/** 차량 회신 지연(ms) — 차량마다 조금씩 늦게 돌아와 시연 화면에서 집계가 차오르는 모습이 보인다 */
const LATENCY = Number(process.env.FLEET_SIM_LATENCY_MS ?? 350);
const STAGGER = Number(process.env.FLEET_SIM_STAGGER_MS ?? 120);
/** 단계 시간 배율(시연·e2e에서 줄인다) — 1이면 Registry 시간값 그대로 */
const TIME_SCALE = Number(process.env.FLEET_SIM_TIME_SCALE ?? 1);
/** 시뮬레이터의 "기능 비작동"까지(DC1)와 "다음 시동"까지(DC3·복원) — 실차는 운전 상황이 정한다 */
const SIM_IDLE_MS = Number(process.env.FLEET_SIM_IDLE_MS ?? 1500);
const SIM_CYCLE_MS = Number(process.env.FLEET_SIM_CYCLE_MS ?? 2000);
const bootNo = (bootId: string) => Number(/-(\d+)$/.exec(bootId)?.[1] ?? 1);

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
    private readonly hsm: HsmService,
    private readonly envelopes: EnvelopeRepo,
    private readonly gate: PolicyGateService,
    private readonly status: StatusIngestService,
    private readonly channels: VehicleChannelRegistry,
  ) {
    // 내부 시뮬레이터도 전달 어댑터 하나다(sim) — 운영 모드 기본은 실제 채널(pull, RD-OPS-04)
    channels.register({
      id: 'sim',
      description: '내부 차량 시뮬레이터(데모·시험) — 차량 쪽 Guard·적용·회신을 이 프로세스가 대신한다',
      deliver: (pub, vins) => {
        vins.forEach((vin, i) => this.scheduler.after(LATENCY + i * STAGGER, () => this.receive(vin, pub)));
        return { ackOnly: [] };
      },
    });
  }

  /**
   * IF-07 전개 — 연결된 차량만 받는다. GLEO 실연동 차량은 GLEO 어댑터가, 나머지는 고른 전달 채널(FF_VEHICLE_CHANNEL)이 맡는다.
   * 회신 의무가 없는 차량 목록을 돌려준다.
   */
  deliver(pub: Publication): { ackOnly: string[]; unreachable: string[]; campaignId?: string } {
    const unreachable: string[] = [];
    const viaGleo: string[] = [];
    const viaChannel: string[] = [];
    // OTA 서버 채널은 연결이 끊긴 차량도 맡긴다 — 차량 연결은 OTA 서버가 더 잘 알고, 기한까지 기다렸다가 NO_RESPONSE로 알린다(80-45 4장)
    const queuesOffline = this.channels.active === 'ota';
    for (const vin of pub.payload.targets) {
      const v = this.fleet.vehicle(vin);
      if (!v || (v.link === 'OFFLINE' && !queuesOffline) || (v.gleo && this.gleo.mode === 'off')) unreachable.push(vin);
      else if (v.gleo && this.gleo.mode === 'ws') viaGleo.push(vin);
      else viaChannel.push(vin);
    }
    const ackOnly = viaGleo.length ? this.gleo.send(pub, viaGleo) : [];
    let campaignId: string | undefined;
    if (viaChannel.length) {
      const r = this.channels.current().deliver(pub, viaChannel);
      ackOnly.push(...r.ackOnly);
      campaignId = r.campaignId;
    }
    return { ackOnly, unreachable, ...(campaignId ? { campaignId } : {}) };
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
    // @req FR-RTE-001-004
    // 정책 게시본도 대상(payload.targets)에 자기 VIN이 있어야 적용한다(차단 봉투는 target_hash로 이미 확인).
    // 대상 밖 게시본은 적용·저장하지 않고 차량 쪽에 거부를 남긴다. 플랫폼은 이 차량에 보낸 적이 없으니 회신(IF-06)은 하지 않는다 —
    // 수집기(D04-03)가 대상 밖 회신을 거부하는 것은 플랫폼 쪽 2차 방어다.
    if (p.kind === 'POLICY' && !p.targets.includes(vin)) {
      s.log.push({ at: this.clock.iso(), publicationId: pub.publicationId, kind: pub.kind, result: 'REJECTED', detail: 'TARGET_MISMATCH' });
      this.runtime.save(s);
      return;
    }
    if (p.sequence <= (s.highest[key] ?? 0)) return reject('REPLAY');
    s.highest[key] = p.sequence;
    // v2 — 이 차량의 봉투가 있으면 Guard 경로(레거시 v1 차단은 아래 기존 경로)
    if ((p.kind === 'KILL' || p.kind === 'RESTORE') && p.kill) {
      const env = this.envelopes.forVehicle(p.kill.killId, vin, p.kind === 'KILL' ? 'deactivate' : 'restore');
      if (env) {
        this.runtime.save(s);
        return this.guard(vin, pub.publicationId, pub.kind, env, p.kill.featureIds);
      }
    }
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

  // ── v2 Guard ─────────────────────────────────────────
  /**
   * 봉투 검증(9.3 순서) → 받으면 DC 단계 진행, 거부하면 거부 코드로 보고.
   * @rule FFG-VEH-002, FFG-DEAC-007 — 차량 쪽(시뮬레이터): 백엔드 기원 진위를 Guard가 직접 검증, 안전 Kill은 복원 명령으로만 풀린다
   */
  guard(vin: string, publicationId: string, kind: string, env: KillCommandV2, featureIds: string[]) {
    const s = this.runtime.get(vin);
    const featureId = env.feature.id;
    const va = env.vehicle_auth!;
    // 봉투 자체의 JWS(차량 1대 범위·vehicle_auth 포함) — 요청 유형의 용도 키여야 한다(FFG-SEC-002)
    const { signature, ...body } = env;
    // alg는 kid 신뢰 앵커와 같아야 한다(RFC 8725 3.1) — 이 HSM의 차단·복원 키는 EdDSA
    const jwsOk = signature.alg === 'EdDSA' && this.hsm.verifyDetached(COMMAND_KEY_PURPOSE[env.request], jcs(body), { alg: 'EdDSA', kid: signature.kid, value: signature.value }).valid;
    const block = Buffer.from(
      authBlock({
        featureId,
        version: env.feature.version,
        request: env.request,
        reason: env.reason.category,
        deactClass: env.feature.deact_class,
        keyEpoch: va.key_epoch,
        vehicleSeq: va.vehicle_seq,
        notBefore: env.validity.not_before,
        expiresAt: env.validity.expires_at,
        targetHash: targetHashOf(vin, env.target.ecu_id, env.target.sw_version),
        approverRefs: [va.approver_refs[0], va.approver_refs[1]],
      }),
    );
    const design = this.gate.registryEntry(featureId, env.feature.version)?.deact_class ?? 'DC4';
    const last = s.guard?.[featureId];
    const current0 = (s.featureState[featureId] as GuardState | undefined) ?? 'ACTIVE';
    // FFP-F019 — 명령 멱등성: 이미 받아들인 명령과 command_id·내용(서명 포함)이 같은 봉투는 네트워크 재시도다.
    // 순번 창 검사(REPLAY → 보안 이벤트)에 넣지 않고, 전이 없이 앞 결과(수락·지금 상태)를 다시 알린다. 내용이 다르면 재시도가 아니다(아래 검증).
    const digest = sha256hex(jcs(env));
    if (last?.commandId === env.command_id && last.digest === digest && last.epoch === va.key_epoch) {
      s.log.push({ at: this.clock.iso(), publicationId, kind, result: 'APPLIED', detail: `${env.request} 재수신 — 앞 결과 그대로(멱등, 전이 없음)` });
      this.runtime.save(s);
      const on = current0 === 'ACTIVE';
      return this.emit(vin, env, current0, { request_result: 'ACCEPTED', hmi: 'NONE', weight: on ? 1000 : 0, edr: on ? 'AVAILABLE' : 'OFF_BY_COMMAND' });
    }
    const verified = guardCheck({
      jwsOk,
      cmdAuthOk: this.hsm.verifyCmac(vin, va.key_epoch, block, va.cmd_auth),
      keyEpoch: va.key_epoch,
      currentEpoch: this.hsm.epoch(),
      vehicleSeq: va.vehicle_seq,
      lastVehicleSeq: last && last.epoch === va.key_epoch ? last.lastSeq : 0,
      now: this.clock.now().getTime(),
      notBefore: Date.parse(env.validity.not_before),
      expiresAt: Date.parse(env.validity.expires_at),
      designClass: design,
      commandClass: env.feature.deact_class,
      approverRefs: [va.approver_refs[0], va.approver_refs[1]],
    });
    const current = current0;
    // @rule FFG-CLS-007 — TC-FF-15: DISABLED(안전 비활성화)는 활성화로 풀지 않는다, 복원 절차(restore)만. 체험권·구독 변경이 활성화를 보내도 그대로
    const code = verified === 'NONE' && env.request === 'activate' && current === 'DISABLED' ? 'STATE_NOT_ALLOWED' : verified;
    if (code !== 'NONE') {
      s.log.push({ at: this.clock.iso(), publicationId, kind, result: 'REJECTED', detail: code });
      this.runtime.save(s);
      // 거부 보고의 vehicle_seq는 마지막으로 받아들인 순번(거부한 명령의 순번을 되풀이하지 않는다)
      return this.emit(vin, env, current, { request_result: 'REJECTED', reject_code: code, vehicleSeq: last?.lastSeq ?? 0 });
    }
    s.guard = { ...(s.guard ?? {}), [featureId]: { lastSeq: va.vehicle_seq, epoch: va.key_epoch, commandId: env.command_id, digest } };
    s.log.push({ at: this.clock.iso(), publicationId, kind, result: 'APPLIED', detail: `${env.request} ${env.feature.deact_class} 수락` });
    this.runtime.save(s);
    if (env.request === 'sync') {
      // SYNC — 인증된 무동작(키 epoch 상향·순번 표시, 9.6). 상태는 그대로
      return this.emit(vin, env, current, { request_result: 'ACCEPTED', hmi: 'NONE', weight: current === 'ACTIVE' ? 1000 : 0, edr: current === 'ACTIVE' ? 'AVAILABLE' : 'OFF_BY_COMMAND' });
    }
    if (env.request === 'activate') {
      // 활성화 — 기능이 작동 중이 아닐 때(FFG-LCY-010): ACT_PENDING → 비작동 확인 → ACTIVE
      this.setState(vin, featureIds, 'ACT_PENDING', false);
      this.emit(vin, env, 'ACT_PENDING', { request_result: 'ACCEPTED', hmi: 'INFO_PENDING', weight: 0, edr: 'OFF' });
      this.scheduler.after(SIM_IDLE_MS * TIME_SCALE, () => {
        this.setState(vin, featureIds, 'ACTIVE', false);
        this.emit(vin, env, 'ACTIVE', { request_result: 'NONE', hmi: 'NONE', weight: 1000, edr: 'AVAILABLE' });
      });
      return;
    }
    if (env.request === 'restore') {
      // 복원 — 다음 시동에서 자체 시험 뒤 차단을 푼다(FFG-DEAC-008, 차량 쪽).
      // FFP-F036 — 해제는 활성화가 아니다: 차단이 풀린 끝 상태는 INACTIVE이고, ACTIVE는 ODD·형상·사용자 절차를 새로 거치는
      // 활성화(activate: ACT_PENDING → 비작동 확인 → ACTIVE, FFG-LCY-010)로만 간다. 플랫폼도 복원 효력을 INACTIVE로 집계한다.
      this.setState(vin, featureIds, 'RESTORE_PENDING', false);
      this.emit(vin, env, 'RESTORE_PENDING', { request_result: 'ACCEPTED', hmi: 'INFO_PENDING' });
      this.scheduler.after(SIM_CYCLE_MS * TIME_SCALE, () => {
        this.setState(vin, featureIds, 'INACTIVE', false, true);
        this.emit(vin, env, 'INACTIVE', { request_result: 'NONE', hmi: 'NONE', weight: 0, edr: 'OFF', source: 'STARTUP' });
      });
      return;
    }
    // 비활성화 — 사유별 유효 등급의 단계를 승인 시각부터 누적해 한꺼번에 건다
    const p = this.gate.registryEntry(featureId, env.feature.version)?.profile ?? {};
    const dc = effectiveClass(env.feature.deact_class, env.reason.category);
    const end = endState(env.reason.category);
    const finish = () => {
      this.setState(vin, featureIds, end, true);
      this.emit(vin, env, end, { request_result: 'NONE', hmi: 'INFO_DISABLED', weight: 0, edr: 'OFF_BY_COMMAND' });
    };
    if (dc === 'DC0') return finish();
    if (dc === 'DC1') {
      this.setState(vin, featureIds, 'DEACT_PENDING_IDLE', false);
      this.emit(vin, env, 'DEACT_PENDING_IDLE', { request_result: 'ACCEPTED', hmi: 'INFO_PENDING' });
      return this.scheduler.after(Math.min(p.max_pending_ms ?? SIM_IDLE_MS, SIM_IDLE_MS) * TIME_SCALE, finish);
    }
    if (dc === 'DC3') {
      this.setState(vin, featureIds, 'DEACT_PENDING_CYCLE', false);
      this.emit(vin, env, 'DEACT_PENDING_CYCLE', { request_result: 'ACCEPTED', hmi: 'INFO_PENDING' });
      return this.scheduler.after(SIM_CYCLE_MS * TIME_SCALE, finish);
    }
    // DC2 — 경고·인계 → 램프 → 끝
    const takeover = (p.takeover_ms ?? 0) * TIME_SCALE;
    const ramp = (p.ramp_ms ?? 0) * TIME_SCALE;
    this.setState(vin, featureIds, 'DEACT_WARNING', false);
    this.emit(vin, env, 'DEACT_WARNING', { request_result: 'ACCEPTED', hmi: 'WARN_TAKEOVER', weight: 1000 });
    this.scheduler.after(takeover, () => {
      this.setState(vin, featureIds, 'DEACT_RAMP', false);
      this.emit(vin, env, 'DEACT_RAMP', { request_result: 'NONE', hmi: 'WARN_TAKEOVER', weight: 500 });
    });
    this.scheduler.after(takeover + ramp, finish);
  }

  /** 차량 상태 반영 — 끝 상태면 차량 측 평가도 차단(kills), ACTIVE·복원 완료(released)면 해제 */
  private setState(vin: string, featureIds: string[], state: GuardState, killed: boolean, released = state === 'ACTIVE') {
    const s = this.runtime.get(vin);
    for (const f of featureIds) {
      s.featureState[f] = state;
      if (killed) s.kills[f] = { killId: 'v2', safeMode: state, publicationId: '-' };
      if (released) delete s.kills[f];
    }
    this.runtime.save(s);
  }

  /** status_report v2 — 차량 키로 state_auth를 붙여 수신 검사(D04-03)로 보낸다(IF-06) */
  private emit(
    vin: string,
    env: KillCommandV2,
    state: GuardState,
    o: { request_result: StatusReportV2['request_result']; reject_code?: RejectCode; hmi?: HmiState; weight?: number; edr?: EdrState; source?: 'REMOTE' | 'STARTUP'; vehicleSeq?: number },
  ) {
    const s = this.runtime.get(vin);
    s.reportCounter = (s.reportCounter ?? 0) + 1;
    this.runtime.save(s);
    const epoch = env.vehicle_auth!.key_epoch;
    const now = this.clock.iso();
    const report: Omit<StatusReportV2, 'state_auth'> = {
      type: 'status_report',
      schema_version: '2.0',
      vehicle_pseudonym: vehiclePseudonym(vin),
      feature: { id: env.feature.id, version: env.feature.version },
      state,
      reason: { category: env.reason.category, source: o.source ?? 'REMOTE' },
      request_result: o.request_result,
      ...(o.reject_code ? { reject_code: o.reject_code } : {}),
      vehicle_seq: o.vehicleSeq ?? env.vehicle_auth!.vehicle_seq,
      durable: true,
      hmi: o.hmi ?? 'NONE',
      feature_weight_permille: o.weight ?? (state === 'ACTIVE' ? 1000 : 0),
      edr_aligned_state: o.edr ?? (state === 'ACTIVE' ? 'AVAILABLE' : 'OFF_BY_COMMAND'),
      received_at: now,
      applied_at: now,
      observed_at: now,
      time_sync: 'SYNCED',
      offline_since: null,
      data_category: 'SAFETY_OPERATION',
      key_epoch: epoch,
      report_seq: reportSeqOf(bootNo(s.bootId), s.reportCounter),
      persistence: 'DURABLE',
    };
    const state_auth = this.hsm.cmac(vin, epoch, Buffer.from(statusAuthCanonical(report as Record<string, unknown>)));
    this.status.ingest(vin, { ...report, state_auth }, 'SIM');
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
        // @req FR-RTE-005-001
        // 차량 측 평가도 자기 형상(SW·ECU)으로 지원 조건을 본다. 서버(ActivationService.decide)와 같은 판정이라
        // 지원 미달 차량에 구독이 생겨도 서버·차량 모두 NOT_SUPPORTED로 OFF(어긋남 없음)
        support: (({ verdict, reason }) => ({ verdict, reason }))(variantRow({ ...f, featureId: b.policy.featureId, version: b.policy.featureVersion }, vehicle)),
      });
      const server = await this.activation.decide(vin, flagKey).then((d) => d.result, () => null);
      evaluations.push({ flagKey, local, server, drift: !!server && server.value !== local.value });
    }
    return { vehicle, runtime: s, evaluations, gleo: vehicle.gleo ? this.gleo.mode : null };
  }

  /** Fleet 실시간 적용 현황 — 차량마다 적용 게시본·Feature 상태·차량 측 값과 서버 판단(어긋남 표시) */
  /** fleet: FLEET = 등록 차량(운영 PRODUCTION·시연 DEMO — 5년 운영 수신 표본 제외, 화면·지도는 표본을 성향·가중치로 따로 본다), ALL = 표본 포함 */
  async fleetStatus(fleet: 'FLEET' | 'ALL' = 'FLEET') {
    const items = [];
    for (const v of this.fleet.vehicles()) {
      if (fleet === 'FLEET' && v.fleet === 'SAMPLE') continue;
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
