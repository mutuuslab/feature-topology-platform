// Feature DB 변경 요청(30-95 §8.2·§8.3, D-REF-8) — 작성(감사 조회자 외 사람 역할) → 자동 점검 → 도메인 검토(DOMAIN_REVIEWER) → 승인·반려(REFDB_ADMIN) → 버전 발행.
//  · 작성: 필드 단위 차이(before·after)와 등록 기준 자동 점검(registration-criteria) 결과를 저장. 막는 실패(필수 정보·ID)는 제출을 막고, 나머지는 '보완 필요'.
//  · 작성: 감사 조회자를 뺀 사람 역할 모두(contracts REFDB_CHANGE_REQUESTERS). 벤치마크 필드는 산정 역할만 바꾼다(아니면 403 + 감사 DENIED).
//  · 검토: 의견(동의·보완·반대)과 설명 필수, 요청자는 자기 요청을 검토할 수 없다(SOD-14).
//  · 승인: 검토 의견이 하나 이상 있어야 하고 마지막 의견이 동의여야 한다(보완·반대면 막음, 2026-11-04 결정). 요청자(SOD-13)·그 요청의 검토자(SOD-15)는
//    승인·반려할 수 없다(계정 기준). 승인된 변경은 '발행 대기' — 기준 행(등록 화면)에는 아직 쓰지 않는다.
//  · 발행: 발행 대기 요청을 묶어 다음 버전(v1.4 …)으로 기준 행에 적용하고 전체 정규화 해시를 남긴다(ref_release 추가만).
//    요청 중(PENDING) 추가 행은 활성(근거 부족이면 검토 필요)이 되고, 반려된 추가 요청의 요청 중 행은 폐기(RETIRED) + 사유, 연결 Feature Owner에게 알림.
//    추가 요청이 새 컴포넌트를 제안했으면(newComponent) 승인 발행 때 분류 표에 컴포넌트(없으면 클러스터도)를 만든다.
//  · 감사: 벤치마크 필드 값은 감사 기록에 남기지 않는다(maskMoney — 감사 이력은 역할 제한이 없다).
//  · 영향: 이 행을 쓰는 Feature(feature_ref_link), 대표 ASIL·T-shirt 변경이면 '재계산 필요'.
// 검토·승인은 상태가 작성(DRAFT)·검토(REVIEW)일 때만 받는다(화면과 같은 규칙).
// 추가 요청(등록 화면 "Feature DB에 없음 → 요청", POST /api/refdb/requests)은 등록 담당의 request-add.service가 만든다 — 이 서비스는 그 ADD 요청을 같은 흐름으로 처리한다.
import { Inject, Injectable } from '@nestjs/common';
import {
  checkRegistration,
  domainAbbrOf,
  FeatureRefRow,
  nextRefId,
  REF_MONEY_FIELDS,
  refAttrMissing,
  refQuality,
  REFDB_REF_REJECTED_EVENT,
  RefRelease,
  refChangeDuty,
  type CreateRefChangeBody,
  type DecideRefChangeBody,
  type PublishRefReleaseBody,
  type RefChange,
  type RefCriterionResult,
  type RefFieldDiff,
  type ReviewRefChangeBody,
  type Role,
  type TaxonomyNode,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService, type AuditEntry } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { appendMemo, applyDiff, approvalBlockers, byChangeId, changedFields, draftRefRow, fieldDiff, isAwaitingPublish, isOpenChange, MODIFY_STATUSES, RECALC_FIELDS, sourceMissing, staleFields } from './change-rules';
import { canSeeBenchmark, maskMoney } from './read-view';
import { nextReleaseId, refdbHash } from './release-hash';
import { RefdbRepository } from './refdb.repository';

const COMPONENT = 'D01-01';
/** 검토 의견·승인·반려를 받는 상태 */
const DECIDABLE: readonly RefChange['status'][] = ['DRAFT', 'REVIEW'];

/** 역할에 맞춰 차이에서 벤치마크 필드(금액·Make/Buy)를 뺀다 — 산정 역할만 본다(20-94 §8) */
function hideBenchmark<T extends Record<string, unknown> | null>(diff: T, role: Role): T {
  if (!diff || canSeeBenchmark(role)) return diff;
  const out: Record<string, unknown> = { ...diff };
  for (const k of REF_MONEY_FIELDS) delete out[k];
  return out as T;
}

/** 분류 표의 컴포넌트 — 시드 JSON은 abbrs(여러 약어)·clusterIds를 더 싣는다 */
type ComponentNode = TaxonomyNode & { abbrs?: string[]; clusterIds?: string[] };
/** 검토 의견 이름(화면 문구) */
const OPINION_KO = { AGREE: '동의', REVISE: '보완', OPPOSE: '반대' } as const;

