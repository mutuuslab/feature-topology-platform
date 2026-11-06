// Feature 운영 점검 Closed loop(D04-03, 80-70 9장, BACKLOG TL-B08·B09·B10 · 화면 TL-UI16·17·18·04).
// ① 관측: Lake Feature 버전 4축 지표(IF-15 GET /v1/metrics/feature-health) → ② 판정: contracts 규칙(INDICATOR_RULES·judgeAxis)
// → ③ 점검 결과(Finding): 조치 필요·주의 축마다 한 건, 같은 Feature·축·원인은 다시 열기(반복 표시) → ④ 조치 연결(JIRA·codeBeamer·정책)
// → ⑤ 효과 확인(조치 전후 비교, 표본·신뢰구간) → 닫힘 / 다시 열림. 효과 확인 없이 닫을 수 없다(INV-20). 상태 이동은 감사·이벤트(→ Lake 라벨)로 남는다.
import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import {
  AXIS_OWNER, FINDING_DUE_DAYS, FindingTransitionBody, HEALTH_AXES, INDICATOR_RULES, findingOpen, findingTransitionProblem, judgeAxis, judgeIndicator,
  type FeatureHealthResponse, type FeatureHealthRow, type FeatureOpsMetrics, type FindingStatus, type Freshness, type HealthAxis, type HealthFinding,
  type HealthState, type IndicatorValue, type LakeIndicatorName,
} from '@ff/contracts';
import { LakeLink } from '../../../adapters/lake/lake-reader';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';

const DAY = 86_400_000;
/** 판정 주기 — 1일 판정(80-70 9.2)을 데모에서는 5분마다 다시 본다 */
const REFRESH_MS = 5 * 60_000;
const OWNER_ROLES = ['OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER', 'FEATURE_AUTHOR', 'RELEASE_MANAGER', 'SECURITY_OFFICER'] as const;

export const findingKey = (f: Pick<HealthFinding, 'featureId' | 'version' | 'axis' | 'cause'>) => `${f.featureId}@${f.version}:${f.axis}:${f.cause}`;

@Injectable()
export class FindingRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  nextId() {
    return `FND-${String(this.db.get<{ n: number }>('SELECT count(*) AS n FROM feature_finding')!.n + 1).padStart(5, '0')}`;
  }
  get(id: string): HealthFinding | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_finding WHERE finding_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  /** 같은 원인의 가장 최근 건 */
  latest(key: string): HealthFinding | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_finding WHERE finding_key = ? ORDER BY finding_id DESC LIMIT 1', key);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(featureId?: string): HealthFinding[] {
    const rows = featureId ? this.db.all<{ doc: string }>('SELECT doc FROM feature_finding WHERE feature_id = ? ORDER BY finding_id', featureId) : this.db.all<{ doc: string }>('SELECT doc FROM feature_finding ORDER BY finding_id');
    return rows.map((r) => JSON.parse(r.doc));
  }
  save(f: HealthFinding) {
    this.db.run(
      'INSERT INTO feature_finding (finding_id, finding_key, feature_id, version, axis, status, doc) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(finding_id) DO UPDATE SET status = excluded.status, doc = excluded.doc',
      f.findingId, findingKey(f), f.featureId, f.version, f.axis, f.status, JSON.stringify(f),
    );
  }
}

/** 효과 판정 — 조치 뒤 값이 경계(주의) 안쪽인가. 비율은 신뢰구간 끝이 경계 안쪽이어야 한다 */
export function effectOf(cause: LakeIndicatorName, before: number | null, after: number | null, samples: number | null): NonNullable<HealthFinding['effect']> {
  const rule = INDICATOR_RULES[cause];
  const target = rule.watch;
  if (after == null || !samples) return { indicator: cause, target, before, after, samples, ci: null, met: null };
  const per1k = cause.endsWith('_per_1k');
  const rate = !per1k && after <= 1 && !cause.endsWith('_count');
  const half = rate ? 1.96 * Math.sqrt((after * (1 - after)) / samples) : per1k ? 1.96 * Math.sqrt(after / (samples / 1000)) : null;
  const ci: [number, number] | null = half == null ? null : [Math.round((after - half) * 1e5) / 1e5, Math.round((after + half) * 1e5) / 1e5];
  const edge = rule.worse === 'up' ? (ci ? ci[1] : after) : ci ? ci[0] : after;
  return { indicator: cause, target, before, after, samples, ci, met: rule.worse === 'up' ? edge <= target : edge >= target };
}

@Injectable()
@PlatformComponent('D04-03')
export class FeatureHealthService {
  private lastRefresh = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly repo: FindingRepo,
    private readonly lake: LakeLink,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 운영 중인 Feature 버전 — 출시(RELEASED) 판 */
  private released() {
    return this.features.all().filter((f) => f.lifecycle === 'RELEASED');
  }

