import { Inject, Injectable } from '@nestjs/common';
import { latestArtifacts, missingArtifacts, semverGreater, SUPPLIER_ARTIFACT_TYPES, type AddSupplierSwcBody, type CreateSupplierCriteriaBody, type CreateSupplierMappingBody, type CreateSupplierPackageBody, type ReviewSupplierPackageBody, type SubmitSupplierArtifactBody, type SubmitSupplierPackageBody, type SupplierArtifactRow, type SupplierCriteriaRow, type SupplierMappingRow, type SupplierPackageRow, type SupplierReviewRow } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { checkedArtifacts, supplierGateFacts, supplierPackageCheck } from './supplier-gate';
import { publicArtifactUri, verifyArtifact } from './supplier-proof';
import { SupplierStore } from './supplier.store';

@Injectable()
@PlatformComponent('D05-01')
export class SupplierService {
  private readonly store: SupplierStore;
  constructor(@Inject(DB) private readonly db: Db, private readonly features: FeatureRepo, private readonly topology: TopologyRepo, private readonly clock: Clock, private readonly audit: AuditService, private readonly events: EventService) { this.store = new SupplierStore(db); }

  private feature(id: string, version?: string) {
    const f = version ? this.features.get(id, version) : this.features.versions(id).at(-1);
    if (!f) throw new DomainError('NOT_FOUND', `Feature ${id}${version ? `@${version}` : ''}이(가) 없습니다.`);
    return f;
  }
  private pkg(id: string) {
    const p = this.store.package(id);
    if (!p) throw new DomainError('NOT_FOUND', `협력사 패키지 ${id}이(가) 없습니다.`);
    return p;
  }
  private mapping(id: string) {
    const m = this.store.mapping(id);
    if (!m) throw new DomainError('NOT_FOUND', `협력사 기능 매핑 ${id}이(가) 없습니다.`);
    return m;
  }
  private mutate<T>(actor: Actor, action: string, target: string, fn: () => T): T {
    try {
      return this.db.tx(() => {
        const out = fn();
        // 산출물 본문은 감사·이벤트에 복제하지 않는다. 별도 추가 전장에 보관하며 검증 해시로 추적한다.
        this.audit.record(actor, action, target, { after: { saved: true }, componentId: 'D05-01' });
        this.events.publish(action.toLowerCase().replaceAll('_', '.'), target, { by: actor.id }, { componentId: 'D05-01', correlationId: actor.correlationId });
        return out;
      });
    } catch (e) {
      if (e instanceof DomainError) this.audit.failed(actor, action, target, e.message, 'D05-01');
      throw e;
    }
  }
  mappings(featureId?: string) {
    if (featureId) this.feature(featureId);
    return { items: this.store.mappings(featureId) };
  }
  createMapping(actor: Actor, b: CreateSupplierMappingBody) {
    return this.mutate(actor, 'SUPPLIER_MAPPING_CREATE', b.featureId, () => {
      this.feature(b.featureId);
      if (this.store.mappings(b.featureId).some((m) => m.supplier === b.supplier && m.supplierFunctionId === b.supplierFunctionId)) throw new DomainError('CONFLICT', '같은 Feature·협력사 Function ID 매핑이 이미 있습니다.');
      if (b.oemFunctionId && !this.topology.allFunctions().some((f) => f.featureId === b.featureId && f.functionId === b.oemFunctionId)) throw new DomainError('GUARD_FAILED', 'OEM 기능 ID가 이 Feature의 기능 분해 목록에 없습니다.');
      const m: SupplierMappingRow = { ...b, mapId: this.store.next('supplier_mapping', 'map_id', 'SFM-'), swcs: [], status: 'ACTIVE', createdBy: actor.id, createdAt: this.clock.iso() };
      this.store.putMapping(m, true);
      return m;
    });
  }
  addSwc(actor: Actor, id: string, b: AddSupplierSwcBody) {
    return this.mutate(actor, 'SUPPLIER_SWC_ADD', id, () => {
      const m = this.mapping(id);
      if (m.swcs.some((s) => s.swcId === b.swcId)) throw new DomainError('CONFLICT', '같은 SW Component ID가 이미 매핑됐습니다.');
      const sw = b.swId ? this.topology.allSw().filter((s) => s.swId === b.swId) : [];
      if (b.swId && (!sw.length || sw.some((s) => s.supplier !== m.supplier))) throw new DomainError('GUARD_FAILED', '같은 협력사가 공급하는 OEM SW만 매핑할 수 있습니다.');
      if (b.swId && !this.features.versions(m.featureId).some((f) => f.swIds.includes(b.swId!))) throw new DomainError('GUARD_FAILED', '이 Feature가 사용하는 OEM SW를 선택하세요.');
      if (b.ecuPno && (!this.topology.ecu(b.ecuPno) || (b.swId && !sw.some((s) => s.ecuPno === b.ecuPno)))) throw new DomainError('GUARD_FAILED', 'OEM SW가 실행되는 ECU를 선택하세요.');
      const next = { ...m, swcs: [...m.swcs, { ...b, addedBy: actor.id, addedAt: this.clock.iso() }] };
      this.store.putMapping(next);
      return next;
    });
  }
  packages(q: { featureId?: string; featureVersion?: string; supplier?: string }) {
    if (q.featureId) this.feature(q.featureId, q.featureVersion);
    return { items: this.store.packages(q.featureId).filter((p) => (!q.featureVersion || p.featureVersion === q.featureVersion) && (!q.supplier || p.supplier === q.supplier)) };
  }
  detail(id: string) {
    const p = this.pkg(id);
    const f = this.feature(p.featureId, p.featureVersion);
    const artifacts = checkedArtifacts(this.store, p);
    return { package: p, artifacts: artifacts.map((a) => ({ ...a, contentUrl: a.text === null ? null : `/api/supplier-artifacts/${a.recordId}/content`, text: null })), latest: latestArtifacts(artifacts).valueOf(), criteria: this.store.criteria(p.featureId).at(-1) ?? null, check: supplierPackageCheck(this.store, p, f), reviews: this.store.reviews(id) };
  }
  createPackage(actor: Actor, b: CreateSupplierPackageBody) {
    return this.mutate(actor, 'SUPPLIER_PACKAGE_CREATE', b.featureId, () => {
      this.feature(b.featureId, b.featureVersion);
      const previous = this.store.packages(b.featureId).filter((p) => p.supplier === b.supplier);
      if (previous.some((p) => !semverGreater(b.version, p.version))) throw new DomainError('CONFLICT', '패키지 버전은 이 Feature·협력사의 마지막 버전보다 커야 합니다.');
      const base = b.basedOn ? this.pkg(b.basedOn) : null;
      if (base && (base.featureId !== b.featureId || base.supplier !== b.supplier || base.featureVersion !== b.featureVersion)) throw new DomainError('GUARD_FAILED', '같은 Feature Version·협력사의 패키지만 이어받을 수 있습니다.');
      const p: SupplierPackageRow = { ...b, packageId: this.store.next('supplier_package', 'package_id', 'SPK-'), status: 'DRAFT', createdBy: actor.id, createdAt: this.clock.iso(), submittedBy: null, submittedAt: null, submitNote: null, decidedBy: null, decidedAt: null };
      this.store.putPackage(p, true);
      if (base) for (const a of Object.values(latestArtifacts(this.store.artifacts(base.packageId)))) {
        const carried: SupplierArtifactRow = { ...a, recordId: this.store.next('supplier_artifact', 'record_id', 'SPA-'), packageId: p.packageId, carriedFrom: a.recordId, submittedBy: actor.id, submittedAt: this.clock.iso(), integrity: verifyArtifact(p, a).integrity };
        this.store.addArtifact(carried);
      }
      return p;
    });
  }
  artifact(actor: Actor, id: string, b: SubmitSupplierArtifactBody) {
    return this.mutate(actor, 'SUPPLIER_ARTIFACT_ADD', id, () => {
      const p = this.pkg(id);
      if (p.status !== 'DRAFT' && p.status !== 'REJECTED') throw new DomainError('IMMUTABLE', '작성 중이거나 보완 요청된 패키지에만 산출물을 추가할 수 있습니다.');
      if (!publicArtifactUri(b.uri)) throw new DomainError('VALIDATION', '산출물 출처는 외부 HTTPS 주소로 입력하세요. 개발 PC·내부망·로컬 파일 주소는 사용할 수 없습니다.');
      const proof = verifyArtifact(p, b);
      const a: SupplierArtifactRow = { ...b, recordId: this.store.next('supplier_artifact', 'record_id', 'SPA-'), packageId: id, submittedBy: actor.id, submittedAt: this.clock.iso(), integrity: proof.integrity, carriedFrom: null };
      this.store.addArtifact(a);
      return { ...a, text: null, contentUrl: b.text === null ? null : `/api/supplier-artifacts/${a.recordId}/content`, verification: proof };
    });
  }
  content(id: string) {
    const a = this.store.artifact(id);
    if (!a) throw new DomainError('NOT_FOUND', '협력사 산출물 기록이 없습니다.');
    if (a.text === null) throw new DomainError('NOT_FOUND', '본문이 아직 서버에 보관되지 않았습니다. 출처 주소만으로는 본문을 검증할 수 없습니다.');
    const proof = verifyArtifact(this.pkg(a.packageId), a);
    return { recordId: id, text: a.text, checksum: proof.bodyChecksum, declaredChecksum: a.checksum, verified: proof.integrity === 'VERIFIED', verification: proof };
  }
  criteria(featureId: string) { this.feature(featureId); return { items: this.store.criteria(featureId) }; }
  createCriteria(actor: Actor, b: CreateSupplierCriteriaBody) {
    return this.mutate(actor, 'SUPPLIER_CRITERIA_CREATE', b.featureId, () => {
      this.feature(b.featureId);
      const c: SupplierCriteriaRow = { ...b, criteriaId: this.store.next('supplier_criteria', 'criteria_id', 'SAC-'), revision: (this.store.criteria(b.featureId).at(-1)?.revision ?? 0) + 1, createdBy: actor.id, createdAt: this.clock.iso() };
      this.store.addCriteria(c);
      return c;
    });
  }
  submit(actor: Actor, id: string, b: SubmitSupplierPackageBody) {
    return this.mutate(actor, 'SUPPLIER_PACKAGE_SUBMIT', id, () => {
      const p = this.pkg(id);
      if (p.status !== 'DRAFT' && p.status !== 'REJECTED') throw new DomainError('CONFLICT', '작성 중·보완 요청 상태에서만 검수를 요청할 수 있습니다.');
      const check = supplierPackageCheck(this.store, p, this.feature(p.featureId, p.featureVersion));
      if (missingArtifacts(latestArtifacts(this.store.artifacts(id))).length) throw new DomainError('GUARD_FAILED', '협력사 필수 산출물 10항목을 모두 등록한 뒤 검수를 요청하세요.', { missing: check.missing });
      const next: SupplierPackageRow = { ...p, status: 'SUBMITTED', submittedBy: actor.id, submittedAt: this.clock.iso(), submitNote: b.note, decidedBy: null, decidedAt: null };
      this.store.putPackage(next);
      return { package: next, check, hold: check.verdict !== 'MET' };
    });
  }
  review(actor: Actor, id: string, b: ReviewSupplierPackageBody) {
    return this.mutate(actor, 'SUPPLIER_PACKAGE_REVIEW', id, () => {
      const p = this.pkg(id);
      if (p.status !== 'SUBMITTED') throw new DomainError('CONFLICT', '검수 요청 상태인 패키지만 판정할 수 있습니다.');
      const participants = new Set([p.createdBy, p.submittedBy, ...this.store.artifacts(id).map((a) => a.submittedBy)]);
      if (participants.has(actor.id)) throw new DomainError('SEPARATION_OF_DUTY', '패키지 작성·산출물 제출·검수 요청자와 다른 검수자가 판정해야 합니다.');
      const check = supplierPackageCheck(this.store, p, this.feature(p.featureId, p.featureVersion));
      if (b.decision === 'ACCEPT' && (check.verdict !== 'MET' || !SUPPLIER_ARTIFACT_TYPES.every((t) => b.items.some((i) => i.type === t && i.result === 'PASS')))) throw new DomainError('GUARD_FAILED', '검증 본문·현재 검수 기준과 10항목별 합격 판정이 모두 있어야 합격할 수 있습니다.', { check });
      const r: SupplierReviewRow = { ...b, reviewId: this.store.next('supplier_review', 'review_id', 'SRV-'), packageId: id, criteriaRevision: check.criteriaRevision, checkVerdict: check.verdict, reviewedBy: actor.id, reviewedAt: this.clock.iso() };
      this.store.addReview(r);
      const next: SupplierPackageRow = { ...p, status: b.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', decidedBy: actor.id, decidedAt: r.reviewedAt };
      this.store.putPackage(next);
      return { package: next, review: r, check };
    });
  }
  gate(featureId: string, version: string) { return supplierGateFacts(this.db, this.feature(featureId, version)); }
}
