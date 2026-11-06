// Feature 추적 연결(D01-02, P3) — Feature ID에 요구사항(FR-DEP-005)·아키텍처 설계 요소(006)·인터페이스 요소(007)·Test Case(008)·OTA 패키지(002-004)를 잇는다.
// 등록: 종류별 역할 → Feature 존재 → 같은 연결 중복 → 출처 존재 확인(요구 제외, IF 호출 기록) → 감사·이벤트. 해제는 지우지 않고 상태·사유로 남긴다.
// Test Evidence는 연결된 Test Case마다 추가만 한다. 커버리지는 contracts rules/trace-link 한 곳에서 계산한다.
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  featureTraceCoverage,
  groupTraceLinks,
  testCaseStatus,
  TEST_EVIDENCE_ROLES,
  TRACE_KIND_RULES,
  TraceKind,
  TraceLinkStatus,
  type CreateTestEvidenceBody,
  type CreateTraceLinkBody,
  type TestEvidenceRow,
  type TraceLinkRow,
  type UnlinkTraceLinkBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { TraceSources } from '../../../adapters/if-mocks/trace-sources';
import { FeatureRepo } from '../repos';
import { TraceLinkRepo } from './trace-link.repo';
import { traceSeed } from './trace-link.seed';

const ACTION = { create: 'TRACE_LINK_CREATE', unlink: 'TRACE_LINK_UNLINK', evidence: 'TEST_EVIDENCE_CREATE' } as const;
/** 실행 일시는 지금보다 늦을 수 없다(시계 차 5분까지) */
const FUTURE_SLACK_MS = 5 * 60_000;
const kindOf = (v: string) => {
  const r = TraceKind.safeParse(v);
  if (!r.success) throw new DomainError('VALIDATION', `kind는 ${TraceKind.options.join('·')} 중 하나입니다.`);
  return r.data;
};

