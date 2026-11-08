// 차량 발신 요청 (D02-03 차량 런타임 · D05-01 API Gateway) — 차량이 먼저 플랫폼을 부른다.
//   조회  POST /vehicle/v1/:vin/flags(/:key)  IF-10 원격 평가 — OFREP 응답 형식, bulk는 ETag/304
//   보고  POST /vehicle/v1/:vin/reports       IF-06 차량 보고 — HELLO·CONTEXT·TRIAL_ACCEPT·FAULT·READBACK (OVERRIDE는 항상 거부)
// 처리 순서: 차량 신원(가드) → 자기 VIN만 → 빈도 한도 → 멱등 키 재시도 → 보고 순서(bootId·sequence) → 종류별 처리 → 재평가 응답.
// 규칙(바꿀 수 있는 관측 속성·순서 판정·거부 사유)은 contracts/rules/vehicle-requests.ts 한 곳에 있다.
import { Body, Controller, Get, Headers, HttpCode, Inject, Injectable, Param, Post, Res } from '@nestjs/common';
import {
  attestationMismatches,
  DATA_CATEGORY_ACCESS,
  checkObservedSet,
  checkReportOrder,
  OfrepBody,
  VEHICLE_RATE_LIMIT,
  VehicleReportBody,
  type ExpectedConfig,
  type Publication,
  type VehicleReportType,
} from '@ff/contracts';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, VehicleEndpoint, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError, type ErrorCode } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { SHARED_STATE, type SharedStateStore } from '../../../kernel/shared-state';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { ActivationService } from '../../d01-policy/activation/activation.service';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { TelemetryService } from '../../d04-ops/telemetry-ingest/telemetry.service';
import { ofrep } from '../../d05-ext/api-gateway/ofrep.controller';
import { PublicationRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { scopeKeyOf } from '../vehicle-runtime/vehicle-runtime.service';
import { VehicleRequestRepo, type StoredVehicleRequest } from './vehicle-request.repo';

const COMPONENT = 'D02-03';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

type Flag = ReturnType<typeof ofrep>;
type Rejection = { code: ErrorCode; message: string; details?: unknown };

@Injectable()
@PlatformComponent(COMPONENT)
export class VehicleRequestService {
  constructor(
    private readonly repo: VehicleRequestRepo,
    private readonly fleet: FleetRepo,
    private readonly policies: PolicyRepo,
    private readonly activation: ActivationService,
    private readonly entitlements: EntitlementService,
    private readonly telemetry: TelemetryService,
    private readonly publications: PublicationRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    /** 차량별 고정 창 빈도 카운터 — 공유 상태(DB): 인스턴스가 여럿이어도·재시작해도 같은 창(RD-OPS-14) */
    @Inject(SHARED_STATE) private readonly shared: SharedStateStore,
  ) {}

  // ---- 공통 관문 ----

  /** 차량 신원과 경로 VIN이 같아야 하고, 등록된 차량이어야 한다 (UL-DD-09·UL-029) */
  private admit(actor: Actor, vin: string, channel: 'QUERY' | 'REPORT', type: VehicleReportType | 'QUERY', summary: string) {
    const self = actor.id.replace(/^vehicle:/, '');
    if (self !== vin) {
      this.reject(actor, vin, channel, type, null, summary, { code: 'VEHICLE_SCOPE', message: `차량 ${self}은(는) 자기 VIN으로만 조회·보고할 수 있습니다 (요청 대상 ${vin}).`, details: { vehicle: self, target: vin } }, false);
    }
    if (!this.fleet.vehicle(vin)) {
      this.audit.denied(actor, 'VEHICLE_REQUEST', vin, '등록되지 않은 차량', COMPONENT);
      throw new DomainError('VEHICLE_UNAUTHENTICATED', `등록되지 않은 차량 ${vin}의 요청은 받지 않습니다.`);
    }
  }

  /** VIN별 고정 창 빈도 한도 — 넘으면 429와 Retry-After(초) */
  private limit(actor: Actor, vin: string, channel: 'QUERY' | 'REPORT', type: VehicleReportType | 'QUERY', summary: string, res: Response) {
    const now = this.clock.now().getTime();
    const w = this.shared.hit(`vehicle-rate:${vin}`, VEHICLE_RATE_LIMIT.windowMs, now);
    if (w.n <= VEHICLE_RATE_LIMIT.requests) return;
    const retryAfter = Math.max(1, Math.ceil((w.start + VEHICLE_RATE_LIMIT.windowMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    this.reject(actor, vin, channel, type, null, summary, { code: 'RATE_LIMITED', message: `요청이 너무 잦습니다 — ${retryAfter}초 뒤에 다시 보내세요.`, details: { retryAfterSec: retryAfter, limit: VEHICLE_RATE_LIMIT } }, false);
  }

  /** 거부도 기록하고 감사에 남긴 뒤 던진다. keyed(내용 때문에 생긴 거부)면 같은 멱등 키 재시도가 같은 거부를 받는다 */
  private reject(actor: Actor, vin: string, channel: 'QUERY' | 'REPORT', type: VehicleReportType | 'QUERY', report: VehicleReportBody | null, summary: string, err: Rejection, keyed: boolean): never {
    this.db.tx(() => this.repo.insert(this.record(vin, channel, type, report, 'REJECTED', err.code, summary, err), keyed && !!report));
    // 거부·실패 감사는 트랜잭션 밖에서 (커널 규칙 — 롤백돼도 남는다)
    const reason = `${err.code}: ${err.message}`;
    if (err.code === 'VEHICLE_SCOPE' || err.code === 'VEHICLE_OVERRIDE_FORBIDDEN' || err.code === 'TRUST_SOURCE_FIELD') this.audit.denied(actor, `VEHICLE_${type}`, vin, reason, COMPONENT);
    else this.audit.failed(actor, `VEHICLE_${type}`, vin, reason, COMPONENT);
    throw new DomainError(err.code, err.message, err.details);
  }

  private record(vin: string, channel: 'QUERY' | 'REPORT', type: VehicleReportType | 'QUERY', report: VehicleReportBody | null, outcome: StoredVehicleRequest['outcome'], reason: string | null, summary: string, response: unknown): StoredVehicleRequest {
    return {
      requestId: this.repo.nextId(),
      vin,
      at: this.clock.iso(),
      channel,
      type,
      bootId: report?.bootId ?? null,
      sequence: report?.sequence ?? null,
      outcome,
      reason,
      summary,
      flags: [],
      bodyHash: report ? hash(report) : null,
      response,
    };
  }

  private async evaluate(vin: string): Promise<Flag[]> {
    return (await this.activation.decideAll(vin)).map(ofrep);
  }

  // ---- 조회 (IF-10) ----

  async query(actor: Actor, vin: string, body: OfrepBody, res: Response, key?: string): Promise<{ flags: Flag[] } | Flag> {
    const summary = key ? `조회 ${key}` : '조회 (전체)';
    // OpenFeature SDK 호환 — 본문의 targetingKey는 없어도 되지만, 있으면 경로 VIN과 같아야 한다. 그 밖의 문맥은 쓰지 않는다(서버 기준 정보로 평가)
    this.admit(actor, vin, 'QUERY', 'QUERY', summary);
    const target = body.context?.targetingKey;
    if (target && target !== vin) {
      this.reject(actor, vin, 'QUERY', 'QUERY', null, summary, { code: 'VEHICLE_SCOPE', message: `차량 ${vin}은(는) 다른 차량(${target})을 조회할 수 없습니다.`, details: { vehicle: vin, target } }, false);
    }
    this.limit(actor, vin, 'QUERY', 'QUERY', summary, res);
    if (key && !this.policies.deployed(key)) {
      this.reject(actor, vin, 'QUERY', 'QUERY', null, summary, { code: 'NOT_FOUND', message: `${key}로 배포된 정책이 없습니다 — 차량은 기본값(Safe Default)을 씁니다.`, details: { key, errorCode: 'FLAG_NOT_FOUND' } }, false);
    }
    const flags = key ? [ofrep((await this.activation.decide(vin, key)).result)] : await this.evaluate(vin);
    const rec = { ...this.record(vin, 'QUERY', 'QUERY', null, 'ACCEPTED', null, summary, null), flags: flags.map(brief) };
    this.db.tx(() => this.repo.insert(rec, false));
    return key ? flags[0] : { flags };
  }

  // ---- 보고 (IF-06) ----

  async report(actor: Actor, vin: string, body: VehicleReportBody, res: Response) {
    const summary = summarize(body);
    this.admit(actor, vin, 'REPORT', body.type, summary);
    this.limit(actor, vin, 'REPORT', body.type, summary, res);

    // 같은 멱등 키 재시도 — 저장된 응답(또는 같은 거부)을 그대로 돌려준다
    const prev = this.repo.byKey(vin, body.bootId, body.sequence);
    if (prev) {
      if (prev.bodyHash !== hash(body)) throw new DomainError('IDEMPOTENCY_KEY_REUSED', `(${body.bootId}, ${body.sequence})는 다른 내용의 보고(${prev.requestId})에 이미 쓰였습니다.`, { requestId: prev.requestId });
      if (prev.outcome === 'REJECTED') {
        const e = prev.response as Rejection;
        throw new DomainError(e.code, e.message, e.details);
      }
      return { ...(prev.response as object), outcome: 'DUPLICATE' as const };
    }

    const order = checkReportOrder(this.repo.cursor(vin), body);
    if ('reason' in order) {
      const cur = this.repo.cursor(vin)!;
      const message =
        order.reason === 'BOOT_MISMATCH'
          ? `알려진 부팅(${cur.bootId})과 다른 부팅(${body.bootId})의 보고입니다 — 재부팅 후에는 HELLO로 먼저 대사하세요.`
          : `이미 받은 보고(sequence ${cur.sequence})보다 오래된 보고(${body.sequence})입니다 — 최신 상태를 덮어쓰지 않습니다.`;
      // 순서 거부는 그때의 보고 위치에 달린 일시적 거부라 멱등 키로 남기지 않는다 — HELLO로 대사한 뒤 같은 보고를 다시 보내면 처리돼야 한다
      this.reject(actor, vin, 'REPORT', body.type, body, summary, { code: order.reason, message, details: { cursor: cur } }, false);
    }

    if (body.type === 'OVERRIDE') {
      this.reject(actor, vin, 'REPORT', body.type, body, summary, { code: 'VEHICLE_OVERRIDE_FORBIDDEN', message: `차량은 Flag 값(${body.flagKey})을 직접 바꿀 수 없습니다 — 플랫폼 정책·긴급 차단만 값을 정합니다.`, details: { flagKey: body.flagKey } }, true);
    }

    let extra: Record<string, unknown> = {};
    try {
      extra = this.db.tx(() => {
        const out = this.apply(actor, vin, body);
        this.repo.setCursor(vin, { bootId: body.bootId, sequence: body.sequence });
        return out;
      });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      this.reject(actor, vin, 'REPORT', body.type, body, summary, { code: e.code, message: e.message, details: e.details }, true);
    }

    const flags = await this.evaluate(vin);
    const rec = this.record(vin, 'REPORT', body.type, body, 'ACCEPTED', null, summary, null);
    const response = { requestId: rec.requestId, vin, type: body.type, outcome: 'ACCEPTED' as const, ...extra, flags };
    this.db.tx(() => this.repo.insert({ ...rec, flags: flags.map(brief), response }, true));
    return response;
  }

  /** 종류별 처리 — 트랜잭션 안. 실패는 DomainError로 던져 거부로 기록된다 */
  private apply(actor: Actor, vin: string, body: Exclude<VehicleReportBody, { type: 'OVERRIDE' }>): Record<string, unknown> {
    const meta = { componentId: COMPONENT, correlationId: actor.correlationId };
    switch (body.type) {
      case 'HELLO': {
        const redeliver = this.missing(vin, body.highest);
        this.events.publish('vehicle.hello', vin, { bootId: body.bootId, highest: body.highest, redeliver: redeliver.map((p) => p.publicationId) }, meta);
        return { redeliver };
      }
      case 'CONTEXT': {
        const chk = checkObservedSet(body.set);
        if ('rejected' in chk) {
          if (chk.rejected.length) throw new DomainError('TRUST_SOURCE_FIELD', `차량이 바꿀 수 없는 속성입니다: ${chk.rejected.join(', ')} — 국가·차종·트림·사용 권한은 신뢰 원천 기준 정보입니다.`, chk);
          throw new DomainError('VALIDATION', `관측값 형식이 맞지 않습니다: ${chk.invalid.join(', ') || '변경 없음'}`, chk);
        }
        const before = this.fleet.vehicle(vin)!;
        const after = { ...before, ...chk.set };
        this.fleet.updateVehicle(after);
        const changed = Object.fromEntries(Object.keys(chk.set).map((k) => [k, { before: before[k as keyof typeof before], after: after[k as keyof typeof after] }]));
        this.audit.record(actor, 'VEHICLE_CONTEXT', vin, { before: pick(before, chk.set), after: chk.set, componentId: COMPONENT });
        this.events.publish('vehicle.context.reported', vin, { changed, observedAt: body.observedAt }, meta);
        return { changed };
      }
      case 'TRIAL_ACCEPT': {
        // 기간형 체험권 — 제안 중(OFFERED)인 체험만 수락한다. 수락일부터 30일 ON
        const trials = this.entitlements.grants(vin).filter((g) => g.catalogId === body.catalogId && g.kind === '체험');
        const offered = trials.find((g) => g.state === 'OFFERED');
        if (!offered) {
          const active = trials.find((g) => g.state === 'ACTIVE');
          throw new DomainError('GUARD_FAILED', active ? `${vin}은(는) 이미 ${body.catalogId} 체험 중입니다 (${active.validTo}까지).` : `${vin}에 수락할 수 있는 ${body.catalogId} 체험 제안이 없습니다.`, { catalogId: body.catalogId });
        }
        const grant = this.entitlements.accept(actor, offered.grantId);
        return { grant: { grantId: grant.grantId, status: grant.status, validFrom: grant.validFrom, validTo: grant.validTo, daysLeft: grant.daysLeft } };
      }
      case 'FAULT': {
        const fault = { featureId: body.featureId, code: body.code, severity: body.severity, detail: body.detail ?? null, observedAt: body.observedAt, bootId: body.bootId, sequence: body.sequence };
        this.events.publish('vehicle.fault.reported', vin, fault, meta);
        this.audit.record(actor, 'VEHICLE_FAULT', vin, { after: fault, componentId: COMPONENT });
        return { fault };
      }
      case 'ATTESTATION': {
        const expected = this.expectedConfigs(vin);
        const mismatches = attestationMismatches(body.configs, expected);
        const attestation = { compared: expected.length, reported: body.configs.length, mismatches };
        this.audit.record(actor, 'VEHICLE_ATTESTATION', vin, { after: attestation, componentId: COMPONENT });
        // 불일치는 이상 건(D06-12)으로 — 보고를 받는 즉시(FFG-VEH-007)
        if (mismatches.length) this.events.publish('vehicle.config.mismatch', vin, { vin, mismatches, publications: expected.map((e) => e.publicationId) }, meta);
        return { attestation };
      }
      case 'READBACK': {
        const stored = this.telemetry.ingest({ ...body.readback, vin, bootId: body.bootId }, 'IF-06', actor.correlationId);
        return { readback: { publicationId: stored.publicationId, observed: stored.observed, at: stored.at } };
      }
    }
  }

  /**
   * 기대 구성 — 이 차량에 보낸(전달 시작된) 정책 게시본 중 Flag마다 가장 최근 순번. BOM은 그 Feature Version의 BOM Baseline.
   * @rule FFG-VEH-007 — 플랫폼 기대 구성(정책 해시·Feature Version·BOM)
   */
  private expectedConfigs(vin: string): ExpectedConfig[] {
    const latest = new Map<string, Publication>();
    for (const p of this.publications.list({ kind: 'POLICY' }))
      if (p.status !== 'SIGNED' && p.payload.flagKey && p.payload.targets.includes(vin) && p.payload.sequence > (latest.get(p.payload.flagKey)?.payload.sequence ?? 0)) latest.set(p.payload.flagKey, p);
    return [...latest.values()].map((p) => ({
      featureId: p.payload.featureId,
      flagKey: p.payload.flagKey!,
      featureVersion: p.payload.featureVersion,
      policyHash: p.signature.payloadHash,
      publicationId: p.publicationId,
      bomBaselineId: this.features.get(p.payload.featureId, p.payload.featureVersion)?.baselineId ?? null,
    }));
  }

  /** 재연결 대사 (UL-065) — 이 차량 대상 게시본 중 차량이 가진 순번보다 새 것을 순서대로. 서명째 돌려주어 차량이 직접 검증한다 */
  private missing(vin: string, highest: Record<string, number>): Publication[] {
    return this.publications
      .list()
      .filter((p) => p.status !== 'SIGNED' && p.payload.targets.includes(vin) && p.payload.sequence > (highest[scopeKeyOf(p.payload)] ?? 0))
      .sort((a, b) => scopeKeyOf(a.payload).localeCompare(scopeKeyOf(b.payload)) || a.payload.sequence - b.payload.sequence);
  }

  list(vin: string) {
    if (!this.fleet.vehicle(vin)) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    return { items: this.repo.list(vin).map(({ bodyHash: _h, response: _r, ...r }) => r), cursor: this.repo.cursor(vin), limit: VEHICLE_RATE_LIMIT };
  }
}

const brief = (f: Flag) => ({ key: f.key, value: f.value, reason: f.reason });
const pick = (v: object, keys: object) => Object.fromEntries(Object.keys(keys).map((k) => [k, (v as Record<string, unknown>)[k]]));

function summarize(b: VehicleReportBody): string {
  switch (b.type) {
    case 'HELLO':
      return `재부팅·재연결 ${b.bootId}`;
    case 'CONTEXT':
      return `관측값 ${Object.entries(b.set).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`;
    case 'TRIAL_ACCEPT':
      return `체험 수락 ${b.catalogId}`;
    case 'FAULT':
      return `오류 ${b.featureId} ${b.code} (${b.severity})`;
    case 'READBACK':
      return `회신 ${b.readback.publicationId} ${b.readback.observed}`;
    case 'ATTESTATION':
      return `구성 보고 ${b.configs.length}건`;
    case 'OVERRIDE':
      return `Flag 직접 변경 ${b.flagKey}=${JSON.stringify(b.value)}`;
  }
}

@Controller('vehicle/v1/:vin')
@VehicleEndpoint()
export class VehicleRequestController {
  constructor(private readonly svc: VehicleRequestService) {}

  /** IF-10 전체 flag 조회 — 응답이 같으면 304 */
  @Post('flags')
  @HttpCode(200)
  async bulk(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Body(new ZodPipe(OfrepBody)) body: OfrepBody, @Headers('if-none-match') inm: string | undefined, @Res({ passthrough: true }) res: Response) {
    const out = await this.svc.query(actor, vin, body, res);
    const etag = `"${hash(out)}"`;
    res.setHeader('ETag', etag);
    if (inm === etag) {
      res.status(304);
      return undefined;
    }
    return out;
  }

  @Post('flags/:key')
  @HttpCode(200)
  one(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Param('key') key: string, @Body(new ZodPipe(OfrepBody)) body: OfrepBody, @Res({ passthrough: true }) res: Response) {
    return this.svc.query(actor, vin, body, res, key);
  }

  @Post('reports')
  @HttpCode(200)
  @AuditAction('VEHICLE_REPORT')
  report(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Body(new ZodPipe(VehicleReportBody)) body: VehicleReportBody, @Res({ passthrough: true }) res: Response) {
    return this.svc.report(actor, vin, body, res);
  }
}

@Controller('api/vehicles/:vin/requests')
export class VehicleRequestLogController {
  constructor(private readonly svc: VehicleRequestService) {}

  @Get()
  @Roles(...DATA_CATEGORY_ACCESS.SAFETY_OPERATION)
  list(@Param('vin') vin: string) {
    return this.svc.list(vin);
  }
}
