// 생산 출고(EOL) 실물 구성 대조·품질 보류 (D05-02 · ORC-UI08 · Orca B06) — 규칙 contracts rules/eol.ts
// 실물 구성 원장은 공장 품질 시스템(IF-12 해외 공장 모의) — FF는 주문 사양과 VIN 스캔을 대조해 불일치를 품질 보류로 두고, 보류 해제는 공장 품질 기록(재작업·재대조)을 반영한다.
// 결정 주체 '생산 품질'은 결정 D-ADS-7 기본안대로 기존 BOM 승인자(BOM_APPROVER)에 위임. 결정 기록은 추가만, 재대조 없는 출고 근거는 DB 제약으로도 거부.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post } from '@nestjs/common';
import { acceptanceItems, AsBuiltBody, compareAsBuilt, CONFIG_REPORT_STALE_MS, eolCheckBlockers, EolCheckBody, eolStatus, EOL_STATUS_LABEL, EOL_VERDICT_LABEL, type EolCheckRecord, type EolPart, type VehicleConfigReport } from '@ff/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

/** 커밋된 시드(data/fixtures/ads/p5.json) — repo 루트 기준 */
export const P5_FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'p5.json');

interface AsBuiltDoc {
  vin: string;
  plant: string;
  scannedAt: string;
  orderEcus: { ecuPno: string; hwRevision: string }[];
  builtEcus: EolPart[];
}
interface CheckDoc extends EolCheckRecord {
  checkId: string;
  vin: string;
  cause: string;
  reworkRef: string | null;
  decidedBy: string;
  decidedRole: string;
  decidedAt: string;
  reason: string;
}

