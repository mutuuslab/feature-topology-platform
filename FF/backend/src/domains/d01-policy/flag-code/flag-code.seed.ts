// Flag 코드 연결 시연 시드(20-97 §5) — 생성기가 만든 픽스처(data/fixtures/demo/flag-code/*)를 부팅 때 한 번 넣는다.
// 운영 모드·FF_SEED=none·FF_FLAG_CODE_DEMO=off에서는 넣지 않는다. 스캔 결과는 시연 공개키로 서명을 검증하고, 맞지 않으면 거부 기록만 남긴다.
// 평가 지표·PR 열린 시각은 시드 시각 기준으로 옮긴다(고정 날짜가 지나도 시연 창에 값이 있게).
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { FlagPrCheckResult, FlagPullRequest, FlagRepository, FlagScanTrigger, FlagSourceManifestV2, flagScanSigningPayload, type FlagScanRun } from '@ff/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { DEMO_FIXTURES } from '../../../kernel/seed';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { FlagCodeStore } from './flag-code.store';
import { FLAG_CODE_SYSTEM } from './flag-code.service';
import { trustedScanKeys, verifyScanPayload } from './scan-signing';

const iso = z.string().datetime({ offset: true });
const PlanFixture = z.object({ flagKey: z.string(), featureId: z.string(), version: z.string(), controlPoint: z.enum(['Flag', 'Parameter', 'Signal', 'DTC']), ordinal: z.number().int(), package: z.string(), source: z.enum(['POLICY', 'PLANNED']), plannedAt: iso }).passthrough();
const RetirementFixture = z.object({ flagKey: z.string(), featureId: z.string(), featureVersion: z.string(), approvedAt: iso, nextReleaseAt: iso.nullable().default(null), reason: z.string().default('시연 — Flag Retirement') }).passthrough();
const PlansFile = z.union([z.array(PlanFixture).transform((plans) => ({ plans, retirements: [] as z.infer<typeof RetirementFixture>[] })), z.object({ plans: z.array(PlanFixture), retirements: z.array(RetirementFixture).default([]) }).passthrough()]);
const ScanFixture = z.object({
  repoId: z.string(),
  trigger: FlagScanTrigger.default('DEMO_SEED'),
  ref: z.string().optional(),
  commit: z.string().optional(),
  baseCommit: z.string().nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
  queuedAt: iso.optional(),
  manifest: z.unknown(),
  attestation: z.object({ kind: z.literal('FF_SCANNER'), keyId: z.string(), signature: z.string() }),
  prCheck: FlagPrCheckResult.nullable().default(null),
}).passthrough();
const EvalFixture = z.object({
  windowEnd: iso,
  flags: z.array(z.object({
    flagKey: z.string(),
    lastEvaluatedAt: iso.nullable().default(null),
    buckets: z.array(z.object({ bucketStart: iso, source: z.enum(['UNLEASH_EDGE', 'FF_OFREP', 'VEHICLE_REPORT']), evaluations: z.number().int(), enabled: z.number().int(), disabled: z.number().int(), errors: z.number().int().default(0), vehicles: z.number().int().default(0), fallbacks: z.array(z.object({ reason: z.string(), count: z.number().int() })).default([]), variants: z.array(z.object({ name: z.string(), count: z.number().int() })).default([]) }).passthrough()).default([]),
  }).passthrough()),
}).passthrough();
const UnleashFixture = z.array(z.object({ flagKey: z.string(), policyId: z.string(), revision: z.number().int().nullable().default(null), outcome: z.enum(['SYNCED', 'FAILED']).default('SYNCED'), archived: z.boolean().default(false), at: iso }).passthrough());

/** 시드를 넣는가 — 운영·시드 없음·5년 재생·명시적 끔은 넣지 않는다 */
export const flagCodeDemoEnabled = (env: NodeJS.ProcessEnv = process.env) => !isProduction(env) && seedOf(env) !== 'none' && env.FF_DATASET !== 'ops5y' && env.FF_FLAG_CODE_DEMO !== 'off';
export const flagCodeFixtureDir = (env: NodeJS.ProcessEnv = process.env) => env.FF_FLAG_CODE_FIXTURES?.trim() || join(DEMO_FIXTURES, 'flag-code');

