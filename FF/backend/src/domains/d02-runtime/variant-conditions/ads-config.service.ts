// ADS 구성 (D02-01) — ODD 프로파일(ADS-BE09)과 승인 조합(ADS-BE10). 규칙(의미 검증·상한 비교·형상 대조·보안 최소 버전)은 contracts rules/ads-config.ts.
// 프로파일 흐름: 초안 → 의미 검증 → 기능안전 승인(SAFETY_OFFICER) → 정책 연결 → 배포. 승인된 프로파일은 불변(새 버전), 오류가 남은 초안은 막힘 사유와 함께 거부.
// 승인 조합은 이 화면이 원장(P-14) — 지원 조건·복구 후보 화면은 이 판정을 읽는다. 조합은 추가만, 보안 최소 버전 아래 ECU SW가 있으면 등록 거부.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post } from '@nestjs/common';
import {
  AdsConfigFixture,
  ApproveOddProfileBody,
  classifyVehicleConfig,
  compareDeploySettings,
  configSetRegistrationBlocker,
  compatSummary,
  CONFIG_REPORT_STALE_MS,
  CreateConfigSetBody,
  countVerdicts,
  mergeSecurityMin,
  ODD_SELF_APPROVAL,
  oddApprovalBlockedReason,
  oddConditionDiff,
  siteStatus,
  validateOddProfile,
  type CompatClass,
  type ConfigSet,
  type ConfigSetListItem,
  type ConfigVehicleRow,
  type DeploySetting,
  type OddProfile,
  type OddProfileListItem,
  type SiteStatus,
  type VehicleConfigReport,
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
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, ProductRepo } from '../../d01-policy/repos';
import { isProduction, seedOf } from '../../../kernel/runtime-config';

/** 커밋된 시드(data/fixtures/ads/config.json) — repo 루트 기준 */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'config.json');
type Ago = { minutes?: number; hours?: number; days?: number };
const agoMs = (a: Ago) => ((a.days ?? 0) * 24 * 60 + (a.hours ?? 0) * 60 + (a.minutes ?? 0)) * 60_000;
const COMPAT_ZERO = (): Record<CompatClass, number> => ({ MATCH: 0, MISMATCH: 0, PARTIAL_RECOVERY: 0, BELOW_SECURITY_MIN: 0, UNCONFIRMED: 0 });

