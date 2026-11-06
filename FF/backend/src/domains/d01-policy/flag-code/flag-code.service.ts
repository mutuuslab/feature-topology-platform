// Flag 코드 연결·통제(20-97) — 저장소 연결, 서명된 스캔(webhook·재스캔·CI 업로드), 승인 시 Flag 계획·PR, 시연 병합, 출시 차단 해제, 평가 지표.
// 판정(대사·PR 검사·서명 페이로드·뼈대)은 contracts 순수 함수를 쓴다. GitHub 호출은 트랜잭션 밖에서, 기록은 트랜잭션 안에서 한다.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  domainAbbrOf,
  evaluateFlagPrCheck,
  FLAG_WAIVER_MAX_DAYS,
  flagFeatureDir,
  flagPackageOf,
  flagPrText,
  flagRemovalBranch,
  flagScaffoldBranch,
  flagScaffoldFiles,
  flagScanSigningPayload,
  FlagSourceManifestV2,
  flagConstantName,
  planFeatureFlags,
  type ControlPointType,
  type CreateFlagPrBody,
  type CreateFlagRemovalPrBody,
  type CreateFlagRepositoryBody,
  type FeatureVersionRow,
  type FlagEvaluationSeries,
  type FlagEvaluationsResponse,
  type FlagGateWaiver,
  type FlagGateWaiverBody,
  type FlagGateWaiverDecisionBody,
  type FlagPrCheckResult,
  type FlagPullRequest,
  type FlagRepository,
  type FlagScanAttestation,
  type FlagScanDetail,
  type FlagScanRun,
  type GithubWebhookBody,
  type RescanFlagRepositoryBody,
  type UpdateFlagRepositoryBody,
  type UploadFlagScanBody,
} from '@ff/contracts';
import { createHash } from 'node:crypto';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { authModeOf } from '../../../kernel/auth/auth-config';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../kernel/event.service';
import { decodeCursor, encodeCursor } from '../../../kernel/paging';
import { isProduction } from '../../../kernel/runtime-config';
import { EvaluationStatsService } from '../../d04-ops/telemetry-ingest/evaluation-stats.service';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { PolicyRepo } from '../policy-repos';
import { RefdbRepository } from '../refdb/refdb.repository';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { FeatureRepo } from '../repos';
import { FlagCodeStore, type ScanProvenance, type StoredResult } from './flag-code.store';
import { effectiveWaiverState, FlagCoverageService } from './flag-coverage.service';
import { GithubAdapter, GithubError, githubWebhookSecret, repoPath, verifyGithubSignature, type PullRequestFile } from './github.adapter';
import { scanFlagFiles, FLAG_SCANNER_VERSION, type FlagSourceFile } from './scanner';
import { serverScanKey, signScanPayload, trustedScanKeys, verifyScanPayload } from './scan-signing';

export const FLAG_CODE_SYSTEM = (correlationId: string): Actor => ({ id: 'system:flag-code', role: 'SYSTEM', correlationId });
const DAY = 86_400_000;
/** CI 업로드 scannedAt 시계 오차, 멈춘 배달·PLANNED PR을 다시 처리하기까지 */
const UPLOAD_CLOCK_SKEW_MS = 5 * 60_000;
const DELIVERY_STUCK_MS = 5 * 60_000;
const PR_PLANNED_STUCK_MS = 10 * 60_000;
const prBaseUrl = () => (process.env.FF_FLAG_PR_BASE_URL?.trim() || 'http://localhost:9012').replace(/\/$/, '');
const ffJson = (v: unknown) => JSON.stringify(v);
/** symbol·키에 줄바꿈·제어 문자가 섞이면 계약(clean)에 맞게 공백을 접는다 */
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const validKey = (k: string) => k.length > 0 && k.length <= 200 && k === k.trim() && !/[\x00-\x1f\x7f]/.test(k);

type WaiverDoc = FlagGateWaiver & { decisions: { by: string; role: string; decision: 'APPROVE' | 'REJECT'; at: string; kid: string; sig: string }[] };

@Injectable()
@PlatformComponent('D04-01')
export class FlagCodeService implements OnModuleInit {
  private readonly log = new Logger(FlagCodeService.name);
  /** 승인 뒤 비동기 PR 생성 — 시험이 끝을 기다린다 */
  private pending: Promise<unknown>[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: FlagCodeStore,
    private readonly coverage: FlagCoverageService,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly refdb: RefdbRepository,
    private readonly profiles: SafetyProfileService,
    private readonly hsm: HsmService,
    private readonly github: GithubAdapter,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly evals: EvaluationStatsService,
  ) {}

  /** Feature Version 승인(PROPOSED→APPROVED) — 같은 트랜잭션에서 Flag 계획을 등록하고, 커밋 뒤 Flag PR을 연다 */
  onModuleInit() {
    this.events.onPublish((ev: PlatformEvent) => {
      if (ev.type !== 'feature.lifecycle.changed') return;
      const p = ev.payload as { featureId: string; version: string; from: string; to: string };
      if (p.from !== 'PROPOSED' || p.to !== 'APPROVED') return;
      const planned = this.ensurePlan(p.featureId, p.version, ev.correlationId ?? 'flag-plan');
      if (!planned.length) return;
      this.db.afterCommit(() => this.track(this.autoPr(p.featureId, p.version, ev.correlationId ?? 'flag-plan')));
    });
  }

  private track(p: Promise<unknown>) {
    const done = p.catch((e) => this.log.warn(`Flag PR 자동 생성 실패: ${(e as Error).message}`));
    this.pending.push(done);
    void done.finally(() => (this.pending = this.pending.filter((x) => x !== done)));
  }
  /** 시험용 — 진행 중인 비동기 작업이 끝날 때까지 */
  async idle() {
    while (this.pending.length) await Promise.all(this.pending);
  }

  // ── Flag 계획 ──────────────────────────────────────────
  packageOf(f: FeatureVersionRow) {
    const primary = f.featureRefs?.find((l) => l.role === 'PRIMARY');
    const domain = primary ? this.refdb.getRef(primary.refId)?.domain : undefined;
    return flagPackageOf({ domainAbbr: domain ? domainAbbrOf(domain) ?? null : null, ownerId: f.ownerId, tags: f.tags });
  }

  /** 제어점마다 Flag 키를 정해 flag_plan·flag_registry에 넣는다(이미 있는 키는 그대로). 퇴역한 키는 다시 쓰지 않는다. 반드시 tx 안에서 */
  ensurePlan(featureId: string, version: string, correlationId: string) {
    const f = this.features.get(featureId, version);
    if (!f) return [];
    const policies = [...new Map(this.policies.all().filter((p) => p.featureId === featureId).map((p) => [p.flagKey, { flagKey: p.flagKey, controlPoint: p.controlPoint as ControlPointType }])).values()];
    const registry = this.store.registry();
    const plan = planFeatureFlags(f, this.packageOf(f), policies).filter((e) => !registry.get(e.flagKey)?.retiredAt);
    const at = this.clock.iso();
    const added = plan.filter((e) => this.store.insertPlan({ ...e, plannedAt: at }));
    if (added.length) this.audit.record(FLAG_CODE_SYSTEM(correlationId), 'FLAG_PLAN', `${featureId}@${version}`, { after: { flagKeys: added.map((e) => e.flagKey), package: plan[0]?.package }, componentId: 'D01-06' });
    return plan;
  }

