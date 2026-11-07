// codeBeamer 산출물 8종(80-50 §5, D-ALM-9~12) — 수집(FF Feature ID·요구 ID·관계) → 저장(alm_item·alm_relation) → 완결성(contracts computeCompleteness).
//   결과는 alm_wp_result(버전별, 근거 해시) — Feature 상세 산출물 표·Epic '산출물 작성률' 칸·JIRA Task(산출물 작성 일)·게이트(A5)가 같은 결과를 쓴다.
//   codeBeamer는 바깥으로 webhook을 보내지 않는다(80-51 §5) — 5분 주기(FF_ALM_CB_POLL_MS)로 다시 읽고, 화면·게이트는 필요할 때 바로 읽는다.
//   Task = 산출물 작성 일(§4.1): 작업 중 버전의 필수 종류 중 완결되지 않은 것마다 Epic 아래 Task, 완결되면 FF가 Done으로. 사람이 미완결 Task를 Done으로 옮기면 되돌림.
import { Inject, Injectable, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { computeCompleteness, cyberRequired, epicVersions, WORK_PRODUCT, WP_GATE_STAGES, WP_KINDS, wpGateMode, wpStageBlockers, wpSummaryText, type ExtChange, type ExtRef, type FeatureVersionRow, type RejudgeRow, type WpGateMode, type WpItem, type WpKind, type WpProblem, type WpRelation, type WpResult } from '@ff/contracts';
import type { Actor } from '../../../../kernel/actor';
import { AuditService } from '../../../../kernel/audit.service';
import { createHash } from 'node:crypto';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { Scheduler } from '../../../../kernel/scheduler';
import { FeatureRepo, GateRepo } from '../../../d01-policy/repos';
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
  /** 산출물 게이트 적용 방식(enforce·warn·off) */
  gateMode: WpGateMode;
  /** 게이트 단계별 막힘(§5.5) — 정의 승인 G2 · 검증 G5 · 출시 G8 */
  stages: { judgeGate: string; to: string; blockers: WpProblem[] }[];
  /** 이 버전 게이트 판정의 산출물 근거(최신) */
  evidence: { gate: string; gateRecordId: string; hash: string; items: { key: string; version: number; status: string }[]; backfilled: boolean; at: string }[];
  /** 승인 뒤 바뀐 항목(§5.6) */
  changes: { itemKey: string; title: string; fromVersion: number; toVersion: number; at: string; affected: string[] }[];
  /** 요구 ID 대조(FR-DEP-005-002) — Feature 요구 ID 중 codeBeamer에 없는 것, codeBeamer 시스템 요구 중 Feature에 없는 것 */
  requirementCheck: { missing: string[]; unlisted: string[] };
  /** codeBeamer 의심 표시와 FF 계산이 다른 항목 */
  suspectDiff: string[];
  rejudge: RejudgeRow[];
}
const RELEASED_LIKE = ['RELEASED', 'DEPRECATED', 'RETIRED'];

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
    private readonly gates: GateRepo,
    private readonly audit: AuditService,
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
      const prev = new Map(this.items(featureId).map((i) => [i.key, i]));
      this.db.run('DELETE FROM alm_item WHERE feature_id = ?', featureId);
      this.db.run('DELETE FROM alm_relation WHERE feature_id = ?', featureId);
      for (const it of fetched.items) this.db.run('INSERT INTO alm_item (feature_id, item_key, kind, status, revision, observed_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', featureId, it.key, it.kind, it.status, it.version, now, JSON.stringify(it));
      for (const r of fetched.relations) this.db.run('INSERT OR IGNORE INTO alm_relation (feature_id, from_key, to_key, kind, suspect) VALUES (?, ?, ?, ?, 0)', featureId, r.from, r.to, r.kind);
      this.impact(featureId, prev, fetched, now);
      this.backfillEvidence(featureId);
      for (const v of this.features.versions(featureId)) this.compute(featureId, v.version);
    });
    // Task·Epic 칸 — 작업 중 버전
    const working = epicVersions(this.features.versions(featureId)).working;
    if (working) this.sync.enqueue('JIRA', { op: 'WP_TASKS', featureId }, `wp-tasks:${featureId}:${this.stored(featureId, working.version)?.hash ?? now}`);
  }

  /**
   * 변경 영향(§5.6, D-ALM-14) — 승인된 항목의 version이 오르면: 기록, 그 항목에 기대는 아래 관계를 의심(FF 계산 — REST는 관계별 suspect를 주지 않는다),
   * 그 항목을 근거로 쓴 게이트 판정마다 재판정 요청(검토함), codeBeamer 항목에 알림 댓글. 아래 항목이 다시 승인되면(새 version + 승인) 의심을 푼다.
   */
  private impact(featureId: string, prev: Map<string, WpItem>, fetched: WpFetch, now: string) {
    const byKey = new Map(fetched.items.map((i) => [i.key, i]));
    const versions = new Map(this.features.versions(featureId).map((v) => [v.version, v]));
    for (const it of fetched.items) {
      const p = prev.get(it.key);
      if (!p || !p.approved || it.version <= p.version) continue;
      const downstream = fetched.relations.filter((r) => r.to === it.key);
      this.db.run('INSERT INTO alm_change (feature_id, item_key, from_version, to_version, at, doc) VALUES (?, ?, ?, ?, ?, ?)', featureId, it.key, p.version, it.version, now, JSON.stringify({ title: it.title, kind: it.kind, status: it.status, affected: downstream.map((r) => r.from) }));
      for (const r of downstream)
        this.db.run(
          'INSERT INTO alm_suspect (feature_id, from_key, to_key, kind, from_version, since, cleared_at, doc) VALUES (?, ?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(feature_id, from_key, to_key, kind) DO UPDATE SET from_version = excluded.from_version, since = excluded.since, cleared_at = NULL, doc = excluded.doc',
          featureId, r.from, r.to, r.kind, byKey.get(r.from)?.version ?? 0, now, JSON.stringify({ cause: it.key, fromVersion: p.version, toVersion: it.version }),
        );
      // 이 항목을 근거로 쓴 게이트(버전·게이트별 최신 판정)
      const gates = new Map<string, { version: string; gate: string }>();
      for (const e of this.db.all<{ version: string; gate: string; doc: string }>('SELECT version, gate, doc FROM alm_gate_evidence WHERE feature_id = ?', featureId)) {
        const used = (JSON.parse(e.doc) as { items: { key: string; version: number }[] }).items.find((x) => x.key === it.key);
        if (used && used.version < it.version) gates.set(`${e.version}#${e.gate}`, { version: e.version, gate: e.gate });
      }
      for (const g of gates.values()) {
        const released = RELEASED_LIKE.includes(versions.get(g.version)?.lifecycle ?? '');
        this.db.run('INSERT OR IGNORE INTO alm_rejudge (feature_id, version, gate, item_key, to_version, status, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', featureId, g.version, g.gate, it.key, it.version, 'OPEN', now, JSON.stringify({ itemTitle: it.title, fromVersion: p.version, released, resolvedBy: null }));
      }
      if (gates.size) {
        const list = [...gates.values()].map((g) => `${fid(featureId, g.version)} ${g.gate}`).join(', ');
        const rel = [...gates.values()].some((g) => RELEASED_LIKE.includes(versions.get(g.version)?.lifecycle ?? ''));
        this.sync.enqueue('CODEBEAMER', { op: 'COMMENT', key: it.key, text: `[Feature Platform] 승인 뒤 변경(v${p.version} → v${it.version}) — ${list} 재판정 요청${rel ? ' · 출시 버전 산출물 변경(긴급 차단 여부는 담당자가 판단)' : ''}` }, `impact:${featureId}:${it.key}:${it.version}`);
      }
    }
    // 아래 항목이 다시 승인되면(새 version + 승인) 그 관계의 의심을 푼다
    for (const s2 of this.db.all<{ from_key: string; to_key: string; kind: string; from_version: number; doc: string }>('SELECT from_key, to_key, kind, from_version, doc FROM alm_suspect WHERE feature_id = ? AND cleared_at IS NULL', featureId)) {
      const from = byKey.get(s2.from_key);
      if (from && from.approved && from.version > s2.from_version) this.db.run('UPDATE alm_suspect SET cleared_at = ?, doc = ? WHERE feature_id = ? AND from_key = ? AND to_key = ? AND kind = ?', now, JSON.stringify({ ...JSON.parse(s2.doc), cleared: 'reapproved' }), featureId, s2.from_key, s2.to_key, s2.kind);
    }
    this.db.run('UPDATE alm_relation SET suspect = 1 WHERE feature_id = ? AND EXISTS (SELECT 1 FROM alm_suspect s WHERE s.feature_id = alm_relation.feature_id AND s.from_key = alm_relation.from_key AND s.to_key = alm_relation.to_key AND s.kind = alm_relation.kind AND s.cleared_at IS NULL)', featureId);
  }

  /** 산출물 추적 전에 이미 PASS였던 정의 승인·검증·출시 판정(G2·G5·G8)에 그때의 산출물을 근거로 잇는다(이전 판정 보충) */
  private backfillEvidence(featureId: string) {
    for (const v of this.features.versions(featureId))
      for (const st of WP_GATE_STAGES) {
        const rec = this.gates.latest(featureId, v.version)[st.judgeGate];
        if (!rec || rec.status !== 'PASS' || this.db.get('SELECT 1 FROM alm_gate_evidence WHERE gate_record_id = ?', rec.gateRecordId)) continue;
        if (this.db.get('SELECT 1 FROM alm_gate_evidence WHERE feature_id = ? AND version = ? AND gate = ?', featureId, v.version, st.judgeGate)) continue;
        this.writeEvidence(featureId, v.version, st.judgeGate, rec.gateRecordId, true);
      }
  }

  /** 판정 증거 — 완결성 해시와 그때의 항목·version 목록(§5.5) */
  writeEvidence(featureId: string, version: string, gate: string, gateRecordId: string, backfilled = false) {
    const items = this.items(featureId).filter((i) => !i.obsolete && (!i.ffVersion || i.ffVersion === version));
    const f = this.features.get(featureId, version);
    if (!f) return;
    const result = computeCompleteness({ featureId, version, ctx: this.context(f), items, relations: this.relations(featureId) });
    this.db.run('INSERT INTO alm_gate_evidence (gate_record_id, feature_id, version, gate, hash, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gate_record_id) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at, doc = excluded.doc', gateRecordId, featureId, version, gate, sha(result.basis), this.clock.iso(), JSON.stringify({ items: items.map((i) => ({ key: i.key, version: i.version, status: i.status })), backfilled, rate: result.rate }));
  }

  /** 그 게이트를 다시 판정하면 열린 재판정 요청을 닫는다 */
  resolveRejudge(featureId: string, version: string, gate: string, by: string) {
    for (const r of this.db.all<{ rejudge_id: number; doc: string }>("SELECT rejudge_id, doc FROM alm_rejudge WHERE feature_id = ? AND version = ? AND gate = ? AND status = 'OPEN'", featureId, version, gate))
      this.db.run("UPDATE alm_rejudge SET status = 'RESOLVED', doc = ? WHERE rejudge_id = ?", JSON.stringify({ ...JSON.parse(r.doc), resolvedBy: by, resolvedAt: this.clock.iso(), how: 'rejudged' }), r.rejudge_id);
  }

  rejudges(q: { status?: string; featureId?: string } = {}): RejudgeRow[] {
    const where = [q.status ? 'status = ?' : null, q.featureId ? 'feature_id = ?' : null].filter(Boolean).join(' AND ');
    return this.db
      .all<{ rejudge_id: number; feature_id: string; version: string; gate: string; item_key: string; to_version: number; status: 'OPEN' | 'RESOLVED'; created_at: string; doc: string }>(`SELECT * FROM alm_rejudge${where ? ` WHERE ${where}` : ''} ORDER BY rejudge_id DESC LIMIT 500`, ...[q.status, q.featureId].filter((x): x is string => !!x))
      .map((r) => {
        const d = JSON.parse(r.doc) as { itemTitle: string; fromVersion: number; released: boolean; resolvedBy: string | null };
        return { rejudgeId: r.rejudge_id, featureId: r.feature_id, version: r.version, gate: r.gate, itemKey: r.item_key, itemTitle: d.itemTitle, fromVersion: d.fromVersion, toVersion: r.to_version, status: r.status, createdAt: r.created_at, released: d.released, resolvedBy: d.resolvedBy ?? null };
      });
  }

  /** 재판정 요청을 사유로 닫는다(영향 없음 — 출시 버전처럼 다시 판정할 수 없을 때) */
  closeRejudge(actor: Actor, id: number, reason: string): RejudgeRow {
    const r = this.db.get<{ doc: string; status: string; feature_id: string; version: string; gate: string }>('SELECT doc, status, feature_id, version, gate FROM alm_rejudge WHERE rejudge_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `재판정 요청 ${id}을(를) 찾을 수 없습니다.`);
    if (r.status !== 'OPEN') throw new DomainError('CONFLICT', `재판정 요청 ${id}은(는) 이미 닫혔습니다.`);
    this.db.tx(() => {
      this.db.run("UPDATE alm_rejudge SET status = 'RESOLVED', doc = ? WHERE rejudge_id = ?", JSON.stringify({ ...JSON.parse(r.doc), resolvedBy: actor.id, resolvedAt: this.clock.iso(), how: 'closed', reason }), id);
      this.audit.record(actor, 'ALM_REJUDGE_CLOSE', `${r.feature_id}@${r.version}#${r.gate}`, { before: { status: 'OPEN' }, after: { status: 'RESOLVED', rejudgeId: id }, reason, componentId: 'D05-01' });
    });
    return this.rejudges({}).find((x) => x.rejudgeId === id)!;
  }

  /** 의심 관계 풀기 — 아래 항목에 영향 없음(사유) */
  clearSuspect(actor: Actor, featureId: string, version: string, from: string, to: string, reason: string): WpView {
    const rows = this.db.all<{ kind: string; doc: string }>('SELECT kind, doc FROM alm_suspect WHERE feature_id = ? AND from_key = ? AND to_key = ? AND cleared_at IS NULL', featureId, from, to);
    if (!rows.length) throw new DomainError('NOT_FOUND', `${from} → ${to}에 풀 의심 관계가 없습니다.`);
    this.db.tx(() => {
      for (const r of rows) this.db.run('UPDATE alm_suspect SET cleared_at = ?, doc = ? WHERE feature_id = ? AND from_key = ? AND to_key = ? AND kind = ?', this.clock.iso(), JSON.stringify({ ...JSON.parse(r.doc), cleared: 'no-impact', by: actor.id, reason }), featureId, from, to, r.kind);
      this.db.run('UPDATE alm_relation SET suspect = 0 WHERE feature_id = ? AND from_key = ? AND to_key = ?', featureId, from, to);
      this.audit.record(actor, 'ALM_SUSPECT_CLEAR', `${featureId}@${version}`, { after: { from, to }, reason, componentId: 'D05-01' });
      for (const v of this.features.versions(featureId)) this.compute(featureId, v.version);
    });
    return this.view(featureId, version)!;
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
    const f = this.features.get(featureId, version)!;
    const reqIds = new Set(items.filter((i) => i.kind === 'SYS_REQ' && i.reqId).map((i) => i.reqId!));
    const latestEv = new Map<string, WpView['evidence'][number]>();
    for (const e of this.db.all<{ gate_record_id: string; gate: string; hash: string; created_at: string; doc: string }>('SELECT gate_record_id, gate, hash, created_at, doc FROM alm_gate_evidence WHERE feature_id = ? AND version = ? ORDER BY created_at, gate_record_id', featureId, version)) {
      const d = JSON.parse(e.doc) as { items: { key: string; version: number; status: string }[]; backfilled?: boolean };
      latestEv.set(e.gate, { gate: e.gate, gateRecordId: e.gate_record_id, hash: e.hash, items: d.items, backfilled: !!d.backfilled, at: e.created_at });
    }
    const keys = new Set(items.map((i) => i.key));
    const changes = this.db
      .all<{ item_key: string; from_version: number; to_version: number; at: string; doc: string }>('SELECT item_key, from_version, to_version, at, doc FROM alm_change WHERE feature_id = ? ORDER BY change_id DESC LIMIT 50', featureId)
      .filter((c) => keys.has(c.item_key))
      .map((c) => {
        const d = JSON.parse(c.doc) as { title: string; affected: string[] };
        return { itemKey: c.item_key, title: d.title, fromVersion: c.from_version, toVersion: c.to_version, at: c.at, affected: d.affected };
      });
    return {
      featureId,
      version,
      result: s.result,
      cyberWhy: s.cyberWhy,
      items,
      hash: s.hash,
      computedAt: s.computedAt,
      gateMode: wpGateMode(process.env),
      stages: WP_GATE_STAGES.map((st) => ({ judgeGate: st.judgeGate, to: st.to, blockers: wpStageBlockers(s.result, st) })),
      evidence: [...latestEv.values()],
      changes,
      requirementCheck: { missing: (f.requirementIds ?? []).filter((r) => !reqIds.has(r)), unlisted: [...reqIds].filter((r) => !(f.requirementIds ?? []).includes(r)) },
      suspectDiff: items.filter((i) => i.cbSuspected !== undefined && !!i.cbSuspected !== (suspect.has(i.key) || this.relations(featureId).some((r) => r.suspect && r.to === i.key))).map((i) => i.key),
      rejudge: this.rejudges({ featureId }).filter((r) => r.version === version),
    };
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
