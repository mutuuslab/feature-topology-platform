// ADS 구성 (D02-01) — ODD 프로파일(ADS-BE09)과 승인 조합(ADS-BE10). 규칙(의미 검증·상한 비교·형상 대조·보안 최소 버전)은 contracts rules/ads-config.ts.
// 프로파일 흐름: 초안 → 의미 검증 → 기능안전 승인(SAFETY_OFFICER) → 정책 연결 → 배포. 승인된 프로파일은 불변(새 버전), 오류가 남은 초안은 막힘 사유와 함께 거부.
// 승인 조합은 이 화면이 원장(P-14) — 지원 조건·복구 후보 화면은 이 판정을 읽는다. 조합은 추가만, 보안 최소 버전 아래 ECU SW가 있으면 등록 거부.
// 조합 등록 = 제안 → 다른 사람(기능안전 담당) 승인 뒤에만 대조·발행 근거. 보안 최소 버전의 정본은 사이버보안 담당이 승인한 표(security-min-store.ts).
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  AdsConfigFixture,
  ApproveConfigSetBody,
  ApproveOddProfileBody,
  ApproveSecurityMinBody,
  configSetApprovalBlocker,
  ProposeSecurityMinBody,
  SECURITY_MIN_UNREGISTERED,
  securityMinApprovalBlocker,
  securityMinProposalBlocker,
  unregisteredSecurityMin,
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
  oddCompileBlockers,
  reactivationCandidate,
  recoveryDecisionBlockers,
  recoveryMetadataVerdict,
  siteAdditionVerdict,
  ApproveOddSiteBody,
  CreateOddSiteBody,
  RecoveryDecisionBody,
  type Publication,
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
import { approvedConfigSets, readConfigSet, readConfigSets } from './config-set-store';
import { readSecurityMins, securityMinTable } from './security-min-store';

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
        // 제안 기록 + 다른 계정의 승인 기록(승인 대기 조합은 승인 기록 없음)
        const { approvedAgo, proposedAgo, approvedBy, approvalReason, ...rest } = c;
        const doc = { ...rest, status: 'PROPOSED', proposedAt: at(proposedAgo), approvedBy: null, approvedAt: null } as ConfigSet;
        this.db.run('INSERT INTO ads_config_set (set_id, feature_id, feature_version, doc) VALUES (?, ?, ?, ?)', doc.setId, doc.featureId, doc.featureVersion, JSON.stringify(doc));
        if (approvedBy && approvedAgo) this.db.run('INSERT INTO ads_config_set_approval (set_id, approved_by, approved_role, approved_at, reason) VALUES (?, ?, ?, ?, ?)', doc.setId, approvedBy, 'SAFETY_OFFICER', at(approvedAgo), approvalReason ?? '승인');
      }
      for (const m of fx.securityMins) {
        this.db.run('INSERT INTO ads_security_min (entry_id, sw_id, version, rationale, proposed_by, proposed_at) VALUES (?, ?, ?, ?, ?, ?)', m.entryId, m.swId, m.version, m.rationale, m.proposedBy, at(m.proposedAgo));
        if (m.approvedBy && m.approvedAgo) this.db.run('INSERT INTO ads_security_min_approval (entry_id, approved_by, approved_at, reason) VALUES (?, ?, ?, ?)', m.entryId, m.approvedBy, at(m.approvedAgo), m.approvalReason ?? '승인');
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
    const sites = [...this.siteRows(p), ...this.siteRequestRows(p)];
    const policies = this.policies.forFeature(p.featureId, p.featureVersion).map((x) => ({ policyId: x.policyId, flagKey: x.flagKey, status: x.status }));
    // ADS-BE09 정책 컴파일 검사 — Flag별 배포 설정 ↔ 지금 승인 상한(초안 프로파일도 같은 승인 기준으로 본다)
    const approved = this.approvedProfile(p.featureId, p.featureVersion);
    const allSettings = this.settings(p.featureId, p.featureVersion);
    const compile = [...new Set(allSettings.map((s) => s.flagKey))].map((flagKey) => ({ flagKey, against: approved?.profileId ?? null, blockers: oddCompileBlockers({ flagKey, settings: allSettings, profile: approved }) }));
    const configSets = this.allSets().filter((s) => s.oddProfileId === p.profileId).map((s) => s.setId);
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
      compile,
      logs: this.verdictLogs(p),
    };
  }

  /** 판정 로그 — 이 프로파일 참조(odd_ref)로 기록된 차량 판정만 센다(다른 ODD 버전과 섞지 않는다, FFP-F025) */
  private verdictLogs(p: OddProfile) {
    const rows = this.db.all<{ verdict: string; n: number }>('SELECT verdict, count(*) AS n FROM safety_verdict WHERE feature_id = ? AND odd_ref = ? GROUP BY verdict', p.featureId, p.profileId);
    const c = { ALLOW: 0, DENY: 0, UNKNOWN: 0 } as Record<string, number>;
    for (const r of rows) c[r.verdict] = Number(r.n);
    return { oddRef: p.profileId, ALLOW: c.ALLOW, DENY: c.DENY, UNKNOWN: c.UNKNOWN, total: c.ALLOW + c.DENY + c.UNKNOWN };
  }

  // ── 적용 장소 추가(HT02) — 변경 영향 범위 확정 전에는 승인 대기, 승인 상한(Envelope)은 바뀌지 않는다 ──
  private siteRequests(profileId: string) {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_odd_site_request WHERE profile_id = ? ORDER BY site_id', profileId).map((r) => JSON.parse(r.doc) as SiteRequest);
  }
  private siteRequestRows(p: OddProfile) {
    return this.siteRequests(p.profileId).map((r) => {
      const s = siteStatus({ siteId: r.siteId, name: r.name, kind: r.kind, mapVersion: r.mapVersion, infraVersion: r.infraVersion, impactConfirmed: r.status === 'APPROVED' }, p);
      const keep = s.status === 'PENDING' && r.code ? { reason: r.reason, code: r.code } : {};
      return { siteId: r.siteId, name: r.name, kind: r.kind, mapVersion: r.mapVersion, infraVersion: r.infraVersion, impactConfirmed: r.status === 'APPROVED', ...s, ...keep, requested: true, changeImpactRef: r.changeImpactRef, requestedBy: r.requestedBy };
    });
  }
  private impact(ref: string | null) {
    if (!ref) return null;
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_change_impact WHERE impact_id = ?', ref);
    if (!r) throw new DomainError('NOT_FOUND', `변경 영향 ${ref}을(를) 찾을 수 없습니다.`);
    const d = JSON.parse(r.doc) as { impactId: string; featureId: string; version: string; scopeStatus: 'CONFIRMED' | 'REVIEW_REQUIRED' };
    return { impactId: d.impactId, featureId: d.featureId, version: d.version, scopeStatus: d.scopeStatus };
  }

  addSite(actor: Actor, profileId: string, body: CreateOddSiteBody) {
    const p = this.profile(profileId);
    const v = siteAdditionVerdict(this.impact(body.changeImpactRef), p);
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM ads_odd_site_request')!.n;
    const doc: SiteRequest = { siteId: `SITE-${String(1001 + Number(n))}`, profileId, name: body.name, kind: body.kind, mapVersion: body.mapVersion, infraVersion: body.infraVersion, changeImpactRef: body.changeImpactRef, status: 'PENDING', code: v.code ?? null, reason: v.reason, requestedBy: actor.id, requestedAt: this.clock.iso(), approvedBy: null, approvedAt: null };
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_odd_site_request (site_id, profile_id, status, doc) VALUES (?, ?, ?, ?)', doc.siteId, profileId, doc.status, JSON.stringify(doc));
      this.audit.record(actor, 'ODD_SITE_REQUEST', doc.siteId, { after: { profileId, status: doc.status, code: doc.code, changeImpactRef: doc.changeImpactRef }, reason: body.reason, componentId: 'D02-01' });
      return doc;
    });
  }

  /** 장소 승인(기능안전 담당) — 변경 영향이 지금도 확정이어야 한다(IMPACT_REVIEW_OPEN이면 거부) */
  approveSite(actor: Actor, profileId: string, siteId: string, reason: string) {
    const p = this.profile(profileId);
    const r = this.siteRequests(profileId).find((x) => x.siteId === siteId);
    if (!r) throw new DomainError('NOT_FOUND', `적용 장소 ${siteId}을(를) 찾을 수 없습니다.`);
    if (r.status === 'APPROVED') throw new DomainError('CONFLICT', '이미 승인된 적용 장소입니다.');
    const v = siteAdditionVerdict(this.impact(r.changeImpactRef), p);
    if (v.status !== 'APPROVED') {
      this.audit.failed(actor, 'ODD_SITE_APPROVE', siteId, v.reason, 'D02-01');
      throw new DomainError('GUARD_FAILED', `적용 장소를 승인할 수 없습니다 — ${v.reason}`, { blockers: [{ code: v.code, message: v.reason, ref: r.changeImpactRef ?? siteId }] });
    }
    const next: SiteRequest = { ...r, status: 'APPROVED', code: null, reason: v.reason, approvedBy: actor.id, approvedAt: this.clock.iso() };
    return this.db.tx(() => {
      this.db.run('UPDATE ads_odd_site_request SET status = ?, doc = ? WHERE site_id = ?', next.status, JSON.stringify(next), siteId);
      this.audit.record(actor, 'ODD_SITE_APPROVE', siteId, { before: { status: r.status }, after: { status: next.status, changeImpactRef: r.changeImpactRef }, reason, componentId: 'D02-01' });
      return next;
    });
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
  /** 승인된 조합만 — 대조·발행·지원 판정의 근거 */
  sets(): ConfigSet[] {
    return approvedConfigSets(this.db);
  }
  /** 승인 대기 포함 — 목록 */
  allSets(): ConfigSet[] {
    return readConfigSets(this.db);
  }
  private set(id: string): ConfigSet {
    const s = readConfigSet(this.db, id);
    if (!s) throw new DomainError('NOT_FOUND', `승인 조합 ${id}을(를) 찾을 수 없습니다.`);
    return s;
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
      const verdict = classifyVehicleConfig(set, rep, now);
      return { vin: v.vin, label: v.label, reportedAt: rep?.reportedAt ?? null, sw: rep?.ecus.flatMap((e) => e.sw) ?? [], ...verdict, reactivation: reactivationCandidate(verdict) };
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
    // 승인 대기 조합도 행으로 보인다(차량 수는 승인 뒤 대조할 차량 미리보기) — 요약·차량 한 번 세기는 승인된 조합만
    const items: ConfigSetListItem[] = this.allSets().map((s) => {
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
    return { items, summary: { ...compatSummary(rows), counts }, staleAfterMs: CONFIG_REPORT_STALE_MS, unverified: this.unverifiedCombos(sets), decisions: this.recoveryDecisions().length, pending: items.filter((s) => s.status !== 'APPROVED').length };
  }

  setVehicles(id: string) {
    const set = this.set(id);
    const rows = this.rows(set);
    return { set: { ...set, featureName: this.features.get(set.featureId, set.featureVersion)?.name ?? null }, items: rows, summary: compatSummary(rows), staleAfterMs: CONFIG_REPORT_STALE_MS, now: this.clock.iso() };
  }

  /** 보안 최소 버전 검사 — 표(승인 값)를 하한으로, 본문 값은 올리기만. 표에 없는 SW·하한 아래 SW가 있으면 막힘 사유 */
  private securityCheck(ecuSw: ConfigSet['ecuSw'], extra: ConfigSet['securityMin']) {
    const table = securityMinTable(this.db);
    const swIds = new Set(ecuSw.map((s) => s.swId));
    const securityMin = mergeSecurityMin(table.filter((m) => swIds.has(m.swId)), extra);
    const missing = unregisteredSecurityMin(ecuSw, table);
    if (missing.length) return { securityMin, blocker: { code: 'SECURITY_MIN_UNREGISTERED', message: SECURITY_MIN_UNREGISTERED(missing), ref: missing.join(',') } };
    const blocked = configSetRegistrationBlocker({ ecuSw, securityMin });
    return { securityMin, blocker: blocked ? { code: 'SECURITY_MIN_VIOLATION', message: blocked, ref: ecuSw.map((s) => s.swId).join(',') } : null };
  }

  /** 승인 조합 등록(제안) — 차량 사양·Variant 담당. 보안 최소 버전 표 아래·표에 없는 ECU SW가 있으면 거부. 승인은 다른 사람(approveSet) */
  createSet(actor: Actor, body: CreateConfigSetBody) {
    const target = `${body.featureId}@${body.featureVersion}#config-set`;
    if (!this.features.get(body.featureId, body.featureVersion)) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.featureVersion}을(를) 찾을 수 없습니다.`);
    // 보안 최소 버전 하한 — 사이버보안 담당이 승인한 표가 정본, 요청 본문은 낮출 수 없다(빠뜨리거나 낮춘 값은 표 값으로 올린다)
    const { securityMin, blocker } = this.securityCheck(body.ecuSw, body.securityMin);
    if (blocker) {
      this.audit.failed(actor, 'CONFIG_SET_CREATE', target, blocker.message, 'D02-01');
      throw new DomainError('GUARD_FAILED', blocker.message, { blockers: [blocker] });
    }
    if (body.oddProfileId) {
      const p = this.profile(body.oddProfileId);
      if (p.status !== 'APPROVED') throw new DomainError('GUARD_FAILED', `ODD 프로파일 ${p.profileId}이(가) 승인 전입니다 — 승인된 프로파일만 조합에 묶습니다.`);
    }
    const n = this.db.all<{ set_id: string }>('SELECT set_id FROM ads_config_set WHERE feature_id = ?', body.featureId).length;
    const { reason, ...rest } = body;
    const doc: ConfigSet = { ...rest, securityMin, setId: `CFG-${body.featureId}-${String(n + 1).padStart(2, '0')}`, status: 'PROPOSED', proposedBy: actor.id, proposedAt: this.clock.iso(), approvedBy: null, approvedAt: null };
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_config_set (set_id, feature_id, feature_version, doc) VALUES (?, ?, ?, ?)', doc.setId, doc.featureId, doc.featureVersion, JSON.stringify(doc));
      this.audit.record(actor, 'CONFIG_SET_CREATE', doc.setId, { after: doc, reason, componentId: 'D02-01' });
      return doc;
    });
  }

  /** 조합 승인 — 기능안전 담당, 제안자 본인 거부(직무 분리), 승인 시점의 보안 최소 버전 표로 다시 검사 */
  approveSet(actor: Actor, id: string, body: ApproveConfigSetBody) {
    const set = this.set(id);
    const blocked = configSetApprovalBlocker(set, actor.id);
    if (blocked?.code === 'ALREADY_APPROVED') {
      this.audit.failed(actor, 'CONFIG_SET_APPROVE', id, blocked.message, 'D02-01');
      throw new DomainError('CONFLICT', blocked.message);
    }
    if (blocked) {
      this.audit.denied(actor, 'CONFIG_SET_APPROVE', id, blocked.message, 'D02-01');
      throw new DomainError('SEPARATION_OF_DUTY', blocked.message);
    }
    const sec = this.securityCheck(set.ecuSw, set.securityMin).blocker;
    if (sec) {
      this.audit.failed(actor, 'CONFIG_SET_APPROVE', id, sec.message, 'D02-01');
      throw new DomainError('GUARD_FAILED', sec.message, { blockers: [sec] });
    }
    const at = this.clock.iso();
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_config_set_approval (set_id, approved_by, approved_role, approved_at, reason) VALUES (?, ?, ?, ?, ?)', id, actor.id, actor.role, at, body.reason);
      this.audit.record(actor, 'CONFIG_SET_APPROVE', id, { before: { status: set.status, proposedBy: set.proposedBy }, after: { status: 'APPROVED' }, reason: body.reason, componentId: 'D02-01' });
      return this.set(id);
    });
  }

  // ── 보안 최소 버전 표(사이버보안 담당 승인) ──
  securityMins() {
    const entries = readSecurityMins(this.db);
    const current = securityMinTable(this.db);
    const used = new Set(this.allSets().flatMap((s) => s.ecuSw.map((x) => x.swId)));
    return { items: entries, current, pending: entries.filter((x) => x.status === 'PROPOSED').length, unregistered: [...used].filter((sw) => !current.some((m) => m.swId === sw)).sort() };
  }

  /** 제안 — 지금 하한보다 높은 값만(올리기만) */
  proposeSecurityMin(actor: Actor, body: ProposeSecurityMinBody) {
    const entries = readSecurityMins(this.db);
    const blocked = securityMinProposalBlocker(entries, body.swId, body.version);
    if (blocked) {
      this.audit.failed(actor, 'SECURITY_MIN_PROPOSE', body.swId, blocked.message, 'D02-01');
      throw new DomainError('GUARD_FAILED', blocked.message, { blockers: [{ code: blocked.code, message: blocked.message, ref: body.swId }] });
    }
    const entryId = `SMV-${String(entries.length + 1).padStart(4, '0')}`;
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_security_min (entry_id, sw_id, version, rationale, proposed_by, proposed_at) VALUES (?, ?, ?, ?, ?, ?)', entryId, body.swId, body.version, body.rationale, actor.id, this.clock.iso());
      this.audit.record(actor, 'SECURITY_MIN_PROPOSE', entryId, { after: { swId: body.swId, version: body.version }, reason: body.rationale, componentId: 'D02-01' });
      return readSecurityMins(this.db).find((x) => x.entryId === entryId)!;
    });
  }

  /** 승인 — 사이버보안 담당, 제안자 본인 거부, 그 사이 같거나 높은 값이 승인됐으면 거부 */
  approveSecurityMin(actor: Actor, id: string, body: ApproveSecurityMinBody) {
    const entries = readSecurityMins(this.db);
    const entry = entries.find((x) => x.entryId === id);
    if (!entry) throw new DomainError('NOT_FOUND', `보안 최소 버전 ${id}을(를) 찾을 수 없습니다.`);
    const blocked = securityMinApprovalBlocker(entries, entry, actor.id);
    if (blocked) {
      if (blocked.code === 'SELF_APPROVAL') this.audit.denied(actor, 'SECURITY_MIN_APPROVE', id, blocked.message, 'D02-01');
      else this.audit.failed(actor, 'SECURITY_MIN_APPROVE', id, blocked.message, 'D02-01');
      throw new DomainError(blocked.code === 'SELF_APPROVAL' ? 'SEPARATION_OF_DUTY' : blocked.code === 'ALREADY_APPROVED' ? 'CONFLICT' : 'GUARD_FAILED', blocked.message, { blockers: [{ code: blocked.code, message: blocked.message, ref: id }] });
    }
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_security_min_approval (entry_id, approved_by, approved_at, reason) VALUES (?, ?, ?, ?)', id, actor.id, this.clock.iso(), body.reason);
      this.audit.record(actor, 'SECURITY_MIN_APPROVE', id, { before: { status: 'PROPOSED' }, after: { status: 'APPROVED', swId: entry.swId, version: entry.version }, reason: body.reason, componentId: 'D02-01' });
      return readSecurityMins(this.db).find((x) => x.entryId === id)!;
    });
  }

  /** 조합 미검증 — 배포 중 정책이 있는 F0·F1 Feature Version 중 승인 조합이 없는 것(기존 Variant 규칙으로 허용, ADS-BE10) */
  private unverifiedCombos(sets: ConfigSet[]) {
    const withSet = new Set(sets.map((s) => `${s.featureId}@${s.featureVersion}`));
    const keys = [...new Set(this.policies.all().filter((x) => x.status === 'DEPLOYED').map((x) => `${x.featureId}@${x.featureVersion}`))].filter((k) => !withSet.has(k)).sort();
    const items = keys
      .map((k) => {
        const [featureId, version] = k.split('@');
        const sp = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version);
        const fClass = sp ? ((JSON.parse(sp.doc) as { fClass?: string }).fClass ?? null) : null;
        return { featureId, version, name: this.features.get(featureId, version)?.name ?? null, fClass };
      })
      .filter((x) => x.fClass === 'F0' || x.fClass === 'F1');
    return { count: items.length, items };
  }

  // ── 복구 결정(차량 1대, FFP-F039·F040) — 경로·근거·형상 참조, 이전 버전 복구는 후보 게시본의 메타데이터를 지금 기준으로 재검증 ──
  recoveryDecisions(vin?: string) {
    return this.db.all<{ doc: string }>(`SELECT doc FROM ads_recovery_decision${vin ? ' WHERE vin = ?' : ''} ORDER BY id`, ...(vin ? [vin] : [])).map((r) => JSON.parse(r.doc) as Record<string, unknown>);
  }
  private candidateMetadata(publicationId: string | null, set: ConfigSet) {
    if (!publicationId) return { keyNotAfter: null, keyEpoch: null, configSetRef: null };
    const r = this.db.get<{ doc: string }>('SELECT doc FROM publication WHERE publication_id = ?', publicationId);
    if (!r) throw new DomainError('NOT_FOUND', `복구 후보 게시본 ${publicationId}을(를) 찾을 수 없습니다.`);
    const pub = JSON.parse(r.doc) as Publication;
    const key = this.db.get<{ not_after: string }>('SELECT not_after FROM pki_key WHERE key_id = ?', pub.signature.keyId);
    const same = pub.payload.featureId === set.featureId && pub.payload.featureVersion === set.featureVersion;
    return { keyNotAfter: key?.not_after ?? null, keyEpoch: pub.build?.keyEpoch ?? 1, configSetRef: same ? set.setId : null };
  }
  createRecoveryDecision(actor: Actor, body: RecoveryDecisionBody) {
    if (!this.fleet.vehicle(body.vin)) throw new DomainError('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);
    const set = this.set(body.configSetRef);
    if (set.status !== 'APPROVED') throw new DomainError('GUARD_FAILED', `승인 조합 ${set.setId}이(가) 승인 전입니다 — 승인된 조합만 복구 기준으로 씁니다.`);
    if (body.path === 'RESTORE_PREVIOUS' && !body.candidatePublicationId) throw new DomainError('VALIDATION', '승인 조합으로 복구하려면 복구 후보 게시본(candidatePublicationId)을 고르세요.');
    const now = this.clock.now().getTime();
    const report = this.report(body.vin);
    const currentEpoch = Number(this.db.get<{ e: number | null }>("SELECT max(epoch) AS e FROM hsm_secret WHERE name = 'vehicle_root'")?.e ?? 1);
    const metadata = body.path === 'RESTORE_PREVIOUS' ? recoveryMetadataVerdict(this.candidateMetadata(body.candidatePublicationId, set), { now, currentEpoch, approvedSetIds: this.sets().map((s) => s.setId) }) : { ok: true, reasons: [] };
    const blockers = recoveryDecisionBlockers({ path: body.path, set, report, metadata, now });
    const target = `${body.vin}#recovery`;
    if (blockers.length) {
      const msg = blockers.map((b) => b.message).join(' · ');
      this.audit.failed(actor, 'RECOVERY_DECISION', target, msg, 'D02-01');
      throw new DomainError('GUARD_FAILED', `복구 결정을 저장할 수 없습니다: ${msg}`, { blockers });
    }
    const verdict = classifyVehicleConfig(set, report, now);
    const n = Number(this.db.get<{ n: number }>('SELECT count(*) AS n FROM ads_recovery_decision')!.n);
    const doc = { decisionId: `RCV-${String(n + 1).padStart(5, '0')}`, vin: body.vin, path: body.path, decidedBy: actor.id, decidedRole: actor.role, rationale: body.rationale, configSetRef: set.setId, candidatePublicationId: body.candidatePublicationId, decidedAt: this.clock.iso(), metadata, verdict: { cls: verdict.cls, code: verdict.code, reasons: verdict.reasons }, reactivation: reactivationCandidate(verdict) };
    return this.db.tx(() => {
      this.db.run('INSERT INTO ads_recovery_decision (decision_id, vin, path, decided_by, rationale, config_set_ref, decided_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', doc.decisionId, doc.vin, doc.path, doc.decidedBy, doc.rationale, doc.configSetRef, doc.decidedAt, JSON.stringify(doc));
      this.audit.record(actor, 'RECOVERY_DECISION', target, { after: { decisionId: doc.decisionId, path: doc.path, configSetRef: doc.configSetRef, cls: verdict.cls }, reason: body.rationale, componentId: 'D02-01' });
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

  @Post('config-sets/:id/approve')
  @Roles('SAFETY_OFFICER')
  @AuditAction('CONFIG_SET_APPROVE')
  approveSet(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ApproveConfigSetBody)) body: ApproveConfigSetBody) {
    return this.ads.approveSet(actor, id, body);
  }

  @Get('security-mins')
  securityMins() {
    return this.ads.securityMins();
  }

  @Post('security-mins')
  @Roles('SECURITY_OFFICER', 'VARIANT_OWNER')
  @AuditAction('SECURITY_MIN_PROPOSE')
  proposeSecurityMin(@CurrentActor() actor: Actor, @Body(new ZodPipe(ProposeSecurityMinBody)) body: ProposeSecurityMinBody) {
    return this.ads.proposeSecurityMin(actor, body);
  }

  @Post('security-mins/:id/approve')
  @Roles('SECURITY_OFFICER')
  @AuditAction('SECURITY_MIN_APPROVE')
  approveSecurityMin(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ApproveSecurityMinBody)) body: ApproveSecurityMinBody) {
    return this.ads.approveSecurityMin(actor, id, body);
  }

  @Get('config-sets/:id/vehicles')
  vehicles(@Param('id') id: string) {
    return this.ads.setVehicles(id);
  }

  @Post('odd-profiles/:id/sites')
  @Roles('FEATURE_AUTHOR', 'SAFETY_OFFICER')
  @AuditAction('ODD_SITE_REQUEST')
  addSite(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(CreateOddSiteBody)) body: CreateOddSiteBody) {
    return this.ads.addSite(actor, id, body);
  }

  @Post('odd-profiles/:id/sites/:siteId/approve')
  @Roles('SAFETY_OFFICER')
  @AuditAction('ODD_SITE_APPROVE')
  approveSite(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('siteId') siteId: string, @Body(new ZodPipe(ApproveOddSiteBody)) body: ApproveOddSiteBody) {
    return this.ads.approveSite(actor, id, siteId, body.reason);
  }

  @Get('config-sets/recovery-decisions')
  decisions(@Query('vin') vin?: string) {
    return { items: this.ads.recoveryDecisions(vin) };
  }

  @Post('config-sets/recovery-decisions')
  @Roles('OPS_LEAD', 'SAFETY_OFFICER')
  @AuditAction('RECOVERY_DECISION')
  decide(@CurrentActor() actor: Actor, @Body(new ZodPipe(RecoveryDecisionBody)) body: RecoveryDecisionBody) {
    return this.ads.createRecoveryDecision(actor, body);
  }
}

interface SiteRequest {
  siteId: string;
  profileId: string;
  name: string;
  kind: 'PARKING' | 'ZONE' | 'ROAD_SECTION';
  mapVersion: string;
  infraVersion: string;
  changeImpactRef: string | null;
  status: 'PENDING' | 'APPROVED';
  code: string | null;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}
