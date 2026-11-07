// OTA 설치 계약 (IF-05 설치 보고, D04-01 · ADS-OTA01 · FFP-F037·F038·F039) — 규칙 contracts rules/ota-install.ts, 본문 schemas/ads-p5.ts InstallReportEvent
// SW 설치는 OTA 원장(외부 위임, D7)의 사실 — FF는 HMAC 서명된 설치 보고(type install.report)를 받아 추가만 저장하고 단계·보류·실패 원인·안전 상태 증거를 보인다.
// 정책 전달 webhook(POST /api/ota/v1/events, ota-server.adapter)과 같은 서명 형식·비밀(FF_OTA_WEBHOOK_SECRET)을 쓰되 경로·저장은 따로(대사는 P9 몫).
// '설치 확인됨'은 차량 형상 보고(ATTESTATION vehicleConfig)가 매니페스트와 맞을 때만, 복구 뒤에는 승인 구성 조합으로 다시 대조한다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, Post, Req } from '@nestjs/common';
import {
  classifyVehicleConfig,
  installFailureCounts,
  InstallReportEvent,
  installStageAxisOf,
  installView,
  manifestConfirmed,
  OTA_WEBHOOK_TOLERANCE_SEC,
  otaSpecCompatible,
  reactivationCandidate,
  simulateVehicleInstall,
  SimulateInstallBody,
  type ConfigSet,
  type InstallRecord,
  type VehicleConfigReport,
} from '@ff/contracts';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { AuditAction, CurrentActor, Roles, WebhookEndpoint, type Actor } from '../../kernel/actor';
import { AuditService } from '../../kernel/audit.service';
import { Clock } from '../../kernel/clock';
import { PlatformComponent } from '../../kernel/components';
import { DB, type Db } from '../../kernel/db';
import { DomainError } from '../../kernel/errors';
import { EventService } from '../../kernel/event.service';
import { isProduction, seedOf } from '../../kernel/runtime-config';
import { ZodPipe } from '../../kernel/zod.pipe';
import { FleetRepo } from '../../domains/d01-policy/policy-repos';
import { FeatureRepo } from '../../domains/d01-policy/repos';
import { P5_FIXTURE } from '../../domains/d05-ext/data-sync/eol.service';
import { otaWebhookSignature } from './ota-server.adapter';

const COMPONENT = 'D04-01';
const OTA_INSTALL_ACTOR: Actor = { id: 'ota-server', role: 'SYSTEM', correlationId: 'ota-install' };
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

