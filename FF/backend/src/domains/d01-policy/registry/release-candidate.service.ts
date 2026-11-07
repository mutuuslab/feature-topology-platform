// 출시 후보 통합 스냅샷(P10, D01-01 · FR-REG-005-015) — 출시(VERIFIED→RELEASED)가 승인되면 같은 트랜잭션에서
// Feature·요구·Variant·정책·Test Evidence를 한 문서로 남긴다(추가만, Version당 1건, 내용 해시). 조회 때 해시를 다시 계산해 맞는지 보인다.
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import { releaseCandidateCanonical, snapshotContent, type FeatureVersionRow, type ReleaseCandidateBaseline, type ReleaseCandidateContent } from '@ff/contracts';
import { createHash } from 'node:crypto';
import type { Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo, GateRepo } from '../repos';
import { TraceLinkRepo } from './trace-link.repo';

const hashOf = (c: ReleaseCandidateContent) => 'sha256:' + createHash('sha256').update(releaseCandidateCanonical(c)).digest('hex');

@Injectable()
@PlatformComponent('D01-01')
export class ReleaseCandidateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly policies: PolicyRepo,
    private readonly traces: TraceLinkRepo,
    private readonly clock: Clock,
  ) {}

  content(f: FeatureVersionRow): ReleaseCandidateContent {
    const links = this.traces.list({ featureId: f.featureId, status: 'ACTIVE' });
    const evidence = this.traces.evidence({ featureId: f.featureId });
    const latest = this.gates.latest(f.featureId, f.version);
    return {
      feature: snapshotContent(f),
      baselineId: f.baselineId,
      requirements: { ids: f.requirementIds, links: links.filter((l) => l.kind === 'REQUIREMENT').map((l) => ({ elementId: l.elementId, elementVersion: l.elementVersion, sourceSystem: l.sourceSystem })) },
      variant: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, upgVc: f.upgVc },
      policies: this.policies
        .forFeature(f.featureId, f.version)
        .filter((p) => p.status === 'APPROVED' || p.status === 'DEPLOYED')
        .map((p) => ({ policyId: p.policyId, revision: p.revision, flagKey: p.flagKey, controlPoint: p.controlPoint, status: p.status, contentHash: p.contentHash })),
      testEvidence: {
        gates: Object.values(latest).map((g) => ({ gate: g!.gate, gateRecordId: g!.gateRecordId, status: g!.status, evidenceRef: g!.evidenceRef })),
        tests: links
          .filter((l) => l.kind === 'TEST_CASE')
          .map((l) => ({ testCaseId: l.elementId, required: l.required, evidence: evidence.filter((e) => e.linkId === l.linkId).map((e) => ({ evidenceId: e.evidenceId, result: e.result, executedAt: e.executedAt })) })),
      },
    };
  }

  /** 출시 전이와 같은 트랜잭션에서 부른다 — f는 RELEASED로 바뀐 행 */
  create(actor: Actor, f: FeatureVersionRow, reason: string): ReleaseCandidateBaseline {
    const existing = this.find(f.featureId, f.version);
    if (existing) return existing;
    const n = (this.db.get<{ n: number }>('SELECT count(*) AS n FROM release_candidate_baseline')?.n ?? 0) + 1;
    const content = this.content(f);
    const r: ReleaseCandidateBaseline = { rcbId: `RCB-${String(n).padStart(5, '0')}`, featureId: f.featureId, version: f.version, contentHash: hashOf(content), createdAt: this.clock.iso(), createdBy: actor.id, reason, content };
    this.db.run('INSERT INTO release_candidate_baseline (rcb_id, feature_id, version, content_hash, created_at, doc) VALUES (?, ?, ?, ?, ?, ?)', r.rcbId, r.featureId, r.version, r.contentHash, r.createdAt, JSON.stringify(r));
    return r;
  }

  find(featureId: string, version: string): ReleaseCandidateBaseline | null {
    const row = this.db.get<{ doc: string }>('SELECT doc FROM release_candidate_baseline WHERE feature_id = ? AND version = ?', featureId, version);
    return row ? JSON.parse(row.doc) : null;
  }

  /** 조회 — Version이 없으면 NOT_FOUND, 출시 전이면 스냅샷 null(아직 출시 승인 전) */
  get(featureId: string, version: string) {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const r = this.find(featureId, version);
    return { snapshot: r, verified: r ? hashOf(r.content) === r.contentHash : null };
  }

  list(featureId?: string): ReleaseCandidateBaseline[] {
    const rows = featureId ? this.db.all<{ doc: string }>('SELECT doc FROM release_candidate_baseline WHERE feature_id = ? ORDER BY rcb_id', featureId) : this.db.all<{ doc: string }>('SELECT doc FROM release_candidate_baseline ORDER BY rcb_id');
    return rows.map((x) => JSON.parse(x.doc));
  }
}

@Controller('api')
export class ReleaseCandidateController {
  constructor(private readonly svc: ReleaseCandidateService) {}

  @Get('features/:id/versions/:ver/release-candidate')
  get(@Param('id') id: string, @Param('ver') ver: string) {
    return this.svc.get(id, ver);
  }

  @Get('release-candidates')
  list(@Query('featureId') featureId?: string) {
    return { items: this.svc.list(featureId || undefined) };
  }
}
