// Data Lake 연계(D05-01 API Gateway, IF-15 — 80-70 6장 10, BACKLOG TL-UI10·UI11·UI12·TL-B06) — 외부 시스템 화면: Lake의 내용을 FF가 읽어 보인다.
// · 데이터 계약(신선도·품질·최근 적재), 모델 목록(Lake 소유, 읽기)과 FF 사용 승인(2인·직무 분리·감사), 라벨 보내기 현황.
// · Lake가 주인인 사실은 바꾸지 않는다. FF가 하는 쓰기는 "어느 모델 판의 점수를 판단 화면에 쓸지" 사용 승인뿐이다.
import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import {
  LakeModelDecisionBody, MODEL_USE_REQUIRED, modelUsable, type DataContractRow, type LabelFeedResponse, type LakeModelRow, type LakeStatusResponse,
} from '@ff/contracts';
import { modelUseOf } from '../../../../adapters/lake/ff-lake-records';
import { LakeLink } from '../../../../adapters/lake/lake-reader';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../../kernel/actor';
import { AuditService } from '../../../../kernel/audit.service';
import { Clock } from '../../../../kernel/clock';
import { PlatformComponent } from '../../../../kernel/components';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { EventService } from '../../../../kernel/event.service';
import { ZodPipe } from '../../../../kernel/zod.pipe';

/** FF → Lake 라벨 종류(80-75 5장 봉투 type 6개)와 원천 FF 이벤트 */
export const LABEL_KINDS: { kind: string; title: string; like: string[] }[] = [
  { kind: 'ff.change', title: '배포·단계·차단·복원·롤백·실험·점검 결과', like: ['policy.%', 'rollout.%', 'kill.%', 'rollback.%', 'publication.%', 'experiment.%', 'release.%', 'flag.%', 'finding.%', 'lake.model.%'] },
  { kind: 'relay.verdict', title: '차량 메시지 FF 검증 결과', like: ['vehicle.%'] },
  { kind: 'anomaly', title: '이상 징후 판정', like: ['anomaly.%'] },
  { kind: 'incident', title: '장애·VOC', like: ['incident.%'] },
  { kind: 'security.alert', title: '보안 경보', like: ['vsoc.%', 'security.%', 'pki.%'] },
  { kind: 'entitlement', title: '체험·구독 결과', like: ['entitlement.%', 'trial.%'] },
];
/** 보내지 않는 것(80-75 5장) — VIN은 가명으로, 자유 글은 빼고 */
const EXCLUDED = ['VIN 원문(가명으로 바꿔 보냄)', '자유 글(사유·메모)', '운전자 신원·연락처', '원시 위치'];

