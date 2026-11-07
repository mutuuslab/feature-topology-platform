// 주기 대사(80-50 §4.5, D-ALM-7) — webhook 즉시 + 주기 대사. 놓친 변경을 찾아 webhook과 같은 길(중복 버림·메아리·주인 규칙)로 태운다.
//   증분(JIRA, 기본 15분 FF_ALM_RECONCILE_MS): 연계 프로젝트에서 최근 20분 안에 바뀐 이슈 → 마지막 관측과 개정이 다르면 변경 이력으로
//     webhook 본문을 만들어 ExtSyncService.receive. 플랫폼 서비스 계정만 바꾼 것은 관측 값만 맞춘다.
//   전체(하루 1회 FF_ALM_FULL_RECONCILE_MS): Feature마다 Epic이 있는지(없으면 만든다 — live로 처음 붙일 때 기존 Feature 일괄),
//     옛 버전별 Epic은 Feature Epic 하나로 합치고, FF 주인 필드가 다르면 다시 쓴다. 상태만 다르면(양쪽 주인) 사람이 고른다(충돌).
// 실행마다 sync_reconcile_run에 남긴다(/integration/connectors?tab=sync).
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { epicFieldDiff, JIRA_EPIC_STATUS, type EpicFieldKey, type ExtSystem } from '@ff/contracts';
import type { Actor } from '../../../../kernel/actor';
import { AuditService } from '../../../../kernel/audit.service';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';
import { EventService } from '../../../../kernel/event.service';
import { Scheduler } from '../../../../kernel/scheduler';
import { FeatureRepo } from '../../../d01-policy/repos';
import { ExtAdapters, modeOf, PLATFORM_USER, type RecentIssue } from './adapters';
import { ExtSyncRepo } from './ext-sync.repo';
import { ExtSyncService } from './ext-sync.service';
import { FeatureEpics } from './feature-epic';
import { isServiceAccount } from './live-adapters';

export type ReconcileKind = 'INCREMENTAL' | 'FULL';
export interface ReconcileRun {
  runId: number;
  system: ExtSystem;
  kind: ReconcileKind;
  startedAt: string;
  finishedAt: string | null;
  scanned: number;
  applied: number;
  conflicts: number;
  errors: number;
  /** 처리한 것 요약(앞 20건) */
  notes: string[];
}

