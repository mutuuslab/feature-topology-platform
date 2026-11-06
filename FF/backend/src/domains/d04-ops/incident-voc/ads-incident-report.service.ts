// ADS 사건 보고 (D04-05, ADS-BE13) — 법정 보고 대상 후보인 ADS 사건. 장애·VOC(incident)·지원 건(service_case)과 다른 개념이다.
// 플랫폼은 인지 시각·기한 계산·초안 근거만 갖고, 시장별 기한 표는 법규 담당 승인 데이터(승인 전이면 기한을 계산하지 않는다).
// 보고 대상 확정(대상·비대상)은 안전·법규 담당의 기록 행위 — 추가만 하고 마지막 기록이 유효하다. 확정 전에는 보고 대상 수·기한 경보에 세지 않는다.
// DSSAD 기록은 차량 소관 — 여기에는 상관 ID만 둔다(운영 감사 기록과 구분).
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, Post } from '@nestjs/common';
import {
  adsIncidentSummary,
  adsIncidentView,
  adsPeriodicReport,
  AdsDeterminationBody,
  AdsEvidenceFixture,
  kstYear,
  type AdsDetermination,
  type AdsExposureMonth,
  type AdsIncidentReport,
  type AdsIncidentView,
  type AdsMarketDeadline,
} from '@ff/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { isProduction, seedOf } from '../../../kernel/runtime-config';

/** ADS 증거 데모 시드 — repo 루트 기준(Safety Case 서비스와 같은 파일) */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'evidence.json');
const MIN = 60_000;

