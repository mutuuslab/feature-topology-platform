// Feature 분류 보강·시장 기준선(ADS-BE16) — ADS 여부·DDT 영향·안전 관련성·담당·상태별 책임자와 시장별 승인 유형·규정 series·승인 ODD 프로파일.
// 완결성은 확정(CONFIRMED) 여부만 본다 — 출처(INFERRED)는 판정에 쓰지 않는다(추정값은 미분류로 센다).
// 출시 전이 거부 규칙(CLS_UNREGISTERED)은 분류 행이 있는 Version(분류 대상 등록)에 켠다 — 행이 없는 Version은 목록·사유만(전체 적용은 결정 대기, 설계 2단계 전환).
// 입력(Feature 작성자)·확정(기능안전 담당, 확정 서명 = 축 값·담당·상태별 책임자)·시장 기준선 입력(법규 담당)·상태별 책임자 지정 이력(추가만).
// 시드는 AdsChangeService(D06-05)가 data/fixtures/ads/change.json에서 싣는다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { classificationCompleteness, classificationConfirmHash, compareVersion, ConfirmClassificationBody, LIFECYCLE_OWNER_STATES, PutMarketBaselineBody, UpdateClassificationBody, type AdsClassification, type ClassificationView, type MarketBaseline, type UnclassifiedRow, type UnclassifiedView } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { createHash } from 'node:crypto';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { FeatureRepo } from '../repos';

/** 출시 전이 거부 규칙 대상이 아닌 상태 — 이미 출시했거나 중단·폐기한 Version */
const OUT_OF_SCOPE = new Set(['RELEASED', 'DEPRECATED', 'RETIRED']);