@Injectable()
@PlatformComponent('D02-01')
export class AdsConfigService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly policies: PolicyRepo,
    private readonly products: ProductRepo,
  ) {}

  /** 빈 표면 시드를 싣는다(FF_SEED=none 제외) — 있는 Feature·차량·상품에만, 시각은 시드 시각 기준 상대값 */
  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(FIXTURE) || this.db.get('SELECT 1 FROM ads_odd_profile LIMIT 1')) return;
    const fx = AdsConfigFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const now = this.clock.now().getTime();
    const at = (a: Ago) => new Date(now - agoMs(a)).toISOString();
    const hasFeature = (id: string, v: string) => !!this.features.get(id, v);
    this.db.tx(() => {
      for (const p of fx.oddProfiles) {
        if (!hasFeature(p.featureId, p.featureVersion)) continue;
        const { createdAgo, approvedAgo, ...rest } = p;
        const doc = { ...rest, createdAt: at(createdAgo), approvedAt: approvedAgo ? at(approvedAgo) : null } as OddProfile;
        this.db.run('INSERT INTO ads_odd_profile (profile_id, feature_id, feature_version, version, status, doc) VALUES (?, ?, ?, ?, ?, ?)', doc.profileId, doc.featureId, doc.featureVersion, doc.version, doc.status, JSON.stringify(doc));
      }
      for (const s of fx.deploySettings) if (hasFeature(s.featureId, s.featureVersion)) this.db.run('INSERT INTO ads_deploy_setting (setting_id, feature_id, feature_version, doc) VALUES (?, ?, ?, ?)', s.settingId, s.featureId, s.featureVersion, JSON.stringify(s));
      for (const c of fx.configSets) {
        if (!hasFeature(c.featureId, c.featureVersion)) continue;
        const { approvedAgo, ...rest } = c;
        const doc = { ...rest, status: 'APPROVED', approvedAt: at(approvedAgo) } as ConfigSet;
        this.db.run('INSERT INTO ads_config_set (set_id, feature_id, feature_version, doc) VALUES (?, ?, ?, ?)', doc.setId, doc.featureId, doc.featureVersion, JSON.stringify(doc));
      }
      for (const r of fx.vehicleConfigs) {
        if (!this.fleet.vehicle(r.vin)) continue;
        const { reportedAgo, ...rest } = r;
        const doc = { ...rest, reportedAt: reportedAgo ? at(reportedAgo) : null } as VehicleConfigReport;
        this.db.run('INSERT INTO ads_vehicle_config (vin, reported_at, doc) VALUES (?, ?, ?)', doc.vin, doc.reportedAt, JSON.stringify(doc));
      }
      for (const a of fx.productMarketApprovals)
        if (this.products.versions(a.catalogId).length) this.db.run('INSERT INTO ads_product_market_approval (catalog_id, market, approved_by, approved_at, rationale) VALUES (?, ?, ?, ?, ?)', a.catalogId, a.market, a.approvedBy, at(a.approvedAgo), a.rationale);
    });
  }

  // ── ODD 프로파일 ──
  private profiles(): OddProfile[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_odd_profile ORDER BY feature_id, feature_version, version').map((r) => JSON.parse(r.doc) as OddProfile);
  }
  private profile(id: string): OddProfile {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_odd_profile WHERE profile_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `ODD 프로파일 ${id}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc) as OddProfile;
  }
  private settings(featureId: string, version: string): DeploySetting[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_deploy_setting WHERE feature_id = ? AND feature_version = ? ORDER BY setting_id', featureId, version).map((r) => JSON.parse(r.doc) as DeploySetting);
  }
  /** Feature Version의 지금 승인 상한 — 가장 높은 승인 버전 */
  approvedProfile(featureId: string, version: string): OddProfile | null {
    return this.profiles().filter((p) => p.featureId === featureId && p.featureVersion === version && p.status === 'APPROVED').sort((a, b) => b.version - a.version)[0] ?? null;
  }
  private siteRows(p: OddProfile) {
    return p.sites.map((s) => ({ ...s, ...siteStatus(s, p) }));
  }

  listProfiles() {
    const all = this.profiles();
    const items: OddProfileListItem[] = all.map((p) => {
      const sites: Record<SiteStatus, number> = { APPROVED: 0, PENDING: 0, EXPOSURE_HOLD: 0 };
      for (const s of this.siteRows(p)) sites[s.status]++;
      return {
        profileId: p.profileId, featureId: p.featureId, featureVersion: p.featureVersion, featureName: this.features.get(p.featureId, p.featureVersion)?.name ?? null,
        version: p.version, status: p.status, issues: validateOddProfile(p).length, deploy: countVerdicts(compareDeploySettings(this.settings(p.featureId, p.featureVersion), p.envelope)), sites,
      };
    });
    // 핵심 메시지 — Feature Version마다 지금 승인 상한과 배포 설정을 한 번만 대조(초안이 같은 설정을 두 번 세지 않게). 승인 프로파일이 없으면 판단 불가
    const keys = [...new Set(this.db.all<{ k: string }>("SELECT DISTINCT feature_id || '@' || feature_version AS k FROM ads_deploy_setting").map((r) => r.k))];
    const summary = { WITHIN: 0, EXCEEDS: 0, UNDECIDABLE: 0 };
    for (const k of keys) {
      const [f, v] = k.split('@');
      const ap = this.approvedProfile(f, v);
      const c = countVerdicts(compareDeploySettings(this.settings(f, v), ap?.envelope ?? []));
      if (!ap) {
        summary.UNDECIDABLE += c.WITHIN + c.EXCEEDS + c.UNDECIDABLE;
        continue;
      }
      summary.WITHIN += c.WITHIN;
      summary.EXCEEDS += c.EXCEEDS;
      summary.UNDECIDABLE += c.UNDECIDABLE;
    }
    return { items, summary: { exceeds: summary.EXCEEDS, undecidable: summary.UNDECIDABLE, within: summary.WITHIN, total: summary.WITHIN + summary.EXCEEDS + summary.UNDECIDABLE } };
  }

  getProfile(id: string) {
    const p = this.profile(id);
    const issues = validateOddProfile(p);
    const base = p.basedOn ? this.profiles().find((x) => x.profileId === p.basedOn) ?? null : null;
    const f = this.features.get(p.featureId, p.featureVersion);
    const deploy = compareDeploySettings(this.settings(p.featureId, p.featureVersion), p.envelope);
    const sites = this.siteRows(p);
    const policies = this.policies.forFeature(p.featureId, p.featureVersion).map((x) => ({ policyId: x.policyId, flagKey: x.flagKey, status: x.status }));
    const configSets = this.sets().filter((s) => s.oddProfileId === p.profileId).map((s) => s.setId);
    return {
      profile: p,
      feature: f ? { featureId: p.featureId, version: p.featureVersion, name: f.name, lifecycle: f.lifecycle } : null,
      issues,
      blockedReason: p.status === 'DRAFT' ? oddApprovalBlockedReason(issues) : null,
      deploy,
      deployCounts: countVerdicts(deploy),
      sites,
      flagKeys: [...new Set(deploy.map((d) => d.flagKey))],
      policies,
      configSets,
      base: base ? { profileId: base.profileId, version: base.version, status: base.status } : null,
      diff: base ? oddConditionDiff(base.conditions, p.conditions) : [],
    };
  }

  /** 기능안전 승인 — 의미 검증 오류가 있으면 막힘 사유(ux 문장)와 함께 거부, 이미 승인이면 충돌 */
  approve(actor: Actor, id: string, reason: string) {
    const p = this.profile(id);
    const target = p.profileId;
    if (p.status === 'APPROVED') {
      this.audit.failed(actor, 'ODD_PROFILE_APPROVE', target, '이미 승인된 ODD 프로파일', 'D02-01');
      throw new DomainError('CONFLICT', '이미 승인된 ODD 프로파일입니다 — 바꾸려면 새 버전 초안을 만드세요.');
    }
    // 직무 분리 — 초안 작성자는 기능안전 담당이어도 자기 초안을 승인하지 않는다
    if (p.createdBy && p.createdBy === actor.id) {
      this.audit.denied(actor, 'ODD_PROFILE_APPROVE', target, ODD_SELF_APPROVAL, 'D02-01');
      throw new DomainError('SEPARATION_OF_DUTY', ODD_SELF_APPROVAL);
    }
    const issues = validateOddProfile(p);
    const blocked = oddApprovalBlockedReason(issues);
    if (blocked) {
      this.audit.failed(actor, 'ODD_PROFILE_APPROVE', target, blocked, 'D02-01');
      throw new DomainError('GUARD_FAILED', blocked, { blockers: issues.map((i) => ({ code: i.code, message: i.message, ref: i.key })) });
    }
    const next: OddProfile = { ...p, status: 'APPROVED', approvedBy: actor.id, approvedAt: this.clock.iso(), approvalReason: reason };
    return this.db.tx(() => {
      this.db.run('UPDATE ads_odd_profile SET status = ?, doc = ? WHERE profile_id = ?', next.status, JSON.stringify(next), next.profileId);
      this.audit.record(actor, 'ODD_PROFILE_APPROVE', target, { before: { status: p.status }, after: { status: next.status, version: next.version }, reason, componentId: 'D02-01' });
      return this.getProfile(id);
    });
  }

  // ── 승인 조합 ──
  sets(): ConfigSet[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_config_set ORDER BY set_id').map((r) => JSON.parse(r.doc) as ConfigSet);
  }
  private set(id: string): ConfigSet {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_config_set WHERE set_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `승인 조합 ${id}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc) as ConfigSet;
  }
  report(vin: string): VehicleConfigReport | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_vehicle_config WHERE vin = ?', vin);
    return r ? (JSON.parse(r.doc) as VehicleConfigReport) : null;
  }
  /** 조합의 대상 차량 — Feature Version의 적용 범위(국가·차종·트림) 안 등록 차량(5년 운영 표본 제외) */
  private scope(set: ConfigSet) {
    const f = this.features.get(set.featureId, set.featureVersion);
    if (!f) return [];
    return this.fleet.vehiclesInScope([{ country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }]).filter((v) => v.fleet !== 'SAMPLE');
  }
  private rows(set: ConfigSet): ConfigVehicleRow[] {
    const now = this.clock.now().getTime();
    return this.scope(set).map((v) => {
      const rep = this.report(v.vin);
      return { vin: v.vin, label: v.label, reportedAt: rep?.reportedAt ?? null, sw: rep?.ecus.flatMap((e) => e.sw) ?? [], ...classifyVehicleConfig(set, rep, now) };
    });
  }
  /** 차량 한 대의 최종 대조 — 같은 Feature의 조합 중 하나라도 부합이면 부합, 아니면 첫 조합 기준 */
  vehicleVerdict(vin: string, featureId: string, version: string): { setId: string; cls: CompatClass } | null {
    const sets = this.sets().filter((s) => s.featureId === featureId && s.featureVersion === version);
    if (!sets.length) return null;
    const now = this.clock.now().getTime();
    const rep = this.report(vin);
    const all = sets.map((s) => ({ setId: s.setId, cls: classifyVehicleConfig(s, rep, now).cls }));
    return all.find((x) => x.cls === 'MATCH') ?? all[0];
  }

  listSets() {
    const sets = this.sets();
    const items: ConfigSetListItem[] = sets.map((s) => {
      const counts = COMPAT_ZERO();
      for (const r of this.rows(s)) counts[r.cls]++;
      return { ...s, featureName: this.features.get(s.featureId, s.featureVersion)?.name ?? null, counts };
    });
    // 차량은 한 번만 센다 — 같은 Feature의 조합 중 하나라도 부합이면 부합
    const byVin = new Map<string, CompatClass>();
    for (const s of sets) for (const v of this.scope(s)) if (!byVin.has(v.vin)) byVin.set(v.vin, this.vehicleVerdict(v.vin, s.featureId, s.featureVersion)!.cls);
    const rows = [...byVin.values()].map((cls) => ({ cls }));
    const counts = COMPAT_ZERO();
    for (const r of rows) counts[r.cls]++;
    return { items, summary: { ...compatSummary(rows), counts }, staleAfterMs: CONFIG_REPORT_STALE_MS };
  }

  setVehicles(id: string) {
    const set = this.set(id);
    const rows = this.rows(set);
    return { set: { ...set, featureName: this.features.get(set.featureId, set.featureVersion)?.name ?? null }, items: rows, summary: compatSummary(rows), staleAfterMs: CONFIG_REPORT_STALE_MS, now: this.clock.iso() };
  }

  /** 승인 조합 등록 — 차량 사양·Variant 담당. 보안 최소 버전 아래 ECU SW가 있으면 거부 */
  createSet(actor: Actor, body: CreateConfigSetBody) {
    const target = `${body.featureId}@${body.featureVersion}#config-set`;
    if (!this.features.get(body.featureId, body.featureVersion)) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.featureVersion}을(를) 찾을 수 없습니다.`);
    // 보안 최소 버전 하한 — 기존 승인 조합(같은 SW)의 최소 버전 아래로는 요청 본문이 낮출 수 없다(빠뜨리거나 낮춘 값은 하한으로 올린다)
    const swIds = new Set(body.ecuSw.map((s) => s.swId));
    const floor = this.sets().reduce((acc, s) => mergeSecurityMin(acc, s.securityMin.filter((m) => swIds.has(m.swId))), [] as ConfigSet['securityMin']);
    const securityMin = mergeSecurityMin(floor, body.securityMin);
    const blocked = configSetRegistrationBlocker({ ecuSw: body.ecuSw, securityMin });
    if (blocked) {
      this.audit.failed(actor, 'CONFIG_SET_CREATE', target, blocked, 'D02-01');
      throw new DomainError('GUARD_FAILED', blocked, { blockers: [{ code: 'SECURITY_MIN_VIOLATION', message: blocked, ref: body.ecuSw.map((s) => s.swId).join(',') }] });
    }
    if (body.oddProfileId) {
      const p = this.profile(body.oddProfileId);
      if (p.status !== 'APPROVED') throw new DomainError('GUARD_FAILED', `ODD 프로파일 ${p.profileId}이(가) 승인 전입니다 — 승인된 프로파일만 조합에 묶습니다.`);
    }
    const n = this.db.all<{ set_id: string }>('SELECT set_id FROM ads_config_set WHERE feature_id = ?', body.featureId).length;
    const { reason, ...rest } = body;
    const doc: ConfigSet = { ...rest, securityMin, setId: `CFG-${body.featureId}-${String(n + 1).padStart(2, '0')}`, status: 'APPROVED', approvedBy: actor.id, approvedAt: this.clock.iso() };
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_config_set (set_id, feature_id, feature_version, doc) VALUES (?, ?, ?, ?)', doc.setId, doc.featureId, doc.featureVersion, JSON.stringify(doc));
      this.audit.record(actor, 'CONFIG_SET_CREATE', doc.setId, { after: doc, reason, componentId: 'D02-01' });
      return doc;
    });
  }

  /** 내부 상품 승인(상품 × 시장) — 지원 판정이 읽는다 */
  productApproval(catalogId: string, market: string): { approvedBy: string; approvedAt: string; rationale: string } | null {
    const r = this.db.get<{ approved_by: string; approved_at: string; rationale: string }>('SELECT approved_by, approved_at, rationale FROM ads_product_market_approval WHERE catalog_id = ? AND market = ?', catalogId, market);
    return r ? { approvedBy: r.approved_by, approvedAt: r.approved_at, rationale: r.rationale } : null;
  }
}


@Controller('api')
export class AdsConfigController {
  constructor(private readonly ads: AdsConfigService) {}

  @Get('odd-profiles')
  list() {
    return this.ads.listProfiles();
  }

  @Get('odd-profiles/:id')
  get(@Param('id') id: string) {
    return this.ads.getProfile(id);
  }

  @Post('odd-profiles/:id/approve')
  @Roles('SAFETY_OFFICER')
  @AuditAction('ODD_PROFILE_APPROVE')
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ApproveOddProfileBody)) body: ApproveOddProfileBody) {
    return this.ads.approve(actor, id, body.reason);
  }

  @Get('config-sets')
  sets() {
    return this.ads.listSets();
  }

  @Post('config-sets')
  @Roles('VARIANT_OWNER')
  @AuditAction('CONFIG_SET_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateConfigSetBody)) body: CreateConfigSetBody) {
    return this.ads.createSet(actor, body);
  }

  @Get('config-sets/:id/vehicles')
  vehicles(@Param('id') id: string) {
    return this.ads.setVehicles(id);
  }
}