@Injectable()
@PlatformComponent('D01-02')
export class TraceLinkService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: TraceLinkRepo,
    private readonly features: FeatureRepo,
    private readonly sources: TraceSources,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 데모 시드 — 데이터셋 Feature의 요구·SW·ECU·인터페이스·Test Case·OTA 패키지 연결과 Lifecycle에 맞는 Test Evidence(운영 모드·시드 없음에서는 넣지 않는다) */
  onApplicationBootstrap() {
    if (isProduction() || seedOf() === 'none' || this.repo.count() > 0) return;
    const { links, evidence } = traceSeed(this.features.all(), this.sources, this.clock.now());
    if (!links.length) return;
    this.db.tx(() => {
      for (const l of links) this.repo.insert(l);
      for (const e of evidence) this.repo.insertEvidence(e);
    });
  }

  list(q: { featureId?: string; kind?: string; elementType?: string; sourceSystem?: string; status?: string } = {}) {
    const kind = q.kind ? kindOf(q.kind) : undefined;
    if (q.status && q.status !== 'ALL' && !TraceLinkStatus.safeParse(q.status).success) throw new DomainError('VALIDATION', 'status는 ACTIVE·UNLINKED·ALL 중 하나입니다.');
    const status = q.status === 'ALL' ? undefined : ((q.status as TraceLinkStatus | undefined) ?? 'ACTIVE');
    const items = this.repo
      .list({ featureId: q.featureId, kind, status })
      .filter((l) => (!q.elementType || l.elementType === q.elementType) && (!q.sourceSystem || l.sourceSystem === q.sourceSystem));
    return { items, groups: groupTraceLinks(items.filter((l) => l.status === 'ACTIVE')) };
  }

  /** 등록 전 확인(화면) — 출처의 이름·버전·유형. 호출 기록은 남기지 않는다(등록 때 남긴다) */
  lookup(kind: string, elementId: string, elementVersion?: string) {
    const k = kindOf(kind);
    if (k === 'REQUIREMENT') return { kind: k, elementId, found: null, element: null, versions: [], ifId: this.sources.ifOf(k) };
    const r = this.sources.find(k, elementId, elementVersion || null);
    return { kind: k, elementId, found: !!r.element, element: r.element, versions: r.versions, ifId: this.sources.ifOf(k) };
  }

  create(actor: Actor, body: CreateTraceLinkBody): TraceLinkRow {
    const label = `${body.featureId} ${body.kind} ${body.elementId}`;
    const reject = (code: 'NOT_FOUND' | 'IMMUTABLE' | 'GUARD_FAILED' | 'CONFLICT', msg: string, details?: unknown): never => {
      this.audit.failed(actor, ACTION.create, label, msg, 'D01-02');
      throw new DomainError(code, msg, details);
    };
    this.allow(actor, TRACE_KIND_RULES[body.kind].roles, ACTION.create, label);
    const versions = this.features.versions(body.featureId);
    if (!versions.length) reject('NOT_FOUND', `${body.featureId}이(가) Registry에 없습니다.`);
    if (versions.at(-1)!.lifecycle === 'RETIRED') reject('IMMUTABLE', `${body.featureId}은(는) 폐기된 Feature입니다 — 새 연결을 받지 않습니다.`);
    const dup = this.repo.activeFor(body.featureId, body.kind, body.elementId);
    if (dup) reject('CONFLICT', `${dup.linkId}가 이미 같은 요소를 연결하고 있습니다.`, { linkId: dup.linkId });

    // 출처 확인은 tx 밖에서 — 실패 감사(FAILED)가 되돌려지지 않게
    const linkId = this.repo.nextId();
    let existence: TraceLinkRow['existence'] = 'NOT_CHECKED';
    let sourceRef: string | null = null;
    let name = body.elementName;
    let version = body.elementVersion;
    if (body.kind !== 'REQUIREMENT') {
      const v = this.sources.verify(body.kind, linkId, body.elementId, body.elementVersion);
      if (!v.element) {
        const known = v.versions.length ? ` — 출처에 있는 버전: ${v.versions.join(', ')}` : '';
        reject('GUARD_FAILED', `출처 ${body.sourceSystem}에 ${body.elementId}${body.elementVersion ? ` ${body.elementVersion}` : ''}이(가) 없습니다${known}.`, { sourceRef: v.ref, versions: v.versions });
      }
      if (v.element!.elementType !== body.elementType)
        reject('GUARD_FAILED', `${body.elementId}의 출처 유형은 ${v.element!.elementType}입니다 — ${body.elementType}(으)로 연결할 수 없습니다.`, { sourceType: v.element!.elementType });
      existence = 'VERIFIED';
      sourceRef = v.ref;
      name ??= v.element!.name;
      version ??= v.element!.version;
    }
    return this.db.tx(() => {
      const row: TraceLinkRow = {
        linkId,
        featureId: body.featureId,
        kind: body.kind,
        elementId: body.elementId,
        elementType: body.elementType,
        elementName: name,
        elementVersion: version,
        sourceSystem: body.sourceSystem,
        required: body.kind === 'TEST_CASE' ? body.required : null,
        existence,
        sourceRef,
        status: 'ACTIVE',
        linkedBy: actor.id,
        linkedAt: this.clock.iso(),
        unlinkedBy: null,
        unlinkedAt: null,
        unlinkReason: null,
      };
      this.repo.insert(row);
      this.audit.record(actor, ACTION.create, `${body.featureId}:${linkId}`, { after: row, componentId: 'D01-02' });
      this.events.publish('trace-link.created', body.featureId, { linkId, kind: row.kind, elementId: row.elementId, existence }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return row;
    });
  }

  unlink(actor: Actor, linkId: string, body: UnlinkTraceLinkBody): TraceLinkRow {
    const link = this.repo.get(linkId);
    if (!link) throw new DomainError('NOT_FOUND', `${linkId}을(를) 찾을 수 없습니다.`);
    this.allow(actor, TRACE_KIND_RULES[link.kind].roles, ACTION.unlink, linkId);
    if (link.status !== 'ACTIVE') {
      this.audit.failed(actor, ACTION.unlink, linkId, '이미 해제된 연결', 'D01-02');
      throw new DomainError('CONFLICT', `${linkId}은(는) ${link.unlinkedAt}에 이미 해제됐습니다.`);
    }
    return this.db.tx(() => {
      const next: TraceLinkRow = { ...link, status: 'UNLINKED', unlinkedBy: actor.id, unlinkedAt: this.clock.iso(), unlinkReason: body.reason };
      this.repo.update(next);
      this.audit.record(actor, ACTION.unlink, `${link.featureId}:${linkId}`, { before: link, after: next, reason: body.reason, componentId: 'D01-02' });
      this.events.publish('trace-link.unlinked', link.featureId, { linkId, kind: link.kind, elementId: link.elementId, reason: body.reason }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return next;
    });
  }

  addEvidence(actor: Actor, linkId: string, body: CreateTestEvidenceBody): TestEvidenceRow {
    const link = this.repo.get(linkId);
    if (!link) throw new DomainError('NOT_FOUND', `${linkId}을(를) 찾을 수 없습니다.`);
    const label = `${linkId} ${body.evidenceId}`;
    this.allow(actor, TEST_EVIDENCE_ROLES, ACTION.evidence, label);
    const reject = (code: 'GUARD_FAILED' | 'CONFLICT' | 'VALIDATION', msg: string): never => {
      this.audit.failed(actor, ACTION.evidence, label, msg, 'D01-02');
      throw new DomainError(code, msg);
    };
    if (link.kind !== 'TEST_CASE') reject('GUARD_FAILED', `${linkId}은(는) Test Case 연결이 아닙니다 — Test Evidence는 Test Case에만 등록합니다.`);
    if (link.status !== 'ACTIVE') reject('CONFLICT', `${linkId}은(는) 해제된 연결입니다 — 다시 연결한 뒤 등록하세요.`);
    if (Date.parse(body.executedAt) > this.clock.now().getTime() + FUTURE_SLACK_MS) reject('VALIDATION', '실행 일시가 지금보다 늦습니다.');
    if (this.repo.hasEvidence(linkId, body.evidenceId)) reject('CONFLICT', `${body.evidenceId}는 이미 이 Test Case에 등록된 Evidence입니다.`);
    return this.db.tx(() => {
      const row: TestEvidenceRow = {
        recordId: this.repo.nextEvidenceId(),
        linkId,
        featureId: link.featureId,
        testCaseId: link.elementId,
        evidenceId: body.evidenceId,
        executedAt: new Date(body.executedAt).toISOString(),
        result: body.result,
        environment: body.environment,
        registeredBy: actor.id,
        registeredAt: this.clock.iso(),
      };
      this.repo.insertEvidence(row);
      this.audit.record(actor, ACTION.evidence, `${link.featureId}:${linkId}`, { after: row, componentId: 'D01-02' });
      this.events.publish('test-evidence.recorded', link.featureId, { linkId, testCaseId: link.elementId, evidenceId: row.evidenceId, result: row.result }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return row;
    });
  }

  /** Feature 하나의 추적 연결 요약 — 연결(해제 이력 포함)·묶음·Test Case별 Evidence 상태·요구 목록·커버리지 */
  featureSummary(featureId: string) {
    const f = this.sources.latest(featureId);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const links = this.repo.list({ featureId });
    const evidence = this.repo.evidence({ featureId });
    const requirements = this.sources.requirementsOf(featureId);
    const active = links.filter((l) => l.status === 'ACTIVE');
    const linkedReq = new Set(active.filter((l) => l.kind === 'REQUIREMENT').map((l) => l.elementId));
    return {
      feature: { featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId },
      links: links.map((l) => (l.kind === 'TEST_CASE' ? { ...l, test: testCaseStatus(l, evidence) } : l)),
      groups: groupTraceLinks(active),
      requirements: requirements.map((r) => ({ ...r, linked: linkedReq.has(r.reqId) })),
      evidence,
      coverage: featureTraceCoverage(links, evidence, requirements.map((r) => r.reqId)),
    };
  }

  /** Feature별 커버리지 — filter=noRequirement(요구 미연결, FR-DEP-005-005)·missingEvidence(필수 Test Evidence 미등록, FR-DEP-008-006) */
  coverage(filter?: string) {
    if (filter && filter !== 'noRequirement' && filter !== 'missingEvidence') throw new DomainError('VALIDATION', 'filter는 noRequirement 또는 missingEvidence입니다.');
    const links = this.repo.list();
    const evidence = this.repo.evidence();
    const byFeature = new Map<string, TraceLinkRow[]>();
    for (const l of links) (byFeature.get(l.featureId) ?? byFeature.set(l.featureId, []).get(l.featureId)!).push(l);
    const evByFeature = new Map<string, TestEvidenceRow[]>();
    for (const e of evidence) (evByFeature.get(e.featureId) ?? evByFeature.set(e.featureId, []).get(e.featureId)!).push(e);
    const ids = [...new Set(this.features.all().map((f) => f.featureId))].sort();
    const all = ids.map((id) => {
      const f = this.sources.latest(id)!;
      const c = featureTraceCoverage(byFeature.get(id) ?? [], evByFeature.get(id) ?? [], this.sources.requirementsOf(id).map((r) => r.reqId));
      return { featureId: id, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, asil: f.asil, ...c };
    });
    const sum = (k: (x: (typeof all)[number]) => number) => all.reduce((n, x) => n + k(x), 0);
    const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 10000 : null);
    const items = all.filter((x) => (filter === 'noRequirement' ? !x.hasRequirementLink : filter === 'missingEvidence' ? x.missingRequiredEvidence : true));
    return {
      summary: {
        features: all.length,
        noRequirement: all.filter((x) => !x.hasRequirementLink).length,
        missingEvidence: all.filter((x) => x.missingRequiredEvidence).length,
        requirementRatio: ratio(sum((x) => x.requirement.covered), sum((x) => x.requirement.total)),
        testRatio: ratio(sum((x) => x.test.withEvidence), sum((x) => x.test.required)),
      },
      filter: filter ?? null,
      items,
    };
  }

  private allow(actor: Actor, roles: readonly string[], action: string, target: string) {
    if (roles.includes(actor.role)) return;
    this.audit.denied(actor, action, target, `역할 ${actor.role}은(는) 이 연결을 바꿀 수 없음`, 'D01-02');
    throw new DomainError('FORBIDDEN', `이 연결은 ${roles.join('·')} 역할이 등록·해제합니다.`);
  }
}