@Injectable()
@PlatformComponent('D01-01')
export class AdsClassificationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  get(featureId: string, version: string): AdsClassification | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_classification WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? (JSON.parse(r.doc) as AdsClassification) : null;
  }

  baselines(q: { featureId?: string; version?: string } = {}): MarketBaseline[] {
    const where: string[] = [];
    const args: string[] = [];
    if (q.featureId) where.push('feature_id = ?'), args.push(q.featureId);
    if (q.version) where.push('version = ?'), args.push(q.version);
    return this.db.all<{ doc: string }>(`SELECT doc FROM ads_market_baseline${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY feature_id, version, market`, ...args).map((r) => JSON.parse(r.doc) as MarketBaseline);
  }

  view(featureId: string, version: string): ClassificationView {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const c = this.get(featureId, version);
    const sp = this.db.get<{ status: string }>('SELECT status FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version);
    return { featureId, version, lifecycle: f.lifecycle, classification: c, completeness: classificationCompleteness(c), baselines: this.baselines({ featureId, version }), safetyProfileStatus: sp?.status ?? null, ruleEnabled: !!c, ownerHistory: this.ownerHistory(featureId, version) };
  }

  /** 미분류 Feature — 출시 전 Feature(최신 Version)의 축별 빈칸. 행이 없으면 모든 축이 빈칸 */
  unclassified(): UnclassifiedView {
    const latest = new Map<string, ReturnType<FeatureRepo['all']>[number]>();
    for (const f of this.features.all()) {
      const have = latest.get(f.featureId);
      if (!have || compareVersion(f.version, have.version) > 0) latest.set(f.featureId, f);
    }
    const scope = [...latest.values()].filter((f) => !OUT_OF_SCOPE.has(f.lifecycle));
    const items: UnclassifiedRow[] = [];
    for (const f of scope) {
      const c = classificationCompleteness(this.get(f.featureId, f.version));
      if (!c.classified) items.push({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, gaps: c.gaps, inferred: c.inferred });
    }
    items.sort((a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0));
    return { items, scope: scope.length, ruleEnabled: false };
  }

  /** 상태별 책임자 지정 이력(feature_lifecycle_owner) — 추가만 */
  ownerHistory(featureId: string, version: string) {
    return this.db
      .all<{ state: string; owner_id: string | null; assigned_at: string; assigned_by: string }>('SELECT state, owner_id, assigned_at, assigned_by FROM ads_lifecycle_owner WHERE feature_id = ? AND version = ? ORDER BY id', featureId, version)
      .map((r) => ({ state: r.state, ownerId: r.owner_id, assignedAt: r.assigned_at, assignedBy: r.assigned_by }));
  }

  private save(c: AdsClassification, insert: boolean) {
    if (insert) this.db.run('INSERT INTO ads_classification (feature_id, version, status, doc) VALUES (?, ?, ?, ?)', c.featureId, c.version, c.status, JSON.stringify(c));
    else this.db.run('UPDATE ads_classification SET status = ?, doc = ? WHERE feature_id = ? AND version = ?', c.status, JSON.stringify(c), c.featureId, c.version);
  }

  /** 분류 입력(Feature 작성자) — 출처는 MANUAL. 확정 서명 대상(축 값·담당·상태별 책임자)이 바뀌면 확정이 풀린다(재확정 필요) */
  update(actor: Actor, featureId: string, version: string, body: UpdateClassificationBody): ClassificationView {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const before = this.get(featureId, version);
    const lifecycleOwners = { ...(before?.lifecycleOwners ?? {}), ...body.lifecycleOwners };
    const draft: AdsClassification = { featureId, version, adsFeature: body.adsFeature, ddtImpact: body.ddtImpact, safetyRelated: body.safetyRelated, owner: body.owner, source: 'MANUAL', status: 'DRAFT', confirmedBy: null, confirmedAt: null, lifecycleOwners };
    const same = before?.status === 'CONFIRMED' && classificationConfirmHash(before) === classificationConfirmHash(draft);
    const next: AdsClassification & { confirmHash?: string | null } = same ? { ...before!, source: 'MANUAL' } : { ...draft, confirmHash: null };
    const now = this.clock.iso();
    return this.db.tx(() => {
      this.save(next, !before);
      for (const st of LIFECYCLE_OWNER_STATES) {
        const prev = before?.lifecycleOwners?.[st] ?? null;
        const cur = lifecycleOwners[st] ?? null;
        if (!before || prev !== cur) this.db.run('INSERT INTO ads_lifecycle_owner (feature_id, version, state, owner_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?, ?, ?)', featureId, version, st, cur, now, actor.id);
      }
      this.audit.record(actor, 'ADS_CLASSIFICATION_UPDATE', `${featureId}@${version}`, { before: before ? { status: before.status, adsFeature: before.adsFeature, ddtImpact: before.ddtImpact } : null, after: { status: next.status, adsFeature: next.adsFeature, ddtImpact: next.ddtImpact, reconfirmRequired: before?.status === 'CONFIRMED' && !same }, reason: body.reason, componentId: 'D01-01' });
      return this.view(featureId, version);
    });
  }

  /** 분류 확정(기능안전 담당) — 빈 축·상태별 책임자 미지정이면 거부, 확정 서명 = 확정 대상 필드의 정규 해시 */
  confirm(actor: Actor, featureId: string, version: string, reason: string): ClassificationView {
    const c = this.get(featureId, version);
    if (!c) throw new DomainError('NOT_FOUND', `${featureId} ${version}의 분류 입력이 없습니다 — Feature 작성자가 먼저 입력합니다.`);
    if (c.status === 'CONFIRMED') throw new DomainError('CONFLICT', '이미 확정된 분류입니다 — 바꾸려면 분류를 다시 입력하세요.');
    const gaps = classificationCompleteness({ ...c, status: 'CONFIRMED' }).gaps;
    const target = `${featureId}@${version}`;
    if (gaps.length) {
      const label: Record<string, string> = { ADS: 'ADS 여부', DDT: 'DDT 영향', SAFETY: '안전 관련성', OWNER: '담당', LIFECYCLE_OWNER: '상태별 책임자' };
      const msg = `분류 빈칸이 남아 확정할 수 없습니다 — ${gaps.map((g) => label[g] ?? g).join('·')}`;
      this.audit.failed(actor, 'ADS_CLASSIFICATION_CONFIRM', target, msg, 'D01-01');
      throw new DomainError('GUARD_FAILED', msg, { gaps });
    }
    const next = { ...c, status: 'CONFIRMED' as const, confirmedBy: actor.id, confirmedAt: this.clock.iso(), confirmHash: `sha256:${createHash('sha256').update(classificationConfirmHash(c)).digest('hex')}` };
    return this.db.tx(() => {
      this.save(next, false);
      this.audit.record(actor, 'ADS_CLASSIFICATION_CONFIRM', target, { before: { status: c.status }, after: { status: next.status, confirmHash: next.confirmHash }, reason, componentId: 'D01-01' });
      return this.view(featureId, version);
    });
  }

  /** 시장 기준선 입력(법규 담당) — 승인 ODD 프로파일은 같은 Feature Version의 승인 프로파일만 */
  putBaseline(actor: Actor, featureId: string, version: string, market: string, body: PutMarketBaselineBody): MarketBaseline {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    if (!/^[A-Z]{2,6}$/.test(market)) throw new DomainError('VALIDATION', `시장 코드 ${market} 형식이 맞지 않습니다.`);
    if (body.oddProfileRef) {
      const p = this.db.get<{ status: string; feature_id: string; feature_version: string }>('SELECT status, feature_id, feature_version FROM ads_odd_profile WHERE profile_id = ?', body.oddProfileRef);
      if (!p || p.status !== 'APPROVED' || p.feature_id !== featureId || p.feature_version !== version) throw new DomainError('GUARD_FAILED', `승인 ODD ${body.oddProfileRef}은(는) ${featureId} ${version}의 승인된 ODD 프로파일이 아닙니다.`);
    }
    const before = this.baselines({ featureId, version }).find((b) => b.market === market) ?? null;
    const { reason, ...rest } = body;
    const doc: MarketBaseline = { market, featureId, version, approvalType: rest.approvalType, regulations: rest.regulations, oddProfileRef: rest.oddProfileRef ?? null, approvalStatus: rest.approvalStatus, note: rest.note ?? null, assumed: false };
    return this.db.tx(() => {
      if (before) this.db.run('UPDATE ads_market_baseline SET doc = ? WHERE feature_id = ? AND version = ? AND market = ?', JSON.stringify(doc), featureId, version, market);
      else this.db.run('INSERT INTO ads_market_baseline (feature_id, version, market, doc) VALUES (?, ?, ?, ?)', featureId, version, market, JSON.stringify(doc));
      this.audit.record(actor, 'ADS_MARKET_BASELINE_PUT', `${featureId}@${version}#${market}`, { before: before ? { approvalStatus: before.approvalStatus, oddProfileRef: before.oddProfileRef } : null, after: { approvalStatus: doc.approvalStatus, oddProfileRef: doc.oddProfileRef, approvalType: doc.approvalType }, reason, componentId: 'D01-01' });
      return doc;
    });
  }
}