/** 추가 요청을 발행할 때의 상태 — 1차 출처가 없거나 분류 속성(SW 계층·수명주기·기술 영역)이 비면 검토 필요(P5-8), 아니면 활성 */
export function addStatus(c: Pick<RefChange, 'checks'>, merged: Partial<FeatureRefRow>): 'ACTIVE' | 'REVIEW' {
  return sourceMissing(c.checks ?? [], merged) || refAttrMissing(merged as FeatureRefRow) ? 'REVIEW' : 'ACTIVE';
}

/** 감사 이력 단계 — 변경 요청 상세 '감사 이력' 패널(P5-6) */
const AUDIT_STAGE: Record<string, 'REQUEST' | 'REVIEW' | 'DECIDE' | 'PUBLISH'> = {
  REFDB_ADD_REQUEST: 'REQUEST',
  REFDB_CHANGE_CREATE: 'REQUEST',
  REFDB_CHANGE_REVIEW: 'REVIEW',
  REFDB_CHANGE_DECIDE: 'DECIDE',
  REFDB_RELEASE_PUBLISH: 'PUBLISH',
};

/** 같은 접두(도메인약어-컴포넌트약어-)에서 지금까지 쓴 가장 큰 일련번호 */
export function maxSerial(prefix: string, used: Iterable<string>): number {
  let max = 0;
  for (const id of used) if (id.startsWith(prefix)) max = Math.max(max, Number(id.slice(prefix.length)) || 0);
  return max;
}

/** 다음 기준 행 ID — 일련번호를 999까지 다 썼으면 500이 아니라 409(새 컴포넌트 약어가 필요) */
export function nextRefIdOr409(domainAbbr: string, componentAbbr: string, used: Iterable<string>): string {
  try {
    return nextRefId(domainAbbr, componentAbbr, used);
  } catch (e) {
    throw new DomainError('CONFLICT', `${domainAbbr}-${componentAbbr}- 일련번호를 모두 썼습니다(999) — 새 컴포넌트 약어로 요청하세요.`, { prefix: `${domainAbbr}-${componentAbbr}-`, cause: (e as Error).message });
  }
}
type DraftRow = Partial<FeatureRefRow> & { refId: string };