@Injectable()
export class FlagCodeSeeder implements OnApplicationBootstrap {
  private readonly log = new Logger(FlagCodeSeeder.name);
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: FlagCodeStore,
    private readonly profiles: SafetyProfileService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (!flagCodeDemoEnabled()) return;
    const dir = flagCodeFixtureDir();
    if (!existsSync(join(dir, 'repositories.json')) || this.db.get("SELECT 1 FROM meta WHERE key = 'seed:flag-code'")) return;
    const counts = this.seed(dir);
    this.log.log(`Flag 코드 연결 시연 시드 — 저장소 ${counts.repos} · 계획 ${counts.plans} · 스캔 ${counts.scans}(거부 ${counts.rejected}) · PR ${counts.prs}`);
  }

  private read<T>(dir: string, name: string, schema: z.ZodType<T>, fallback: T): T {
    const p = join(dir, name);
    return existsSync(p) ? schema.parse(JSON.parse(readFileSync(p, 'utf8'))) : fallback;
  }

  seed(dir: string) {
    const now = this.clock.iso();
    const showcase = process.env.FF_SHOWCASE === '1';
    const repos = this.read(dir, 'repositories.json', z.array(z.unknown()), []).map((r) => r as Record<string, unknown>).filter((r) => showcase || !r.showcaseOnly).map(({ showcaseOnly: _s, ...r }) => FlagRepository.parse(r));
    const repoIds = new Set(repos.map((r) => r.repoId));
    const plans = this.read(dir, 'plans.json', PlansFile, { plans: [], retirements: [] });
    const scans = this.read(dir, 'scans.json', z.array(ScanFixture), []);
    const prs = this.read(dir, 'pull-requests.json', z.array(z.record(z.string(), z.unknown())), []);
    const evals = this.read(dir, 'evaluations.json', EvalFixture.nullable(), null);
    const unleash = this.read(dir, 'unleash-sync.json', UnleashFixture, []);
    const sys = FLAG_CODE_SYSTEM('demo-flag-code');
    const keys = trustedScanKeys();
    let rejected = 0;
    let scanCount = 0;
    this.db.tx(() => {
      for (const r of repos) this.store.insertRepo(r, r.createdAt);
      // 시드하지 않은 저장소(전시 전용 — FF_SHOWCASE=1일 때만)의 계획은 넣지 않는다 — 그 Feature는 이 실행에 없다
      for (const p of plans.plans) {
        const { plannedAt, ...rest } = p;
        const repoId = typeof rest.repoId === 'string' ? rest.repoId : undefined;
        if (repoId && !repoIds.has(repoId)) continue;
        this.store.insertPlan({ flagKey: rest.flagKey, featureId: rest.featureId, version: rest.version, controlPoint: rest.controlPoint, ordinal: rest.ordinal, package: rest.package as never, source: rest.source, plannedAt, ...(repoId ? { repoId } : {}) });
      }
      // REMOVAL_DUE 시연 — 승인된 Retirement 행(정책이 없는 계획 Flag도 있으므로 직접 만든다)
      let n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM flag_retirement')?.n ?? 0;
      for (const r of plans.retirements) {
        if (this.db.get("SELECT 1 FROM flag_retirement WHERE flag_key = ? AND status != 'CLOSED'", r.flagKey)) continue;
        n = Number(n) + 1;
        const fClass = this.profiles.ensure(r.featureId, r.featureVersion).fClass;
        const doc = { retirementId: `RET-${String(n).padStart(5, '0')}`, flagKey: r.flagKey, featureId: r.featureId, featureVersion: r.featureVersion, fClass, reason: r.reason, nextReleaseAt: r.nextReleaseAt, requestedBy: 'usr-author', requestedAt: r.approvedAt, status: 'APPROVED', approvals: [{ by: 'usr-approver', role: 'FEATURE_APPROVER', at: r.approvedAt }, ...(fClass === 'F0' || fClass === 'F1' ? [] : [{ by: 'usr-safety', role: 'SAFETY_OFFICER', at: r.approvedAt }])], approvedAt: r.approvedAt, steps: {} };
        this.db.run('INSERT INTO flag_retirement (retirement_id, flag_key, status, doc) VALUES (?, ?, ?, ?)', doc.retirementId, doc.flagKey, doc.status, JSON.stringify(doc));
      }
      for (const s of scans) {
        if (!repoIds.has(s.repoId)) continue;
        const repo = repos.find((r) => r.repoId === s.repoId)!;
        const parsed = FlagSourceManifestV2.safeParse(s.manifest);
        const key = keys.get(s.attestation.keyId);
        const ok = parsed.success && !!key && verifyScanPayload(flagScanSigningPayload(parsed.data), s.attestation.signature, key) && parsed.data.repository === repo.repository;
        const m = parsed.success ? parsed.data : null;
        const scanId = this.store.nextScanId();
        const at = s.queuedAt ?? m?.scannedAt ?? now;
        let resultId: string | null = null;
        if (ok && m) {
          const prior = this.store.resultFor(repo.repoId, m.commit);
          resultId = (prior ?? this.store.insertResult({ repoId: repo.repoId, ref: m.ref, commit: m.commit, scannedAt: m.scannedAt, provenance: 'DEMO', attestation: s.attestation, manifest: m })).resultId;
        } else rejected++;
        const run: FlagScanRun = {
          scanId,
          repoId: repo.repoId,
          trigger: s.trigger,
          ref: s.ref ?? m?.ref ?? repo.defaultBranch,
          commit: m?.commit ?? (s.commit && /^[0-9a-f]{40}$/.test(s.commit) ? s.commit : null),
          baseCommit: s.baseCommit && /^[0-9a-f]{40}$/.test(s.baseCommit) ? s.baseCommit : null,
          prNumber: s.prNumber,
          status: ok ? 'SUCCEEDED' : 'REJECTED',
          queuedAt: new Date(at).toISOString(),
          finishedAt: new Date(at).toISOString(),
          resultId,
          summary: ok && m ? { filesScanned: m.filesScanned, usages: m.usages.length, flagKeys: new Set(m.usages.map((u) => u.flagKey)).size, unresolved: m.unresolved.length } : null,
          attestation: s.attestation,
          prCheck: s.prCheck,
          error: ok ? null : { code: 'SIGNATURE_INVALID', message: '시연 스캔의 서명을 확인하지 못했습니다 — 결과를 쓰지 않습니다.' },
          requestedBy: sys.id,
          deliveryId: null,
        };
        this.store.insertRun(run);
        scanCount++;
      }
      for (const r of repos) {
        const last = this.store.latestResult(r.repoId, r.defaultBranch);
        const run = last ? this.store.runByResult(last.resultId) : undefined;
        if (last && run) this.store.updateRepo({ ...this.store.repo(r.repoId)!, lastScan: { scanId: run.scanId, commit: last.commit, at: last.scannedAt, status: 'SUCCEEDED' } }, now);
      }
      for (const raw of prs) {
        const { openedAtOffsetHours, ...rest } = raw as { openedAtOffsetHours?: number };
        const pr = FlagPullRequest.parse(typeof openedAtOffsetHours === 'number' ? { ...rest, createdAt: new Date(Date.parse(now) + openedAtOffsetHours * 3_600_000).toISOString() } : rest);
        if (!repoIds.has(pr.repoId) || this.store.prByBranch(pr.repoId, pr.branch)) continue;
        this.store.insertPr(pr);
      }
      if (evals) {
        // 창 끝을 시드 시각(시간 단위)에 맞춘다 — 모든 시각을 같은 만큼 옮긴다
        const hour = 3_600_000;
        const shift = Math.floor((Date.parse(now) - Date.parse(evals.windowEnd)) / hour) * hour;
        const move = (t: string) => new Date(Date.parse(t) + shift).toISOString();
        for (const f of evals.flags) {
          if (f.lastEvaluatedAt) this.store.setLastEvaluated(f.flagKey, move(f.lastEvaluatedAt));
          for (const b of f.buckets) {
            const fallbacks = b.fallbacks.reduce((s, x) => s + x.count, 0);
            this.store.insertBucket({ flag_key: f.flagKey, bucket_start: move(b.bucketStart), source: b.source, evaluations: b.evaluations, enabled: b.enabled, disabled: b.disabled, fallbacks, errors: b.errors, vehicles: b.vehicles, doc: { fallbacks: b.fallbacks, variants: b.variants } });
          }
        }
      }
      for (const u of unleash) this.store.insertUnleash(u);
      this.db.run("INSERT INTO meta (key, value) VALUES ('seed:flag-code', ?)", `repos=${repos.length} plans=${plans.plans.length} scans=${scanCount} rejected=${rejected}`);
      this.audit.record(sys, 'FLAG_CODE_DEMO_SEED', 'flag-code', { after: { repos: repos.map((r) => r.repoId), plans: plans.plans.length, retirements: plans.retirements.length, scans: scanCount, rejected, prs: prs.length, evaluations: evals?.flags.length ?? 0, unleash: unleash.length }, componentId: 'D04-01' });
    });
    return { repos: repos.length, plans: plans.plans.length, scans: scanCount, rejected, prs: prs.length };
  }
}
