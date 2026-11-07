// codeBeamer 산출물 8종(80-50 §5, D-ALM-9~12) — 수집(FF Feature ID·요구 ID·관계) → 저장(alm_item·alm_relation) → 완결성(contracts computeCompleteness).
//   결과는 alm_wp_result(버전별, 근거 해시) — Feature 상세 산출물 표·Epic '산출물 작성률' 칸·JIRA Task(산출물 작성 일)·게이트(A5)가 같은 결과를 쓴다.
//   codeBeamer는 바깥으로 webhook을 보내지 않는다(80-51 §5) — 5분 주기(FF_ALM_CB_POLL_MS)로 다시 읽고, 화면·게이트는 필요할 때 바로 읽는다.
//   Task = 산출물 작성 일(§4.1): 작업 중 버전의 필수 종류 중 완결되지 않은 것마다 Epic 아래 Task, 완결되면 FF가 Done으로. 사람이 미완결 Task를 Done으로 옮기면 되돌림.
import { Inject, Injectable, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { computeCompleteness, cyberRequired, epicVersions, WORK_PRODUCT, WP_KINDS, wpSummaryText, type ExtChange, type ExtRef, type FeatureVersionRow, type WpItem, type WpKind, type WpRelation, type WpResult } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { Scheduler } from '../../../../kernel/scheduler';
import { FeatureRepo } from '../../../d01-policy/repos';
import { ExtAdapters, modeOf, PLATFORM_USER, type WpFetch } from './adapters';
import type { AlmOp } from './alm-ops';
import { ExtSyncRepo, type OutboxJob } from './ext-sync.repo';
import { ExtSyncService, type Outcome } from './ext-sync.service';
import { FeatureEpics } from './feature-epic';
import { MockExtStore } from './mock-ext.store';

const fid = (featureId: string, version: string) => `${featureId}@${version}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface WpView {
  featureId: string;
  version: string;
  result: WpResult;
  /** 사이버보안 요구가 필요한 까닭(A-4) */
  cyberWhy: string;
  items: (WpItem & { url: string; suspect: boolean })[];
  hash: string;
  computedAt: string;
}

@Injectable()
export class AlmWorkProductsService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExtSyncRepo,
    private readonly adapters: ExtAdapters,
    private readonly sync: ExtSyncService,
    private readonly epics: FeatureEpics,
    private readonly features: FeatureRepo,
    private readonly store: MockExtStore,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.sync.extend({ kinds: { TASK: (c, prev, ref, cid) => this.onTask(c, prev, ref, cid) }, ops: { WP_TASKS: (j) => this.wpTasks(j) }, onSeed: () => this.seed() });
    // Epic 읽기 전용 칸 '산출물 작성률'
    this.epics.addExtra((featureId, version) => {
      const r = this.stored(featureId, version);
      return r ? { workProducts: wpSummaryText(r.result) } : {};
    });
  }

  onApplicationBootstrap() {
    if (this.scheduler.manual || modeOf('CODEBEAMER') === 'off') return;
    const raw = process.env.FF_ALM_CB_POLL_MS;
    if (raw === 'off') return;
    const ms = Number(raw) > 0 ? Number(raw) : 5 * 60_000;
    const tick = () => void this.collectAll().catch(() => undefined).finally(() => this.scheduler.after(ms, tick));
    // 기동 직후 한 번(데모 화면·Epic 칸·Task가 처음부터 채워진다), 그 뒤 주기
    this.scheduler.after(3_000, tick);
  }

  // ───────────────────────── 수집·계산 ─────────────────────────
  /** 모든 Feature — 작업 중 버전 기준(주기 대사) */
  async collectAll(): Promise<{ features: number; errors: number }> {
    let errors = 0;
    const ids = [...new Set(this.features.all().map((f) => f.featureId))];
    for (const id of ids) {
      try {
        await this.collect(id);
      } catch {
        errors++;
      }
    }
    await this.sync.drain();
    return { features: ids.length, errors };
  }

  /** 한 Feature를 codeBeamer에서 다시 읽어 저장하고 모든 버전의 완결성을 다시 계산한다 */
  async collect(featureId: string): Promise<void> {
    const versions = this.features.versions(featureId);
    if (!versions.length) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const reqIds = [...new Set(versions.flatMap((v) => v.requirementIds ?? []))];
    const fetched = await this.adapters.of('CODEBEAMER').workProducts({ featureId, requirementIds: reqIds });
    this.save(featureId, fetched);
  }

  /** 모의 연결 — 같은 결과를 동기로(게이트 판정 직전 다시 읽기) */
  collectNow(featureId: string): boolean {
    const a = this.adapters.of('CODEBEAMER') as unknown as { workProductsNow?: (q: { featureId: string; requirementIds: string[] }) => WpFetch };
    if (modeOf('CODEBEAMER') !== 'mock' || !a.workProductsNow) return false;
    const versions = this.features.versions(featureId);
    this.save(featureId, a.workProductsNow({ featureId, requirementIds: [...new Set(versions.flatMap((v) => v.requirementIds ?? []))] }));
    return true;
  }

  private save(featureId: string, fetched: WpFetch) {
    const now = this.clock.iso();
    this.db.tx(() => {
      const prevSuspect = new Map(this.db.all<{ from_key: string; to_key: string; kind: string; suspect: number }>('SELECT from_key, to_key, kind, suspect FROM alm_relation WHERE feature_id = ?', featureId).map((r) => [`${r.from_key}>${r.to_key}>${r.kind}`, r.suspect]));
      this.db.run('DELETE FROM alm_item WHERE feature_id = ?', featureId);
      this.db.run('DELETE FROM alm_relation WHERE feature_id = ?', featureId);
      for (const it of fetched.items) this.db.run('INSERT INTO alm_item (feature_id, item_key, kind, status, revision, observed_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', featureId, it.key, it.kind, it.status, it.version, now, JSON.stringify(it));
      for (const r of fetched.relations) this.db.run('INSERT OR IGNORE INTO alm_relation (feature_id, from_key, to_key, kind, suspect) VALUES (?, ?, ?, ?, ?)', featureId, r.from, r.to, r.kind, prevSuspect.get(`${r.from}>${r.to}>${r.kind}`) ?? 0);
      for (const v of this.features.versions(featureId)) this.compute(featureId, v.version);
    });
    // Task·Epic 칸 — 작업 중 버전
    const working = epicVersions(this.features.versions(featureId)).working;
    if (working) this.sync.enqueue('JIRA', { op: 'WP_TASKS', featureId }, `wp-tasks:${featureId}:${this.stored(featureId, working.version)?.hash ?? now}`);
  }

  items(featureId: string): (WpItem & { url: string })[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM alm_item WHERE feature_id = ? ORDER BY item_key', featureId).map((r) => JSON.parse(r.doc));
  }
  relations(featureId: string): WpRelation[] {
    return this.db.all<{ from_key: string; to_key: string; kind: WpRelation['kind']; suspect: number }>('SELECT from_key, to_key, kind, suspect FROM alm_relation WHERE feature_id = ?', featureId).map((r) => ({ from: r.from_key, to: r.to_key, kind: r.kind, suspect: !!r.suspect }));
  }

  /** 필요 조건(§5.1) — ASIL·사이버보안 대상(D10 A-4 기본값) */
  context(f: FeatureVersionRow): { asil: string; cyber: boolean; why: string } {
    const doc = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', f.featureId, f.version)?.doc;
    const p = doc ? (JSON.parse(doc) as { regClass?: string; adsFeature?: boolean }) : {};
    const hasTara = !!this.db.get("SELECT 1 FROM analysis_record WHERE feature_id = ? AND kind = 'TARA'", f.featureId);
    const c = cyberRequired({ regClass: p.regClass ?? null, adsFeature: !!p.adsFeature, hasTara, refDomains: (f.featureRefs ?? []).map((r) => r.refId.slice(0, 2)), name: f.name, tags: f.tags });
    return { asil: f.asil, cyber: c.required, why: c.why };
  }

  /** 버전 하나 계산·저장(트랜잭션 안에서 불러도 된다) */
  compute(featureId: string, version: string): WpView {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const ctx = this.context(f);
    const result = computeCompleteness({ featureId, version, ctx, items: this.items(featureId), relations: this.relations(featureId) });
    const hash = sha(result.basis);
    const computedAt = this.clock.iso();
    this.db.run('INSERT INTO alm_wp_result (feature_id, version, hash, computed_at, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(feature_id, version) DO UPDATE SET hash = excluded.hash, computed_at = excluded.computed_at, doc = excluded.doc', featureId, version, hash, computedAt, JSON.stringify({ result, cyberWhy: ctx.why }));
    return this.view(featureId, version)!;
  }

  private stored(featureId: string, version: string): { result: WpResult; cyberWhy: string; hash: string; computedAt: string } | null {
    const r = this.db.get<{ hash: string; computed_at: string; doc: string }>('SELECT hash, computed_at, doc FROM alm_wp_result WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? { ...(JSON.parse(r.doc) as { result: WpResult; cyberWhy: string }), hash: r.hash, computedAt: r.computed_at } : null;
  }

  view(featureId: string, version: string): WpView | null {
    const s = this.stored(featureId, version);
    if (!s) return null;
    const suspect = new Set(this.relations(featureId).filter((r) => r.suspect).map((r) => r.from));
    const items = this.items(featureId).filter((i) => !i.obsolete && (!i.ffVersion || i.ffVersion === version)).map((i) => ({ ...i, suspect: suspect.has(i.key) }));
    return { featureId, version, result: s.result, cyberWhy: s.cyberWhy, items, hash: s.hash, computedAt: s.computedAt };
  }

  /** 화면·게이트 — 저장된 결과가 없으면 지금 읽는다 */
  async get(featureId: string, version: string): Promise<WpView> {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const v = this.view(featureId, version);
    if (v) return v;
    await this.collect(featureId);
    return this.view(featureId, version)!;
  }
  async refresh(featureId: string, version: string): Promise<WpView> {
    await this.collect(featureId);
    await this.sync.drain();
    return this.view(featureId, version)!;
  }

  // ───────────────────────── Task = 산출물 작성 일 ─────────────────────────
  private tasks(featureId: string, version: string): Map<WpKind, ExtRef> {
    const out = new Map<WpKind, ExtRef>();
    for (const l of this.repo.linksOf('FEATURE', fid(featureId, version), 'JIRA')) if (l.kind === 'TASK' && l.extra.wpVersion === version && typeof l.extra.workProduct === 'string') out.set(l.extra.workProduct as WpKind, l);
    return out;
  }
  private missingText(r: WpResult, kind: WpKind) {
    const mine = r.problems.filter((p) => p.kind === kind);
    return mine.length ? mine.map((p) => `- ${p.why}`).join('\n') : '- 없음';
  }

  private async wpTasks(j: OutboxJob): Promise<'done' | 'failed'> {
    const op = j.job as Extract<AlmOp, { op: 'WP_TASKS' }>;
    const working = epicVersions(this.features.versions(op.featureId)).working;
    const s = working ? this.stored(op.featureId, working.version) : null;
    if (!working || !s) return this.sync.skip(j, '작업 중 버전·산출물 결과 없음');
    const epic = this.epics.key(op.featureId);
    if (!epic) {
      this.repo.retry(j, 'Feature Epic이 아직 없습니다.');
      return 'failed';
    }
    const a = this.adapters.of('JIRA');
    const have = this.tasks(op.featureId, working.version);
    for (const k of s.result.kinds.filter((x) => x.required)) {
      const t = have.get(k.kind);
      const label = WORK_PRODUCT[k.kind];
      if (!k.passed && !t) {
        const body = `Feature Platform ${fid(op.featureId, working.version)}의 ${label.process} ${label.ko} 산출물이 아직 완결되지 않았습니다(codeBeamer 승인 + 위·아래 추적).\n\n누락\n${this.missingText(s.result, k.kind)}\n\ncodeBeamer 트래커 ${label.tracker}에서 작성·승인하면 플랫폼이 이 Task를 닫습니다.`;
        const it = await a.create('TASK', { title: `[산출물] ${label.process} ${label.ko} — ${working.version}`, body, status: 'To Do', fields: { parentKey: epic, child: { workProduct: k.kind } } });
        this.db.tx(() => {
          this.sync.observe(it, 'SYNCED', { workProduct: k.kind, wpVersion: working.version });
          this.repo.link('JIRA', it.key, 'FEATURE', fid(op.featureId, working.version), PLATFORM_USER);
        });
      } else if (k.passed && t && t.status !== 'Done') {
        const r = await a.write(t.key, { status: 'Done', comment: `codeBeamer ${label.ko} 산출물 완결 확인(승인·추적) — 플랫폼이 닫습니다.` }, null);
        if (r.ok) this.sync.observe(r.item, 'SYNCED');
      }
    }
    // Epic '산출물 작성률' 칸
    this.sync.queueEpicMirror(op.featureId, working.version, null, `wp-epic:${op.featureId}:${s.hash}`);
    return this.sync.done(j);
  }

  /** JIRA Task — 상태는 JIRA에서 바꿀 수 있지만, 미완결 산출물 Task를 Done으로 옮기면 되돌리고 누락 목록을 댓글로 */
  private onTask(c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string): Outcome {
    this.repo.putItem(ref);
    const kind = (ref.extra.workProduct ?? prev?.extra.workProduct) as WpKind | undefined;
    const version = (ref.extra.wpVersion ?? prev?.extra.wpVersion) as string | undefined;
    const featureId = this.repo.entitiesOf('JIRA', c.key, 'FEATURE')[0]?.entityId.split('@')[0];
    if (!kind || !version || !featureId || !(WP_KINDS as readonly string[]).includes(kind)) return { outcome: 'IGNORED', summary: `Task ${c.key} — 산출물 Task가 아님` };
    const s = this.stored(featureId, version);
    const row = s?.result.kinds.find((k) => k.kind === kind);
    if (c.status === 'Done' && row && !row.passed) {
      const back = prev && prev.status !== 'Done' ? prev.status : 'To Do';
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.sync.enqueue('JIRA', { op: 'CR_STATUS', key: c.key, status: back, comment: `플랫폼이 이 Task 완료를 받지 않았습니다 — codeBeamer ${WORK_PRODUCT[kind].ko} 산출물이 아직 완결되지 않았습니다.\n${this.missingText(s!.result, kind)}` }, `task-revert:${correlationId}`);
      });
      return { outcome: 'REJECTED', summary: `${c.key} Done 거부 — ${WORK_PRODUCT[kind].ko} 미완결` };
    }
    return { outcome: 'APPLIED', summary: `Task ${c.key} ${c.status}` };
  }

  // ───────────────────────── 모의 초기 상태 ─────────────────────────
  /**
   * 데모 Feature마다 codeBeamer 산출물 — 단계에 맞춰(출시·검증 완료는 완결, 개발 중은 설계·시험 일부 검토 중, 정의 단계는 위쪽만) 만든다.
   * 시스템 요구는 이미 있는 요구 항목(요구 ID)을 쓴다. Feature마다 결정적으로 조금씩 다르게(작성률 화면 확인용, 80-50 §6 시드).
   */
  private seed() {
    const byReq = new Map(this.store.all('CODEBEAMER', 'REQUIREMENT').filter((i) => typeof i.fields.reqId === 'string').map((i) => [i.fields.reqId as string, i.key]));
    for (const featureId of new Set(this.features.all().map((f) => f.featureId))) {
      const v = epicVersions(this.features.versions(featureId)).epic;
      if (!v) continue;
      const f = this.features.get(featureId, v.version)!;
      const ctx = this.context(f);
      const n = Number.parseInt(sha(featureId).slice(0, 4), 16) % 4;
      const lc = f.lifecycle;
      const done = ['VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'].includes(lc);
      const st = (kind: WpKind): string | null => {
        if (done) return 'Approved';
        if (lc === 'DEVELOPING') return kind === 'TEST_SPEC' ? (n === 0 ? 'Approved' : 'Draft') : kind === 'SW_DD' ? (n < 2 ? 'In Review' : 'Approved') : 'Approved';
        if (lc === 'APPROVED') return ['SYS_REQ', 'SAFETY_REQ', 'CS_REQ', 'SYS_ARCH'].includes(kind) ? 'Approved' : kind === 'SW_REQ' ? 'In Review' : n === 3 ? null : 'Draft';
        // PROPOSED — 위쪽만, 일부는 검토 중
        if (kind === 'SAFETY_REQ' || kind === 'CS_REQ') return n % 2 ? 'In Review' : 'Approved';
        if (kind === 'SW_REQ') return n === 0 ? 'Draft' : n === 1 ? 'Approved' : null;
        return null;
      };
      const make = (kind: WpKind, rel: { to: string; kind: WpRelation['kind'] }[]) => {
        const status = st(kind);
        if (!status) return null;
        const w = WORK_PRODUCT[kind];
        const it = this.store.create('CODEBEAMER', 'REQUIREMENT', { title: `${w.ko} — ${f.name}`, body: `${f.name}(${featureId})의 ${w.process} ${w.ko}. 적용 범위 ${f.country}/${f.vehicleModel}/${f.trim}, ASIL ${f.asil}.`, status, by: kind.startsWith('SW') ? 'lee.engineer' : 'jung.req', fields: { wpKind: kind, ffFeatureId: featureId, tracker: w.tracker, relations: rel.filter((r) => !!r.to) } });
        return it.key;
      };
      const sys = (f.requirementIds ?? []).map((r) => byReq.get(r)).filter((k): k is string => !!k);
      if (!sys.length) {
        const k = make('SYS_REQ', []);
        if (k) sys.push(k);
      }
      const safety = ctx.asil !== 'QM' ? make('SAFETY_REQ', []) : null;
      const cyber = ctx.cyber ? make('CS_REQ', []) : null;
      // 시스템 요구 → 안전·보안 요구 할당은 시스템 요구 쪽 관계로(시드 요구 항목은 그대로 두고 아래 항목에서 건다)
      const arch = make('SYS_ARCH', sys.map((to) => ({ to, kind: 'allocated' as const })));
      const swReq = make('SW_REQ', [...sys.map((to) => ({ to, kind: 'derived' as const })), ...(safety ? [{ to: safety, kind: 'allocated' as const }] : []), ...(cyber ? [{ to: cyber, kind: 'allocated' as const }] : [])]);
      const swArch = swReq ? make('SW_ARCH', [{ to: swReq, kind: 'allocated' }]) : null;
      const dd = swArch ? make('SW_DD', [{ to: swArch, kind: 'refines' }]) : null;
      make('TEST_SPEC', [...sys, arch, swReq, swArch, dd].filter((k): k is string => !!k).map((to) => ({ to, kind: 'verifies' as const })));
    }
  }
}