@Injectable()
export class RefdbChangeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RefdbRepository,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  // ── 조회 ─────────────────────────────────────────────────

  /** 이 요청이 다루는 도메인 — 요청 값 → 전 값 → 지금 행 */
  private domainOf(c: RefChange): string | undefined {
    return c.after.domain ?? c.before?.domain ?? this.repo.getRef(c.refId)?.domain;
  }

  private view(c: RefChange, role: Role) {
    return {
      ...c,
      before: hideBenchmark(c.before as Record<string, unknown> | null, role),
      after: hideBenchmark(c.after as Record<string, unknown>, role),
      /** 승인됐지만 아직 발행되지 않음 — 등록 화면에는 반영되지 않았다 */
      awaitingPublish: isAwaitingPublish(c),
      domain: this.domainOf(c) ?? null,
    };
  }

  list(actor: Actor, f: { status?: string; kind?: string; refId?: string; domain?: string }) {
    const items = this.repo.changes({ status: f.status || undefined, kind: f.kind || undefined, refId: f.refId || undefined }).filter((c) => !f.domain || this.domainOf(c) === f.domain);
    return { items: items.map((c) => this.view(c, actor.role)), total: items.length };
  }

  detail(actor: Actor, changeId: string) {
    const change = this.mustGet(changeId);
    const role = actor.role;
    const diff = fieldDiff(hideBenchmark(change.before as Record<string, unknown> | null, role), hideBenchmark(change.after as Record<string, unknown>, role));
    const features = this.repo.linkedFeatures(change.refId).map((l) => {
      const doc = l.doc ? (JSON.parse(l.doc) as { name?: string; ownerId?: string }) : {};
      return { featureId: l.featureId, version: l.version, role: l.role, refVersion: l.refVersion, name: doc.name ?? null, ownerId: doc.ownerId ?? null, lifecycle: l.lifecycle };
    });
    const recalcFields = change.kind === 'ADD' ? [] : Object.keys(change.after).filter(k=>JSON.stringify((change.before as any)?.[k])!==JSON.stringify((change.after as any)[k]));
    return {
      change: this.view(change, role),
      diff,
      checks: change.checks ?? [],
      impact: {
        features,
        /** 기준 행 원천(규모·ASIL·범위·근거 메모 등) 변경 — 불변 지문이 달라져 재산정·승인 근거를 다시 확인한다. */
        recalcRequired: recalcFields.length > 0,
        recalcFields,
        costProjects: this.repo.linkedCostProjects(change.refId).map(p=>({...p,recalcRequired:recalcFields.length>0,awaitingPublish:change.status!=='PUBLISHED'})),
      },
      /** 이 행을 쓰는 Feature 연결(feature_ref_link) — 화면 호환 키 */
      usedBy: this.repo.usersOf(change.refId),
    };
  }

  // ── 작성 ─────────────────────────────────────────────────

  create(actor: Actor, body: CreateRefChangeBody) {
    const requested = body.after as RefFieldDiff;
    if (!canSeeBenchmark(actor.role)) {
      const money = REF_MONEY_FIELDS.filter((k) => requested[k] !== undefined);
      if (money.length) {
        const message = `벤치마크 필드(${money.join('·')})는 산정 역할(Feature DB 관리자)만 바꿀 수 있습니다.`;
        // 거부도 감사에 남긴다(값은 남기지 않는다)
        this.audit.denied(actor, 'REFDB_CHANGE_CREATE', body.refId ?? requested.refId ?? 'refdb:add', message, COMPONENT);
        throw new DomainError('FORBIDDEN', message, { fields: money });
      }
    }
    return this.db.tx(() => {
      const at = this.clock.iso();
      const { refId, before, after, row } = body.kind === 'ADD' ? this.prepareAdd(body) : this.prepareChange(body);
      const open = this.repo.changes({ refId }).find(isOpenChange);
      if (open) throw new DomainError('CONFLICT', `기준 행 ${refId}에는 진행 중인 변경 요청 ${open.changeId}이(가) 있습니다 — 그 요청이 발행되거나 반려된 뒤 다시 요청하세요.`, { changeId: open.changeId });
      const checks = this.checksFor(body.kind, row, false);
      const blocking = checks.filter((c) => !c.ok && c.blocking);
      if (blocking.length) throw new DomainError('VALIDATION', `등록 기준을 채우지 못해 제출할 수 없습니다: ${blocking.map((c) => c.message).join(' / ')}`, { checks: blocking });
      const change: RefChange = {
        changeId: this.repo.nextChangeId(this.clock.now().getUTCFullYear()),
        kind: body.kind,
        refId,
        before,
        after,
        reason: body.reason,
        requestedBy: actor.id,
        requestedAt: at,
        // 자동 점검을 거쳐 도메인 검토로(§8.2)
        status: 'REVIEW',
        reviews: [],
        decision: null,
        release: null,
        checks,
      };
      this.repo.insertChange(change);
      this.audit.record(actor, 'REFDB_CHANGE_CREATE', change.changeId, { after: { refId, kind: change.kind, before: maskMoney(before), after: maskMoney(after), advisory: checks.filter((c) => !c.ok) }, reason: body.reason, componentId: COMPONENT });
      this.events.publish('refdb.change.created', change.changeId, { changeId: change.changeId, refId, kind: change.kind, by: actor.id, advisory: checks.filter((c) => !c.ok && !c.blocking).map((c) => c.id) }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(change, actor.role);
    });
  }

  /** ADD — 새 행 전체를 after에. ID는 지정 값 또는 같은 접두의 다음 번호(한 번 쓴 ID는 다시 쓰지 않는다). 행은 발행 때 만든다 */
  private prepareAdd(body: CreateRefChangeBody): { refId: string; before: null; after: RefFieldDiff; row: DraftRow } {
    const requested = body.after as RefFieldDiff;
    if (body.refId && requested.refId && requested.refId !== body.refId) throw new DomainError('VALIDATION', '기준 행 ID(refId)와 after.refId가 다릅니다.', { field: 'after.refId' });
    const given = body.refId ?? requested.refId;
    if (given) this.mustBeNextInPrefix(given);
    const refId = given ?? this.assignRefId(requested);
    const row = draftRefRow(refId, requested, this.clock.iso().slice(0, 10));
    return { refId, before: null, after: row as RefFieldDiff, row };
  }

  private assignRefId(r: RefFieldDiff): string {
    const domainAbbr = r.domain ? domainAbbrOf(r.domain) : undefined;
    if (!domainAbbr) throw new DomainError('VALIDATION', '추가 요청은 공식 도메인(after.domain)을 입력하거나 기준 행 ID(refId)를 지정하세요.', { field: 'after.domain' });
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const node = (this.repo.taxonomy() as ComponentNode[]).find((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && !!r.component && (same(n.nameEn, r.component) || (!!n.abbr && same(n.abbr, r.component))));
    const componentAbbr = node?.abbr ?? (r.component ? this.repo.listRefs({ domain: r.domain }).find((x) => same(x.component, r.component!))?.refId.split('-')[1] : undefined);
    if (!componentAbbr) throw new DomainError('VALIDATION', `컴포넌트 '${r.component ?? ''}'의 약어를 찾을 수 없습니다 — 기준 행 ID(refId)를 지정하세요(새 컴포넌트는 등록 화면 추가 요청으로).`, { field: 'refId' });
    return nextRefIdOr409(domainAbbr, componentAbbr, this.repo.usedRefIds());
  }

  /** 지정한 ID는 같은 접두의 '지금까지 쓴 가장 큰 번호 + 1' 이하만 — 큰 번호를 미리 잡아 번호를 소진시키지 않게(형식·재사용은 자동 점검이 본다) */
  private mustBeNextInPrefix(refId: string) {
    const m = /^(.+-)(\d{3})$/.exec(refId);
    if (!m) return; // 형식 오류는 자동 점검(ID 형식)이 막는다
    const max = maxSerial(m[1], this.repo.usedRefIds());
    const next = `${m[1]}${String(max + 1).padStart(3, '0')}`;
    if (Number(m[2]) > max + 1) throw new DomainError('VALIDATION', `지정한 ID ${refId}은(는) 다음 번호 ${next}보다 큽니다 — ID를 비우면 다음 번호를 붙입니다.`, { field: 'refId', next });
  }

  /** MODIFY·DEPRECATE·RETIRE — 지금 행과 견준 바뀐 필드만 before·after에 */
  private prepareChange(body: CreateRefChangeBody): { refId: string; before: RefFieldDiff; after: RefFieldDiff; row: DraftRow } {
    const refId = body.refId!;
    const cur = this.repo.getRef(refId);
    if (!cur) throw new DomainError('NOT_FOUND', `기준 행 ${refId}이(가) Feature DB에 없습니다.`);
    if (cur.status === 'PENDING') throw new DomainError('CONFLICT', `기준 행 ${refId}은(는) 요청 중입니다 — 추가 요청이 승인·발행된 뒤 변경을 요청하세요.`);
    if (cur.status === 'RETIRED') throw new DomainError('CONFLICT', `기준 행 ${refId}은(는) 폐기되었습니다 — 폐기한 행은 바꾸지 않습니다(ID 재사용 금지).`);
    const requested = { ...(body.after as RefFieldDiff) };
    if (requested.refId !== undefined && requested.refId !== refId) throw new DomainError('VALIDATION', '기준 행 ID는 바꿀 수 없습니다.', { field: 'after.refId' });
    delete requested.refId;
    if (body.kind === 'MODIFY' && requested.status !== undefined && !MODIFY_STATUSES.includes(requested.status))
      throw new DomainError('VALIDATION', '수정 요청으로는 상태를 활성·검토 필요로만 바꿀 수 있습니다 — 폐기 예정·폐기는 그 종류로 요청하세요.', { field: 'after.status' });
    if (body.kind === 'DEPRECATE') {
      requested.status = 'DEPRECATED';
      const to = requested.replacedBy;
      if (to) {
        const target = this.repo.getRef(to);
        if (to === refId || !target || target.status === 'RETIRED' || target.status === 'PENDING') throw new DomainError('VALIDATION', `대체 행 ${to}은(는) 선택할 수 있는 다른 기준 행이어야 합니다.`, { field: 'after.replacedBy' });
      }
    }
    if (body.kind === 'RETIRE') requested.status = 'RETIRED';
    const { before, after } = changedFields(cur, requested);
    if (!Object.keys(after).length) throw new DomainError('VALIDATION', '바뀌는 필드가 없습니다.', { field: 'after' });
    const parsed = FeatureRefRow.safeParse(applyDiff(body.kind, cur, after));
    if (!parsed.success) throw new DomainError('VALIDATION', '바꾼 기준 행이 Feature DB 형식에 맞지 않습니다.', { issues: parsed.error.issues });
    return { refId, before, after, row: parsed.data };
  }

  /**
   * 등록 기준 자동 점검. ownReservation — 이 요청이 이미 잡아 둔 ID(ADD 요청·요청 중 행)를 '이미 쓴 ID'로 보지 않는다
   * (발행된 다른 행이 같은 ID를 가지면 그대로 막는다).
   */
  private checksFor(kind: RefChange['kind'], row: DraftRow, ownReservation: boolean): RefCriterionResult[] {
    const refs = this.repo.listRefs();
    const real = refs.find((r) => r.refId === row.refId);
    let used = this.repo.usedRefIds();
    if (kind === 'ADD' && ownReservation && (!real || real.status === 'PENDING')) used = used.filter((id) => id !== row.refId);
    return checkRegistration(row, { kind, usedIds: used, existingIds: refs.filter((r) => r.status !== 'PENDING').map((r) => r.refId), sourceIds: this.repo.sources().map((s) => s.sourceId) });
  }

  // ── 도메인 검토 ───────────────────────────────────────────

  review(actor: Actor, changeId: string, body: ReviewRefChangeBody) {
    const c = this.mustGet(changeId);
    this.separate(actor, c, 'REVIEW', 'REFDB_CHANGE_REVIEW');
    this.mustBeDecidable(c);
    // TODO(30-95 §8.1): 도메인 검토자의 담당 도메인은 계정 속성이다 — FF 계정에 도메인 범위가 생기면 this.domainOf(c)가 그 범위 안인지 확인한다.
    //                   지금은 계정별 도메인 범위가 없어 모든 도메인을 검토할 수 있다.
    return this.db.tx(() => {
      const review = { reviewerId: actor.id, opinion: body.opinion, comment: body.comment, at: this.clock.iso() };
      // 같은 검토자가 다시 의견을 내면 바꾼다(검토자마다 마지막 의견만), 작성 중(DRAFT)이면 검토 단계로
      const next: RefChange = { ...c, status: 'REVIEW', reviews: [...c.reviews.filter((r) => r.reviewerId !== actor.id), review] };
      this.repo.updateChange(next);
      this.audit.record(actor, 'REFDB_CHANGE_REVIEW', changeId, { before: { status: c.status, reviews: c.reviews.length }, after: review, reason: body.comment, componentId: COMPONENT });
      this.events.publish('refdb.change.reviewed', changeId, { changeId, refId: c.refId, opinion: body.opinion, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(next, actor.role);
    });
  }

  // ── 승인·반려 ─────────────────────────────────────────────

  decide(actor: Actor, changeId: string, body: DecideRefChangeBody) {
    const c = this.mustGet(changeId);
    this.separate(actor, c, 'DECIDE', 'REFDB_CHANGE_DECIDE');
    this.mustBeDecidable(c);
    return this.db.tx(() => {
      let checks = c.checks ?? [];
      if (body.decision === 'APPROVE') {
        if (!c.reviews.length) throw new DomainError('GUARD_FAILED', '도메인 검토 의견이 하나 이상 있어야 승인할 수 있습니다.', { code: 'REVIEW_REQUIRED' });
        // 마지막 검토 의견이 보완·반대면 승인하지 않는다 — 보완한 뒤 다시 동의 의견을 받아야 한다(2026-11-04 결정). 반려는 막지 않는다
        const last = c.reviews.at(-1)!;
        if (last.opinion !== 'AGREE')
          throw new DomainError('GUARD_FAILED', `마지막 도메인 검토 의견이 '${OPINION_KO[last.opinion]}'입니다 — 동의 의견을 받은 뒤 승인하세요.`, { code: 'REVIEW_NOT_AGREED', opinion: last.opinion, reviewerId: last.reviewerId });
        const { row, stale } = this.rowForDecision(c);
        if (stale.length) throw new DomainError('CONFLICT', `요청 뒤에 기준 행 ${c.refId}의 ${stale.join('·')}이(가) 바뀌었습니다 — 반려하고 새로 요청하세요.`, { fields: stale });
        checks = this.checksFor(c.kind, row, true);
        const blockers = approvalBlockers(checks, c, row);
        if (blockers.length) throw new DomainError('GUARD_FAILED', `필수 정보가 빠져 승인할 수 없습니다: ${blockers.map((b) => b.message).join(' / ')}`, { checks: blockers });
      }
      const decision = { decision: body.decision, decidedBy: actor.id, reason: body.reason, at: this.clock.iso() };
      const next: RefChange = { ...c, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision, checks };
      this.repo.updateChange(next);
      this.audit.record(actor, 'REFDB_CHANGE_DECIDE', changeId, { before: { status: c.status }, after: { status: next.status, decision }, reason: body.reason, componentId: COMPONENT });
      this.events.publish('refdb.change.decided', changeId, { changeId, refId: c.refId, kind: c.kind, decision: body.decision, by: actor.id, requestedBy: c.requestedBy }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(next, actor.role);
    });
  }

  /** 승인 때 점검할 행 — ADD는 요청 값(요청 중 행이 있으면 그 위에), 나머지는 지금 행에 차이를 덮은 것 */
  private rowForDecision(c: RefChange): { row: DraftRow; stale: string[] } {
    const cur = this.repo.getRef(c.refId);
    if (c.kind === 'ADD') {
      if (cur && cur.status !== 'PENDING') return { row: { ...cur }, stale: ['refId'] };
      return { row: { ...(cur ?? {}), ...c.after, refId: c.refId }, stale: [] };
    }
    if (!cur) throw new DomainError('NOT_FOUND', `기준 행 ${c.refId}이(가) Feature DB에 없습니다.`);
    return { row: applyDiff(c.kind, cur, c.after), stale: staleFields(cur, c.before) };
  }

  // ── 버전 발행 ─────────────────────────────────────────────

  /** 발행 대상 — 승인된 요청(발행 대기) + 반려된 추가 요청(요청 중 행을 폐기로 정리) 중 아직 발행되지 않은 것 */
  private publishable(): RefChange[] {
    return this.repo.changes().filter((c) => c.release === null && (c.status === 'APPROVED' || (c.status === 'REJECTED' && c.kind === 'ADD' && this.repo.statusOf(c.refId) === 'PENDING')));
  }

  publish(actor: Actor, body: PublishRefReleaseBody) {
    return this.db.tx(() => {
      const candidates = this.publishable();
      const selected = body.changeIds.length
        ? body.changeIds.map((id) => {
            const c = candidates.find((x) => x.changeId === id);
            if (!c) throw new DomainError('CONFLICT', `변경 요청 ${id}은(는) 발행할 수 없습니다 — 승인되고 아직 발행되지 않은 요청만 묶습니다.`, { changeId: id });
            return c;
          })
        : candidates;
      if (!selected.length) throw new DomainError('CONFLICT', '발행할 변경 요청이 없습니다 — 승인된(발행 대기) 요청이 있어야 합니다.');
      const ordered = [...new Map(selected.map((c) => [c.changeId, c])).values()].sort((a, b) => byChangeId(a.changeId, b.changeId));
      const latest = this.repo.latestRelease()?.release;
      const release = nextReleaseId(latest);
      const at = this.clock.iso();
      const applied: { changeId: string; refId: string; kind: string; status: string; taxonomy?: string[] }[] = [];
      const retired: { changeId: string; refId: string; features: { featureId: string; version: string }[] }[] = [];

      for (const c of ordered) {
        const cur = this.repo.getRef(c.refId);
        if (c.status === 'REJECTED') {
          // 반려된 추가 요청 — 요청 중 행을 폐기 + 사유(ID는 다시 쓰지 않는다). 연결된 Feature는 다른 행으로 다시 연결해야 승인할 수 있다
          const row = FeatureRefRow.parse({ ...cur!, status: 'RETIRED', adminMemo: appendMemo(cur!.adminMemo, `${c.changeId} 추가 요청 반려(${release}): ${c.decision?.reason ?? ''}`.trim()) });
          this.repo.updateRef(row, at);
          const features = this.repo.usersOf(c.refId).map((l) => ({ featureId: l.featureId, version: l.version }));
          retired.push({ changeId: c.changeId, refId: c.refId, features });
          for (const f of features)
            this.events.publish(
              REFDB_REF_REJECTED_EVENT,
              `${f.featureId}@${f.version}`,
              { featureId: f.featureId, version: f.version, refId: c.refId, nameKo: row.nameKo, changeId: c.changeId, reason: c.decision?.reason ?? '', release, by: actor.id },
              { componentId: COMPONENT, correlationId: actor.correlationId },
            );
          applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status: 'RETIRED' });
          continue;
        }
        if (c.kind === 'ADD') {
          if (cur && cur.status !== 'PENDING') throw new DomainError('CONFLICT', `기준 행 ${c.refId}이(가) 이미 Feature DB에 있습니다 — ${c.changeId}을(를) 발행할 수 없습니다.`, { changeId: c.changeId });
          const merged = { ...(cur ?? {}), ...c.after, refId: c.refId } as DraftRow;
          const status = addStatus(c, merged);
          const attrNote = refAttrMissing(merged as FeatureRefRow) ? ' — SW 계층·수명주기·기술 영역 미입력으로 검토 필요' : '';
          const row = FeatureRefRow.parse({ ...merged, status, registeredIn: release, adminMemo: appendMemo(merged.adminMemo ?? '', `${c.changeId} 추가 승인·${release} 발행${attrNote}`) });
          if (cur) this.repo.updateRef(row, at);
          else this.repo.insertRef(row, at);
          const taxonomy = this.addProposedComponent(c, row);
          applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status, ...(taxonomy.length ? { taxonomy } : {}) });
          continue;
        }
        if (!cur) throw new DomainError('NOT_FOUND', `기준 행 ${c.refId}이(가) Feature DB에 없습니다.`);
        const stale = staleFields(cur, c.before);
        if (stale.length) throw new DomainError('CONFLICT', `요청 ${c.changeId} 뒤에 기준 행 ${c.refId}의 ${stale.join('·')}이(가) 바뀌었습니다 — 이 요청을 빼고 발행하세요.`, { changeId: c.changeId, fields: stale });
        const row = FeatureRefRow.parse(applyDiff(c.kind, cur, c.after));
        this.repo.updateRef(row, at);
        applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status: row.status });
      }

      const hash = refdbHash(this.repo.listRefs());
      const rel = RefRelease.parse({ release, publishedBy: actor.id, publishedAt: at, changeIds: ordered.map((c) => c.changeId), hash, ...(body.note ? { note: body.note } : {}) });
      this.repo.insertRelease(rel);
      for (const c of ordered) this.repo.updateChange({ ...c, status: c.status === 'APPROVED' ? 'PUBLISHED' : c.status, release });
      this.audit.record(actor, 'REFDB_RELEASE_PUBLISH', release, { before: { release: latest ?? null }, after: { release, changeIds: rel.changeIds, hash, applied }, reason: body.note || `Feature DB ${release} 발행`, componentId: COMPONENT });
      this.events.publish('refdb.release.published', release, { release, changeIds: rel.changeIds, hash, by: actor.id, retired: retired.map((r) => r.refId) }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return { release: rel, applied, retired };
    });
  }

  /**
   * 추가 요청이 제안한 새 컴포넌트를 분류 표에 만든다(승인 발행 때) — 없는 클러스터도 함께. 만든 노드 ID.
   * 노드 모양은 가져오기(tools/refdb/import) 관례: 클러스터 '도메인약어:이름', 컴포넌트 '도메인약어/이름' + abbrs·clusterIds.
   */
  private addProposedComponent(c: RefChange, row: FeatureRefRow): string[] {
    const nc = c.newComponent;
    if (!nc) return [];
    const domainAbbr = domainAbbrOf(row.domain);
    if (!domainAbbr) return [];
    const tax = this.repo.taxonomy() as ComponentNode[];
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (tax.some((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && (same(n.nameEn, nc.component) || n.abbr === nc.abbr || !!n.abbrs?.includes(nc.abbr)))) return [];
    const made: string[] = [];
    let cluster = tax.find((n) => n.level === 'CLUSTER' && n.parentId === domainAbbr && same(n.nameEn, nc.cluster));
    if (!cluster) {
      cluster = { nodeId: `${domainAbbr}:${nc.cluster}`, level: 'CLUSTER', parentId: domainAbbr, nameEn: nc.cluster, nameKo: '', abbr: null, status: 'ACTIVE' };
      this.repo.insertTaxonomy(cluster);
      made.push(cluster.nodeId);
    }
    const node: ComponentNode = { nodeId: `${domainAbbr}/${nc.component}`, level: 'COMPONENT', parentId: domainAbbr, nameEn: nc.component, nameKo: '', abbr: nc.abbr, abbrs: [nc.abbr], clusterIds: [cluster.nodeId], status: 'ACTIVE' };
    this.repo.insertTaxonomy(node);
    made.push(node.nodeId);
    return made;
  }

  // ── 발행 미리 보기(P5-4) ───────────────────────────────────

  /**
   * 다음 발행에 묶일 것 — 승인 요청(발행 대기)과 반려된 추가 요청(요청 중 행 → 폐기), 폐기 행을 연결한 Feature Owner(알림 대상),
   * 품질 지표 전후. 발행과 같은 규칙으로 계산하지만 아무것도 쓰지 않는다. 메모 기본값(발행 메모 필수 — 화면이 미리 채운다)도 준다.
   */
  preview() {
    const candidates = [...this.publishable()].sort((a, b) => byChangeId(a.changeId, b.changeId));
    const latest = this.repo.latestRelease()?.release;
    const release = nextReleaseId(latest);
    const refs = this.repo.listRefs();
    const byId = new Map(refs.map((r) => [r.refId, { ...r }]));
    const approved: { changeId: string; kind: string; refId: string; nameKo: string | null; status: string; requestedBy: string; decidedBy: string | null; decidedAt: string | null }[] = [];
    const retiring: { changeId: string; refId: string; nameKo: string | null; reason: string }[] = [];
    const notify: { featureId: string; version: string; name: string | null; ownerId: string | null; refId: string }[] = [];
    for (const c of candidates) {
      const cur = byId.get(c.refId);
      if (c.status === 'REJECTED') {
        if (cur) byId.set(c.refId, { ...cur, status: 'RETIRED' });
        retiring.push({ changeId: c.changeId, refId: c.refId, nameKo: cur?.nameKo ?? null, reason: c.decision?.reason ?? '' });
        for (const l of this.repo.usersOf(c.refId)) notify.push({ featureId: l.featureId, version: l.version, refId: c.refId, ...this.repo.featureOwner(l.featureId, l.version) });
        continue;
      }
      let status: string;
      if (c.kind === 'ADD') {
        const merged = { ...(cur ?? {}), ...c.after, refId: c.refId } as FeatureRefRow;
        status = addStatus(c, merged);
        byId.set(c.refId, { ...merged, status } as FeatureRefRow);
      } else if (cur) {
        const row = applyDiff(c.kind, cur, c.after);
        status = row.status;
        byId.set(c.refId, row);
      } else status = '—';
      approved.push({ changeId: c.changeId, kind: c.kind, refId: c.refId, nameKo: byId.get(c.refId)?.nameKo ?? null, status, requestedBy: c.requestedBy, decidedBy: c.decision?.decidedBy ?? null, decidedAt: c.decision?.at ?? null });
    }
    const releases = this.repo.releases();
    const changes = this.repo.changes();
    const now = this.clock.iso();
    const before = refQuality(refs, releases, changes, now);
    const ids = new Set(candidates.map((c) => c.changeId));
    const after = refQuality([...byId.values()], releases, changes.map((c) => (ids.has(c.changeId) ? { ...c, status: c.status === 'APPROVED' ? ('PUBLISHED' as const) : c.status, release } : c)), now);
    const pick = (q: typeof before) => ({ published: q.published, pending: q.pending, byStatus: q.byStatus, noSource: q.noSource, attrMissing: q.attrMissing, awaitingPublish: q.awaitingPublish });
    const memo = [`Feature DB ${release} 발행`, approved.length ? `승인 ${approved.length}건(${approved.map((a) => a.changeId).join(', ')})` : '', retiring.length ? `반려 정리 ${retiring.length}건(${retiring.map((r) => r.changeId).join(', ')})` : ''].filter(Boolean).join(' — ');
    return { release, latest: latest ?? null, total: candidates.length, approved, retiring, notify, quality: { before: pick(before), after: pick(after) }, memo };
  }

  // ── 감사 이력(P5-6) ──────────────────────────────────────

  /** 변경 요청 한 건의 감사 이력 — 요청 번호·대상 행(추가 요청)·발행 버전에 남은 기록을 시간 순으로. 금액 값은 감사에 남기지 않았다 */
  auditTrail(changeId: string) {
    const c = this.mustGet(changeId);
    const mine = (e: AuditEntry) => {
      if (e.target === changeId) return true;
      const after = (e.after ?? {}) as { changeId?: string; changeIds?: string[] };
      if (e.target === c.refId && e.action === 'REFDB_ADD_REQUEST') return after.changeId === changeId;
      if (c.release && e.target === c.release && e.action === 'REFDB_RELEASE_PUBLISH') return !!after.changeIds?.includes(changeId);
      return false;
    };
    const rows = [...this.audit.list({ target: changeId, limit: 1000 }), ...this.audit.list({ target: c.refId, limit: 1000 }), ...(c.release ? this.audit.list({ target: c.release, limit: 1000 }) : [])].filter(mine);
    const seen = new Set<number>();
    const items = rows
      .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      .sort((a, b) => a.id - b.id)
      .map((e) => ({ id: e.id, at: e.at, actorId: e.actorId, actorRole: e.actorRole, action: e.action, stage: AUDIT_STAGE[e.action] ?? null, target: e.target, result: e.result, reason: e.reason, before: maskMoney(e.before as Record<string, unknown> | null), after: maskMoney(e.after as Record<string, unknown> | null) }));
    const release = c.release ? (this.repo.releases().find((r) => r.release === c.release) ?? null) : null;
    return {
      changeId,
      refId: c.refId,
      items,
      decision: c.decision ? { decision: c.decision.decision, decidedBy: c.decision.decidedBy, at: c.decision.at } : null,
      release: release ? { release: release.release, publishedBy: release.publishedBy, publishedAt: release.publishedAt, note: release.note ?? null } : null,
    };
  }

  // ── 공통 ─────────────────────────────────────────────────

  private mustGet(changeId: string): RefChange {
    const c = this.repo.getChange(changeId);
    if (!c) throw new DomainError('NOT_FOUND', `변경 요청 ${changeId}이(가) 없습니다.`);
    return c;
  }

  private mustBeDecidable(c: RefChange) {
    if (!DECIDABLE.includes(c.status)) throw new DomainError('CONFLICT', `변경 요청 ${c.changeId}은(는) 검토·승인할 단계가 아닙니다(지금 ${c.status}).`, { status: c.status });
  }

  /** 직무 분리(SOD-13·14·15, 계정 기준) — 막히면 거부 감사(독립 트랜잭션, 사유에 규칙 ID)를 남기고 403 */
  private separate(actor: Actor, c: RefChange, stage: 'REVIEW' | 'DECIDE', action: string) {
    const blocked = refChangeDuty(c, actor.id, stage);
    if (!blocked) return;
    this.audit.denied(actor, action, c.changeId, `${blocked.message} (${blocked.rule})`, COMPONENT);
    throw new DomainError('SEPARATION_OF_DUTY', blocked.message, { rule: blocked.rule, changeId: c.changeId });
  }
}