@Injectable()
@PlatformComponent('D05-01')
export class LakeIntegrationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lake: LakeLink,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  status(): LakeStatusResponse {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, asOf: null, datasets: [], stale: 0, labelBacklog: 0, failures24h: 0 };
    const f = reader.freshness();
    const datasets = f.types.map((t) => LakeLink.freshness(t));
    return { connected: true, asOf: f.as_of, datasets, stale: datasets.filter((d) => d.stale).length, labelBacklog: this.backlog(reader.cursor().last_seq), failures24h: reader.failures24h() };
  }

  private maxSeq() {
    return this.db.get<{ seq: number | null }>('SELECT max(seq) AS seq FROM events')?.seq ?? 0;
  }

  private backlog(lakeSeq: number) {
    return Math.max(0, this.maxSeq() - lakeSeq);
  }

  contracts(): { connected: boolean; items: DataContractRow[] } {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, items: [] };
    return {
      connected: true,
      items: reader.datasets().map((d) => ({
        dataset: d.dataset, title: d.title, owner: d.owner, schemaVersion: d.schema_version, category: d.category, markets: d.markets, basis: d.basis, basisNote: d.basis_note,
        retention: d.retention, pseudonymization: d.pseudonymization,
        quality: { missingRate: d.quality.missing_rate, duplicateRate: d.quality.duplicate_rate, rangeViolations: d.quality.range_violations, passed: d.quality.missing_rate <= 0.02 && d.quality.duplicate_rate <= 0.001 && d.quality.range_violations <= 5 },
        lastLoadedAt: d.last_loaded_at, rowsLastLoad: d.rows_last_load, freshness: LakeLink.freshness(d.freshness), transferHold: d.transfer_hold,
      })),
    };
  }

  models(): { connected: boolean; items: LakeModelRow[] } {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, items: [] };
    return {
      connected: true,
      items: reader.models().map((m) => {
        const u = modelUseOf(this.db, m.model_id, m.version);
        return {
          modelId: m.model_id, version: m.version, purpose: m.purpose, title: m.title, technique: m.technique, owner: m.owner, lakeApprovedBy: m.lake_approved_by,
          trainedAt: m.trained_at, datasetHash: m.dataset_hash,
          metrics: { precision: m.metrics.precision, recall: m.metrics.recall, calibration: m.metrics.calibration, fairnessGap: m.metrics.fairness_gap },
          drift: m.drift, driftNote: m.drift_note, use: u.use, approvals: u.approvals, usable: modelUsable({ use: u.use, drift: m.drift }),
        };
      }),
    };
  }

  /** 모델 사용 승인·거부(TL-B06) — 같은 사람 두 번 불가(2인), 거부는 사유와 함께 판 전체를 막는다 */
  decide(actor: Actor, modelId: string, body: LakeModelDecisionBody) {
    const reader = this.lake.reader();
    if (!reader) throw new DomainError('GUARD_FAILED', 'Data Lake가 연결되지 않아 모델을 승인할 수 없습니다.');
    const m = reader.models().find((x) => x.model_id === modelId && x.version === body.version);
    if (!m) throw new DomainError('NOT_FOUND', `${modelId} ${body.version}을(를) Data Lake 모델 목록에서 찾을 수 없습니다.`);
    const before = modelUseOf(this.db, modelId, body.version);
    if (before.use !== 'PENDING') throw new DomainError('GUARD_FAILED', `이미 ${before.use === 'APPROVED' ? '승인' : '거부'}된 판입니다.`);
    if (before.approvals.some((a) => a.by === actor.id)) {
      this.audit.failed(actor, 'LAKE_MODEL_USE', `${modelId}@${body.version}`, '같은 사람이 두 번 승인할 수 없음(2인 승인)', 'D05-01');
      throw new DomainError('SEPARATION_OF_DUTY', '이미 이 판에 결정을 남겼습니다 — 사용 승인은 서로 다른 두 사람이 합니다.');
    }
    if (body.decision === 'APPROVE' && m.drift) throw new DomainError('GUARD_FAILED', '드리프트가 표시된 판은 사용 승인할 수 없습니다 — Lake의 재학습 판을 기다립니다.');
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO lake_model_use (model_id, version, decided_by, role, decision, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)', modelId, body.version, actor.id, actor.role, body.decision, body.reason, at);
      const after = modelUseOf(this.db, modelId, body.version);
      this.audit.record(actor, 'LAKE_MODEL_USE', `${modelId}@${body.version}`, { before: { use: before.use, approvals: before.approvals.length }, after: { use: after.use, approvals: after.approvals.length, required: MODEL_USE_REQUIRED }, reason: body.reason, componentId: 'D05-01' });
      this.events.publish('lake.model.use', modelId, { modelId, version: body.version, decision: body.decision, use: after.use }, { componentId: 'D05-01', correlationId: actor.correlationId });
    });
    return this.models().items.find((x) => x.modelId === modelId && x.version === body.version);
  }

  /** 라벨 보내기 현황 — FF 이벤트(원천)를 종류별로 세고, Lake가 받은 위치(/v1/ff/cursor)와 비교한다 */
  labels(): LabelFeedResponse {
    const reader = this.lake.reader();
    const ffSeq = this.maxSeq();
    if (!reader) return { connected: false, asOf: null, ffSeq, lakeCursor: 0, backlog: 0, excluded: EXCLUDED, items: [] };
    const cursor = reader.cursor().last_seq;
    const items = LABEL_KINDS.map((k) => {
      const where = k.like.map(() => 'type LIKE ?').join(' OR ');
      const r = this.db.get<{ n: number; at: string | null }>(`SELECT count(*) AS n, max(at) AS at FROM events WHERE seq <= ? AND (${where})`, cursor, ...k.like);
      return { kind: k.kind, title: k.title, sent: r?.n ?? 0, lastAt: r?.at ?? null };
    });
    return { connected: true, asOf: this.clock.iso(), ffSeq, lakeCursor: cursor, backlog: Math.max(0, ffSeq - cursor), excluded: EXCLUDED, items };
  }
}

@Controller('api/lake')
export class LakeIntegrationController {
  constructor(private readonly svc: LakeIntegrationService) {}

  @Get('status')
  status() {
    return this.svc.status();
  }

  @Get('contracts')
  contracts() {
    return this.svc.contracts();
  }

  @Get('models')
  models() {
    return this.svc.models();
  }

  @Post('models/:id/approvals')
  @Roles('SAFETY_OFFICER', 'OPS_LEAD')
  @AuditAction('LAKE_MODEL_USE')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(LakeModelDecisionBody)) body: LakeModelDecisionBody) {
    return this.svc.decide(actor, id, body);
  }

  @Get('labels')
  labels() {
    return this.svc.labels();
  }
}
