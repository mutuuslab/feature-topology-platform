// 차단 요청 접수·비활성화 조건 확인 (D03-03, P11a — 결정 D1 (a): 2인 승인 유지, 자동은 '중단 필요' 알림, 외부는 '차단 요청 접수'까지).
// · 외부 시스템(API 키, SYSTEM 역할 — FR-AGW-001-002): 차단을 실행하지 않는다. 접수(KIN-)만 만들고 상태 조회로 결과(옮긴 차단 ID·상태)를 돌려준다.
// · 이상 징후(FR-SVS-002-001): 열림·격상마다 비활성화 조건 넷을 확인해 기록(DCK-, 추가만). 충족이면 접수 + '중단 필요' 알림, 미충족이면 사유만.
// 접수는 운영자가 차단 요청(type-to-confirm·사유·범위)으로 옮기거나(CONVERTED) 사유와 함께 닫는다(DISMISSED). 발행은 늘 사람 2인 승인 뒤.
import { Body, Controller, Get, Inject, Injectable, Logger, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { deactivationCheck, KillIntakeBody, KillIntakeDismissBody, type KillIntake, type KillIntakeSource } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';
import { KillRepo } from './kill.repo';
import { KILL_ROLES, KillService } from './kill.service';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'deactivation-check' };
const pad = (n: number) => String(n).padStart(5, '0');

export interface DeactivationCheckRecord {
  checkId: string;
  anomalyId: string;
  featureId: string;
  featureVersion: string | null;
  advice: string;
  severity: string;
  met: boolean;
  conditions: ReturnType<typeof deactivationCheck>['conditions'];
  unmet: string[];
  intakeId: string | null;
  checkedAt: string;
}