  /** Lake 4축 지표 → 화면 지표·신선도 */
  measure(featureId: string, version: string, market: string): { indicators: IndicatorValue[]; freshness: Freshness; activeVehicles: number | null } | null {
    const reader = this.lake.reader();
    if (!reader) return null;
    const doc = reader.featureHealth(featureId, version, market);
    const indicators = doc.indicators.map((i) => ({ name: i.name as LakeIndicatorName, axis: i.axis, current: i.current, previous: i.previous, sampleVehicles: i.sample_vehicles, suppressed: i.suppressed }));
    const freshness = LakeLink.freshness(doc.meta.freshness);
    return { indicators, freshness: { ...freshness, stale: freshness.stale || doc.meta.provisional }, activeVehicles: doc.active_vehicles };
  }

  private axes(indicators: IndicatorValue[], stale: boolean) {
    return Object.fromEntries(HEALTH_AXES.map((a) => [a, judgeAxis(indicators.filter((i) => i.axis === a), stale)])) as FeatureHealthRow['axes'];
  }

  private decorate(f: HealthFinding): HealthFinding {
    return { ...f, overdue: findingOpen(f.status) && Date.parse(f.dueAt) < this.clock.now().getTime() };
  }

  /** ②·③ 판정 → 점검 결과 만들기·다시 열기. 열린 같은 원인 건이 있으면 새로 만들지 않는다(중복 방지) */
  refresh(): number {
    if (!this.lake.reader()) return 0;
    this.lastRefresh = this.clock.now().getTime();
    let changed = 0;
    for (const f of this.released()) {
      const m = this.measure(f.featureId, f.version, f.country ?? 'KR');
      if (!m) continue;
      const axes = this.axes(m.indicators, m.freshness.stale);
      for (const axis of HEALTH_AXES) {
        const { state, cause } = axes[axis];
        if ((state !== 'ACTION' && state !== 'WATCH') || !cause) continue;
        const key = `${f.featureId}@${f.version}:${axis}:${cause}`;
        const prev = this.repo.latest(key);
        if (prev && findingOpen(prev.status)) continue;
        const now = this.clock.iso();
        const due = new Date(this.clock.now().getTime() + FINDING_DUE_DAYS[state] * DAY).toISOString();
        const evidence = { freshness: m.freshness, indicators: m.indicators.filter((i) => i.axis === axis) };
        const next: HealthFinding = prev
          ? { ...prev, status: 'REOPENED', severity: state, repeats: prev.repeats + 1, dueAt: due, updatedAt: now, evidence, effect: null, history: [...prev.history, { at: now, from: prev.status, to: 'REOPENED', by: 'SYSTEM', note: '같은 원인으로 다시 감지 — 반복 문제' }] }
          : {
              findingId: this.repo.nextId(), featureId: f.featureId, version: f.version, featureName: f.name, axis, cause, severity: state, status: 'DETECTED',
              ownerRole: AXIS_OWNER[axis], dueAt: due, overdue: false, detectedAt: now, updatedAt: now, repeats: 0, evidence, actions: [], effect: null,
              history: [{ at: now, from: null, to: 'DETECTED', by: 'SYSTEM', note: `4축 판정 — ${state === 'ACTION' ? '조치 필요' : '주의'}` }],
            };
        this.db.tx(() => {
          this.repo.save(next);
          this.events.publish(prev ? 'finding.reopened' : 'finding.detected', next.findingId, { featureId: next.featureId, version: next.version, axis, cause, severity: state }, { componentId: 'D04-03' });
        });
        changed++;
      }
    }
    return changed;
  }

  private refreshIfDue() {
    if (this.clock.now().getTime() - this.lastRefresh >= REFRESH_MS) this.refresh();
  }

  overview(): FeatureHealthResponse {
    if (!this.lake.reader()) return { connected: false, asOf: null, rows: [], findings: [] };
    this.refreshIfDue();
    const findings = this.repo.list().map((f) => this.decorate(f));
    const rows = this.released().flatMap((f): FeatureHealthRow[] => {
      const m = this.measure(f.featureId, f.version, f.country ?? 'KR');
      if (!m) return [];
      const axes = this.axes(m.indicators, m.freshness.stale);
      const mine = findings.filter((x) => x.featureId === f.featureId && x.version === f.version && findingOpen(x.status));
      const worst = (['ACTION', 'WATCH', 'UNKNOWN', 'OK'] as HealthState[]).find((s) => HEALTH_AXES.some((a) => axes[a].state === s)) ?? 'OK';
      return [{ featureId: f.featureId, version: f.version, name: f.name, market: f.country ?? 'KR', activeVehicles: m.activeVehicles, axes, worst, openFindings: mine.length, overdue: mine.filter((x) => x.overdue).length, freshness: m.freshness, indicators: m.indicators }];
    });
    return { connected: true, asOf: this.clock.iso(), rows, findings };
  }