  /** 승인 뒤 자동 PR — 패키지를 맡은 연결 저장소(ACTIONS_OIDC 제외)가 있고 아직 코드에 없는 키가 있을 때만 */
  private async autoPr(featureId: string, version: string, correlationId: string) {
    const plan = this.store.plans().filter((p) => p.featureId === featureId);
    const inCode = this.coverage.keysInCode();
    if (!plan.length || plan.every((p) => inCode.has(p.flagKey))) return null;
    const usable = this.store.repos().filter((r) => r.status === 'ACTIVE' && r.mode !== 'ACTIONS_OIDC' && r.packages.some((x) => x.name === plan[0].package));
    const repo = usable.find((r) => r.repoId === plan.find((p) => p.repoId)?.repoId) ?? usable[0];
    if (!repo || this.store.prByBranch(repo.repoId, flagScaffoldBranch(featureId, version))) return null;
    return this.openScaffoldPr(FLAG_CODE_SYSTEM(correlationId), repo, featureId, version, undefined);
  }

  // ── 저장소 ─────────────────────────────────────────────
  repositories() {
    return { items: this.store.repos() };
  }

  private requireRepo(id: string): FlagRepository {
    const r = this.store.repo(id);
    if (!r) throw new DomainError('NOT_FOUND', `${id} 저장소 연결을 찾을 수 없습니다.`);
    return r;
  }

  createRepository(actor: Actor, body: CreateFlagRepositoryBody): FlagRepository {
    if (this.store.repoByUrl(body.repository)) throw new DomainError('CONFLICT', '이미 연결된 저장소입니다.');
    const now = this.clock.iso();
    const provider = new URL(body.repository).hostname.includes('gitlab') ? 'GITLAB' : 'GITHUB';
    const repo: FlagRepository = {
      repoId: this.store.nextRepoId(),
      provider,
      repository: body.repository,
      displayName: body.displayName,
      mode: body.mode,
      defaultBranch: body.defaultBranch,
      scanPaths: body.scanPaths,
      packages: body.packages,
      scanIntervalMinutes: body.scanIntervalMinutes,
      status: 'ACTIVE',
      installationId: body.installationId,
      webhook: { state: body.mode === 'GITHUB_APP' ? 'ACTIVE' : 'NOT_CONFIGURED', lastDeliveryId: null, lastDeliveryAt: null, failureCount: 0, lastError: null },
      lastScan: null,
      createdAt: now,
      createdBy: actor.id,
    };
    return this.db.tx(() => {
      this.store.insertRepo(repo, now);
      this.audit.record(actor, 'FLAG_REPO_CREATE', repo.repoId, { after: { repository: repo.repository, mode: repo.mode, packages: repo.packages.map((p) => p.name), scanIntervalMinutes: repo.scanIntervalMinutes }, componentId: 'D04-01' });
      this.events.publish('flag.repository.created', repo.repoId, { repoId: repo.repoId, repository: repo.repository, mode: repo.mode }, { componentId: 'D04-01', correlationId: actor.correlationId });
      return repo;
    });
  }

