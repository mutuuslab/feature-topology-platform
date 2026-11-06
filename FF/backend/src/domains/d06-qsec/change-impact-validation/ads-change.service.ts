// ADS 변경 영향(ADS-BE08) — 변경 종류를 diff 사실로 산출하고(선언값보다 무거우면 승격), 종류별 필수 승인 경로(재-HARA·R156 영향·SUMS·Safety Case)와
// 미완료 항목을 낸다. 릴리스 비교(ADS-UI09) — 대상·의존 Feature·운행 조건 축별 확대/축소·종료 동작(DC·대체 동작·MRC 계약).
// 출시·배포·서명을 실제로 막는 서버 거부는 결함 ADS-BE06(다른 작업) — 여기서는 사유(reharaOpenAfterRelease)만 읽기로 낸다.
// 시드: data/fixtures/ads/change.json(빈 표 + FF_SEED≠none + Feature가 있을 때만, 한 트랜잭션). 시각은 시드 시각 기준 상대값.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  ADS_IMPACT_PATHS,
  AdsChangeFixture,
  classifyChange,
  CloseImpactPathBody,
  compareVersion,
  changedKeys,
  diffSummary,
  factsFromDiff,
  gatesToRejudge,
  openPathCounts,
  parseReleaseId,
  PATH_CLOSER,
  PATH_CLOSER_ROLES,
  pathItems,
  releaseDiff,
  releaseId,
  type AdsChangeImpactList,
  type AdsChangeImpactView,
  type AdsImpactPath,
  type AdsImpactPathItem,
  type AdsReleaseSeed,
  type Lifecycle,
  type ReleaseDiffView,
  type ReleaseListItem,
  type ReleaseSnapshot,
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
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { ReharaRepo } from '../../d01-policy/topology/rehara.repo';
import { isProduction, seedOf } from '../../../kernel/runtime-config';

/** 커밋된 ADS 변경 시드 — repo 루트 기준 */
export const ADS_CHANGE_FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'change.json');

type Recorded = Partial<Record<AdsImpactPath, Partial<Omit<AdsImpactPathItem, 'path' | 'closer'>>>>;
interface ImpactDoc {
  impactId: string;
  featureId: string;
  version: string;
  baseVersion: string | null;
  title: string;
  declaredKind: AdsChangeImpactView['declaredKind'];
  facts: AdsChangeImpactView['facts'];
  paths: Recorded;
  scopeStatus: AdsChangeImpactView['scopeStatus'];
  assignee: string | null;
  openedAt: string;
}

const hoursAgo = (now: Date, h: number | null | undefined) => (h == null ? null : new Date(now.getTime() - h * 3600_000).toISOString());