  finding(id: string): HealthFinding {
    const f = this.repo.get(id);
    if (!f) throw new DomainError('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
    return this.decorate(f);
  }

  /** ④·⑤ 상태 이동 — 조치 연결·효과 확인. 효과 미달이면 다시 열림만 */
  transition(actor: Actor, id: string, body: FindingTransitionBody): HealthFinding {
    const f = this.finding(id);
    const problem = findingTransitionProblem(f, body.to, !!body.action);
    if (problem) {
      this.audit.failed(actor, 'FINDING_TRANSITION', id, problem, 'D04-03');
      throw new DomainError('GUARD_FAILED', `${problem} (${f.status} → ${body.to})`);
    }
    const now = this.clock.iso();
    const actions = body.action ? [...f.actions, { ...body.action, at: now, by: actor.id }] : f.actions;
    let effect = f.effect;
    if (body.to === 'VERIFYING') {
      // 조치 뒤 창 — Lake 지금 값과 감지 때 값 비교
      const m = this.measure(f.featureId, f.version, this.features.get(f.featureId, f.version)?.country ?? 'KR');
      const now1 = m?.indicators.find((i) => i.name === f.cause);
      const before = f.evidence.indicators.find((i) => i.name === f.cause)?.current ?? null;
      effect = effectOf(f.cause, before, now1?.current ?? null, now1?.sampleVehicles ?? null);
    }
    const reopenDue = body.to === 'REOPENED' ? new Date(this.clock.now().getTime() + FINDING_DUE_DAYS[f.severity] * DAY).toISOString() : f.dueAt;
    const next: HealthFinding = {
      ...f, status: body.to, actions, effect, dueAt: reopenDue, updatedAt: now,
      repeats: body.to === 'REOPENED' ? f.repeats + 1 : f.repeats,
      history: [...f.history, { at: now, from: f.status, to: body.to, by: actor.id, note: body.note }],
    };
    this.db.tx(() => {
      this.repo.save(next);
      this.audit.record(actor, 'FINDING_TRANSITION', id, { before: { status: f.status, actions: f.actions.length }, after: { status: next.status, actions: next.actions.length, effect: next.effect }, reason: body.note, componentId: 'D04-03' });
      // 판정·조치·효과는 FF 이벤트 → 라벨로 Lake에 간다(재학습·다음 분석)
      this.events.publish('finding.moved', id, { featureId: f.featureId, version: f.version, axis: f.axis, cause: f.cause, from: f.status, to: next.status, action: body.action?.kind ?? null, effectMet: next.effect?.met ?? null }, { componentId: 'D04-03', correlationId: actor.correlationId });
    });
    return this.decorate(next);
  }

  /** Feature 상세 '운영 지표' — 버전별 운영 지표·4축 이력(14일)·점검 결과 */
  opsMetrics(featureId: string): FeatureOpsMetrics {
    const versions = this.features.versions(featureId);
    if (!versions.length) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    if (!this.lake.reader()) return { connected: false, asOf: null, featureId, versions: [], history: [], findings: [] };
    const live = versions.filter((v) => v.lifecycle === 'RELEASED' || v.lifecycle === 'DEPRECATED');
    const findings = this.repo.list(featureId).map((f) => this.decorate(f));
    const voc = this.db.get<{ n: number }>('SELECT count(*) AS n FROM incident WHERE feature_id = ?', featureId)?.n ?? 0;
    const rollbacks = this.db.get<{ n: number }>('SELECT count(*) AS n FROM rollback_execution WHERE feature_id = ?', featureId)?.n ?? 0;
    const today = Date.parse(this.clock.iso().slice(0, 10));
    const out: FeatureOpsMetrics = { connected: true, asOf: this.clock.iso(), featureId, versions: [], history: [], findings };
    for (const v of live) {
      const m = this.measure(featureId, v.version, v.country ?? 'KR');
      if (!m) continue;
      const val = (n: LakeIndicatorName) => m.indicators.find((i) => i.name === n)?.current ?? null;
      const ok = val('delivery_success_rate');
      out.versions.push({ version: v.version, activeVehicles: m.activeVehicles, usageRate: val('usage_rate'), failureRate: ok == null ? null : Math.round((1 - ok) * 1e5) / 1e5, dtcRate: val('dtc_vehicle_rate'), vocAfterDeploy: voc, rollbacks, freshness: m.freshness });
      const axes = this.axes(m.indicators, m.freshness.stale);
      // 판정 이력 — 그날 열려 있던 점검 결과의 심각도, 없으면 정상(지금 판단 불가인 축은 판단 불가)
      for (let d = 13; d >= 0; d--) {
        const end = today + (1 - d) * DAY; // 그날이 끝나는 시각
        const date = new Date(today - d * DAY).toISOString().slice(0, 10);
        const states = Object.fromEntries(HEALTH_AXES.map((a): [HealthAxis, HealthState] => {
          const open = findings.filter((f) => f.version === v.version && f.axis === a && Date.parse(f.detectedAt) < end && !closedBefore(f, end));
          if (open.some((f) => f.severity === 'ACTION')) return [a, 'ACTION'];
          if (open.length) return [a, 'WATCH'];
          return [a, axes[a].state === 'UNKNOWN' ? 'UNKNOWN' : 'OK'];
        })) as Record<HealthAxis, HealthState>;
        out.history.push({ date, version: v.version, axes: states });
      }
    }
    return out;
  }

  /** 데모 예시(ff-demo.json) — 진행된 점검 결과를 그대로 넣는다(감지·분석·조치·효과 이력 포함) */
  seedFinding(s: { key: string; detectedDays: number; status: FindingStatus; severity?: 'ACTION' | 'WATCH'; repeats?: number; before?: [number, number, number]; steps: [FindingStatus, number, string, string][]; actions: [string, string, string, string, number][]; effect: { target: number; after?: [number, number]; ci?: [number, number]; met?: boolean } }) {
    const [fv, axis, cause] = s.key.split(':') as [string, HealthAxis, LakeIndicatorName];
    const [featureId, version] = fv.split('@');
    const f = this.features.get(featureId, version);
    if (!f || this.repo.latest(s.key)) return;
    const m = this.measure(featureId, version, f.country ?? 'KR');
    if (!m) return;
    const at = (days: number) => new Date(this.clock.now().getTime() - days * DAY).toISOString();
    const indicators = m.indicators.filter((i) => i.axis === axis).map((i) => (i.name === cause && s.before ? { ...i, current: s.before[0], previous: s.before[1], sampleVehicles: s.before[2] } : i));
    const severity = s.severity ?? (judgeIndicator(indicators.find((i) => i.name === cause)!) === 'WATCH' ? 'WATCH' : 'ACTION');
    const detectedAt = at(s.detectedDays);
    const reopened = s.steps.filter((x) => x[0] === 'REOPENED').pop();
    const dueFrom = reopened ? at(reopened[1]) : detectedAt;
    const before = indicators.find((i) => i.name === cause)?.current ?? null;
    const doc: HealthFinding = {
      findingId: this.repo.nextId(), featureId, version, featureName: f.name, axis, cause, severity, status: s.status, ownerRole: AXIS_OWNER[axis],
      dueAt: new Date(Date.parse(dueFrom) + FINDING_DUE_DAYS[severity] * DAY).toISOString(), overdue: false, detectedAt, updatedAt: s.steps.length ? at(s.steps[s.steps.length - 1][1]) : detectedAt,
      repeats: s.repeats ?? 0, evidence: { freshness: { ...m.freshness, asOf: detectedAt }, indicators },
      actions: s.actions.map(([kind, ref, title, by, days]) => ({ kind: kind as HealthFinding['actions'][number]['kind'], ref, title, by, at: at(days) })),
      effect: s.effect.after ? { indicator: cause, target: s.effect.target, before, after: s.effect.after[0], samples: s.effect.after[1], ci: s.effect.ci ?? null, met: s.effect.met ?? null } : null,
      history: [{ at: detectedAt, from: null, to: 'DETECTED', by: 'SYSTEM', note: `4축 판정 — ${severity === 'ACTION' ? '조치 필요' : '주의'}` }, ...s.steps.map(([to, days, by, note], i) => ({ at: at(days), from: i ? s.steps[i - 1][0] : ('DETECTED' as FindingStatus), to, by, note }))],
    };
    this.repo.save(doc);
  }
}

const closedBefore = (f: HealthFinding, end: number) => f.history.some((h) => h.to === 'CLOSED' && Date.parse(h.at) < end) && f.status === 'CLOSED';

@Controller('api')
export class FeatureHealthController {
  constructor(private readonly health: FeatureHealthService) {}

  @Get('feature-health')
  overview() {
    return this.health.overview();
  }

  @Get('feature-health/findings/:id')
  finding(@Param('id') id: string) {
    return this.health.finding(id);
  }

  @Post('feature-health/findings/:id/transition')
  @Roles(...OWNER_ROLES)
  @AuditAction('FINDING_TRANSITION')
  transition(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(FindingTransitionBody)) body: FindingTransitionBody) {
    return this.health.transition(actor, id, body);
  }

  @Get('features/:id/ops-metrics')
  opsMetrics(@Param('id') id: string) {
    return this.health.opsMetrics(id);
  }
}