@Injectable()
@PlatformComponent('D04-01')
export class OtaInstallService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
  ) {}

  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(P5_FIXTURE) || this.db.get('SELECT 1 FROM ota_install_record LIMIT 1')) return;
    type Seed = Omit<InstallRecord, 'at' | 'source' | 'schedule' | 'safeState'> & { agoMin: number; schedule?: { fromInMin: number; toInMin: number; estDurationMin: number; driveRestriction: boolean }; safeState?: { reachedAgoMin: number; basis: string } };
    const fx = JSON.parse(readFileSync(P5_FIXTURE, 'utf8')) as { installs: Seed[] };
    const now = this.clock.now().getTime();
    const at = (m: number) => new Date(now - m * 60_000).toISOString();
    this.db.tx(() => {
      for (const s of fx.installs) {
        if (!this.fleet.vehicle(s.vin)) continue;
        const { agoMin, schedule, safeState, ...rest } = s;
        this.insert({ ...rest, at: at(agoMin), source: 'SIMULATED', schedule: schedule ? { windowFrom: at(-schedule.fromInMin), windowTo: at(-schedule.toInMin), estDurationMin: schedule.estDurationMin, driveRestriction: schedule.driveRestriction } : null, safeState: safeState ? { reachedAt: at(safeState.reachedAgoMin), basis: safeState.basis } : null }, null);
      }
    });
  }

  private insert(r: InstallRecord, eventId: string | null) {
    this.db.run('INSERT INTO ota_install_record (install_id, vin, stage, at, source, failure_kind, event_id, received_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', r.installId, r.vin, r.stage, r.at, r.source, r.failureKind ?? null, eventId, this.clock.iso(), JSON.stringify(r));
  }
  private records(vin: string): InstallRecord[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ota_install_record WHERE vin = ? ORDER BY at, id', vin).map((r) => JSON.parse(r.doc) as InstallRecord);
  }
  private report(vin: string): VehicleConfigReport | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_vehicle_config WHERE vin = ?', vin);
    return r ? (JSON.parse(r.doc) as VehicleConfigReport) : null;
  }
  /** 이 차량을 적용 범위로 갖는 Feature의 승인 조합 — 복구 뒤 재검증 */
  private setsFor(vin: string): ConfigSet[] {
    const v = this.fleet.vehicle(vin);
    if (!v) return [];
    return this.db
      .all<{ doc: string }>('SELECT doc FROM ads_config_set ORDER BY set_id')
      .map((r) => JSON.parse(r.doc) as ConfigSet)
      .filter((s) => {
        const f = this.features.get(s.featureId, s.featureVersion);
        return !!f && f.country === v.country && f.vehicleModel === v.vehicleModel && f.trim === v.trim;
      });
  }

  vehicle(vin: string) {
    if (!this.fleet.vehicle(vin)) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const records = this.records(vin);
    const installedAt = [...records].reverse().find((r) => r.stage === 'INSTALLED');
    const manifest = [...records].reverse().find((r) => r.manifest)?.manifest ?? null;
    const report = this.report(vin);
    const m = installedAt ? manifestConfirmed(manifest, report, installedAt.at) : { confirmed: false, partial: false, missing: [] as string[] };
    const now = this.clock.now().getTime();
    const view = installView(records, { now, confirmed: m.confirmed });
    const sets = this.setsFor(vin);
    const verdicts = sets.map((s) => classifyVehicleConfig(s, report, now));
    const best = verdicts.find((x) => x.cls === 'MATCH') ?? verdicts[0] ?? null;
    return {
      vin,
      view,
      axis: installStageAxisOf(view.stage, view.confirmed),
      manifest: { ...m, ecus: manifest?.ecus ?? [] },
      reactivation: best ? reactivationCandidate(best) : null,
      history: records,
      failures: installFailureCounts(records),
      source: records.some((r) => r.source === 'OTA_SERVER') ? 'OTA_SERVER' : records.length ? 'SIMULATED' : null,
      ledger: 'OTA 원장',
    };
  }

  /** 설치 현황 — 차량별 현재 단계, 실패 원인별 수, 설치 확인(매니페스트 대조) 수 */
  list() {
    const vins = this.db.all<{ vin: string }>('SELECT DISTINCT vin FROM ota_install_record ORDER BY vin').map((r) => r.vin);
    const items = vins.map((vin) => {
      const v = this.vehicle(vin);
      return { vin, label: this.fleet.vehicle(vin)?.label ?? vin, stage: v.view.stage, label2: v.view.label, step: v.view.step, branch: v.view.branch, confirmed: v.view.confirmed, stale: v.view.stale, lastAt: v.view.lastAt, axis: v.axis, failureKind: v.view.failureKind, restriction: v.view.restriction, reactivation: v.reactivation };
    });
    const all = this.db.all<{ doc: string }>('SELECT doc FROM ota_install_record').map((r) => JSON.parse(r.doc) as InstallRecord);
    return {
      items,
      failures: installFailureCounts(all),
      summary: { vehicles: items.length, confirmed: items.filter((x) => x.confirmed).length, inProgress: items.filter((x) => x.axis === 'INSTALLING').length, notInstalled: items.filter((x) => x.axis === 'NOT_INSTALLED').length, partialFailure: items.filter((x) => x.axis === 'PARTIAL_FAILURE').length, recoveryNeeded: items.filter((x) => x.axis === 'RECOVERY_NEEDED').length, stale: items.filter((x) => x.stale).length },
    };
  }

  /** webhook — 서명(비밀 없으면 받지 않음) → 시각 창 → 본문 → 판 → 이벤트 ID(한 번만) → 차량별 기록 추가 */
  receive(headers: Record<string, string | string[] | undefined>, raw: string, body: unknown) {
    const h = (k: string) => {
      const v = headers[k];
      return (Array.isArray(v) ? v[0] : v) ?? '';
    };
    const secrets = [process.env.FF_OTA_WEBHOOK_SECRET, process.env.FF_OTA_WEBHOOK_SECRET_PREVIOUS].map((s) => (s ?? '').trim()).filter(Boolean);
    if (!secrets.length) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 비밀(FF_OTA_WEBHOOK_SECRET)이 설정되지 않아 설치 보고를 받지 않습니다.');
    const ts = h('x-ota-timestamp');
    const sig = h('x-ota-signature');
    if (!/^\d{9,12}$/.test(ts) || !sig) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 서명 머리글(X-OTA-Timestamp·X-OTA-Signature)이 없습니다.');
    if (!secrets.some((s) => same(sig, otaWebhookSignature(s, ts, raw)))) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 서명이 맞지 않습니다.');
    if (Math.abs(this.clock.now().getTime() / 1000 - Number(ts)) > OTA_WEBHOOK_TOLERANCE_SEC) throw new DomainError('UNAUTHENTICATED', `OTA webhook 서명 시각이 허용 범위(±${OTA_WEBHOOK_TOLERANCE_SEC}초) 밖입니다.`);
    const parsed = InstallReportEvent.safeParse(body);
    if (!parsed.success) throw new DomainError('VALIDATION', `OTA 설치 보고가 규격(IF-05 install.report)과 맞지 않습니다 — ${parsed.error.issues.slice(0, 3).map((i) => i.message).join(' · ')}`, { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const ev = parsed.data;
    if (!otaSpecCompatible(ev.specVersion)) throw new DomainError('VALIDATION', `OTA 설치 보고 규격 판 ${ev.specVersion}은(는) 지원하지 않습니다.`, { code: 'UNSUPPORTED_SPEC_VERSION' });
    const digest = createHash('sha256').update(raw).digest('hex');
    const seen = this.db.get<{ body_sha256: string }>('SELECT body_sha256 FROM ota_install_event WHERE event_id = ?', ev.eventId);
    if (seen) {
      if (seen.body_sha256 !== digest) throw new DomainError('CONFLICT', `OTA 이벤트 ${ev.eventId}은(는) 이미 다른 내용으로 받았습니다.`);
      return { eventId: ev.eventId, duplicate: true, accepted: 0, ignored: 0 };
    }
    const ignored: { vin: string; reason: string }[] = [];
    let accepted = 0;
    this.db.tx(() => {
      for (const i of ev.installs) {
        if (!this.fleet.vehicle(i.vin)) {
          ignored.push({ vin: i.vin, reason: 'UNKNOWN_VEHICLE' });
          continue;
        }
        this.insert({ installId: i.installId, vin: i.vin, stage: i.stage, at: i.at, source: 'OTA_SERVER', campaignId: i.campaignId ?? null, schedule: i.schedule ?? null, deferredReason: i.deferredReason ?? null, failureKind: i.failureKind ?? null, recoveryResult: i.recoveryResult ?? null, safeState: i.safeState ?? null, manifest: i.manifest ?? null }, ev.eventId);
        accepted++;
      }
      this.db.run('INSERT INTO ota_install_event (event_id, body_sha256, received_at) VALUES (?, ?, ?)', ev.eventId, digest, this.clock.iso());
      this.audit.record(OTA_INSTALL_ACTOR, 'OTA_INSTALL_REPORT', ev.eventId, { after: { accepted, ignored: ignored.length }, componentId: COMPONENT });
      this.events.publish('ota.install.reported', ev.eventId, { eventId: ev.eventId, accepted, vins: [...new Set(ev.installs.map((x) => x.vin))] }, { componentId: COMPONENT });
    });
    return { eventId: ev.eventId, duplicate: false, accepted, ignored: ignored.length, ...(ignored.length ? { ignoredResults: ignored } : {}) };
  }

  /** 시뮬 차량 설치 — 차량 로컬 사전조건 검사·결과 경로를 모의 기록(source SIMULATED)으로 남긴다(TC16·TC18) */
  simulate(actor: Actor, body: SimulateInstallBody) {
    if (!this.fleet.vehicle(body.vin)) throw new DomainError('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);
    const n = Number(this.db.get<{ n: number }>('SELECT count(DISTINCT install_id) AS n FROM ota_install_record')!.n);
    const installId = `INS-SIM-${String(n + 1).padStart(4, '0')}`;
    const steps = simulateVehicleInstall({ socPct: body.socPct, parkHold: body.parkHold, ddtActive: body.ddtActive }, body.outcome, this.clock.iso());
    const records: InstallRecord[] = steps.map((s) => ({ ...s, installId, vin: body.vin, source: 'SIMULATED', campaignId: body.campaignId ?? null }));
    this.db.tx(() => {
      for (const r of records) this.insert(r, null);
      this.audit.record(actor, 'OTA_INSTALL_SIMULATE', body.vin, { after: { installId, outcome: body.outcome, stages: records.map((r) => r.stage) }, reason: body.reason, componentId: COMPONENT });
    });
    return { installId, records, vehicle: this.vehicle(body.vin) };
  }

  /** 지원 판정이 읽는다 — 이 차량에 설치 기록이 있으면 설치 기록 연동 */
  linked(vin: string): boolean {
    return !!this.db.get('SELECT 1 FROM ota_install_record WHERE vin = ? LIMIT 1', vin);
  }
}

@Controller('api')
export class OtaInstallController {
  constructor(private readonly svc: OtaInstallService) {}

  /** OTA 원장이 부른다 — 행위자 헤더 대신 HMAC 서명 */
  @Post('ota/v1/installs')
  @HttpCode(202)
  @WebhookEndpoint()
  events(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.svc.receive(req.headers, raw, req.body);
  }

  @Get('ota/installs')
  list() {
    return this.svc.list();
  }

  @Post('ota/installs/simulate')
  @Roles('OPERATOR', 'OPS_LEAD')
  @AuditAction('OTA_INSTALL_SIMULATE')
  simulate(@CurrentActor() actor: Actor, @Body(new ZodPipe(SimulateInstallBody)) body: SimulateInstallBody) {
    return this.svc.simulate(actor, body);
  }

  @Get('vehicles/:vin/installs')
  vehicle(@Param('vin') vin: string) {
    return this.svc.vehicle(vin);
  }
}