@Controller('api')
export class AdsClassificationController {
  constructor(private readonly svc: AdsClassificationService) {}

  @Get('features/:id/versions/:ver/classification')
  view(@Param('id') id: string, @Param('ver') ver: string) {
    return this.svc.view(id, ver);
  }

  @Get('classification/unclassified')
  unclassified() {
    return this.svc.unclassified();
  }

  @Get('market-baselines')
  baselines(@Query('featureId') featureId?: string, @Query('version') version?: string) {
    return { items: this.svc.baselines({ featureId, version }) };
  }

  @Put('features/:id/versions/:ver/classification')
  @Roles('FEATURE_AUTHOR')
  @AuditAction('ADS_CLASSIFICATION_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(UpdateClassificationBody)) body: UpdateClassificationBody) {
    return this.svc.update(actor, id, ver, body);
  }

  @Post('features/:id/versions/:ver/classification/confirm')
  @Roles('SAFETY_OFFICER')
  @AuditAction('ADS_CLASSIFICATION_CONFIRM')
  confirm(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(ConfirmClassificationBody)) body: ConfirmClassificationBody) {
    return this.svc.confirm(actor, id, ver, body.reason);
  }

  @Put('market-baselines/:id/:ver/:market')
  @HttpCode(200)
  @Roles('REGULATORY_OWNER')
  @AuditAction('ADS_MARKET_BASELINE_PUT')
  putBaseline(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Param('market') market: string, @Body(new ZodPipe(PutMarketBaselineBody)) body: PutMarketBaselineBody) {
    return this.svc.putBaseline(actor, id, ver, market, body);
  }
}
