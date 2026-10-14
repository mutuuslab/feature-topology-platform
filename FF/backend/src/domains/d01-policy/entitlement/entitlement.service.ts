// 사용 권한 관리 (D01-05) — 체험권·구독·구매 권한. 체험권은 기간형(2026-10-13 결정):
//   제안(OFFERED, 14일 안에 수락) → 수락(ACTIVE, 수락일부터 30일 기능 ON) → 만료 / 거절 / 구매 전환(CONVERTED, 과금 연계 D05-04가 부른다).
// 상태·유효 판단은 contracts/rules/trial.ts grantState 한 곳 — 저장된 상태가 ACTIVE여도 기간이 지나면 OFF.
import { Inject, Injectable } from '@nestjs/common';
import { addDays, grantState, SEGMENT_DIMENSIONS, TRIAL_DAYS, type Entitlement, type OfferTrialsBody, type TrialState, type VehicleProfile } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo } from '../policy-repos';
import { BaselineRepo, ProductRepo } from '../repos';

export type GrantView = Entitlement & { state: TrialState; effective: boolean; daysLeft: number | null };
export type Source = 'DEMO' | 'SYNTHETIC' | 'ALL';
export const asSource = (s?: string): Source => (s === 'SYNTHETIC' || s === 'ALL' ? s : 'DEMO');

export interface TrialQuery {
  catalogId?: string;
  state?: string;
  source?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  /** 성향 필터 — country·region·vehicleModel·trim·ageBand·drivingStyle·adasUsage */
  segment?: Partial<Record<(typeof SEGMENT_DIMENSIONS)[number], string>>;
}