@Injectable()
@PlatformComponent('D04-05')
export class AdsIncidentReportService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** 빈 DB면 시드를 싣는다 — 시각은 시드 시각 기준 상대값(분), Feature·VIN이 있는 사건만 */
  onModuleInit() {
    if (this.db.get('SELECT 1 FROM ads_incident_report LIMIT 1') || !existsSync(FIXTURE) || isProduction() || seedOf() === 'none') return;
    const fx = AdsEvidenceFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const now = this.clock.now().getTime();
    const at = (ago: number) => new Date(now - ago * MIN).toISOString();
    const opt = (ago: number | null) => (ago === null ? null : at(ago));
    this.db.tx(() => {
      for (const d of fx.marketDeadlines) {
        const doc: AdsMarketDeadline = { market: d.market, label: d.label, shortTermDays: d.shortTermDays, periodicMonths: d.periodicMonths, status: d.status, approvedBy: d.approvedBy, approvedAt: opt(d.approvedMinAgo), basis: d.basis };
        this.db.run('INSERT OR IGNORE INTO ads_market_deadline (market, status, doc) VALUES (?, ?, ?)', d.market, d.status, JSON.stringify(doc));
      }
      const loaded = new Set<string>();
      for (const i of fx.incidents) {
        if (!this.features.get(i.featureId, i.featureVersion) || !this.fleet.vehicle(i.vin)) continue;
        const doc: AdsIncidentReport = {
          reportId: i.reportId,
          featureId: i.featureId,
          featureVersion: i.featureVersion,
          vin: i.vin,
          market: i.market,
          summary: i.summary,
          occurredAt: opt(i.occurredMinAgo),
          awareAt: at(i.awareMinAgo),
          firstNoticeAt: opt(i.firstNoticeMinAgo),
          activeWindow: i.activeWindow,
          configSet: i.configSet,
          oddProfileRef: i.oddProfileRef,
          dssadCorrelationId: i.dssadCorrelationId,
          auditTarget: i.reportId,
          shortTermSubmittedAt: opt(i.shortTermSubmittedMinAgo),
          events: i.events.map((e) => ({ kind: e.kind, label: e.label, vehicleAt: opt(e.vehicleMinAgo), vehicleSeq: e.vehicleSeq, serverAt: at(e.serverMinAgo), ingestSeq: e.ingestSeq, owner: e.owner, ref: e.ref, ...(e.gap ? { gap: true } : {}) })),
        };
        this.db.run('INSERT INTO ads_incident_report (report_id, feature_id, feature_version, market, doc) VALUES (?, ?, ?, ?, ?)', doc.reportId, doc.featureId, doc.featureVersion, doc.market, JSON.stringify(doc));
        loaded.add(doc.reportId);
      }
      const versions = new Map<string, number>();
      for (const d of fx.determinations) {
        if (!loaded.has(d.reportId)) continue;
        const version = (versions.get(d.reportId) ?? 0) + 1;
        versions.set(d.reportId, version);
        const doc: AdsDetermination = { reportId: d.reportId, version, decision: d.decision, reason: d.reason, decidedBy: d.decidedBy, decidedRole: d.decidedRole, decidedAt: at(d.decidedMinAgo) };
        this.db.run('INSERT INTO ads_incident_determination (report_id, version, doc) VALUES (?, ?, ?)', d.reportId, version, JSON.stringify(doc));
      }
      const e = fx.exposure;
      if (this.features.get(e.featureId, e.featureVersion))
        for (const m of e.months) {
          // KST 기준 달 — 시드 시각에서 monthsAgo달 전
          const k = new Date(now + 9 * 3600_000);
          const month = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - m.monthsAgo, 1)).toISOString().slice(0, 7);
          this.db.run('INSERT INTO ads_exposure (feature_id, feature_version, month, hours, km) VALUES (?, ?, ?, ?, ?)', e.featureId, e.featureVersion, month, m.hours, m.km);
        }
    });
  }

  private deadlines(): Map<string, AdsMarketDeadline> {
    return new Map(this.db.all<{ doc: string }>('SELECT doc FROM ads_market_deadline').map((r) => JSON.parse(r.doc) as AdsMarketDeadline).map((d) => [d.market, d]));
  }
  private determinations(reportId?: string): AdsDetermination[] {
    const rows = reportId ? this.db.all<{ doc: string }>('SELECT doc FROM ads_incident_determination WHERE report_id = ? ORDER BY version', reportId) : this.db.all<{ doc: string }>('SELECT doc FROM ads_incident_determination ORDER BY id');
    return rows.map((r) => JSON.parse(r.doc) as AdsDetermination);
  }
  private views(reportId?: string): AdsIncidentView[] {
    const rows = reportId ? this.db.all<{ doc: string }>('SELECT doc FROM ads_incident_report WHERE report_id = ?', reportId) : this.db.all<{ doc: string }>('SELECT doc FROM ads_incident_report ORDER BY report_id DESC');
    const rules = this.deadlines();
    const ds = this.determinations(reportId);
    const now = this.clock.now();
    return rows.map((r) => JSON.parse(r.doc) as AdsIncidentReport).map((r) => adsIncidentView(r, rules.get(r.market) ?? null, ds, now));
  }
  private featureName(featureId: string, version: string) {
    return this.features.get(featureId, version)?.name ?? featureId;
  }

  list() {
    const items = this.views().map((v) => ({ ...v, featureName: this.featureName(v.featureId, v.featureVersion) }));
    return { at: this.clock.iso(), summary: adsIncidentSummary(items), markets: [...this.deadlines().values()], items };
  }

  detail(reportId: string) {
    const v = this.views(reportId)[0];
    if (!v) throw new DomainError('NOT_FOUND', `${reportId}을(를) 찾을 수 없습니다.`);
    // 운영 감사 기록 — 이 사건 대상(확정 기록 등). DSSAD(차량 기록)와 섞지 않는다
    const audit = this.db
      .all<{ at: string; actor_id: string; actor_role: string; action: string; result: string }>('SELECT at, actor_id, actor_role, action, result FROM audit WHERE target = ? ORDER BY id', reportId)
      .map((a) => ({ at: a.at, actor: a.actor_id, role: a.actor_role, action: a.action, result: a.result }));
    return { at: this.clock.iso(), ...v, featureName: this.featureName(v.featureId, v.featureVersion), determinations: this.determinations(reportId), audit };
  }

  /** 보고 대상 확정 — 사유 필수, 추가만(이전 기록은 남는다) */
  determine(actor: Actor, reportId: string, body: AdsDeterminationBody) {
    const cur = this.views(reportId)[0];
    if (!cur) throw new DomainError('NOT_FOUND', `${reportId}을(를) 찾을 수 없습니다.`);
    const version = (cur.determination?.version ?? 0) + 1;
    const doc: AdsDetermination = { reportId, version, decision: body.decision, reason: body.reason, decidedBy: actor.id, decidedRole: actor.role, decidedAt: this.clock.iso() };
    this.db.tx(() => {
      this.db.run('INSERT INTO ads_incident_determination (report_id, version, doc) VALUES (?, ?, ?)', reportId, version, JSON.stringify(doc));
      this.audit.record(actor, 'ADS_INCIDENT_DETERMINE', reportId, { before: cur.determination ? { decision: cur.determination.decision, version: cur.determination.version } : { status: cur.reportStatus }, after: { decision: doc.decision, version }, reason: body.reason, componentId: 'D04-05' });
    });
    return this.detail(reportId);
  }

  /** 정기 보고(연 1회) — KST 연도, 노출량은 ADS Feature Version별 월 집계를 합친다 */
  periodic(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError('VALIDATION', '연도는 4자리 숫자여야 합니다.');
    const exp = this.db.all<{ feature_id: string; feature_version: string; month: string; hours: number; km: number }>('SELECT feature_id, feature_version, month, hours, km FROM ads_exposure ORDER BY month');
    const byMonth = new Map<string, AdsExposureMonth>();
    for (const r of exp) {
      const m = byMonth.get(r.month) ?? { month: r.month, hours: 0, km: 0 };
      byMonth.set(r.month, { month: r.month, hours: m.hours + r.hours, km: m.km + r.km });
    }
    const first = exp[0];
    const report = adsPeriodicReport(year, [...byMonth.values()], this.views());
    const years = [...new Set([...exp.map((r) => Number(r.month.slice(0, 4))), kstYear(this.clock.iso())])].sort((a, b) => b - a);
    return { at: this.clock.iso(), featureId: first?.feature_id ?? null, featureVersion: first?.feature_version ?? null, basis: '텔레메트리 노출량 집계(IF-15) — 월별 ADS 운행 시간·거리', years, ...report };
  }
}

@Controller('api/incident-reports')
export class AdsIncidentReportController {
  constructor(private readonly svc: AdsIncidentReportService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post(':id/determination')
  @HttpCode(201)
  @Roles('REGULATORY_OWNER', 'SAFETY_OFFICER')
  @AuditAction('ADS_INCIDENT_DETERMINE')
  determine(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AdsDeterminationBody)) body: AdsDeterminationBody) {
    return this.svc.determine(actor, id, body);
  }
}

@Controller('api/periodic-reports')
export class AdsPeriodicReportController {
  constructor(private readonly svc: AdsIncidentReportService) {}

  @Get(':year')
  periodic(@Param('year') year: string) {
    return this.svc.periodic(Number(year));
  }
}