@Injectable()
@PlatformComponent('D05-02')
export class EolService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
  ) {}

  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(P5_FIXTURE) || this.db.get('SELECT 1 FROM as_built_config LIMIT 1')) return;
    const fx = JSON.parse(readFileSync(P5_FIXTURE, 'utf8')) as { asBuilt: (Omit<AsBuiltDoc, 'scannedAt'> & { scannedAgoMin: number })[]; eolChecks: (Omit<CheckDoc, 'checkId' | 'decidedAt' | 'decidedRole' | 'reason'> & { agoMin: number })[] };
    const now = this.clock.now().getTime();
    const at = (m: number) => new Date(now - m * 60_000).toISOString();
    this.db.tx(() => {
      for (const a of fx.asBuilt) {
        if (!this.fleet.vehicle(a.vin)) continue;
        const { scannedAgoMin, ...rest } = a;
        const doc: AsBuiltDoc = { ...rest, scannedAt: at(scannedAgoMin) };
        this.db.run('INSERT INTO as_built_config (vin, plant, scanned_at, doc) VALUES (?, ?, ?, ?)', doc.vin, doc.plant, doc.scannedAt, JSON.stringify(doc));
      }
      fx.eolChecks.forEach((c, i) => {
        if (!this.fleet.vehicle(c.vin)) return;
        const { agoMin, ...rest } = c;
        this.insertCheck({ ...rest, checkId: `EOL-${String(i + 1).padStart(5, '0')}`, decidedRole: 'BOM_APPROVER', decidedAt: at(agoMin), reason: '시드 — 공장 품질 시스템 기록 반영' });
      });
    });
  }

  private asBuilt(vin: string): AsBuiltDoc | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM as_built_config WHERE vin = ?', vin);
    return r ? (JSON.parse(r.doc) as AsBuiltDoc) : null;
  }
  private checks(vin: string): CheckDoc[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM eol_check WHERE vin = ? ORDER BY id', vin).map((r) => JSON.parse(r.doc) as CheckDoc);
  }
  private insertCheck(c: CheckDoc) {
    this.db.run('INSERT INTO eol_check (check_id, vin, decision, decided_by, decided_role, decided_at, recheck_result, shipped_evidence, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', c.checkId, c.vin, c.decision, c.decidedBy, c.decidedRole, c.decidedAt, c.recheckResult, c.shippedEvidence, JSON.stringify(c));
  }

  /** 출고 구성 기록 ECU — 지원 판정 HW 칸이 읽는다(스캔된 부품 전부, 개정 판독 여부와 무관) */
  asBuiltEcus(vin: string): string[] | null {
    const a = this.asBuilt(vin);
    return a ? a.builtEcus.map((e) => e.ecuPno) : null;
  }

  private row(a: AsBuiltDoc) {
    const compare = compareAsBuilt(a.orderEcus, a.builtEcus);
    const checks = this.checks(a.vin);
    const status = eolStatus(compare, checks);
    return { vin: a.vin, label: this.fleet.vehicle(a.vin)?.label ?? a.vin, plant: a.plant, scannedAt: a.scannedAt, verdict: compare.verdict, verdictLabel: EOL_VERDICT_LABEL[compare.verdict], reason: compare.reason, parts: compare.parts, orderEcus: a.orderEcus, builtEcus: a.builtEcus, status, statusLabel: EOL_STATUS_LABEL[status], lastCheck: checks.at(-1) ?? null };
  }

  mismatches() {
    const items = this.db.all<{ doc: string }>('SELECT doc FROM as_built_config ORDER BY vin').map((r) => this.row(JSON.parse(r.doc) as AsBuiltDoc));
    const hold = items.filter((x) => x.status === 'QUALITY_HOLD' || x.status === 'REWORK').length;
    // 불일치 유출 — 출고(근거 저장)됐는데 마지막 대조가 불일치이고 재대조 통과 기록이 없는 차량(0이어야 한다)
    const shippedWithMismatch = items.filter((x) => x.status === 'SHIPPED' && x.verdict !== 'MATCH' && x.lastCheck?.recheckResult !== 'PASS').length;
    return { items, summary: { total: items.length, hold, unconfirmed: items.filter((x) => x.verdict === 'UNCONFIRMED').length, match: items.filter((x) => x.verdict === 'MATCH').length, shippedWithMismatch }, ledger: '공장 품질 시스템' };
  }

  vehicle(vin: string) {
    const a = this.asBuilt(vin);
    if (!a) throw new DomainError('NOT_FOUND', `${vin}의 출고 실물 구성 기록이 없습니다 — 공장 VIN 스캔이 들어오면 보입니다.`);
    return { ...this.row(a), checks: this.checks(vin), acceptance: this.acceptance(vin) };
  }

  /** 인도 인수 — 계약 기능(지금 권리의 상품 구성 + 이 차량 사양의 출시 Feature) × 최신 차량 보고. ODD·DDT 영향이 있는 기능은 주행 조건에서 확인할 항목 */
  private acceptance(vin: string) {
    const today = this.clock.iso().slice(0, 10);
    const catalogs = new Set(this.fleet.grants(vin).filter((g) => (g.status === 'ACTIVE' || g.status === 'OFFERED') && g.validTo.slice(0, 10) >= today).map((g) => g.catalogId));
    const v = this.fleet.vehicle(vin);
    const rep = this.db.get<{ doc: string }>('SELECT doc FROM ads_vehicle_config WHERE vin = ?', vin);
    const report = rep ? (JSON.parse(rep.doc) as VehicleConfigReport) : null;
    const fresh = !!report?.reportedAt && this.clock.now().getTime() - Date.parse(report.reportedAt) <= CONFIG_REPORT_STALE_MS;
    const seen = new Set<string>();
    const feats = this.features
      .all()
      .filter((f) => !!v && f.country === v.country && f.vehicleModel === v.vehicleModel && ((f.catalogIds ?? []).some((c) => catalogs.has(c)) || (f.trim === v.trim && f.lifecycle === 'RELEASED')))
      .sort((a, b) => (a.featureId === b.featureId ? (a.version < b.version ? 1 : -1) : a.featureId < b.featureId ? -1 : 1))
      .filter((f) => (seen.has(f.featureId) ? false : (seen.add(f.featureId), true)))
      .map((f) => {
        const odd = !!this.db.get('SELECT 1 FROM ads_odd_profile WHERE feature_id = ? LIMIT 1', f.featureId);
        const cls = this.db.get<{ doc: string }>('SELECT doc FROM ads_classification WHERE feature_id = ? AND version = ?', f.featureId, f.version);
        const ddt = cls ? (JSON.parse(cls.doc) as { ddtImpact?: string | null }).ddtImpact : null;
        const need = f.ecuPnos ?? [];
        const reported = fresh && need.every((e) => report!.ecus.some((x) => x.ecuPno === e));
        return { featureId: f.featureId, name: f.name, drivingCondition: odd || (!!ddt && ddt !== 'NONE'), reported };
      });
    return acceptanceItems(feats);
  }

  receiveAsBuilt(actor: Actor, body: AsBuiltBody) {
    if (!this.fleet.vehicle(body.vin)) throw new DomainError('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);
    const doc: AsBuiltDoc = { vin: body.vin, plant: body.plant, scannedAt: body.scannedAt, orderEcus: body.orderEcus, builtEcus: body.builtEcus.map((e) => ({ ecuPno: e.ecuPno, hwRevision: e.hwRevision ?? null })) };
    const compare = compareAsBuilt(doc.orderEcus, doc.builtEcus);
    return this.db.tx(() => {
      if (this.asBuilt(body.vin)) this.db.run('UPDATE as_built_config SET plant = ?, scanned_at = ?, doc = ? WHERE vin = ?', doc.plant, doc.scannedAt, JSON.stringify(doc), doc.vin);
      else this.db.run('INSERT INTO as_built_config (vin, plant, scanned_at, doc) VALUES (?, ?, ?, ?)', doc.vin, doc.plant, doc.scannedAt, JSON.stringify(doc));
      this.audit.record(actor, 'EOL_AS_BUILT', body.vin, { after: { plant: doc.plant, verdict: compare.verdict, parts: compare.parts.length }, componentId: 'D05-02' });
      if (compare.verdict === 'MISMATCH') this.events.publish('plant.eol.mismatch', body.vin, { vin: body.vin, parts: compare.parts }, { componentId: 'D05-02', correlationId: actor.correlationId });
      return this.row(doc);
    });
  }

  createCheck(actor: Actor, body: EolCheckBody) {
    const a = this.asBuilt(body.vin);
    if (!a) throw new DomainError('NOT_FOUND', `${body.vin}의 출고 실물 구성 기록이 없습니다.`);
    const compare = compareAsBuilt(a.orderEcus, a.builtEcus);
    const blockers = eolCheckBlockers({ role: actor.role, decision: body.decision, recheckResult: body.recheckResult ?? null, shippedEvidence: body.shippedEvidence ?? null, compare });
    if (blockers.length) {
      const msg = blockers.map((b) => b.message).join(' · ');
      this.audit.failed(actor, 'EOL_CHECK', body.vin, msg, 'D05-02');
      throw new DomainError('GUARD_FAILED', msg, { blockers });
    }
    const n = Number(this.db.get<{ n: number }>('SELECT count(*) AS n FROM eol_check')!.n);
    const doc: CheckDoc = { checkId: `EOL-${String(n + 1).padStart(5, '0')}`, vin: body.vin, decision: body.decision, cause: body.cause, reworkRef: body.reworkRef ?? null, recheckResult: body.recheckResult ?? null, shippedEvidence: body.shippedEvidence ?? null, decidedBy: actor.id, decidedRole: actor.role, decidedAt: this.clock.iso(), reason: body.reason };
    return this.db.tx(() => {
      this.insertCheck(doc);
      this.audit.record(actor, 'EOL_CHECK', body.vin, { after: { checkId: doc.checkId, decision: doc.decision, recheckResult: doc.recheckResult, shippedEvidence: doc.shippedEvidence }, reason: body.reason, componentId: 'D05-02' });
      return doc;
    });
  }
}

@Controller('api/plants/eol')
export class EolController {
  constructor(private readonly eol: EolService) {}

  @Get('mismatches')
  mismatches() {
    return this.eol.mismatches();
  }

  @Get('vehicles/:vin')
  vehicle(@Param('vin') vin: string) {
    return this.eol.vehicle(vin);
  }

  @Post('as-built')
  @Roles('BOM_APPROVER')
  @AuditAction('EOL_AS_BUILT')
  asBuilt(@CurrentActor() actor: Actor, @Body(new ZodPipe(AsBuiltBody)) body: AsBuiltBody) {
    return this.eol.receiveAsBuilt(actor, body);
  }

  @Post('checks')
  @Roles('BOM_APPROVER')
  @AuditAction('EOL_CHECK')
  check(@CurrentActor() actor: Actor, @Body(new ZodPipe(EolCheckBody)) body: EolCheckBody) {
    return this.eol.createCheck(actor, body);
  }
}
