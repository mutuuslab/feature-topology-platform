// Feature·관계 초안 삭제(P10, D01-01·D01-02 · 결정 D2 (b), F0 공용 규칙) — 승인 전 초안만 지운다. 승인 이력·참조가 있으면 폐기(즉시 폐기)·미사용 표시로 안내.
//  · Feature Version(PROPOSED): 작성자만(이관 시드처럼 작성자가 없으면 Feature 작성자 역할), Gate PASS·N/A·정의 승인 이력이 있거나
//    정책·상품·관계·Gate 판정·분석 근거·반려 기록·추적 연결·폐기 요청이 참조하면 거부(FR-REG-001-013·014)
//  · 관계(원천이 PROPOSED): 원천 Version 초안과 함께만 바뀐다 — 지우면 원천의 dependencyIds에서도 빠진다(FR-DEP-001-005)
//  · 지운 ID는 묘비로 남아 다시 쓰지 않는다(FeatureRepo.nextFeatureId·TopologyRepo.nextId가 묘비를 본다)
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Query } from '@nestjs/common';
import { DeleteDraftBody, type DraftFacts } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DraftDeletionService } from '../../../kernel/draft-deletion';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../policy-repos';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo, TopologyRepo } from '../repos';
import { TraceLinkRepo } from './trace-link.repo';

export const FEATURE_DRAFT_ENTITY = 'feature-version';
export const RELATION_DRAFT_ENTITY = 'feature-relation';