@Injectable()
@PlatformComponent('D01-05')
export class EntitlementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly products: ProductRepo,
    private readonly baselines: BaselineRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  today() {
    return this.clock.kst().slice(0, 10);
  }

  view(g: Entitlement, today = this.today()): GrantView {
    const s = grantState(g, today);
    return { ...g, state: s.state, effective: s.effective && (g.usesLeft === null || g.usesLeft > 0), daysLeft: s.daysLeft };
  }

  grants(vin?: string, source?: string) {
    const today = this.today();
    return this.fleet.grants(vin, asSource(source)).map((g) => this.view(g, today));
  }

  /** 이 차량이 이 Feature를 쓸 수 있는 유효한 권한이 있나 — 그 Feature의 Baseline을 구성에 가진 상품의 권한 */
  activeFor(vin: string, featureId: string): { active: boolean; grants: Entitlement[] } {
    const bls = this.baselines.forFeature(featureId).map((b) => b.baselineId);
    const cats = new Set(this.products.all().filter((p) => p.baselineIds.some((b) => bls.includes(b))).map((p) => p.catalogId));
    const today = this.today();
    const grants = this.fleet.grants(vin).filter((g) => cats.has(g.catalogId));
    return { active: grants.some((g) => this.view(g, today).effective), grants };
  }

  /** 체험권 차량 목록 — 상태·성향 필터, 쪽 나눔. 차량 성향(가명 구간값)을 함께 돌려준다 */
  trials(q: TrialQuery) {
    const today = this.today();
    const profiles = this.fleet.profiles();
    const source = asSource(q.source ?? 'ALL');
    const rows = (q.catalogId ? this.fleet.grantsForCatalog(q.catalogId, source) : this.fleet.grants(undefined, source))
      .filter((g) => g.kind === '체험')
      .map((g) => ({ ...this.view(g, today), profile: profiles.get(g.vin) ?? null }));
    const needle = q.q?.trim().toLowerCase();
    const scoped = rows.filter(
      (r) =>
        (!needle || r.vin.toLowerCase().includes(needle) || r.grantId.toLowerCase().includes(needle)) &&
        Object.entries(q.segment ?? {}).every(([k, v]) => !v || (r.profile as VehicleProfile | null)?.[k as keyof VehicleProfile] === v),
    );
    // 상태별 개수는 상태 필터 전 — 화면의 상태 선택지에 개수를 붙인다
    const byState: Record<string, number> = {};
    for (const r of scoped) byState[r.state] = (byState[r.state] ?? 0) + 1;
    const filtered = q.state ? scoped.filter((r) => r.state === q.state) : scoped;
    // 데모 차량이 먼저, 그다음 최근 제안 순
    filtered.sort((a, b) => (a.source === b.source ? (b.offeredAt ?? b.validFrom).localeCompare(a.offeredAt ?? a.validFrom) || a.grantId.localeCompare(b.grantId) : a.source === 'DEMO' ? -1 : 1));
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 200);
    const page = Math.max(q.page ?? 1, 1);
    return { today, total: filtered.length, page, pageSize, byState, items: filtered.slice((page - 1) * pageSize, page * pageSize) };
  }

  /** 차량별 체험 제안 — 같은 상품의 열린 체험·전환 이력·유효한 구독/구매가 있으면 건너뛴다 */
  offer(actor: Actor, body: OfferTrialsBody) {
    if (!this.products.all().some((p) => p.catalogId === body.catalogId)) throw new DomainError('NOT_FOUND', `${body.catalogId} 상품을 찾을 수 없습니다.`);
    const today = this.today();
    const offered: GrantView[] = [];
    const skipped: { vin: string; reason: string }[] = [];
    this.db.tx(() => {
      for (const vin of [...new Set(body.vins)]) {
        if (!this.fleet.vehicle(vin)) {
          skipped.push({ vin, reason: 'Fleet에 없는 차량' });
          continue;
        }
        const mine = this.fleet.grants(vin).filter((g) => g.catalogId === body.catalogId).map((g) => this.view(g, today));
        const blocking = mine.find((g) => (g.kind === '체험' && (g.state === 'OFFERED' || g.state === 'ACTIVE' || g.state === 'CONVERTED')) || (g.kind !== '체험' && g.effective));
        if (blocking) {
          skipped.push({ vin, reason: `${blocking.grantId} ${blocking.kind} ${blocking.state}` });
          continue;
        }
        const g: Entitlement = {
          grantId: this.fleet.nextGrantId(),
          vin,
          catalogId: body.catalogId,
          kind: '체험',
          validFrom: today,
          validTo: addDays(today, 13),
          usesLeft: null,
          status: 'OFFERED',
          offeredAt: today,
          acceptedAt: null,
          trialDays: null,
          convertedAt: null,
          convertedPlan: null,
          fromTrial: null,
          source: 'DEMO',
          note: body.note ?? null,
          noticeId: null,
          noticeAt: null,
          noticeFor: null,
          expiredAt: null,
        };
        this.fleet.insertGrant(g);
        this.audit.record(actor, 'TRIAL_OFFER', g.grantId, { after: { vin, catalogId: g.catalogId, validTo: g.validTo }, componentId: 'D01-05' });
        this.events.publish('entitlement.offered', vin, { grantId: g.grantId, catalogId: g.catalogId, offerUntil: g.validTo }, { componentId: 'D01-05', correlationId: actor.correlationId });
        offered.push(this.view(g, today));
      }
    });
    return { offered, skipped };
  }

  /** 체험 수락 (IVI·차량 보고 TRIAL_ACCEPT·운영 콘솔) — 수락일부터 30일 기능 ON */
  accept(actor: Actor, grantId: string) {
    const g = this.mustTrial(actor, grantId, 'TRIAL_ACCEPT');
    const today = this.today();
    const s = grantState(g, today).state;
    if (s !== 'OFFERED') return this.refuse(actor, 'TRIAL_ACCEPT', g, `수락할 수 없는 체험권입니다 (${s}${g.acceptedAt ? `, ${g.acceptedAt} 수락` : ''}).`);
    return this.db.tx(() => {
      const next: Entitlement = { ...g, status: 'ACTIVE', acceptedAt: today, validFrom: today, validTo: addDays(today, TRIAL_DAYS - 1), trialDays: TRIAL_DAYS };
      this.fleet.updateGrant(next);
      this.audit.record(actor, 'TRIAL_ACCEPT', grantId, { before: { status: g.status }, after: { status: next.status, validFrom: next.validFrom, validTo: next.validTo }, componentId: 'D01-05' });
      this.events.publish('entitlement.accepted', g.vin, { grantId, catalogId: g.catalogId, validFrom: next.validFrom, validTo: next.validTo }, { componentId: 'D01-05', correlationId: actor.correlationId });
      return this.view(next, today);
    });
  }

  decline(actor: Actor, grantId: string, reason?: string) {
    const g = this.mustTrial(actor, grantId, 'TRIAL_DECLINE');
    const today = this.today();
    const s = grantState(g, today).state;
    if (s !== 'OFFERED') return this.refuse(actor, 'TRIAL_DECLINE', g, `거절할 수 없는 체험권입니다 (${s}).`);
    return this.db.tx(() => {
      const next: Entitlement = { ...g, status: 'DECLINED', note: reason ?? g.note };
      this.fleet.updateGrant(next);
      this.audit.record(actor, 'TRIAL_DECLINE', grantId, { before: { status: g.status }, after: { status: 'DECLINED', reason: reason ?? null }, componentId: 'D01-05' });
      this.events.publish('entitlement.declined', g.vin, { grantId, catalogId: g.catalogId }, { componentId: 'D01-05', correlationId: actor.correlationId });
      return this.view(next, today);
    });
  }

  /** 구매 전환할 수 있나 — 수락한 체험(체험 중이거나 기간이 끝난 뒤)만. 과금 연계 전에 확인한다 */
  convertible(actor: Actor, grantId: string): Entitlement {
    const g = this.mustTrial(actor, grantId, 'TRIAL_PURCHASE');
    const s = grantState(g, this.today()).state;
    if (!g.acceptedAt || (s !== 'ACTIVE' && s !== 'EXPIRED')) return this.refuse(actor, 'TRIAL_PURCHASE', g, `구매로 전환할 수 없는 체험권입니다 (${s}${g.acceptedAt ? '' : ', 수락 전'}).`);
    return g;
  }

  /** 구매 전환 기록 — 과금 연계(D05-04)가 결제 확인 뒤 같은 트랜잭션 안에서 부른다. 체험은 CONVERTED, 구독·구매 권한이 새로 생긴다 */
  convert(actor: Actor, trial: Entitlement, plan: '구독' | '구매', orderId: string) {
    const today = this.today();
    const done: Entitlement = { ...trial, status: 'CONVERTED', convertedAt: today, convertedPlan: plan };
    const grant: Entitlement = {
      grantId: this.fleet.nextGrantId(),
      vin: trial.vin,
      catalogId: trial.catalogId,
      kind: plan,
      validFrom: today,
      validTo: plan === '구독' ? addDays(today, 364) : '9999-12-31',
      usesLeft: null,
      status: 'ACTIVE',
      offeredAt: null,
      acceptedAt: null,
      trialDays: null,
      convertedAt: null,
      convertedPlan: null,
      fromTrial: trial.grantId,
      source: trial.source,
      note: `주문 ${orderId}`,
      noticeId: null,
      noticeAt: null,
      noticeFor: null,
      expiredAt: null,
    };
    this.fleet.updateGrant(done);
    this.fleet.insertGrant(grant);
    this.audit.record(actor, 'TRIAL_PURCHASE', trial.grantId, { before: { status: trial.status }, after: { status: 'CONVERTED', plan, grantId: grant.grantId, orderId }, componentId: 'D05-04' });
    this.events.publish('entitlement.converted', trial.vin, { grantId: trial.grantId, newGrantId: grant.grantId, catalogId: trial.catalogId, plan, orderId }, { componentId: 'D05-04', correlationId: actor.correlationId });
    return { trial: this.view(done, today), grant: this.view(grant, today) };
  }

  private mustTrial(actor: Actor, grantId: string, action: string): Entitlement {
    const g = this.fleet.grant(grantId);
    if (!g) throw new DomainError('NOT_FOUND', `${grantId}을(를) 찾을 수 없습니다.`);
    if (g.kind !== '체험') return this.refuse(actor, action, g, `${grantId}은(는) 체험권이 아닙니다 (${g.kind}).`);
    return g;
  }

  private refuse(actor: Actor, action: string, g: Entitlement, message: string): never {
    this.audit.failed(actor, action, g.grantId, message, 'D01-05');
    throw new DomainError('GUARD_FAILED', message, { grantId: g.grantId, status: g.status });
  }
}