@Injectable()
@PlatformComponent('D06-05')
export class AdsChangeService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly rehara: ReharaRepo,
    private readonly profiles: SafetyProfileService,
  ) {}

  /** 빈 표면 커밋된 시드를 싣는다 — 변경 영향·릴리스 스냅샷·분류·시장 기준선·확대 판정 입력(한 파일, 한 트랜잭션) */
  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(ADS_CHANGE_FIXTURE) || this.db.get('SELECT 1 FROM ads_change_impact LIMIT 1')) return;
    const fx = AdsChangeFixture.parse(JSON.parse(readFileSync(ADS_CHANGE_FIXTURE, 'utf8')));
    const now = this.clock.now();
    const has = (featureId: string, version: string) => !!this.features.get(featureId, version);
    this.db.tx(() => {
      for (const s of fx.changeImpacts) {
        if (!has(s.featureId, s.version)) continue;
        const paths: Recorded = {};
        for (const [p, r] of Object.entries(s.paths) as [AdsImpactPath, NonNullable<(typeof s.paths)[AdsImpactPath]>][]) {
          paths[p] = { status: r.status, note: r.note, ref: r.ref, closedBy: r.closedBy, closedAt: hoursAgo(now, r.closedAgoHours) };
        }
        const doc: ImpactDoc = { impactId: s.impactId, featureId: s.featureId, version: s.version, baseVersion: s.baseVersion, title: s.title, declaredKind: s.declaredKind, facts: s.facts, paths, scopeStatus: s.scopeStatus, assignee: s.assignee, openedAt: hoursAgo(now, s.openedAgoHours)! };
        this.db.run('INSERT INTO ads_change_impact (impact_id, feature_id, version, doc) VALUES (?, ?, ?, ?)', s.impactId, s.featureId, s.version, JSON.stringify(doc));
      }
      for (const r of fx.releases) if (has(r.featureId, r.version)) this.db.run('INSERT INTO ads_release_snapshot (feature_id, version, doc) VALUES (?, ?, ?)', r.featureId, r.version, JSON.stringify(r));
      for (const c of fx.classifications) {
        if (!has(c.featureId, c.version)) continue;
        const { confirmedAgoHours, ...rest } = c;
        const doc = { ...rest, confirmedAt: hoursAgo(now, confirmedAgoHours) };
        this.db.run('INSERT INTO ads_classification (feature_id, version, status, doc) VALUES (?, ?, ?, ?)', c.featureId, c.version, c.status, JSON.stringify(doc));
      }
      for (const b of fx.marketBaselines) if (has(b.featureId, b.version)) this.db.run('INSERT INTO ads_market_baseline (feature_id, version, market, doc) VALUES (?, ?, ?, ?)', b.featureId, b.version, b.market, JSON.stringify(b));
      for (const e of fx.expansions) {
        if (!has(e.featureId, e.version)) continue;
        const doc = {
          ...e,
          metrics: e.metrics.map(({ observedAgoMinutes, staleAfterMinutes, ...m }) => ({ ...m, observedAt: observedAgoMinutes == null ? null : new Date(now.getTime() - observedAgoMinutes * 60_000).toISOString(), staleAfterMs: staleAfterMinutes * 60_000 })),
          frozen: e.frozen ? { reason: e.frozen.reason, scope: e.frozen.scope, by: e.frozen.by, at: hoursAgo(now, e.frozen.agoHours)! } : null,
        };
        this.db.run('INSERT INTO ads_expansion_input (feature_id, version, doc) VALUES (?, ?, ?)', e.featureId, e.version, JSON.stringify(doc));
      }
    });
  }

  private docs(featureId?: string): ImpactDoc[] {
    const rows = featureId
      ? this.db.all<{ doc: string }>('SELECT doc FROM ads_change_impact WHERE feature_id = ? ORDER BY impact_id', featureId)
      : this.db.all<{ doc: string }>('SELECT doc FROM ads_change_impact ORDER BY impact_id');
    return rows.map((r) => JSON.parse(r.doc) as ImpactDoc);
  }

  /** 종결 원장(추가만) — 시드 기록 위에 덮는다 */
  private closures(impactId: string): Recorded {
    const out: Recorded = {};
    for (const r of this.db.all<{ path: AdsImpactPath; closed_by: string; closed_at: string; doc: string }>('SELECT path, closed_by, closed_at, doc FROM ads_impact_path_close WHERE impact_id = ?', impactId)) {
      const d = JSON.parse(r.doc) as { reason: string; ref: string | null };
      out[r.path] = { status: 'DONE', note: d.reason, ref: d.ref, closedBy: r.closed_by, closedAt: r.closed_at };
    }
    return out;
  }

  private view(d: ImpactDoc): AdsChangeImpactView {
    const f = this.features.get(d.featureId, d.version);
    const cls = classifyChange(d.facts, d.declaredKind);
    const paths = pathItems(cls, { ...d.paths, ...this.closures(d.impactId) });
    const reharaRequestIds = this.rehara.list({ featureId: d.featureId, featureVersion: d.version, status: 'OPEN' }).map((r) => r.requestId);
    const reharaOpen = paths.some((p) => p.path === 'REHARA' && p.status === 'OPEN') || reharaRequestIds.length > 0;
    // 다시 판정할 Gate — 직전 Version과 바뀐 속성(상세설계서 표 7) + 재-HARA 경로가 있으면 G2
    const base = d.baseVersion ? this.features.get(d.featureId, d.baseVersion) : undefined;
    const gates = new Set<string>(base && f ? gatesToRejudge(changedKeys(base, f), f.lifecycle as Lifecycle) : []);
    if (cls.paths.includes('REHARA') && paths.some((p) => p.path === 'REHARA' && p.status === 'OPEN')) gates.add('G2');
    return {
      impactId: d.impactId,
      featureId: d.featureId,
      version: d.version,
      baseVersion: d.baseVersion,
      name: f?.name ?? d.featureId,
      lifecycle: f?.lifecycle ?? null,
      policyId: null,
      title: d.title,
      declaredKind: d.declaredKind,
      facts: d.facts,
      cls,
      paths,
      scopeStatus: d.scopeStatus,
      assignee: d.assignee,
      openedAt: d.openedAt,
      reharaOpenAfterRelease: f?.lifecycle === 'RELEASED' && reharaOpen,
      reharaRequestIds,
      rejudgeGates: [...gates].sort(),
    };
  }

  list(q: { featureId?: string; status?: string } = {}): AdsChangeImpactList {
    let items = this.docs(q.featureId).map((d) => this.view(d));
    // OPEN — 끝나지 않은 경로가 있거나 종류를 판단할 수 없는 변경
    if (q.status === 'OPEN') items = items.filter((v) => v.cls.primary === 'UNKNOWN' || v.paths.some((p) => p.status === 'OPEN'));
    if (q.status === 'DONE') items = items.filter((v) => v.cls.primary !== 'UNKNOWN' && v.paths.every((p) => p.status !== 'OPEN'));
    return { items, counts: openPathCounts(items), rejudgeGates: items.reduce((a, v) => a + v.rejudgeGates.length, 0), assumed: true };
  }

  /** 승인 경로 종결 — 경로마다 정해진 역할만(재-HARA·Safety Case = 기능안전 담당자, R156·SUMS = 사이버보안 담당자). 판단 불가 변경은 종류부터 정한다 */
  close(actor: Actor, impactId: string, path: string, body: CloseImpactPathBody) {
    if (!(ADS_IMPACT_PATHS as readonly string[]).includes(path)) throw new DomainError('VALIDATION', `알 수 없는 승인 경로입니다: ${path}`);
    const p = path as AdsImpactPath;
    const d = this.docs().find((x) => x.impactId === impactId);
    if (!d) throw new DomainError('NOT_FOUND', `${impactId}이(가) 없습니다.`);
    if (actor.role !== PATH_CLOSER[p]) {
      const why = `이 승인 경로는 ${PATH_CLOSER[p] === 'SAFETY_OFFICER' ? '기능안전 담당자' : '사이버보안 담당자'}만 종결할 수 있습니다.`;
      // 경로 담당이 아닌 거부도 감사 이력에 남긴다(가드가 아닌 서비스 판정이라 직접)
      this.audit.denied(actor, 'ADS_IMPACT_PATH_CLOSE', `${impactId}/${p}`, why, 'D06-05');
      throw new DomainError('FORBIDDEN', why);
    }
    const before = this.view(d);
    if (before.cls.primary === 'UNKNOWN') throw new DomainError('PRECONDITION_FAILED', '변경 종류를 판단할 수 없어 승인 경로를 종결할 수 없습니다 — 바뀐 ECU·모델 정보를 먼저 입력하세요.');
    const item = before.paths.find((x) => x.path === p)!;
    if (item.status !== 'OPEN') throw new DomainError('CONFLICT', item.status === 'DONE' ? '이미 종결된 승인 경로입니다.' : '이 변경에는 필요 없는 승인 경로입니다.');
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO ads_impact_path_close (impact_id, path, closed_by, closed_at, doc) VALUES (?, ?, ?, ?, ?)', impactId, p, actor.id, at, JSON.stringify({ reason: body.reason, ref: body.ref ?? null }));
      this.audit.record(actor, 'ADS_IMPACT_PATH_CLOSE', `${impactId}/${p}`, { before: { status: 'OPEN' }, after: { status: 'DONE', ref: body.ref ?? null }, reason: body.reason, componentId: 'D06-05' });
    });
    return this.view(d);
  }

  /* ── 릴리스 비교 ── */

  private seedRelease(featureId: string, version: string): AdsReleaseSeed | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_release_snapshot WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? (JSON.parse(r.doc) as AdsReleaseSeed) : null;
  }

  /** 스냅샷 — 대상·의존 Feature는 Feature 원장에서, 운행 조건·종료 동작은 릴리스 시드에서(DC는 없으면 안전 분류) */
  snapshot(featureId: string, version: string): ReleaseSnapshot {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const s = this.seedRelease(featureId, version);
    const deps = this.topology
      .outgoing(featureId, version)
      .map((d) => `${d.targetFeatureId}@${d.targetVersion ?? '—'}`)
      .sort();
    const prof = this.profiles.list(featureId).find((x) => x.version === version) ?? null;
    return {
      featureId,
      version,
      targets: [`${f.country} · ${f.vehicleModel} · ${f.trim}`],
      dependencies: deps,
      odd: s?.odd ?? {},
      termination: { dc: s?.termination.dc ?? prof?.deactClass ?? null, fallback: s?.termination.fallback ?? null, mrc: s?.termination.mrc ?? null },
    };
  }

  private baseOf(featureId: string, version: string): string | null {
    return (
      this.features
        .versions(featureId)
        .map((v) => v.version)
        .filter((v) => compareVersion(v, version) < 0)
        .sort(compareVersion)
        .at(-1) ?? null
    );
  }

  releases(): { items: ReleaseListItem[] } {
    const rows = this.db.all<{ feature_id: string; version: string }>('SELECT feature_id, version FROM ads_release_snapshot ORDER BY feature_id, version');
    const items: ReleaseListItem[] = [];
    for (const r of rows) {
      const base = this.baseOf(r.feature_id, r.version);
      if (!base || !this.seedRelease(r.feature_id, base)) continue;
      const v = this.diff(releaseId(r.feature_id, r.version));
      items.push({ releaseId: v.releaseId, featureId: r.feature_id, version: r.version, baseVersion: base, name: v.name, primaryKind: v.cls.primary });
    }
    return { items };
  }

  diff(id: string, baseVersion?: string): ReleaseDiffView {
    const k = parseReleaseId(id);
    if (!k) throw new DomainError('VALIDATION', '릴리스 ID 형식은 FEAT-xxxxx-버전입니다(예 FEAT-00004-4.1.0).');
    const f = this.features.get(k.featureId, k.version);
    if (!f) throw new DomainError('NOT_FOUND', `${k.featureId} ${k.version}이(가) 없습니다.`);
    const base = baseVersion || this.baseOf(k.featureId, k.version);
    if (!base) throw new DomainError('NOT_FOUND', `${k.featureId} ${k.version}의 비교할 직전 Version이 없습니다.`);
    const before = this.snapshot(k.featureId, base);
    const after = this.snapshot(k.featureId, k.version);
    const rows = releaseDiff(before, after);
    const prev = this.features.get(k.featureId, base);
    const s = this.seedRelease(k.featureId, k.version);
    // SW 변경은 Feature 원장의 SW·Version으로, 모델·설정 변경은 시드(diff로 알 수 없음 — 없으면 정보 없음)
    const swChanged = prev ? JSON.stringify([prev.swIds, prev.swVersions]) !== JSON.stringify([f.swIds, f.swVersions]) : null;
    const cls = classifyChange(factsFromDiff(rows, { swChanged, modelChanged: s?.extra.modelChanged ?? null, configChanged: s?.extra.configChanged ?? null }));
    return { releaseId: releaseId(k.featureId, k.version), featureId: k.featureId, name: f.name, before, after, rows, summary: diffSummary(rows), cls, assumed: true };
  }
}

@Controller('api/change-impacts')
export class AdsChangeImpactController {
  constructor(private readonly svc: AdsChangeService) {}

  @Get()
  list(@Query('featureId') featureId?: string, @Query('status') status?: string) {
    return this.svc.list({ featureId, status });
  }

  @Post(':id/paths/:path/close')
  @Roles(...PATH_CLOSER_ROLES)
  @AuditAction('ADS_IMPACT_PATH_CLOSE')
  close(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('path') path: string, @Body(new ZodPipe(CloseImpactPathBody)) body: CloseImpactPathBody) {
    return this.svc.close(actor, id, path, body);
  }
}

@Controller('api/releases')
export class AdsReleaseController {
  constructor(private readonly svc: AdsChangeService) {}

  @Get()
  list() {
    return this.svc.releases();
  }

  @Get(':id/diff')
  diff(@Param('id') id: string, @Query('base') base?: string) {
    return this.svc.diff(id, base);
  }
}
