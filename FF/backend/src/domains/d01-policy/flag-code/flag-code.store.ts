// Flag 코드 연결 저장소(20-97 §4.3) — 키·조회 열 + doc(JSON). 스캔 결과는 추가만 한다(091~096 트리거).
import { Inject, Injectable } from '@nestjs/common';
import { canonicalJson, FlagGateWaiver, FlagPullRequest, FlagRepository, FlagScanRun, FlagSourceManifestV2, type FlagPlanEntry, type FlagScanAttestation } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { DB, type Db } from '../../../kernel/db';
import { lastEvaluatedAt } from '../../d04-ops/telemetry-ingest/evaluation-stats.service';

export type ScanProvenance = 'FF_SCAN' | 'CI_ATTESTED' | 'DEMO';
/** 브랜치 머리 스캔 실행 — 성공했고 PR 맥락(PR 머리·기준, PR 업로드)이 아니다. 대사 원천은 이 실행이 가리키는 결과뿐이다 */
const BRANCH_HEAD_RUN = "s.status = 'SUCCEEDED' AND s.result_id IS NOT NULL AND s.pr_number IS NULL AND s.scan_trigger IN ('PUSH','MANUAL','SCHEDULE','CI_UPLOAD','DEMO_SEED')";
export interface StoredResult {
  resultId: string;
  repoId: string;
  ref: string;
  commit: string;
  scannedAt: string;
  contentHash: string;
  provenance: ScanProvenance;
  attestation: FlagScanAttestation;
  manifest: FlagSourceManifestV2;
}
export interface PlanRow extends FlagPlanEntry {
  plannedAt: string;
  /** 시연 픽스처가 정한 담당 저장소 — 자동 PR이 먼저 고른다 */
  repoId?: string;
}
export interface UnleashObservation {
  flagKey: string;
  policyId: string;
  revision: number | null;
  outcome: 'SYNCED' | 'FAILED';
  archived: boolean;
  at: string;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const manifestHash = (m: FlagSourceManifestV2) => 'sha256:' + createHash('sha256').update(canonicalJson(m)).digest('hex');

@Injectable()
export class FlagCodeStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  private next(table: string, col: string, prefix: string, width: number): string {
    const rows = this.db.all<{ id: string }>(`SELECT ${col} AS id FROM ${table}`);
    const n = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(prefix.length)) || 0), 0) + 1;
    return `${prefix}${pad(n, width)}`;
  }

  // ── 저장소 ──
  repos(): FlagRepository[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM flag_code_repository ORDER BY repo_id').map((r) => FlagRepository.parse(JSON.parse(r.doc)));
  }
  repo(id: string): FlagRepository | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_code_repository WHERE repo_id = ?', id);
    return r ? FlagRepository.parse(JSON.parse(r.doc)) : undefined;
  }
  repoByUrl(url: string): FlagRepository | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_code_repository WHERE repository = ?', url);
    return r ? FlagRepository.parse(JSON.parse(r.doc)) : undefined;
  }
  nextRepoId() {
    return this.next('flag_code_repository', 'repo_id', 'FREPO-', 3);
  }
  insertRepo(r: FlagRepository, at: string) {
    this.db.run('INSERT INTO flag_code_repository (repo_id, provider, repository, mode, status, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', r.repoId, r.provider, r.repository, r.mode, r.status, r.createdAt, at, JSON.stringify(r));
  }
  updateRepo(r: FlagRepository, at: string) {
    this.db.run('UPDATE flag_code_repository SET status = ?, updated_at = ?, doc = ? WHERE repo_id = ?', r.status, at, JSON.stringify(FlagRepository.parse(r)), r.repoId);
  }

  // ── webhook 배달 ──
  delivery(id: string) {
    const r = this.db.get<{ delivery_id: string; outcome: string; scan_id: string | null; signature_ok: number; received_at: string }>('SELECT delivery_id, outcome, scan_id, signature_ok, received_at FROM flag_webhook_delivery WHERE delivery_id = ?', id);
    return r ? { ...r, signature_ok: Number(r.signature_ok) } : undefined;
  }
  insertDelivery(d: { deliveryId: string; repoId: string | null; event: string; at: string; signatureOk: boolean; outcome: string; scanId?: string | null }) {
    this.db.run('INSERT INTO flag_webhook_delivery (delivery_id, repo_id, event, received_at, signature_ok, outcome, scan_id) VALUES (?, ?, ?, ?, ?, ?, ?)', d.deliveryId, d.repoId, d.event, d.at, d.signatureOk ? 1 : 0, d.outcome, d.scanId ?? null);
  }
  /** 서명이 틀렸던 배달을 바른 서명으로 다시 받았을 때 */
  acceptDelivery(id: string, repoId: string | null, at: string, outcome: string) {
    this.db.run('UPDATE flag_webhook_delivery SET repo_id = ?, received_at = ?, signature_ok = 1, outcome = ? WHERE delivery_id = ?', repoId, at, outcome, id);
  }
  setDeliveryOutcome(id: string, outcome: string, scanId: string | null) {
    this.db.run('UPDATE flag_webhook_delivery SET outcome = ?, scan_id = ? WHERE delivery_id = ?', outcome, scanId, id);
  }

  // ── 스캔 실행 ──
  nextScanId() {
    return this.next('flag_scan_run', 'scan_id', 'FSCAN-', 6);
  }
  insertRun(s: FlagScanRun) {
    this.db.run('INSERT INTO flag_scan_run (scan_id, repo_id, scan_trigger, ref, commit_id, base_commit, pr_number, status, queued_at, finished_at, result_id, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.scanId, s.repoId, s.trigger, s.ref, s.commit, s.baseCommit, s.prNumber, s.status, s.queuedAt, s.finishedAt, s.resultId, JSON.stringify(FlagScanRun.parse(s)));
  }
  updateRun(s: FlagScanRun) {
    this.db.run('UPDATE flag_scan_run SET commit_id = ?, status = ?, finished_at = ?, result_id = ?, doc = ? WHERE scan_id = ?', s.commit, s.status, s.finishedAt, s.resultId, JSON.stringify(FlagScanRun.parse(s)), s.scanId);
  }
  run(id: string): FlagScanRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_scan_run WHERE scan_id = ?', id);
    return r ? FlagScanRun.parse(JSON.parse(r.doc)) : undefined;
  }
  /** 최근 순(queued_at·scan_id 내림차순) — cursor는 마지막 행의 [queued_at, scan_id] */
  runs(q: { repoId?: string; status?: string; trigger?: string; limit: number; before?: { at: string; id: string } | null }): FlagScanRun[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.repoId) (where.push('repo_id = ?'), params.push(q.repoId));
    if (q.status) (where.push('status = ?'), params.push(q.status));
    if (q.trigger) (where.push('scan_trigger = ?'), params.push(q.trigger));
    if (q.before) (where.push('(queued_at < ? OR (queued_at = ? AND scan_id < ?))'), params.push(q.before.at, q.before.at, q.before.id));
    return this.db
      .all<{ doc: string }>(`SELECT doc FROM flag_scan_run ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY queued_at DESC, scan_id DESC LIMIT ${q.limit}`, ...params)
      .map((r) => FlagScanRun.parse(JSON.parse(r.doc)));
  }
  runByResult(resultId: string): FlagScanRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_scan_run WHERE result_id = ? ORDER BY queued_at LIMIT 1', resultId);
    return r ? FlagScanRun.parse(JSON.parse(r.doc)) : undefined;
  }

  // ── 스캔 결과(추가만) ──
  nextResultId() {
    return this.next('flag_scan_result', 'result_id', 'FRES-', 6);
  }
  /** 결과는 추가만 하므로 해석한 manifest를 결과 ID·내용 해시로 기억한다(대사·출시 관문이 자주 읽는다) */
  private readonly parsed = new Map<string, StoredResult>();
  private readResult(r: { result_id: string; repo_id: string; ref: string; commit_id: string; scanned_at: string; content_hash: string; provenance: ScanProvenance; attestation: string; doc: string }): StoredResult {
    const key = `${r.result_id}\u0000${r.content_hash}`;
    const hit = this.parsed.get(key);
    if (hit) return hit;
    const out: StoredResult = { resultId: r.result_id, repoId: r.repo_id, ref: r.ref, commit: r.commit_id, scannedAt: r.scanned_at, contentHash: r.content_hash, provenance: r.provenance, attestation: JSON.parse(r.attestation), manifest: FlagSourceManifestV2.parse(JSON.parse(r.doc)) };
    if (this.parsed.size > 2000) this.parsed.clear();
    this.parsed.set(key, out);
    return out;
  }
  resultFor(repoId: string, commit: string): StoredResult | undefined {
    const r = this.db.get<any>('SELECT * FROM flag_scan_result WHERE repo_id = ? AND commit_id = ?', repoId, commit);
    return r ? this.readResult(r) : undefined;
  }
  result(id: string): StoredResult | undefined {
    const r = this.db.get<any>('SELECT * FROM flag_scan_result WHERE result_id = ?', id);
    return r ? this.readResult(r) : undefined;
  }
  insertResult(r: Omit<StoredResult, 'resultId' | 'contentHash'>): StoredResult {
    const resultId = this.nextResultId();
    const contentHash = manifestHash(r.manifest);
    this.db.run('INSERT INTO flag_scan_result (result_id, repo_id, ref, commit_id, scanned_at, content_hash, provenance, attestation, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', resultId, r.repoId, r.ref, r.commit, r.scannedAt, contentHash, r.provenance, JSON.stringify(r.attestation), canonicalJson(r.manifest));
    const seen = new Set<string>();
    for (const u of r.manifest.usages) {
      const k = `${u.flagKey}\u0000${u.path}\u0000${u.line}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.db.run('INSERT INTO flag_usage_index (result_id, flag_key, path, line) VALUES (?, ?, ?, ?)', resultId, u.flagKey, u.path, u.line);
    }
    return { ...r, resultId, contentHash };
  }
  /**
   * 저장소·브랜치의 최신 결과 — 그 브랜치 머리를 스캔한 성공 실행(PR 맥락 제외)의 서버 기록 시각 순.
   * 결과 행의 ref·scannedAt으로 고르지 않는다: 결과는 커밋마다 하나라 PR 기준·포크 머리(이름이 main일 수 있다)도 같은 ref로 남고, CI 업로드의 scannedAt은 업로더가 정한다.
   */
  latestResult(repoId: string, ref: string): (StoredResult & { runAt: string }) | undefined {
    const s = this.db.get<{ result_id: string; finished_at: string }>(`SELECT s.result_id, s.finished_at FROM flag_scan_run s WHERE s.repo_id = ? AND s.ref = ? AND ${BRANCH_HEAD_RUN} ORDER BY s.finished_at DESC, s.scan_id DESC LIMIT 1`, repoId, ref);
    const r = s ? this.result(s.result_id) : undefined;
    return r ? { ...r, runAt: s!.finished_at } : undefined;
  }
  /** 브랜치 머리 스캔 결과 ID(처음 본 순) — 같은 결과를 다시 스캔해도 한 번 */
  branchResults(repoId: string, ref: string, until: string): string[] {
    return this.db
      .all<{ result_id: string; first_at: string }>(`SELECT s.result_id, min(s.finished_at) AS first_at FROM flag_scan_run s WHERE s.repo_id = ? AND s.ref = ? AND ${BRANCH_HEAD_RUN} AND s.finished_at <= ? GROUP BY s.result_id ORDER BY first_at, s.result_id`, repoId, ref, until)
      .map((r) => r.result_id);
  }
  /** 이 키를 마지막으로 본 결과(같은 저장소·브랜치 머리 스캔, 기준 실행 시각 이전) */
  lastSeen(repoId: string, ref: string, flagKey: string, before: string): { commit: string; at: string } | null {
    const r = this.db.get<{ commit_id: string; scanned_at: string }>(
      `SELECT r.commit_id, r.scanned_at FROM flag_usage_index u JOIN flag_scan_run s ON s.result_id = u.result_id JOIN flag_scan_result r ON r.result_id = u.result_id WHERE u.flag_key = ? AND s.repo_id = ? AND s.ref = ? AND ${BRANCH_HEAD_RUN} AND s.finished_at <= ? ORDER BY s.finished_at DESC, s.scan_id DESC LIMIT 1`,
      flagKey, repoId, ref, before,
    );
    return r ? { commit: r.commit_id, at: r.scanned_at } : null;
  }
  /** 이 키가 보인 브랜치 머리 결과들(최근 순) — ref는 그 결과를 스캔한 브랜치 */
  historyOf(flagKey: string, limit = 20): { resultId: string; repoId: string; ref: string; commit: string; at: string; usages: number }[] {
    return this.db
      .all<{ result_id: string; repo_id: string; ref: string; commit_id: string; scanned_at: string; n: number }>(
        `SELECT r.result_id, r.repo_id, b.ref, r.commit_id, r.scanned_at, (SELECT count(*) FROM flag_usage_index x WHERE x.result_id = r.result_id AND x.flag_key = ?) AS n FROM (SELECT s.result_id, s.ref, max(s.finished_at) AS last_at, max(s.scan_id) AS last_id FROM flag_scan_run s WHERE ${BRANCH_HEAD_RUN} AND s.result_id IN (SELECT u.result_id FROM flag_usage_index u WHERE u.flag_key = ?) GROUP BY s.result_id, s.ref) b JOIN flag_scan_result r ON r.result_id = b.result_id ORDER BY b.last_at DESC, b.last_id DESC LIMIT ${limit}`,
        flagKey, flagKey,
      )
      .map((r) => ({ resultId: r.result_id, repoId: r.repo_id, ref: r.ref, commit: r.commit_id, at: r.scanned_at, usages: Number(r.n) }));
  }

  // ── Flag 계획 ──
  plans(): PlanRow[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM flag_plan ORDER BY feature_id, ordinal, flag_key').map((r) => JSON.parse(r.doc) as PlanRow);
  }
  plan(flagKey: string): PlanRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_plan WHERE flag_key = ?', flagKey);
    return r ? (JSON.parse(r.doc) as PlanRow) : undefined;
  }
  /** 계획 등록 — 이미 있는 키는 그대로 둔다(키는 Feature 단위). flag_registry에도 묶는다. 넣었으면 true */
  insertPlan(p: PlanRow): boolean {
    const r = this.db.run('INSERT OR IGNORE INTO flag_plan (flag_key, feature_id, first_version, control_point, ordinal, package, source, planned_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', p.flagKey, p.featureId, p.version, p.controlPoint, p.ordinal, p.package, p.source, p.plannedAt, JSON.stringify(p));
    this.db.run('INSERT OR IGNORE INTO flag_registry (flag_key, feature_id, bound_at) VALUES (?, ?, ?)', p.flagKey, p.featureId, p.plannedAt);
    return r.changes > 0;
  }
  registry(): Map<string, { featureId: string; retiredAt: string | null }> {
    return new Map(this.db.all<{ flag_key: string; feature_id: string; retired_at: string | null }>('SELECT flag_key, feature_id, retired_at FROM flag_registry').map((r) => [r.flag_key, { featureId: r.feature_id, retiredAt: r.retired_at }]));
  }

  // ── Flag PR ──
  nextPrId() {
    return this.next('flag_pull_request', 'pr_id', 'FPR-', 6);
  }
  prs(q: { repoId?: string; featureId?: string; kind?: string; state?: string } = {}): FlagPullRequest[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.repoId) (where.push('repo_id = ?'), params.push(q.repoId));
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    if (q.kind) (where.push('kind = ?'), params.push(q.kind));
    if (q.state) (where.push('state = ?'), params.push(q.state));
    return this.db.all<{ doc: string }>(`SELECT doc FROM flag_pull_request ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, pr_id DESC`, ...params).map((r) => FlagPullRequest.parse(JSON.parse(r.doc)));
  }
  pr(id: string): FlagPullRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_pull_request WHERE pr_id = ?', id);
    return r ? FlagPullRequest.parse(JSON.parse(r.doc)) : undefined;
  }
  prByBranch(repoId: string, branch: string): FlagPullRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_pull_request WHERE repo_id = ? AND branch = ?', repoId, branch);
    return r ? FlagPullRequest.parse(JSON.parse(r.doc)) : undefined;
  }
  insertPr(p: FlagPullRequest) {
    this.db.run('INSERT INTO flag_pull_request (pr_id, repo_id, kind, feature_id, version, branch, number, state, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', p.prId, p.repoId, p.kind, p.featureId, p.version, p.branch, p.number, p.state, p.createdAt, p.createdAt, JSON.stringify(FlagPullRequest.parse(p)));
  }
  updatePr(p: FlagPullRequest, at: string) {
    this.db.run('UPDATE flag_pull_request SET number = ?, state = ?, updated_at = ?, doc = ? WHERE pr_id = ?', p.number, p.state, at, JSON.stringify(FlagPullRequest.parse(p)), p.prId);
  }

  // ── 출시 차단 해제 ──
  nextWaiverId() {
    return this.next('flag_gate_waiver', 'waiver_id', 'FWV-', 4);
  }
  waivers(q: { featureId?: string; state?: string; flagKey?: string } = {}): (FlagGateWaiver & { decisions?: unknown[] })[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    if (q.state) (where.push('state = ?'), params.push(q.state));
    if (q.flagKey) (where.push('flag_key = ?'), params.push(q.flagKey));
    return this.db.all<{ doc: string }>(`SELECT doc FROM flag_gate_waiver ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY requested_at DESC, waiver_id DESC`, ...params).map((r) => JSON.parse(r.doc));
  }
  waiver(id: string): (FlagGateWaiver & { decisions?: unknown[] }) | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_gate_waiver WHERE waiver_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  insertWaiver(w: FlagGateWaiver & { decisions: unknown[] }) {
    this.db.run('INSERT INTO flag_gate_waiver (waiver_id, flag_key, feature_id, version, state, requested_by, requested_at, decided_by, decided_at, expires_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', w.waiverId, w.flagKey, w.featureId, w.version, w.state, w.requestedBy, w.requestedAt, w.decidedBy, w.decidedAt, w.expiresAt, JSON.stringify(w));
  }
  updateWaiver(w: FlagGateWaiver & { decisions?: unknown[] }) {
    this.db.run('UPDATE flag_gate_waiver SET state = ?, decided_by = ?, decided_at = ?, doc = ? WHERE waiver_id = ?', w.state, w.decidedBy, w.decidedAt, JSON.stringify(w), w.waiverId);
  }

  // ── 평가 지표 — 저장·쓰기는 평가 집계 한 저장소(evaluation-stats, 통합 D-INT-2). 대사는 마지막 평가 시각만 읽는다 ──
  lastEvaluated(): Map<string, string> {
    return lastEvaluatedAt(this.db);
  }

  // ── Unleash 관측(시연 동기화 기록) ──
  insertUnleash(o: UnleashObservation) {
    this.db.run('INSERT OR IGNORE INTO flag_unleash_observation (flag_key, policy_id, revision, outcome, archived, observed_at) VALUES (?, ?, ?, ?, ?, ?)', o.flagKey, o.policyId, o.revision, o.outcome, o.archived ? 1 : 0, o.at);
  }
  unleashObservations(): UnleashObservation[] {
    return this.db
      .all<{ flag_key: string; policy_id: string; revision: number | null; outcome: 'SYNCED' | 'FAILED'; archived: number; observed_at: string }>('SELECT * FROM flag_unleash_observation ORDER BY observed_at')
      .map((r) => ({ flagKey: r.flag_key, policyId: r.policy_id, revision: r.revision == null ? null : Number(r.revision), outcome: r.outcome, archived: !!Number(r.archived), at: r.observed_at }));
  }
}