@Injectable()
@PlatformComponent('D01-01')
export class FeatureDraftService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly policies: PolicyRepo,
    private readonly traces: TraceLinkRepo,
    private readonly refdb: RefdbRepository,
    private readonly drafts: DraftDeletionService,
    private readonly audit: AuditService,
  ) {}

  /** 삭제 판정 사실 — 화면이 버튼을 미리 막을 때도 같은 사실을 본다 */
  featureFacts(featureId: string, version: string): DraftFacts {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const target = `${featureId}@${version}`;
    const gates = this.db.all<{ gate_record_id: string; status: string }>('SELECT gate_record_id, status FROM gate_record WHERE feature_id = ? AND feature_version = ? ORDER BY gate_record_id', featureId, version);
    const approvedTransitions = this.db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE target = ? AND action LIKE 'FEATURE_TRANSITION PROPOSED→%' AND result = 'ALLOWED'", target)?.n ?? 0;
    const approvals = gates.filter((g) => g.status === 'PASS' || g.status === 'N/A').length + approvedTransitions;
    const versions = this.features.versions(featureId);
    const refs: { kind: string; id: string }[] = [
      ...this.policies.forFeature(featureId, version).map((p) => ({ kind: '정책', id: p.policyId })),
      ...(f.catalogIds ?? []).map((c) => ({ kind: '상품', id: c })),
      ...this.topology.outgoing(featureId, version).map((d) => ({ kind: '관계', id: d.dependencyId })),
      ...this.topology.incoming(featureId).filter((d) => d.targetVersion === version || (!d.targetVersion && versions.length === 1)).map((d) => ({ kind: '관계', id: d.dependencyId })),
      ...gates.filter((g) => g.status !== 'PASS' && g.status !== 'N/A').map((g) => ({ kind: 'Gate 판정', id: g.gate_record_id })),
      ...this.db.all<{ record_id: string }>('SELECT record_id FROM analysis_record WHERE feature_id = ? AND feature_version = ?', featureId, version).map((r) => ({ kind: '분석 근거', id: r.record_id })),
      ...this.db.all<{ record_id: string }>('SELECT record_id FROM feature_review_record WHERE feature_id = ? AND version = ?', featureId, version).map((r) => ({ kind: '반려 기록', id: r.record_id })),
      ...this.db.all<{ request_id: string }>("SELECT request_id FROM feature_retire_request WHERE feature_id = ? AND version = ? AND status = 'PENDING'", featureId, version).map((r) => ({ kind: '폐기 요청', id: r.request_id })),
      ...(versions.length === 1 ? this.traces.list({ featureId, status: 'ACTIVE' }).map((l) => ({ kind: '추적 연결', id: l.linkId })) : []),
    ];
    return { status: f.lifecycle, draftStatuses: ['PROPOSED'], approvals, references: refs };
  }

  private requireAuthor(actor: Actor, featureId: string, version: string) {
    const createdBy = this.features.meta(featureId, version).createdBy;
    if (createdBy && createdBy !== actor.id) {
      const msg = `이 Version은 작성자(${createdBy})만 지울 수 있습니다.`;
      this.audit.denied(actor, 'FEATURE_VERSION_DRAFT_DELETE', `${featureId}@${version}`, msg, 'D01-01');
      throw new DomainError('FORBIDDEN', msg);
    }
  }

  /** @req FR-REG-001-013 FR-REG-001-014 — 초안 Feature Version 삭제 */
  deleteFeature(actor: Actor, featureId: string, version: string, body: DeleteDraftBody) {
    const facts = this.featureFacts(featureId, version);
    this.requireAuthor(actor, featureId, version);
    const snapshot = this.features.get(featureId, version);
    return this.drafts.deleteDraft(actor, {
      entity: FEATURE_DRAFT_ENTITY,
      recordId: `${featureId}@${version}`,
      facts,
      snapshot,
      reason: body.reason,
      componentId: 'D01-01',
      remove: () => {
        this.refdb.replaceLinks(featureId, version, []);
        for (const t of ['feature_variability', 'safety_profile']) this.db.run(`DELETE FROM ${t} WHERE feature_id = ? AND version = ?`, featureId, version);
        this.db.run('DELETE FROM feature_function WHERE feature_id = ? AND feature_version = ?', featureId, version);
        this.features.delete(featureId, version);
      },
    });
  }

  relationFacts(dependencyId: string): DraftFacts {
    const d = this.topology.get(dependencyId);
    if (!d) throw new DomainError('NOT_FOUND', `${dependencyId}을(를) 찾을 수 없습니다.`);
    const source = this.features.get(d.sourceFeatureId, d.sourceVersion);
    if (!source) throw new DomainError('NOT_FOUND', `관계의 원천 ${d.sourceFeatureId} ${d.sourceVersion}을(를) 찾을 수 없습니다.`);
    // 원천 Gate가 승인됐던 관계와 다른 Version이 참조하는 관계는 기록을 보존한다(D2).
    const approvals = this.featureFacts(d.sourceFeatureId, d.sourceVersion).approvals;
    const references = this.features.all()
      .filter((f) => !(f.featureId === d.sourceFeatureId && f.version === d.sourceVersion) && f.dependencyIds.includes(dependencyId))
      .map((f) => ({ kind: 'Feature Version', id: `${f.featureId}@${f.version}` }));
    return { status: source.lifecycle, draftStatuses: ['PROPOSED'], approvals, references };
  }

  /** @req FR-DEP-001-005 — 원천이 초안(PROPOSED)인 관계 삭제, 원천 Version의 관계 목록에서도 뺀다 */
  deleteRelation(actor: Actor, dependencyId: string, body: DeleteDraftBody) {
    const facts = this.relationFacts(dependencyId);
    const d = this.topology.get(dependencyId)!;
    return this.drafts.deleteDraft(actor, {
      entity: RELATION_DRAFT_ENTITY,
      recordId: dependencyId,
      facts,
      snapshot: d,
      reason: body.reason,
      componentId: 'D01-02',
      remove: () => {
        this.topology.delete(dependencyId);
        const s = this.features.get(d.sourceFeatureId, d.sourceVersion);
        if (s) this.features.update({ ...s, dependencyIds: s.dependencyIds.filter((x) => x !== dependencyId) });
      },
    });
  }

  tombstones(entity?: string) {
    return { items: this.drafts.list(entity) };
  }
}

@Controller('api')
export class FeatureDraftController {
  constructor(private readonly svc: FeatureDraftService) {}

  @Delete('features/:id/versions/:ver')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR')
  @AuditAction('FEATURE_VERSION_DRAFT_DELETE')
  deleteFeature(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(DeleteDraftBody)) body: DeleteDraftBody) {
    return this.svc.deleteFeature(actor, id, ver, body);
  }

  @Delete('dependencies/:id')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR', 'VARIANT_OWNER')
  @AuditAction('FEATURE_RELATION_DRAFT_DELETE')
  deleteRelation(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(DeleteDraftBody)) body: DeleteDraftBody) {
    return this.svc.deleteRelation(actor, id, body);
  }

  @Get('deleted-drafts')
  tombstones(@Query('entity') entity?: string) {
    return this.svc.tombstones(entity || undefined);
  }
}
