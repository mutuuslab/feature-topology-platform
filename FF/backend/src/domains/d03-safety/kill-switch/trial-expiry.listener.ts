// 체험권 만료 → 상업 사유 차단 요청 (D03-03, 보고서 v1.1 FFG-LCY-010·FFG-DEAC-004) — 사용 권한(D01-05)의 만료 sweep이 낸 trial.expired 중
// F2 이상 Feature는 평가 변화만으로 끄지 않고 kill_command v2 deactivate(COMMERCIAL / TRIAL_EXPIRED, Registry DC → 차량에서 DC3·INACTIVE)로 낸다.
// 만료 전 사용자 고지(trial.expiry.notice)가 있어야 한다 — 없으면 요청을 만들지 않고 감사 FAILED·trial.expiry.blocked(고지 없는 F2 이상 상업 명령 금지).
// 진행 중 차단이 있으면 덮어쓰지 않는다(DEAC-004). 요청은 시스템이 만들고 발행은 기존 승인함의 2인 승인(요청자 = 시스템 제외)을 거친다.
// F0·F1은 지금처럼 평가 변화(OFREP·활성화 판단)만으로 끈다.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { DB, type Db } from '../../../kernel/db';
import { Inject } from '@nestjs/common';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { KillService } from './kill.service';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'trial-expiry' };

interface TrialExpired {
  grantId: string;
  vin: string;
  catalogId: string;
  featureIds: string[];
  fClassMax: string | null;
  validTo: string;
  noticeId: string | null;
  noticeAt: string | null;
  expiredAt: string;
}

@Injectable()
export class TrialExpiryListener implements OnModuleInit {
  private readonly log = new Logger('TrialExpiry');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly kills: KillService,
    private readonly policies: PolicyRepo,
    private readonly profiles: SafetyProfileService,
  ) {}

  onModuleInit() {
    this.events.stream(['trial.expired']).subscribe((e) => {
      try {
        this.onExpired(e.payload as TrialExpired);
      } catch (err) {
        this.log.error(`trial.expired 처리 실패: ${(err as Error).message}`);
      }
    });
  }

  /**
   * 이 체험권으로 켜지는 Feature의 Version — 그 상품 사용 권한을 요구하는 배포 정책(entitlementCatalogId)이 있는 Feature만.
   * 상품에 묶인 기반 기능(REQUIRES 대상 등)은 체험과 무관하게 동작하므로 끄지 않는다.
   */
  private versionOf(featureId: string, catalogId: string): string | null {
    return this.policies.all().find((p) => p.featureId === featureId && p.status === 'DEPLOYED' && p.entitlementCatalogId === catalogId)?.featureVersion ?? null;
  }

  /**
   * @rule FFG-LCY-010 — 차단 쪽: F2 이상 체험 만료는 고지 뒤 상업 사유 명령(DC3·INACTIVE)으로, 고지 없으면 명령 금지. 차량의 작동 중 미적용은 Guard(ACT_PENDING·DC3)
   */
  onExpired(t: TrialExpired): string[] {
    const made: string[] = [];
    for (const featureId of t.featureIds) {
      const version = this.versionOf(featureId, t.catalogId);
      if (!version) continue;
      const fClass = this.profiles.list(featureId).find((p) => p.version === version)?.fClass ?? null;
      if (fClass !== null && fClass < 'F2') continue; // F0·F1 — 평가 변화만으로 충분
      const target = `${featureId}@${version}`;
      if (!t.noticeId) {
        this.audit.failed(SYSTEM, 'TRIAL_EXPIRY_KILL', target, `${t.grantId} ${t.vin}: 만료 전 사용자 고지 없음 — 고지 없는 F2 이상 상업 명령 금지(FFG-PLT-006·LCY-010)`, 'D03-03');
        this.db.tx(() => this.events.publish('trial.expiry.blocked', t.vin, { ...t, featureId, version, reason: 'NO_NOTICE' }, { componentId: 'D03-03' }));
        continue;
      }
      try {
        const k = this.kills.issue(
          SYSTEM,
          { featureId, featureVersion: version, vins: [t.vin], reasonCategory: 'COMMERCIAL', reasonCode: 'TRIAL_EXPIRED', reason: `체험권 ${t.grantId} 만료(${t.validTo}) — 고지 ${t.noticeId}`, confirm: featureId },
          { userNoticeRef: t.noticeId },
        );
        made.push(k.killId);
      } catch (err) {
        // 진행 중 차단(CONFLICT)은 덮어쓰지 않는다(DEAC-004) — 그 밖의 거부도 기록만
        const msg = err instanceof DomainError ? `${err.code} ${err.message}` : (err as Error).message;
        this.audit.failed(SYSTEM, 'TRIAL_EXPIRY_KILL', target, `${t.grantId} ${t.vin}: ${msg}`, 'D03-03');
      }
    }
    return made;
  }
}
