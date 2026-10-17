// 체험권 만료 sweep (D01-05) — 하루 한 번 수락된 체험(저장 상태 ACTIVE)을 훑어 만료 사전 고지와 만료 확정을 낸다.
// @rule FFG-LCY-010 — F2 이상 Feature의 상업 비활성화는 시장 Profile이 요구하는 사용자 고지 뒤에만 적용한다.
//   trial.expiry.notice: 만료 TRIAL_NOTICE_DAYS일 전, 만료일마다 한 번(연장되면 다시) — 고지 ID(NTC-NNNNN)는 차단 명령의 user_notice.text_ref
//   trial.expired:       만료일 다음 날 저장 상태를 EXPIRED로 확정하며 낸다 — 그 만료일에 대한 고지가 없었으면 noticeId·noticeAt = null
//   F2 이상 → COMMERCIAL 차단 요청(D03-03 trial-expiry.listener), F0·F1은 평가 변화(trialSessionValid=false)만.
// 대상은 데모 원천(DEMO) 체험권 — 합성 모집단(SYNTHETIC)은 통계용이라 차량이 없다.
// 부팅 때 한 번 + 24시간마다. FF_SCHEDULER=manual(시험)이면 타이머 없이 sweep()을 직접 부르고, FF_TRIAL_SWEEP=off면 돌지 않는다.
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { fRank, isSampleVin, noticeOf, trialSweepPlan, type Entitlement, type FClass } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { Scheduler } from '../../../kernel/scheduler';
import { FleetRepo } from '../policy-repos';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { BaselineRepo, ProductRepo } from '../repos';

const SYSTEM: Actor = { id: 'system:trial-expiry', role: 'SYSTEM', correlationId: 'trial-expiry-sweep' };
const DAY_MS = 24 * 3600_000;
const pad = (n: number) => String(n).padStart(5, '0');

export interface TrialNoticePayload {
  grantId: string;
  vin: string;
  catalogId: string;
  featureIds: string[];
  fClassMax: FClass | null;
  validTo: string;
  noticeId: string | null;
  noticeAt: string | null;
}
export type TrialExpiredPayload = TrialNoticePayload & { expiredAt: string };

@Injectable()
export class TrialExpiryService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly products: ProductRepo,
    private readonly baselines: BaselineRepo,
    private readonly safety: SafetyProfileService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  onApplicationBootstrap() {
    if (this.scheduler.manual || process.env.FF_TRIAL_SWEEP === 'off') return;
    const tick = () => {
      this.sweep();
      this.scheduler.after(DAY_MS, tick);
    };
    tick();
  }

  /** 하루 한 번 — 오늘(KST) 기준으로 고지·만료를 낸다. 같은 날 다시 불러도 결과가 늘지 않는다(멱등) */
  sweep(today = this.clock.kst().slice(0, 10)) {
    const notices: TrialNoticePayload[] = [];
    const expired: TrialExpiredPayload[] = [];
    // 데모 권한 + 5년 운영 표본 권한(실제 경로로 제안·수락된 것). 통계용 합성 시드(SYN-…)는 과거 기록이라 sweep하지 않는다
    for (const g of this.fleet.activeGrants().filter((x) => x.source === 'DEMO' || isSampleVin(x.vin))) {
      const plan = trialSweepPlan(g, today);
      if (plan === 'NOTICE') notices.push(this.notice(g));
      else if (plan === 'EXPIRE') expired.push(this.expire(g));
    }
    return { today, notices, expired };
  }

  /** 상품(모든 Version)의 Baseline → Feature Version과 그중 가장 높은 안전 분류 */
  private scope(catalogId: string): { featureIds: string[]; fClassMax: FClass | null } {
    const bls = new Set(this.products.all().filter((p) => p.catalogId === catalogId).flatMap((p) => p.baselineIds));
    const fvs = [...bls].map((id) => this.baselines.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
    const featureIds = [...new Set(fvs.map((b) => b.featureId))].sort();
    let fClassMax: FClass | null = null;
    for (const b of fvs) {
      const f = this.safety.ensure(b.featureId, b.version).fClass;
      if (!fClassMax || fRank(f) > fRank(fClassMax)) fClassMax = f;
    }
    return { featureIds, fClassMax };
  }

  private base(g: Entitlement) {
    return { grantId: g.grantId, vin: g.vin, catalogId: g.catalogId, ...this.scope(g.catalogId), validTo: g.validTo };
  }

  private nextNoticeId(): string {
    const r = this.db.get<{ m: string | null }>('SELECT max(notice_id) AS m FROM trial_notice');
    return `NTC-${pad(r?.m ? Number(r.m.slice(4)) + 1 : 1)}`;
  }

  private notice(g: Entitlement): TrialNoticePayload {
    return this.db.tx(() => {
      const noticeId = this.nextNoticeId();
      const noticeAt = this.clock.iso();
      const payload: TrialNoticePayload = { ...this.base(g), noticeId, noticeAt };
      this.db.run('INSERT INTO trial_notice (notice_id, grant_id, valid_to, at, doc) VALUES (?, ?, ?, ?, ?)', noticeId, g.grantId, g.validTo, noticeAt, JSON.stringify(payload));
      this.fleet.updateGrant({ ...g, noticeId, noticeAt, noticeFor: g.validTo });
      this.audit.record(SYSTEM, 'TRIAL_EXPIRY_NOTICE', g.grantId, { after: { noticeId, validTo: g.validTo, fClassMax: payload.fClassMax }, componentId: 'D01-05' });
      this.events.publish('trial.expiry.notice', g.vin, payload, { componentId: 'D01-05', correlationId: SYSTEM.correlationId });
      return payload;
    });
  }

  private expire(g: Entitlement): TrialExpiredPayload {
    return this.db.tx(() => {
      const expiredAt = this.clock.iso();
      const payload: TrialExpiredPayload = { ...this.base(g), ...noticeOf(g), expiredAt };
      this.fleet.updateGrant({ ...g, status: 'EXPIRED', expiredAt });
      this.audit.record(SYSTEM, 'TRIAL_EXPIRED', g.grantId, { before: { status: g.status }, after: { status: 'EXPIRED', noticeId: payload.noticeId, fClassMax: payload.fClassMax }, componentId: 'D01-05' });
      this.events.publish('trial.expired', g.vin, payload, { componentId: 'D01-05', correlationId: SYSTEM.correlationId });
      return payload;
    });
  }
}
