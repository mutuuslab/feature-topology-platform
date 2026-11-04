// Feature DB에 없는 기능 — 등록 화면의 추가 요청(30-95 §6.4, D-REF-7).
// 서버가 정식 형식 ID(도메인약어-컴포넌트약어-다음번호)를 바로 부여하고, 요청 중(PENDING) 행과 추가 변경 요청(ref_change kind=ADD, 도메인 검토 REVIEW)을 만든다.
// ID는 한 번 쓰면 바꾸지 않는다(폐기·반려돼도 다시 쓰지 않음) — 요청자는 이 행을 대표로 Feature를 바로 등록하고, 승인 전에는 Feature 정의 승인이 막힌다.
// 새 컴포넌트가 필요하면 같은 요청에 약어를 제안한다 — 분류 표 추가도 DB 관리자 승인(변경 요청 사유에 남긴다).
import { Inject, Injectable } from '@nestjs/common';
import {
  checkRegistration,
  domainAbbrOf,
  domainOfAbbr,
  FeatureRefRow,
  nextRefId,
  type RefChange,
  type RequestRefAddBody,
  type TaxonomyNode,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { RefdbRepository } from './refdb.repository';

/** 분류 표의 컴포넌트 — 시드 JSON은 abbrs(여러 약어)·clusterIds를 더 싣는다 */
type ComponentNode = TaxonomyNode & { abbrs?: string[]; clusterIds?: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

@Injectable()
export class RefdbRequestAddService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RefdbRepository,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  requestAdd(actor: Actor, body: RequestRefAddBody): { ref: FeatureRefRow; change: RefChange } {
    // 도메인 — 공식 이름(Body & Comfort) 또는 약어(BC)
    const domainAbbr = domainAbbrOf(body.domain) ?? (domainOfAbbr(body.domain.toUpperCase()) ? body.domain.toUpperCase() : undefined);
    if (!domainAbbr) throw new DomainError('VALIDATION', `도메인 '${body.domain}'은(는) Feature DB 공식 도메인이 아닙니다.`, { field: 'domain' });
    const domain = domainOfAbbr(domainAbbr)!;
    const { component, componentAbbr, cluster, newComponent } = this.componentOf(domainAbbr, domain, body);

    return this.db.tx(() => {
      const used = this.repo.usedRefIds();
      // 같은 접두의 가장 큰 번호 다음 — 폐기·반려된 번호도 used에 있으므로 다시 쓰지 않는다
      const refId = nextRefId(domainAbbr, componentAbbr, used);
      const at = this.clock.iso();
      const changeId = this.repo.nextChangeId(this.clock.now().getUTCFullYear());
      const basis = body.basisNote.trim();
      const ref = FeatureRefRow.parse({
        refId,
        status: 'PENDING',
        replacedBy: null,
        registeredIn: '', // 발행 때 정해진다
        evidenceCheckedAt: at.slice(0, 10),
        domain,
        cluster,
        component,
        swStack: '',
        lifecycle: '',
        techStack: '',
        vehicleType: '',
        region: '',
        nameEn: body.nameEn,
        nameKo: body.nameKo,
        aliases: [],
        autoQuality: '',
        techQuality: '',
        asilRep: body.asilRep,
        method: '',
        tshirt: body.tshirt,
        bundleId: null,
        bundleRep: null,
        sizeEvidenceGrade: null,
        benchmarkEur: null,
        kearneyNote: '',
        makeBuyVolume: '',
        makeBuyPremium: '',
        relevance: '',
        sourceIds: body.sourceIds,
        sourceDetail: '',
        remark: basis,
        basisType: body.sourceIds.length ? '' : '근거 메모',
        duplicateOf: null,
        requires: [],
        excludes: [],
        procurement: '',
        swPackage: '',
        licenseItem: '',
        billing: '',
        definition: null,
        adminMemo: `${changeId} 등록 화면 추가 요청(${actor.id})${newComponent ? ` — 새 컴포넌트 약어 ${componentAbbr} 제안` : ''}`,
      });
      const change: RefChange = {
        changeId,
        kind: 'ADD',
        refId,
        before: null,
        after: ref,
        reason: [`등록 화면 추가 요청 — ${body.nameKo}`, newComponent ? `새 컴포넌트 '${component}' 약어 ${componentAbbr} 제안(분류 표 추가 승인 필요)` : '', basis ? `근거: ${basis}` : ''].filter(Boolean).join(' · '),
        requestedBy: actor.id,
        requestedAt: at,
        // 자동 점검을 거쳐 도메인 검토로(§8.2) — 승인 전까지 행은 요청 중(PENDING)
        status: 'REVIEW',
        reviews: [],
        decision: null,
        release: null,
        checks: checkRegistration(ref, { kind: 'ADD', usedIds: used, sourceIds: this.repo.sources().map((s) => s.sourceId) }),
        fromRegistration: true,
      };
      this.repo.insertRef(ref, at);
      this.repo.insertChange(change);
      this.audit.record(actor, 'REFDB_ADD_REQUEST', refId, { after: { ref, changeId, newComponent: newComponent ? { component, abbr: componentAbbr } : null }, componentId: 'D01-01' });
      this.events.publish('refdb.ref.requested', refId, { refId, changeId, domain, component, nameKo: ref.nameKo, by: actor.id }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return { ref, change };
    });
  }

  /** 컴포넌트 → 약어·클러스터. 분류 표에 있으면 그 약어, 없으면 기존 기준 행 ID에서, 둘 다 없으면 새 컴포넌트 약어 제안이 필요하다 */
  private componentOf(domainAbbr: string, domain: string, body: RequestRefAddBody) {
    const tax = this.repo.taxonomy() as ComponentNode[];
    const node = tax.find((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && (same(n.nameEn, body.component) || same(n.nodeId, body.component) || (!!n.abbr && same(n.abbr, body.component))));
    if (node?.abbr) {
      const clusterNode = node.clusterIds?.length ? tax.find((n) => n.nodeId === node.clusterIds![0]) : undefined;
      return { component: node.nameEn, componentAbbr: node.abbr, cluster: body.cluster ?? clusterNode?.nameEn ?? this.clusterFromRefs(domain, node.nameEn), newComponent: false };
    }
    const existing = this.repo.listRefs({ domain }).find((r) => same(r.component, body.component));
    if (existing) return { component: existing.component, componentAbbr: existing.refId.split('-')[1], cluster: body.cluster ?? existing.cluster, newComponent: false };
    if (!body.componentAbbr)
      throw new DomainError('VALIDATION', `컴포넌트 '${body.component}'이(가) ${domain} 분류에 없습니다 — 새 컴포넌트라면 3글자 약어(componentAbbr)를 제안하세요.`, { field: 'componentAbbr' });
    const taken = tax.some((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && (n.abbr === body.componentAbbr || n.abbrs?.includes(body.componentAbbr!))) || this.repo.usedRefIds().some((id) => id.startsWith(`${domainAbbr}-${body.componentAbbr}-`));
    if (taken) throw new DomainError('CONFLICT', `약어 ${body.componentAbbr}은(는) ${domain}에서 이미 다른 컴포넌트가 씁니다 — 다른 약어를 제안하세요.`, { field: 'componentAbbr' });
    if (!body.cluster?.trim()) throw new DomainError('VALIDATION', '새 컴포넌트는 클러스터(cluster)를 함께 입력하세요.', { field: 'cluster' });
    return { component: body.component.trim(), componentAbbr: body.componentAbbr, cluster: body.cluster.trim(), newComponent: true };
  }

  private clusterFromRefs(domain: string, component: string): string {
    const r = this.repo.listRefs({ domain, component })[0];
    if (!r) throw new DomainError('VALIDATION', `컴포넌트 '${component}'의 클러스터를 찾을 수 없습니다 — 클러스터(cluster)를 입력하세요.`, { field: 'cluster' });
    return r.cluster;
  }
}