  updateRepository(actor: Actor, id: string, body: UpdateFlagRepositoryBody): FlagRepository {
    const before = this.requireRepo(id);
    const { reason, ...patch } = body;
    const after: FlagRepository = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if (after.scanIntervalMinutes > 0 && after.scanIntervalMinutes < 15) throw new DomainError('VALIDATION', '주기 재스캔은 15분 이상입니다.');
    const changed = Object.keys(patch).filter((k) => (before as any)[k] !== undefined && ffJson((before as any)[k]) !== ffJson((after as any)[k]));
    return this.db.tx(() => {
      this.store.updateRepo(after, this.clock.iso());
      this.audit.record(actor, 'FLAG_REPO_UPDATE', id, { before: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])), after: Object.fromEntries(changed.map((k) => [k, (after as any)[k]])), reason, componentId: 'D04-01' });
      this.events.publish('flag.repository.updated', id, { repoId: id, changed }, { componentId: 'D04-01', correlationId: actor.correlationId });
      return after;
    });
  }

  // ── 스캔 기록 ───────────────────────────────────────────
  scans(q: { repoId?: string; status?: string; trigger?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && (!c || typeof c.at !== 'string' || typeof c.id !== 'string')) throw new DomainError('VALIDATION', 'cursor가 올바르지 않습니다.');
    const items = this.store.runs({ repoId: q.repoId, status: q.status, trigger: q.trigger, limit: limit + 1, before: c ? { at: String(c.at), id: String(c.id) } : null });
    const page = items.slice(0, limit);
    return { items: page, nextCursor: items.length > limit ? encodeCursor({ at: page.at(-1)!.queuedAt, id: page.at(-1)!.scanId }) : null };
  }

  scanDetail(id: string): FlagScanDetail {
    const scan = this.store.run(id);
    if (!scan) throw new DomainError('NOT_FOUND', `${id} 스캔을 찾을 수 없습니다.`);
    const result = scan.resultId ? this.store.result(scan.resultId) : undefined;
    return { scan, manifest: result?.manifest ?? null, provenance: result?.provenance ?? null, verified: !!result && this.verifyAttestation(result.manifest, result.attestation, result.provenance) };
  }

  /** 저장된 결과의 출처 확인 — FF 스캐너 서명은 믿는 키로 다시 검증, OIDC는 받을 때 검증한 기록 */
  private verifyAttestation(manifest: FlagSourceManifestV2, att: FlagScanAttestation, provenance: ScanProvenance): boolean {
    if (att.kind === 'FF_SCANNER') {
      const key = trustedScanKeys().get(att.keyId);
      return !!key && verifyScanPayload(flagScanSigningPayload(manifest), att.signature, key);
    }
    return att.kind === 'GITHUB_OIDC' && provenance === 'CI_ATTESTED';
  }

  /** 스캔 기록 남기기 — 결과는 (저장소, 커밋)마다 하나. 같은 커밋의 내용이 다르면 거부(이전 결과 유지) */
  private record(actor: Actor, i: { repo: FlagRepository; trigger: FlagScanRun['trigger']; ref: string; baseCommit: string | null; prNumber: number | null; deliveryId: string | null; queuedAt?: string; manifest: FlagSourceManifestV2 | null; attestation: FlagScanAttestation | null; provenance: ScanProvenance | null; prCheck?: FlagPrCheckResult | null; error?: { code: string; message: string } | null }): FlagScanRun {
    const now = this.clock.iso();
    return this.db.tx(() => {
      let status: FlagScanRun['status'] = i.error ? (i.error.code === 'SIGNATURE_INVALID' || i.error.code === 'CONTENT_CONFLICT' ? 'REJECTED' : 'FAILED') : 'SUCCEEDED';
      let error = i.error ?? null;
      let result: StoredResult | undefined;
      if (!error && i.manifest && i.attestation && i.provenance) {
        const prior = this.store.resultFor(i.repo.repoId, i.manifest.commit);
        if (prior) {
          const same = (m: FlagSourceManifestV2) => ffJson({ ...m, scannedAt: '' });
          if (same(prior.manifest) !== same(i.manifest)) {
            status = 'REJECTED';
            error = { code: 'CONTENT_CONFLICT', message: '같은 커밋의 이전 스캔 결과와 내용이 다릅니다 — 이전 결과를 유지합니다.' };
          } else result = prior;
        } else result = this.store.insertResult({ repoId: i.repo.repoId, ref: i.manifest.ref, commit: i.manifest.commit, scannedAt: i.manifest.scannedAt, provenance: i.provenance, attestation: i.attestation, manifest: i.manifest });
      }
      const m = result?.manifest ?? i.manifest;
      const run: FlagScanRun = {
        scanId: this.store.nextScanId(),
        repoId: i.repo.repoId,
        trigger: i.trigger,
        ref: i.ref,
        commit: m?.commit ?? null,
        baseCommit: i.baseCommit,
        prNumber: i.prNumber,
        status,
        queuedAt: i.queuedAt ?? now,
        finishedAt: now,
        resultId: status === 'SUCCEEDED' ? (result?.resultId ?? null) : null,
        summary: m && status === 'SUCCEEDED' ? { filesScanned: m.filesScanned, usages: m.usages.length, flagKeys: new Set(m.usages.map((u) => u.flagKey)).size, unresolved: m.unresolved.length } : null,
        attestation: status === 'SUCCEEDED' ? (result?.attestation ?? i.attestation) : i.attestation,
        prCheck: i.prCheck ?? null,
        error,
        requestedBy: actor.id,
        deliveryId: i.deliveryId,
      };
      this.store.insertRun(run);
      const repo = this.store.repo(i.repo.repoId)!;
      // 저장소의 '최근 스캔'은 기본 브랜치 머리 스캔 — PR 머리(포크 브랜치 이름이 main일 수 있다)·기준·PR 업로드는 실패만 알린다
      const branchHead = i.trigger !== 'PULL_REQUEST' && i.prNumber == null;
      if (run.commit && ((branchHead && i.ref === repo.defaultBranch) || status !== 'SUCCEEDED')) this.store.updateRepo({ ...repo, lastScan: { scanId: run.scanId, commit: run.commit, at: run.finishedAt!, status: run.status } }, now);
      const detail = { scanId: run.scanId, repoId: run.repoId, trigger: run.trigger, ref: run.ref, commit: run.commit, status: run.status, provenance: i.provenance, conclusion: run.prCheck?.conclusion ?? null };
      if (status === 'SUCCEEDED') this.audit.record(actor, 'FLAG_SCAN', run.scanId, { after: detail, componentId: 'D04-01' });
      else this.audit.record(actor, 'FLAG_SCAN', run.scanId, { after: { ...detail, error: run.error }, componentId: 'D04-01' });
      this.events.publish(status === 'SUCCEEDED' ? 'flag.scan.completed' : 'flag.scan.failed', run.scanId, detail, { componentId: 'D04-01', correlationId: actor.correlationId });
      return run;
    });
  }

  /** 파일 묶음 → 서버 서명 manifest v2 */
  private buildManifest(repo: FlagRepository, ref: string, commit: string, files: FlagSourceFile[], scannedAt = this.clock.iso()): { manifest: FlagSourceManifestV2; attestation: FlagScanAttestation } {
    const found = scanFlagFiles(files);
    const usages = found.usages.filter((u) => validKey(u.flagKey)).map((u) => ({ ...u, symbol: clean(u.symbol) }));
    const unresolved = [...found.unresolved, ...found.usages.filter((u) => !validKey(u.flagKey)).map(({ path, line, symbol, method }) => ({ path, line, symbol, method }))].map((u) => ({ ...u, symbol: clean(u.symbol) }));
    const manifest = FlagSourceManifestV2.parse({ format: 'ff-flag-source/v2', provider: repo.provider, repository: repo.repository, ref, commit, scannedAt, scanner: { name: 'ff-flag-scan', version: FLAG_SCANNER_VERSION }, filesScanned: files.length, usages, unresolved });
    return { manifest, attestation: this.sign(manifest) };
  }

  private sign(manifest: FlagSourceManifestV2): FlagScanAttestation {
    const key = serverScanKey();
    if (!key) throw new DomainError('PRECONDITION_FAILED', '스캔 서명 키가 설정되지 않았습니다(FF_FLAG_SCAN_PRIVATE_KEY).');
    return { kind: 'FF_SCANNER', keyId: key.keyId, signature: signScanPayload(flagScanSigningPayload(manifest), key.key) };
  }

  /** 서버 스캔 — 저장소에서 커밋 파일을 읽어 스캔·서명. 실패하면 FAILED 기록(이전 결과 유지) */
  private async serverScan(actor: Actor, repo: FlagRepository, i: { trigger: FlagScanRun['trigger']; ref: string; commit: string | null; deliveryId: string | null; baseCommit?: string | null; prNumber?: number | null; prCheck?: (head: StoredResult) => FlagPrCheckResult | null }): Promise<FlagScanRun> {
    const queuedAt = this.clock.iso();
    const port = this.github.port(repo);
    const fail = (code: string, message: string) => this.record(actor, { repo, trigger: i.trigger, ref: i.ref, baseCommit: i.baseCommit ?? null, prNumber: i.prNumber ?? null, deliveryId: i.deliveryId, queuedAt, manifest: null, attestation: null, provenance: null, error: { code, message } });
    if (!port) {
      // 시연 미러에 로컬 저장소가 없으면 같은 커밋의 이전 결과를 다시 확인한다
      const prior = i.commit ? this.store.resultFor(repo.repoId, i.commit) : this.store.latestResult(repo.repoId, i.ref);
      if (repo.mode === 'DEMO_MIRROR' && prior) return this.record(actor, { repo, trigger: i.trigger, ref: i.ref, baseCommit: i.baseCommit ?? null, prNumber: i.prNumber ?? null, deliveryId: i.deliveryId, queuedAt, manifest: prior.manifest, attestation: prior.attestation, provenance: prior.provenance, prCheck: i.prCheck?.(prior) ?? null, error: this.verifyAttestation(prior.manifest, prior.attestation, prior.provenance) ? null : { code: 'SIGNATURE_INVALID', message: '저장된 스캔의 서명을 확인하지 못했습니다.' } });
      return fail('NOT_READABLE', repo.mode === 'ACTIONS_OIDC' ? 'Actions OIDC 연결은 CI가 스캔해 올립니다 — 저장소 워크플로를 다시 실행하세요.' : '이 연결에서 저장소를 읽을 수 없습니다.');
    }
    try {
      const commit = i.commit ?? (await port.headOf(repo, i.ref));
      const files = await port.files(repo, commit);
      const { manifest, attestation } = this.buildManifest(repo, i.ref, commit, files);
      const head: StoredResult = { resultId: '', repoId: repo.repoId, ref: i.ref, commit, scannedAt: manifest.scannedAt, contentHash: '', provenance: 'FF_SCAN', attestation, manifest };
      return this.record(actor, { repo, trigger: i.trigger, ref: i.ref, baseCommit: i.baseCommit ?? null, prNumber: i.prNumber ?? null, deliveryId: i.deliveryId, queuedAt, manifest, attestation, provenance: 'FF_SCAN', prCheck: i.prCheck?.(head) ?? null });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      return fail('SCAN_FAILED', e instanceof GithubError ? e.message : `스캔하지 못했습니다: ${(e as Error).message}`);
    }
  }

  async rescan(actor: Actor, id: string, body: RescanFlagRepositoryBody): Promise<FlagScanRun> {
    const repo = this.requireRepo(id);
    if (repo.status !== 'ACTIVE') throw new DomainError('GUARD_FAILED', '일시 중지된 저장소는 재스캔할 수 없습니다.');
    const ref = body.ref ?? repo.defaultBranch;
    this.db.tx(() => this.audit.record(actor, 'FLAG_SCAN_REQUEST', id, { after: { ref }, reason: body.reason, componentId: 'D04-01' }));
    return this.serverScan(actor, repo, { trigger: 'MANUAL', ref, commit: null, deliveryId: null });
  }

  /** CI 업로드 — OIDC 토큰의 저장소·커밋·브랜치가 manifest와 같아야 한다. 토큰은 저장하지 않는다 */
  async upload(actor: Actor, body: UploadFlagScanBody): Promise<FlagScanRun> {
    const m = body.manifest;
    // scannedAt은 업로더가 정한다 — 미래 시각은 받지 않는다(시계 오차 5분)
    if (Date.parse(m.scannedAt) > this.clock.now().getTime() + UPLOAD_CLOCK_SKEW_MS) throw new DomainError('VALIDATION', '스캔 시각(scannedAt)이 지금보다 뒤입니다 — 러너 시계를 확인하세요.');
    const repo = this.store.repoByUrl(m.repository);
    if (!repo) throw new DomainError('NOT_FOUND', '연결되지 않은 저장소의 스캔입니다 — 저장소 연결을 먼저 하세요.');
    if (repo.status !== 'ACTIVE') throw new DomainError('GUARD_FAILED', '일시 중지된 저장소입니다.');
    let claims: Record<string, any>;
    try {
      claims = await this.github.verifyOidc(body.oidcToken);
    } catch (e) {
      this.audit.failed(actor, 'FLAG_SCAN_UPLOAD', repo.repoId, (e as Error).message, 'D04-01');
      throw new DomainError('UNAUTHENTICATED', `OIDC 토큰을 확인하지 못했습니다: ${(e as Error).message}`);
    }
    const refOk = claims.ref === `refs/heads/${m.ref}` || (body.prNumber != null && claims.ref === `refs/pull/${body.prNumber}/merge`);
    if (claims.repository !== repoPath(repo.repository) || String(claims.sha).toLowerCase() !== m.commit || !refOk) {
      this.audit.failed(actor, 'FLAG_SCAN_UPLOAD', repo.repoId, 'OIDC 신원과 스캔 대상(저장소·커밋·브랜치) 불일치', 'D04-01');
      throw new DomainError('FORBIDDEN', 'OIDC 토큰의 저장소·커밋·브랜치가 스캔 결과와 다릅니다.');
    }
    const attestation: FlagScanAttestation = { kind: 'GITHUB_OIDC', issuer: 'https://token.actions.githubusercontent.com', subject: String(claims.sub ?? ''), workflowRef: String(claims.job_workflow_ref ?? claims.workflow_ref ?? ''), runId: String(claims.run_id ?? ''), verifiedAt: this.clock.iso() };
    const prCheck = body.prNumber != null ? this.prCheckOf(m, body.baseCommit ? this.store.resultFor(repo.repoId, body.baseCommit)?.manifest ?? null : null) : null;
    return this.record(actor, { repo, trigger: 'CI_UPLOAD', ref: m.ref, baseCommit: body.baseCommit, prNumber: body.prNumber, deliveryId: null, manifest: m, attestation, provenance: 'CI_ATTESTED', prCheck });
  }

  private prCheckOf(head: FlagSourceManifestV2, base: FlagSourceManifestV2 | null): FlagPrCheckResult {
    return evaluateFlagPrCheck({ base: base?.usages ?? [], head: head.usages, baseUnresolved: base?.unresolved ?? [], headUnresolved: head.unresolved, registryState: this.coverage.registryState() });
  }

  // ── GitHub webhook ─────────────────────────────────────
  async webhook(headers: Record<string, string | string[] | undefined>, raw: Buffer, body: GithubWebhookBody): Promise<{ status: number; body: Record<string, unknown> }> {
    const h = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const deliveryId = h('x-github-delivery')?.trim() ?? '';
    const event = h('x-github-event')?.trim() ?? '';
    const at = this.clock.iso();
    const sys = FLAG_CODE_SYSTEM(deliveryId || 'github-webhook');
    if (!deliveryId || !event) throw new DomainError('VALIDATION', 'X-GitHub-Delivery·X-GitHub-Event 머리글이 필요합니다.');
    const prior = this.store.delivery(deliveryId);
    const repo = this.store.repoByUrl(String(body.repository?.html_url ?? '').replace(/\.git$/, '').replace(/\/$/, ''));
    if (!verifyGithubSignature(githubWebhookSecret(), raw, h('x-hub-signature-256'))) {
      this.db.tx(() => {
        if (!prior) this.store.insertDelivery({ deliveryId, repoId: repo?.repoId ?? null, event, at, signatureOk: false, outcome: 'SIGNATURE_INVALID' });
        if (repo) this.store.updateRepo({ ...repo, webhook: { ...repo.webhook, state: 'FAILING', failureCount: repo.webhook.failureCount + 1, lastError: 'X-Hub-Signature-256 서명이 맞지 않습니다.', lastDeliveryId: deliveryId, lastDeliveryAt: at } }, at);
      });
      this.audit.failed(sys, 'FLAG_WEBHOOK', deliveryId, 'X-Hub-Signature-256 서명 불일치', 'D04-01');
      throw new DomainError('UNAUTHENTICATED', 'webhook 서명(X-Hub-Signature-256)이 맞지 않습니다.');
    }
    // 처리를 끝낸 배달만 중복이다 — 처리 중 실패(ERROR)했거나 받은 뒤 멈춘(RECEIVED, 5분 경과) 배달은 GitHub 재전송으로 다시 처리한다(스캔은 커밋마다 멱등)
    const retriable = !!prior && (prior.outcome === 'ERROR' || (prior.outcome === 'RECEIVED' && Date.parse(at) - Date.parse(prior.received_at) > DELIVERY_STUCK_MS));
    if (prior?.signature_ok && !retriable) return { status: 200, body: { deliveryId, duplicate: true, outcome: prior.outcome, scanId: prior.scan_id } };
    if (!repo) {
      this.db.tx(() => (prior ? this.store.acceptDelivery(deliveryId, null, at, 'UNKNOWN_REPOSITORY') : this.store.insertDelivery({ deliveryId, repoId: null, event, at, signatureOk: true, outcome: 'UNKNOWN_REPOSITORY' })));
      throw new DomainError('NOT_FOUND', '연결되지 않은 저장소의 webhook입니다.');
    }
    // 같은 App의 다른 설치(저장소 이름을 이어받은 다른 조직 등)가 보낸 배달은 받지 않는다 — 서명은 App 전체가 같은 비밀이다
    const installation = body.installation?.id;
    if (repo.mode === 'GITHUB_APP' && repo.installationId && installation != null && installation !== repo.installationId) {
      this.db.tx(() => {
        if (prior) this.store.acceptDelivery(deliveryId, repo.repoId, at, 'INSTALLATION_MISMATCH');
        else this.store.insertDelivery({ deliveryId, repoId: repo.repoId, event, at, signatureOk: true, outcome: 'INSTALLATION_MISMATCH' });
        this.store.updateRepo({ ...repo, webhook: { ...repo.webhook, state: 'FAILING', failureCount: repo.webhook.failureCount + 1, lastError: `연결한 App 설치(${repo.installationId})가 아닌 설치(${installation})의 배달입니다.`, lastDeliveryId: deliveryId, lastDeliveryAt: at } }, at);
      });
      this.audit.failed(sys, 'FLAG_WEBHOOK', deliveryId, `App 설치 번호 불일치(${installation})`, 'D04-01');
      throw new DomainError('FORBIDDEN', '연결한 GitHub App 설치의 webhook이 아닙니다.');
    }
    this.db.tx(() => {
      if (prior) this.store.acceptDelivery(deliveryId, repo.repoId, at, 'RECEIVED');
      else this.store.insertDelivery({ deliveryId, repoId: repo.repoId, event, at, signatureOk: true, outcome: 'RECEIVED' });
      this.store.updateRepo({ ...repo, webhook: { ...repo.webhook, state: 'ACTIVE', lastDeliveryId: deliveryId, lastDeliveryAt: at, lastError: null } }, at);
    });
    const done = (outcome: string, scan: FlagScanRun | null) => {
      this.db.tx(() => this.store.setDeliveryOutcome(deliveryId, outcome, scan?.scanId ?? null));
      return { status: 202, body: { deliveryId, outcome, scanId: scan?.scanId ?? null, status: scan?.status ?? null, conclusion: scan?.prCheck?.conclusion ?? null } };
    };
    if (repo.status !== 'ACTIVE') return done('IGNORED_PAUSED', null);
    try {
      return await this.handleEvent(sys, repo, event, body, deliveryId, done);
    } catch (e) {
      this.db.tx(() => this.store.setDeliveryOutcome(deliveryId, 'ERROR', null));
      throw e;
    }
  }

  private async handleEvent(sys: Actor, repo: FlagRepository, event: string, body: GithubWebhookBody, deliveryId: string, done: (outcome: string, scan: FlagScanRun | null) => { status: number; body: Record<string, unknown> }) {
    if (event === 'push') {
      const branch = String(body.ref ?? '').replace(/^refs\/heads\//, '');
      if (branch !== repo.defaultBranch || !body.after || /^0+$/.test(body.after)) return done('IGNORED', null);
      return done('SCANNED', await this.serverScan(sys, repo, { trigger: 'PUSH', ref: branch, commit: body.after.toLowerCase(), deliveryId }));
    }
    if (event === 'pull_request' && body.pull_request) {
      const pr = body.pull_request;
      const action = body.action ?? '';
      if (action === 'closed') {
        this.closePr(sys, repo, pr.head.ref, pr.number, !!pr.merged, (pr as { merge_commit_sha?: string }).merge_commit_sha ?? null);
        return done(pr.merged ? 'PR_MERGED' : 'PR_CLOSED', null);
      }
      if (!['opened', 'synchronize', 'reopened'].includes(action)) return done('IGNORED', null);
      const base = this.store.resultFor(repo.repoId, pr.base.sha.toLowerCase()) ?? (await this.ensureBase(sys, repo, pr.base.ref, pr.base.sha.toLowerCase(), deliveryId));
      const run = await this.serverScan(sys, repo, { trigger: 'PULL_REQUEST', ref: pr.head.ref, commit: pr.head.sha.toLowerCase(), deliveryId, baseCommit: pr.base.sha.toLowerCase(), prNumber: pr.number, prCheck: (head) => this.prCheckOf(head.manifest, base?.manifest ?? null) });
      await this.publishCheck(repo, run);
      return done('PR_CHECKED', run);
    }
    return done('IGNORED', null);
  }

  /** PR 기준 커밋 결과가 없으면 먼저 스캔한다(기준·머리 비교) */
  private async ensureBase(actor: Actor, repo: FlagRepository, ref: string, commit: string, deliveryId: string): Promise<StoredResult | undefined> {
    const run = await this.serverScan(actor, repo, { trigger: 'PULL_REQUEST', ref, commit, deliveryId: null });
    void deliveryId;
    return run.resultId ? this.store.result(run.resultId) : undefined;
  }

  /** Check Run 'FF Flag 검사' — 발견을 표로, 줄마다 FF 화면 링크 */
  private async publishCheck(repo: FlagRepository, run: FlagScanRun) {
    if (!run.prCheck || !run.commit) return;
    const port = this.github.port(repo);
    if (!port?.canWrite) return;
    const rows = run.prCheck.findings.map((f) => `| ${f.level} | ${f.code} | ${f.flagKey ? `[${f.flagKey}](${prBaseUrl()}/flag-code/flags/${f.flagKey})` : '—'} | ${f.path}${f.line ? `:${f.line}` : ''} | ${f.message} |`);
    const summary = rows.length ? ['| 결과 | 코드 | Flag | 위치 | 설명 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n') : 'Flag 호출 변경에 문제가 없습니다.';
    try {
      await port.checkRun(repo, { headSha: run.commit, conclusion: run.prCheck.conclusion, title: run.prCheck.conclusion === 'success' ? 'FF Flag 검사 통과' : `FF Flag 검사 실패 ${run.prCheck.findings.filter((f) => f.level === 'FAILURE').length}건`, summary });
    } catch (e) {
      this.log.warn(`Check Run 기록 실패: ${(e as Error).message}`);
    }
  }

  /** FF가 연 PR만 — 브랜치 이름은 포크 PR이 흉내 낼 수 있으므로 PR 번호까지 같아야 한다 */
  private closePr(actor: Actor, repo: FlagRepository, branch: string, number: number, merged: boolean, mergeCommit: string | null) {
    const pr = this.store.prByBranch(repo.repoId, branch);
    if (!pr || pr.number !== number || pr.state === 'MERGED' || pr.state === 'CLOSED') return;
    const at = this.clock.iso();
    const next: FlagPullRequest = { ...pr, state: merged ? 'MERGED' : 'CLOSED', mergedAt: merged ? at : null, mergedBy: merged ? actor.id : null, mergeCommit: merged && mergeCommit && /^[0-9a-f]{40}$/.test(mergeCommit) ? mergeCommit : null };
    this.db.tx(() => {
      this.store.updatePr(next, at);
      this.audit.record(actor, merged ? 'FLAG_PR_MERGED' : 'FLAG_PR_CLOSED', pr.prId, { after: { state: next.state, number: pr.number, mergeCommit: next.mergeCommit }, componentId: 'D01-06' });
      this.events.publish(merged ? 'flag.pr.merged' : 'flag.pr.closed', pr.prId, { prId: pr.prId, featureId: pr.featureId, version: pr.version, kind: pr.kind }, { componentId: 'D01-06', correlationId: actor.correlationId });
    });
  }

  // ── Flag PR ────────────────────────────────────────────
  pullRequests(q: { repoId?: string; featureId?: string; kind?: string; state?: string }) {
    return { items: this.store.prs(q) };
  }

  async createPr(actor: Actor, body: CreateFlagPrBody): Promise<FlagPullRequest> {
    const repo = this.requireRepo(body.repoId);
    const f = this.features.get(body.featureId, body.version);
    if (!f) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.version}을(를) 찾을 수 없습니다.`);
    if (['PROPOSED', 'RETIRED'].includes(f.lifecycle)) throw new DomainError('GUARD_FAILED', `${f.lifecycle} Version은 Flag PR을 만들 수 없습니다 — 승인 뒤 퇴역 전까지입니다.`);
    this.db.tx(() => this.ensurePlan(f.featureId, f.version, actor.correlationId));
    return this.openScaffoldPr(actor, repo, body.featureId, body.version, body.flagKeys);
  }

  private async openScaffoldPr(actor: Actor, repo: FlagRepository, featureId: string, version: string, only: string[] | undefined): Promise<FlagPullRequest> {
    const f = this.features.get(featureId, version)!;
    const plan = this.store.plans().filter((p) => p.featureId === featureId);
    if (!plan.length) throw new DomainError('GUARD_FAILED', `${featureId} ${version}에 제어점이 정의되지 않아 Flag 계획이 없습니다.`);
    const unknown = (only ?? []).filter((k) => !plan.some((p) => p.flagKey === k));
    if (unknown.length) throw new DomainError('VALIDATION', `이 Feature의 Flag 계획에 없는 키: ${unknown.join(', ')}`);
    if (repo.status !== 'ACTIVE') throw new DomainError('GUARD_FAILED', '일시 중지된 저장소에는 PR을 만들 수 없습니다.');
    if (repo.mode === 'ACTIONS_OIDC') throw new DomainError('GUARD_FAILED', 'Actions OIDC 연결은 FF가 PR을 만들지 않습니다 — 수동으로 반영하세요.');
    const pkg = plan[0].package;
    if (!repo.packages.some((p) => p.name === pkg)) throw new DomainError('GUARD_FAILED', `${repo.displayName}에 ${pkg} 패키지가 연결되지 않았습니다.`);
    const entries = plan.map((p) => ({ ...p, version }));
    const files = flagScaffoldFiles({ featureId, version, name: f.name }, entries);
    const keys = only?.length ? only : entries.map((e) => e.flagKey);
    const text = flagPrText('SCAFFOLD', { featureId, version, name: f.name }, keys, prBaseUrl());
    return this.openPr(actor, repo, { kind: 'SCAFFOLD', featureId, version, flagKeys: keys, branch: flagScaffoldBranch(featureId, version), title: text.title, body: text.body, files: files.map((x) => ({ path: x.path, content: x.content })), retirementId: null });
  }

  /** PR 행을 PLANNED로 남기고(실패해도 기록), 모드에 따라 GitHub PR을 열거나 시연 PR로 연다 */
  private async openPr(actor: Actor, repo: FlagRepository, p: { kind: 'SCAFFOLD' | 'REMOVAL'; featureId: string; version: string; flagKeys: string[]; branch: string; title: string; body: string; files: PullRequestFile[]; retirementId: string | null }): Promise<FlagPullRequest> {
    const prior = this.store.prByBranch(repo.repoId, p.branch);
    const at = this.clock.iso();
    // PLANNED는 GitHub 호출 중 — 그 사이 서버가 멈추면 PLANNED로 남으므로 일정 시간 뒤에는 다시 만들 수 있다
    const stuck = prior?.state === 'PLANNED' && Date.parse(at) - Date.parse(prior.createdAt) > PR_PLANNED_STUCK_MS;
    if (prior && !['FAILED', 'CLOSED'].includes(prior.state) && !stuck) throw new DomainError('CONFLICT', `같은 브랜치(${p.branch})의 Flag PR이 이미 ${prior.state} 상태입니다.`);
    const base: FlagPullRequest = {
      prId: prior?.prId ?? this.store.nextPrId(),
      repoId: repo.repoId,
      kind: p.kind,
      featureId: p.featureId,
      version: p.version,
      flagKeys: p.flagKeys,
      branch: p.branch,
      number: null,
      url: null,
      title: p.title,
      state: 'PLANNED',
      checkConclusion: null,
      files: p.files.map((x) => ({ path: x.path, change: x.content === null ? 'DELETE' : p.kind === 'REMOVAL' ? 'MODIFY' : 'ADD' })),
      createdAt: at,
      createdBy: actor.id,
      mergedAt: null,
      mergedBy: null,
      mergeCommit: null,
      retirementId: p.retirementId,
      failure: null,
    };
    this.db.tx(() => (prior ? this.store.updatePr(base, at) : this.store.insertPr(base)));
    let next: FlagPullRequest;
    if (repo.mode === 'DEMO_MIRROR') {
      const number = Math.max(0, ...this.store.prs({ repoId: repo.repoId }).map((x) => x.number ?? 0)) + 1;
      next = { ...base, state: 'OPEN', number, checkConclusion: 'PENDING' };
    } else {
      const port = this.github.port(repo);
      try {
        if (!port?.canWrite) throw new GithubError('이 연결은 PR을 만들 수 없습니다.');
        const opened = await port.createPullRequest(repo, { branch: p.branch, base: repo.defaultBranch, title: p.title, body: p.body, message: p.title, files: p.files });
        next = { ...base, state: 'OPEN', number: opened.number, url: opened.url, checkConclusion: 'PENDING' };
      } catch (e) {
        next = { ...base, state: 'FAILED', failure: e instanceof GithubError ? e.message : `PR을 만들지 못했습니다: ${(e as Error).message}` };
      }
    }
    return this.db.tx(() => {
      this.store.updatePr(next, this.clock.iso());
      const detail = { prId: next.prId, repoId: repo.repoId, kind: next.kind, featureId: next.featureId, version: next.version, branch: next.branch, number: next.number, state: next.state, flagKeys: next.flagKeys };
      if (next.state === 'FAILED') this.audit.record(actor, 'FLAG_PR_CREATE', next.prId, { after: { ...detail, failure: next.failure }, componentId: 'D01-06' });
      else this.audit.record(actor, 'FLAG_PR_CREATE', next.prId, { after: detail, componentId: 'D01-06' });
      this.events.publish(next.state === 'FAILED' ? 'flag.pr.failed' : 'flag.pr.opened', next.prId, detail, { componentId: 'D01-06', correlationId: actor.correlationId });
      return next;
    });
  }

  async createRemovalPr(actor: Actor, body: CreateFlagRemovalPrBody): Promise<FlagPullRequest> {
    const repo = this.requireRepo(body.repoId);
    const ret = this.db.get<{ doc: string }>('SELECT doc FROM flag_retirement WHERE retirement_id = ?', body.retirementId);
    if (!ret) throw new DomainError('NOT_FOUND', `${body.retirementId} Retirement 건을 찾을 수 없습니다.`);
    const r = JSON.parse(ret.doc) as { flagKey: string; featureId: string; featureVersion: string; status: string; approvedAt: string | null };
    if (r.flagKey !== body.flagKey) throw new DomainError('VALIDATION', 'Retirement 건의 Flag와 다릅니다.');
    if (r.status !== 'APPROVED' || !r.approvedAt) throw new DomainError('GUARD_FAILED', 'Retirement가 승인된 Flag만 제거 PR을 만들 수 있습니다.');
    const latest = this.store.latestResult(repo.repoId, repo.defaultBranch);
    const paths = [...new Set((latest?.manifest.usages ?? []).filter((u) => u.flagKey === body.flagKey).map((u) => u.path))];
    if (!paths.length) throw new DomainError('GUARD_FAILED', `${repo.displayName}의 최신 스캔에 ${body.flagKey} 호출이 없습니다 — 제거할 코드가 없습니다.`);
    const f = this.features.get(r.featureId, r.featureVersion);
    const files = this.removalFiles(r.featureId, r.featureVersion, f?.name ?? r.featureId, body.flagKey, paths);
    const text = flagPrText('REMOVAL', { featureId: r.featureId, version: r.featureVersion, name: f?.name ?? r.featureId }, [body.flagKey], prBaseUrl());
    return this.openPr(actor, repo, { kind: 'REMOVAL', featureId: r.featureId, version: r.featureVersion, flagKeys: [body.flagKey], branch: flagRemovalBranch(body.flagKey), title: text.title, body: text.body, files, retirementId: body.retirementId });
  }

  /** 제거 PR 파일 — 상수 파일에서 키를 빼고, 호출 뼈대의 해당 함수는 최종 값을 그대로 돌려준다(호출하는 기능 코드는 그대로 컴파일된다) */
  private removalFiles(featureId: string, version: string, name: string, flagKey: string, paths: string[]): PullRequestFile[] {
    const plan = this.store.plans().filter((p) => p.featureId === featureId);
    const removed = plan.find((p) => p.flagKey === flagKey);
    if (!removed) return paths.map((path) => ({ path, content: `// FF Flag 제거 — ${flagKey}의 호출을 지우고 최종 값 분기만 남긴다.\n` }));
    const keep = plan.filter((p) => p.flagKey !== flagKey).map((p) => ({ ...p, version }));
    const deployed = this.policies.deployed(flagKey);
    const finalValue = !!deployed && deployed.enabled !== false;
    const scaffold = keep.length ? flagScaffoldFiles({ featureId, version, name }, keep) : [];
    const dir = flagFeatureDir(removed.package, featureId);
    const guard = flagScaffoldFiles({ featureId, version, name }, [{ ...removed, version }])[1].content.split('\n').filter((l) => l.startsWith('export function'))[0]?.replace(/\{$/, '') ?? '';
    const stub = `${guard}{\n  // Retirement 최종 값 — ${flagConstantName(flagKey)} 호출을 지웠다\n  return Promise.resolve(${finalValue});\n}\n`;
    const flags = scaffold.find((x) => x.path.endsWith('/flags.ts'))?.content ?? `// FF가 만든 Flag 상수 — ${featureId}의 Flag가 모두 퇴역했다.\nexport {};\n`;
    const guards = (scaffold.find((x) => x.path.endsWith('/flag-guards.ts'))?.content ?? "import type { FlagClient, FlagContext } from '../../../../runtime/src/flag-client.ts';\n\n") + stub;
    return [{ path: `${dir}/flags.ts`, content: flags }, { path: `${dir}/flag-guards.ts`, content: guards }];
  }

  /** 시연 병합 — 개발자 병합을 재현한다. 병합 결과를 서버가 스캔·서명해 PUSH 스캔으로 남긴다. 운영·실제 연결은 거부 */
  demoMerge(actor: Actor, id: string): { pullRequest: FlagPullRequest; scan: FlagScanRun } {
    if (isProduction() || authModeOf() === 'oidc') throw new DomainError('CONFLICT', '시연 병합은 시연 모드에서만 쓸 수 있습니다.');
    const pr = this.store.pr(id);
    if (!pr) throw new DomainError('NOT_FOUND', `${id} Flag PR을 찾을 수 없습니다.`);
    const repo = this.requireRepo(pr.repoId);
    if (repo.mode !== 'DEMO_MIRROR') throw new DomainError('CONFLICT', '실제 연결 저장소의 PR은 GitHub에서 병합하세요 — 시연 병합은 시연 저장소만 됩니다.');
    if (pr.state !== 'OPEN') throw new DomainError('GUARD_FAILED', `${pr.state} PR은 병합할 수 없습니다.`);
    const base = this.store.latestResult(repo.repoId, repo.defaultBranch);
    const baseCommit = base?.commit ?? '0'.repeat(40);
    const commit = createHash('sha1').update(`ff-demo-merge\n${repo.repository}\n${baseCommit}\n${pr.branch}`).digest('hex');
    const kept = base?.manifest ?? null;
    let usages: FlagSourceManifestV2['usages'] =[...(kept?.usages ?? [])];
    let unresolved: FlagSourceManifestV2['unresolved'] = [...(kept?.unresolved ?? [])];
    let filesScanned = kept?.filesScanned ?? 0;
    if (pr.kind === 'SCAFFOLD') {
      const f = this.features.get(pr.featureId, pr.version);
      const plan = this.store.plans().filter((p) => p.featureId === pr.featureId).map((p) => ({ ...p, version: pr.version }));
      const files = flagScaffoldFiles({ featureId: pr.featureId, version: pr.version, name: f?.name ?? pr.featureId }, plan);
      const touched = new Set(files.map((x) => x.path));
      const known = new Set([...usages.map((u) => u.path), ...unresolved.map((u) => u.path)]);
      filesScanned += files.filter((x) => !known.has(x.path)).length;
      const found = scanFlagFiles(files.map((x) => ({ path: x.path, source: x.content })));
      usages = [...usages.filter((u) => !touched.has(u.path)), ...(found.usages.map((u) => ({ ...u, symbol: clean(u.symbol) })) as FlagSourceManifestV2['usages'])];
      unresolved = [...unresolved.filter((u) => !touched.has(u.path)), ...(found.unresolved.map((u) => ({ ...u, symbol: clean(u.symbol) })) as FlagSourceManifestV2['unresolved'])];
    } else {
      const key = pr.flagKeys[0];
      const touched = new Set(usages.filter((u) => u.flagKey === key).map((u) => u.path));
      usages = usages.filter((u) => u.flagKey !== key).map((u) => (touched.has(u.path) ? { ...u, contentHash: 'sha256:' + createHash('sha256').update(`${u.contentHash}\nremove:${key}`).digest('hex') } : u));
    }
    const manifest = FlagSourceManifestV2.parse({ format: 'ff-flag-source/v2', provider: repo.provider, repository: repo.repository, ref: repo.defaultBranch, commit, scannedAt: this.clock.iso(), scanner: { name: 'ff-flag-scan', version: FLAG_SCANNER_VERSION }, filesScanned: Math.max(filesScanned, new Set([...usages.map((u) => u.path), ...unresolved.map((u) => u.path)]).size), usages, unresolved });
    const attestation = this.sign(manifest);
    const at = this.clock.iso();
    const merged: FlagPullRequest = { ...pr, state: 'MERGED', checkConclusion: 'SUCCESS', mergedAt: at, mergedBy: actor.id, mergeCommit: commit };
    return this.db.tx(() => {
      const scan = this.record(actor, { repo, trigger: 'PUSH', ref: repo.defaultBranch, baseCommit: null, prNumber: null, deliveryId: null, manifest, attestation, provenance: 'FF_SCAN' });
      this.store.updatePr(merged, at);
      this.audit.record(actor, 'FLAG_PR_DEMO_MERGE', pr.prId, { after: { number: pr.number, branch: pr.branch, mergeCommit: commit, scanId: scan.scanId }, componentId: 'D01-06' });
      this.events.publish('flag.pr.merged', pr.prId, { prId: pr.prId, featureId: pr.featureId, version: pr.version, kind: pr.kind, mergeCommit: commit, scanId: scan.scanId, demo: true }, { componentId: 'D01-06', correlationId: actor.correlationId });
      return { pullRequest: merged, scan };
    });
  }

  // ── 출시 차단 해제 ─────────────────────────────────────
  /** 만료된 요청·승인을 EXPIRED로 확정한다(감사·이벤트) */
  private sweepWaivers() {
    const now = this.clock.iso();
    const expired = this.store.waivers().filter((w) => effectiveWaiverState(w, now) === 'EXPIRED' && w.state !== 'EXPIRED');
    if (!expired.length) return;
    const sys = FLAG_CODE_SYSTEM('flag-waiver-expiry');
    this.db.tx(() => {
      for (const w of expired) {
        this.store.updateWaiver({ ...w, state: 'EXPIRED' });
        this.audit.record(sys, 'FLAG_WAIVER_EXPIRE', w.waiverId, { before: { state: w.state }, after: { state: 'EXPIRED', expiresAt: w.expiresAt }, componentId: 'D01-01' });
        this.events.publish('flag.waiver.expired', w.waiverId, { waiverId: w.waiverId, flagKey: w.flagKey, featureId: w.featureId, version: w.version }, { componentId: 'D01-01', correlationId: sys.correlationId });
      }
    });
  }

  waivers(q: { featureId?: string; state?: string }) {
    const now = this.clock.iso();
    return { items: this.store.waivers({ featureId: q.featureId }).map(({ decisions: _d, ...w }) => ({ ...w, state: effectiveWaiverState(w, now) })).filter((w) => !q.state || w.state === q.state) };
  }

  private requiredDeciders(featureId: string, version: string): string[] {
    const fClass = this.profiles.ensure(featureId, version).fClass;
    return fClass === 'F0' || fClass === 'F1' ? ['FEATURE_APPROVER'] : ['FEATURE_APPROVER', 'SAFETY_OFFICER'];
  }

  requestWaiver(actor: Actor, body: FlagGateWaiverBody): FlagGateWaiver {
    this.sweepWaivers();
    const now = this.clock.iso();
    const exp = Date.parse(body.expiresAt);
    if (exp <= Date.parse(now)) throw new DomainError('VALIDATION', '만료 시각은 지금보다 뒤여야 합니다.');
    if (exp - Date.parse(now) > FLAG_WAIVER_MAX_DAYS * DAY) throw new DomainError('VALIDATION', `해제 기간은 최대 ${FLAG_WAIVER_MAX_DAYS}일입니다.`);
    if (!this.features.get(body.featureId, body.version)) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.version}을(를) 찾을 수 없습니다.`);
    const gate = this.coverage.gate(body.featureId, body.version);
    const blocker = gate.blockers.find((b) => b.flagKey === body.flagKey);
    if (!blocker) throw new DomainError('GUARD_FAILED', `${body.flagKey}은(는) 이 Version의 출시를 막고 있지 않습니다 — 해제할 것이 없습니다.`);
    if (this.store.waivers({ flagKey: body.flagKey, state: 'REQUESTED' }).some((w) => w.featureId === body.featureId && w.version === body.version && effectiveWaiverState(w, now) === 'REQUESTED')) throw new DomainError('CONFLICT', '같은 Flag·Version의 해제 요청이 이미 결정을 기다립니다.');
    const w: WaiverDoc = { ...body, expiresAt: new Date(exp).toISOString(), waiverId: this.store.nextWaiverId(), state: 'REQUESTED', coverageStatus: blocker.status, requestedBy: actor.id, requestedAt: now, decidedBy: null, decidedAt: null, comment: null, decisions: [] };
    return this.db.tx(() => {
      this.store.insertWaiver(w);
      this.audit.record(actor, 'FLAG_WAIVER_REQUEST', w.waiverId, { after: { flagKey: w.flagKey, featureId: w.featureId, version: w.version, coverageStatus: w.coverageStatus, expiresAt: w.expiresAt, requiredDeciders: this.requiredDeciders(w.featureId, w.version) }, reason: w.reason, componentId: 'D01-01' });
      this.events.publish('flag.waiver.requested', w.waiverId, { waiverId: w.waiverId, flagKey: w.flagKey, featureId: w.featureId, version: w.version, coverageStatus: w.coverageStatus }, { componentId: 'D01-01', correlationId: actor.correlationId });
      const { decisions: _d, ...out } = w;
      return out;
    });
  }

  /** 결정 — Feature 승인자, F2 이상은 Safety Manager도. 요청자는 결정할 수 없고, 결정마다 개인 서명. 반려는 한 사람으로 끝난다 */
  decideWaiver(actor: Actor, id: string, body: FlagGateWaiverDecisionBody): FlagGateWaiver {
    this.sweepWaivers();
    const w = this.store.waiver(id) as WaiverDoc | undefined;
    if (!w) throw new DomainError('NOT_FOUND', `${id} 해제 요청을 찾을 수 없습니다.`);
    if (w.state !== 'REQUESTED') throw new DomainError('GUARD_FAILED', `${w.state} 해제 요청은 결정할 수 없습니다.`);
    if (actor.id === w.requestedBy) {
      this.audit.failed(actor, 'FLAG_WAIVER_DECIDE', id, '요청자 본인의 결정(직무 분리)', 'D01-01');
      throw new DomainError('SEPARATION_OF_DUTY', '출시 차단 해제를 요청한 사람은 같은 해제를 결정할 수 없습니다.');
    }
    const need = this.requiredDeciders(w.featureId, w.version);
    const decisions = w.decisions ?? [];
    if (!need.includes(actor.role)) throw new DomainError('FORBIDDEN', `이 해제의 결정 역할: ${need.join(', ')}`);
    if (decisions.some((d) => d.by === actor.id || d.role === actor.role)) throw new DomainError('CONFLICT', '이미 이 역할의 결정이 있습니다.');
    const at = this.clock.iso();
    const signed = this.hsm.approve(actor.id, JSON.stringify({ waiverId: id, flagKey: w.flagKey, featureId: w.featureId, version: w.version, coverageStatus: w.coverageStatus, expiresAt: w.expiresAt, decision: body.decision, by: actor.id, role: actor.role, at }));
    const nextDecisions = [...decisions, { by: actor.id, role: actor.role, decision: body.decision, at, kid: signed.kid, sig: signed.value }];
    const done = body.decision === 'REJECT' || need.every((r) => nextDecisions.some((d) => d.role === r && d.decision === 'APPROVE'));
    const next: WaiverDoc = { ...w, decisions: nextDecisions, ...(done ? { state: body.decision === 'REJECT' ? 'REJECTED' : 'APPROVED', decidedBy: actor.id, decidedAt: at, comment: body.comment } : {}) } as WaiverDoc;
    return this.db.tx(() => {
      this.store.updateWaiver(next);
      this.audit.record(actor, 'FLAG_WAIVER_DECIDE', id, { before: { state: w.state }, after: { state: next.state, decision: body.decision, role: actor.role, kid: signed.kid, pending: need.filter((r) => !nextDecisions.some((d) => d.role === r)) }, reason: body.comment, componentId: 'D01-01' });
      this.events.publish(done ? `flag.waiver.${next.state.toLowerCase()}` : 'flag.waiver.decision', id, { waiverId: id, flagKey: w.flagKey, featureId: w.featureId, version: w.version, decision: body.decision, by: actor.id }, { componentId: 'D01-01', correlationId: actor.correlationId });
      const { decisions: _d, ...out } = next;
      return out;
    });
  }

  // ── 평가 지표 — 평가 집계 한 저장소(EvaluationStatsService)를 읽는다. Feature로 좁힐 때만 계획 Flag를 더한다 ──
  evaluations(q: { window?: string; featureId?: string; flagKey?: string; source?: string }): FlagEvaluationsResponse {
    const keys = q.featureId ? [...new Set([...this.store.plans().filter((p) => p.featureId === q.featureId).map((p) => p.flagKey), ...this.policies.all().filter((p) => p.featureId === q.featureId).map((p) => p.flagKey)])] : null;
    return this.evals.flags({ window: q.window, flagKeys: keys, flagKey: q.flagKey, source: q.source });
  }

  evaluationSeries(flagKey: string, windowRaw?: string): FlagEvaluationSeries {
    return this.evals.series(flagKey, windowRaw);
  }
}