@Injectable()
@PlatformComponent('D03-03')
export class KillIntakeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly kills: KillService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  private nextId() {
    return `KIN-${pad(this.db.get<{ n: number }>('SELECT count(*) AS n FROM kill_intake')!.n + 1)}`;
  }

  /** 접수 — 대상 Feature·범위를 미리보기와 같은 규칙으로 확인하고 접수만 남긴다(실행 없음). 호출자 트랜잭션이 없으면 새로 연다 */
  receive(actor: Actor, body: KillIntakeBody, opts: { source: KillIntakeSource; anomalyId?: string | null; checkId?: string | null } = { source: 'EXTERNAL' }): KillIntake {
    const pv = this.kills.preview(body.featureId, body.featureVersion, body.vins, body.reasonCategory, body.scope);
    if (pv.unknownVins.length) {
      this.audit.failed(actor, 'KILL_INTAKE', body.featureId, `영향 범위 밖 차량: ${pv.unknownVins.join(', ')}`, 'D03-03');
      throw new DomainError('VALIDATION', `영향 범위 밖의 차량이 있습니다: ${pv.unknownVins.join(', ')}`, { unknownVins: pv.unknownVins });
    }
    const make = () => {
      const i: KillIntake = {
        intakeId: this.nextId(),
        source: opts.source,
        status: 'RECEIVED',
        featureId: body.featureId,
        featureVersion: body.featureVersion,
        reasonCategory: body.reasonCategory,
        reasonCode: body.reasonCode,
        reason: body.reason,
        vins: pv.scoped.map((v) => v.vin),
        scope: pv.scopeKinds.length ? (body.scope ?? null) : null,
        externalRef: body.externalRef ?? null,
        anomalyId: opts.anomalyId ?? null,
        checkId: opts.checkId ?? null,
        receivedBy: actor.id,
        receivedAt: this.clock.iso(),
        killId: null,
        closedBy: null,
        closedAt: null,
        closeReason: null,
      };
      this.db.run('INSERT INTO kill_intake (intake_id, feature_id, source, status, anomaly_id, received_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', i.intakeId, i.featureId, i.source, i.status, i.anomalyId, i.receivedAt, JSON.stringify(i));
      this.audit.record(actor, 'KILL_INTAKE', i.intakeId, { after: { source: i.source, featureId: i.featureId, vins: i.vins.length, externalRef: i.externalRef, anomalyId: i.anomalyId }, reason: i.reason, componentId: 'D03-03' });
      this.events.publish(
        'kill.intake-received',
        i.intakeId,
        { intakeId: i.intakeId, source: i.source, featureId: i.featureId, featureVersion: i.featureVersion, vins: i.vins.length, reason: i.reason, reasonCategory: i.reasonCategory, anomalyId: i.anomalyId, externalRef: i.externalRef, checkId: i.checkId },
        { componentId: 'D03-03', correlationId: actor.correlationId },
      );
      return i;
    };
    return this.db.inTransaction ? make() : this.db.tx(make);
  }

  get(id: string): KillIntake {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM kill_intake WHERE intake_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `차단 요청 접수 ${id}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc) as KillIntake;
  }

  /** 외부 시스템 상태 조회 — 옮긴 차단의 상태까지(실행 결과) */
  status(id: string) {
    const i = this.get(id);
    const k = i.killId ? this.kills.detail(i.killId) : null;
    return { ...i, killStatus: k?.status ?? null, approvals: k?.approvals?.length ?? 0 };
  }

  list(status?: string) {
    const rows = status ? this.db.all<{ doc: string }>('SELECT doc FROM kill_intake WHERE status = ? ORDER BY intake_id DESC', status) : this.db.all<{ doc: string }>('SELECT doc FROM kill_intake ORDER BY intake_id DESC');
    return rows.map((r) => JSON.parse(r.doc) as KillIntake);
  }

  /** 이 Feature의 검토 대기 접수 */
  openFor(featureId: string): KillIntake | null {
    return this.list('RECEIVED').find((i) => i.featureId === featureId) ?? null;
  }

  dismiss(actor: Actor, id: string, reason: string): KillIntake {
    const i = this.get(id);
    if (i.status !== 'RECEIVED') {
      this.audit.failed(actor, 'KILL_INTAKE_DISMISS', id, `${i.status} 접수 닫기 시도`, 'D03-03');
      throw new DomainError('CONFLICT', `이미 처리한 접수입니다 (${i.status}).`);
    }
    return this.db.tx(() => {
      const done: KillIntake = { ...i, status: 'DISMISSED', closedBy: actor.id, closedAt: this.clock.iso(), closeReason: reason };
      this.db.run('UPDATE kill_intake SET status = ?, doc = ? WHERE intake_id = ?', done.status, JSON.stringify(done), id);
      this.audit.record(actor, 'KILL_INTAKE_DISMISS', id, { before: { status: 'RECEIVED' }, after: { status: 'DISMISSED' }, reason, componentId: 'D03-03' });
      return done;
    });
  }
}

/** 이상 상황 → 비활성화 조건 확인(FR-SVS-002-001). 충족이면 접수·'중단 필요' 알림, 미충족이면 사유 기록. 차단을 실행하지 않는다 */
@Injectable()
@PlatformComponent('D03-03')
export class DeactivationCheckService implements OnModuleInit {
  private readonly log = new Logger('DeactivationCheck');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly features: FeatureRepo,
    private readonly kills: KillService,
    private readonly killRepo: KillRepo,
    private readonly intake: KillIntakeService,
  ) {}

  onModuleInit() {
    this.events.stream(['anomaly.opened', 'anomaly.escalated']).subscribe((e) => {
      try {
        this.check(String((e.payload as { anomalyId?: string }).anomalyId ?? e.aggregate));
      } catch (err) {
        this.log.error(`비활성화 조건 확인 실패: ${(err as Error).message}`);
      }
    });
  }

  check(anomalyId: string): DeactivationCheckRecord | null {
    const row = this.db.get<{ doc: string }>('SELECT doc FROM anomaly WHERE anomaly_id = ?', anomalyId);
    if (!row) return null;
    const a = JSON.parse(row.doc) as { anomalyId: string; featureId: string; severity: string; advice: string; vins: string[]; status: string };
    const ver = this.features.versions(a.featureId).at(-1)?.version ?? null;
    let pv: ReturnType<KillService['preview']> | null = null;
    try {
      pv = ver ? this.kills.preview(a.featureId, ver) : null;
    } catch {
      pv = null;
    }
    const inScope = new Set(pv?.vehicles.map((v) => v.vin) ?? []);
    const vins = a.vins.filter((v) => inScope.has(v));
    const openKill = this.killRepo.forFeature(a.featureId).find((k) => k.status === 'ACTIVE' || this.kills.effective(k).status === 'REQUESTED')?.killId ?? null;
    const openIntake = this.intake.openFor(a.featureId)?.intakeId ?? null;
    const r = deactivationCheck({ advice: a.advice, severity: a.severity, registry: pv?.registry ?? null, vehicles: vins.length || (a.vins.length ? 0 : (pv?.vehicles.length ?? 0)), openKill, openIntake });
    return this.db.tx(() => {
      const checkId = `DCK-${pad(this.db.get<{ n: number }>('SELECT count(*) AS n FROM deactivation_check')!.n + 1)}`;
      const intake =
        r.met && ver
          ? this.intake.receive(
              SYSTEM,
              { featureId: a.featureId, featureVersion: ver, reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: `이상 징후 ${a.anomalyId} — 비활성화 조건 충족(중단 필요)`, ...(vins.length ? { vins } : {}) },
              { source: 'ANOMALY', anomalyId: a.anomalyId, checkId },
            )
          : null;
      const rec: DeactivationCheckRecord = { checkId, anomalyId: a.anomalyId, featureId: a.featureId, featureVersion: ver, advice: a.advice, severity: a.severity, met: r.met && !!intake, conditions: r.conditions, unmet: r.unmet, intakeId: intake?.intakeId ?? null, checkedAt: this.clock.iso() };
      this.db.run('INSERT INTO deactivation_check (check_id, anomaly_id, feature_id, met, checked_at, doc) VALUES (?, ?, ?, ?, ?, ?)', checkId, a.anomalyId, a.featureId, rec.met ? 1 : 0, rec.checkedAt, JSON.stringify(rec));
      this.audit.record(SYSTEM, 'DEACTIVATION_CHECK', a.anomalyId, { after: { checkId, met: rec.met, intakeId: rec.intakeId }, reason: rec.met ? '비활성화 조건 충족 — 중단 필요 접수' : `미충족: ${r.unmet.join(' / ')}`, componentId: 'D03-03' });
      return rec;
    });
  }

  list(q: { anomalyId?: string; featureId?: string }) {
    const where = q.anomalyId ? 'WHERE anomaly_id = ?' : q.featureId ? 'WHERE feature_id = ?' : '';
    const args = q.anomalyId ? [q.anomalyId] : q.featureId ? [q.featureId] : [];
    return this.db.all<{ doc: string }>(`SELECT doc FROM deactivation_check ${where} ORDER BY id DESC LIMIT 200`, ...args).map((r) => JSON.parse(r.doc) as DeactivationCheckRecord);
  }
}

/** 외부 시스템 창구 — API 키(SYSTEM)만. 실행이 아니라 접수 */
@Controller('api/ext/v1/kill-intake')
export class ExtKillIntakeController {
  constructor(private readonly intake: KillIntakeService) {}

  @Post()
  @Roles('SYSTEM')
  @AuditAction('KILL_INTAKE')
  receive(@CurrentActor() actor: Actor, @Body(new ZodPipe(KillIntakeBody)) body: KillIntakeBody) {
    return this.intake.receive(actor, body, { source: 'EXTERNAL' });
  }

  @Get(':id')
  @Roles('SYSTEM', 'AUDITOR')
  status(@Param('id') id: string) {
    return this.intake.status(id);
  }
}

@Controller('api/kill-intake')
export class KillIntakeController {
  constructor(private readonly intake: KillIntakeService) {}

  @Get()
  list(@Query('status') status?: string) {
    return { items: this.intake.list(status) };
  }

  @Post(':id/dismiss')
  @Roles(...KILL_ROLES)
  @AuditAction('KILL_INTAKE_DISMISS')
  dismiss(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillIntakeDismissBody)) body: KillIntakeDismissBody) {
    return this.intake.dismiss(actor, id, body.reason);
  }
}

@Controller('api/deactivation-checks')
export class DeactivationCheckController {
  constructor(private readonly checks: DeactivationCheckService) {}

  @Get()
  list(@Query('anomalyId') anomalyId?: string, @Query('featureId') featureId?: string) {
    return { items: this.checks.list({ anomalyId, featureId }) };
  }
}