const minutes = (env: string | undefined, fallback: number) => {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** 증분 대사 창 — 주기(15분)보다 겹치게 20분 */
const WINDOW_MIN = () => minutes(process.env.FF_ALM_RECONCILE_WINDOW_MIN, 20);

@Injectable()
export class AlmReconcileService implements OnApplicationBootstrap {
  private running: Promise<ReconcileRun> | null = null;
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExtSyncRepo,
    private readonly adapters: ExtAdapters,
    private readonly sync: ExtSyncService,
    private readonly epics: FeatureEpics,
    private readonly features: FeatureRepo,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  onApplicationBootstrap() {
    if (this.scheduler.manual) return;
    const every = (envKey: string, fallback: number, fn: () => Promise<unknown>) => {
      const raw = process.env[envKey];
      if (raw === 'off') return;
      const ms = minutes(raw, fallback);
      const tick = () => void fn().catch(() => undefined).finally(() => this.scheduler.after(ms, tick));
      this.scheduler.after(ms, tick);
    };
    every('FF_ALM_RECONCILE_MS', 15 * 60_000, () => (modeOf('JIRA') === 'off' ? Promise.resolve() : this.run('JIRA', 'INCREMENTAL')));
    every('FF_ALM_FULL_RECONCILE_MS', 24 * 3_600_000, () => (modeOf('JIRA') === 'off' ? Promise.resolve() : this.run('JIRA', 'FULL')));
    // 처음 기동(전체 대사 기록 없음) — 5초 뒤 한 번: 기존 Feature의 Epic을 만들고 옛 버전별 Epic을 합친다(live로 처음 붙일 때 일괄)
    const first = !this.db.get("SELECT 1 FROM sync_reconcile_run WHERE kind = 'FULL'");
    if (first && process.env.FF_ALM_FULL_RECONCILE_MS !== 'off' && modeOf('JIRA') !== 'off') this.scheduler.after(5_000, () => void this.run('JIRA', 'FULL').catch(() => undefined));
  }

  /** 대사 한 번 — 겹쳐 부르면 앞 실행을 기다린다 */
  run(system: ExtSystem, kind: ReconcileKind, actor?: Actor): Promise<ReconcileRun> {
    const go = async () => {
      if (this.running) await this.running.catch(() => undefined);
      return kind === 'FULL' ? this.full(system, actor) : this.incremental(system, actor);
    };
    const p = go().finally(() => {
      if (this.running === p) this.running = null;
    });
    this.running = p;
    return p;
  }

  runs(limit = 20): ReconcileRun[] {
    return this.db.all<{ run_id: number; doc: string }>('SELECT run_id, doc FROM sync_reconcile_run ORDER BY run_id DESC LIMIT ?', limit).map((r) => ({ ...(JSON.parse(r.doc) as ReconcileRun), runId: r.run_id }));
  }

  private start(system: ExtSystem, kind: ReconcileKind): ReconcileRun {
    const run: ReconcileRun = { runId: 0, system, kind, startedAt: this.clock.iso(), finishedAt: null, scanned: 0, applied: 0, conflicts: 0, errors: 0, notes: [] };
    const r = this.db.run('INSERT INTO sync_reconcile_run (system, kind, started_at, doc) VALUES (?, ?, ?, ?)', system, kind, run.startedAt, JSON.stringify(run));
    return { ...run, runId: Number(r.lastInsertRowid) };
  }
  private finish(run: ReconcileRun, actor?: Actor): ReconcileRun {
    const done = { ...run, finishedAt: this.clock.iso(), notes: run.notes.slice(0, 20) };
    this.db.tx(() => {
      this.db.run('UPDATE sync_reconcile_run SET finished_at = ?, doc = ? WHERE run_id = ?', done.finishedAt, JSON.stringify(done), done.runId);
      if (actor) this.audit.record(actor, 'EXT_SYNC_RECONCILE', `${run.system}:${run.kind}`, { after: { runId: done.runId, scanned: done.scanned, applied: done.applied, conflicts: done.conflicts, errors: done.errors }, componentId: 'D05-01' });
    });
    return done;
  }

  // ── 증분 ──
  private async incremental(system: ExtSystem, actor?: Actor): Promise<ReconcileRun> {
    const run = this.start(system, 'INCREMENTAL');
    if (system !== 'JIRA') return this.finish(run, actor);
    let recent: RecentIssue[] = [];
    try {
      recent = await this.adapters.of('JIRA').recent(WINDOW_MIN());
    } catch (e) {
      run.errors++;
      run.notes.push(`JIRA 조회 실패 — ${e instanceof Error ? e.message : String(e)}`);
      return this.finish(run, actor);
    }
    for (const r of recent) {
      run.scanned++;
      try {
        const out = this.receiveRecent(r);
        if (!out) continue;
        if (out.outcome === 'APPLIED' || out.outcome === 'REJECTED' || out.outcome === 'UNMAPPED') {
          run.applied++;
          run.notes.push(`${r.key} ${out.summary}`);
        }
      } catch (e) {
        run.errors++;
        run.notes.push(`${r.key} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // 되돌림·댓글 등 보낼 함
    await this.sync.drain();
    run.conflicts = this.repo.countConflicts('JIRA');
    return this.finish(run, actor);
  }

  /**
   * 이슈 하나 — 마지막 관측과 개정이 같으면 건너뜀. 관측 뒤 변경 이력에서 사람(서비스 계정이 아닌)의 마지막 변경을 그 사람의 요청으로,
   * 상태가 바뀌었으면 처음 상태에서 지금 상태로. 사람의 변경이 없으면(플랫폼이 쓴 것) 관측 값만 맞춘다.
   */
  private receiveRecent(r: RecentIssue) {
    const seen = this.repo.item('JIRA', r.key);
    if (seen && seen.revision === r.revision) return null;
    const since = seen?.revision ?? 0;
    const platform = (u: string) => u === PLATFORM_USER || isServiceAccount('JIRA', u);
    const after = r.histories.filter((h) => h.created > since);
    const humans = after.filter((h) => !platform(h.author));
    const author = humans.at(-1)?.author ?? (seen ? PLATFORM_USER : r.reporter || PLATFORM_USER);
    const statusItems = humans.flatMap((h) => h.items.filter((x) => x.field === 'status'));
    const status = String((r.issue.fields.status as { name?: string } | undefined)?.name ?? '');
    const fromStatus = statusItems[0]?.fromString ?? (seen && seen.status !== status ? seen.status : null);
    const body = {
      webhookEvent: seen ? 'jira:issue_updated' : 'jira:issue_created',
      user: { accountId: author },
      issue: r.issue,
      ...(fromStatus && fromStatus !== status ? { changelog: { items: [{ field: 'status', fromString: fromStatus, toString: status }] } } : {}),
    };
    return this.sync.receive('JIRA', `reconcile:${r.key}:${r.revision}`, body);
  }

  // ── 전체 ──
  private async full(system: ExtSystem, actor?: Actor): Promise<ReconcileRun> {
    const run = this.start(system, 'FULL');
    if (system !== 'JIRA') return this.finish(run, actor);
    const ids = [...new Set(this.features.all().map((f) => f.featureId))];
    const a = this.adapters.of('JIRA');
    for (const featureId of ids) {
      run.scanned++;
      try {
        const d = this.epics.desired(featureId);
        if (!d) continue;
        this.consolidate(featureId, run);
        const key = this.epics.key(featureId);
        // Epic 없음 — 만든다(live로 처음 붙일 때 기존 Feature 일괄, 80-50 §4.4)
        if (!key) {
          this.sync.queueEpicMirror(featureId, d.version, null, `reconcile:${run.runId}:${featureId}`);
          run.applied++;
          run.notes.push(`${featureId} Epic 만들기`);
          continue;
        }
        const remote = await a.read(key);
        if (!remote) {
          run.errors++;
          run.notes.push(`${featureId} Epic ${key}이(가) JIRA에 없습니다`);
          continue;
        }
        const seen = this.repo.item('JIRA', key);
        const diff = epicFieldDiff(d, (remote.fields.epic ?? {}) as Partial<Record<EpicFieldKey, unknown>>);
        const titleDiff = remote.title !== d.summary;
        const statusDiff = remote.status !== JIRA_EPIC_STATUS[d.lifecycle];
        const pending = this.sync.pendingEpic(featureId);
        if (pending) continue;
        if (statusDiff && seen && seen.revision !== remote.revision) {
          // 놓친 사람의 변경 — 사람이 고른다(상태는 양쪽 주인)
          this.db.tx(() => {
            this.repo.openConflict({ system: 'JIRA', key, field: 'status', platformValue: JIRA_EPIC_STATUS[d.lifecycle], externalValue: remote.status, jobId: null });
            this.repo.setState('JIRA', key, 'CONFLICT');
            this.events.publish('ext.sync.conflict', key, { system: 'JIRA', key, platformValue: JIRA_EPIC_STATUS[d.lifecycle], externalValue: remote.status, source: 'reconcile' }, { componentId: 'D05-01' });
          });
          run.conflicts++;
          run.notes.push(`${featureId} Epic ${key} 상태 '${remote.status}' ≠ '${JIRA_EPIC_STATUS[d.lifecycle]}' — 선택 필요`);
          continue;
        }
        if (diff.length || titleDiff || statusDiff) {
          this.sync.queueEpicMirror(featureId, d.version, null, `reconcile:${run.runId}:${featureId}`);
          run.applied++;
          run.notes.push(`${featureId} Epic ${key} 다시 쓰기(${[...diff, ...(titleDiff ? ['summary'] : []), ...(statusDiff ? ['status'] : [])].join('·')})`);
        }
      } catch (e) {
        run.errors++;
        run.notes.push(`${featureId} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const r = await this.sync.drain();
    run.conflicts += r.conflicts;
    run.errors += r.failed;
    return this.finish(run, actor);
  }

  /**
   * 옛 버전별 Epic 합치기(80-50 §4.1 이전) — 최신 버전 것을 Feature Epic으로 남기고 나머지는 '이전 Epic' 표시·라벨·중복 링크·안내 댓글.
   * 한 번 합친 Epic은 supersededBy가 있어 다시 하지 않는다(모의·실서버 공통).
   */
  private consolidate(featureId: string, run: ReconcileRun) {
    const live = this.epics.linked(featureId).filter((l) => !l.extra.supersededBy);
    if (live.length < 2) return;
    const keep = this.epics.key(featureId)!;
    for (const old of live.filter((l) => l.key !== keep)) {
      this.db.tx(() => {
        const cur = this.repo.item('JIRA', old.key);
        if (cur) this.repo.putItem({ ...cur, extra: { ...cur.extra, supersededBy: keep } });
        this.epics.linkAll(keep, featureId, PLATFORM_USER);
        this.sync.queueLegacyEpic(old.key, keep, `merge:${old.key}`);
      });
      run.applied++;
      run.notes.push(`${featureId} 이전 Epic ${old.key} → ${keep}`);
    }
  }
}
