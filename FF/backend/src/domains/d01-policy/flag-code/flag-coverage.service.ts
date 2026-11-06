// Flag 코드 연결 대사(20-97 §3) — 등록·코드·Unleash·배포·회신 5원천의 입력을 모아 contracts reconcileFlag에 넘긴다(판정은 계약의 순수 함수).
// 코드 원천은 연결 저장소별 기본 브랜치의 최신 서명 결과뿐이다. 연결 저장소가 0개면 코드 칸은 '미연결'이고 출시 관문을 적용하지 않는다.
import { Inject, Injectable } from '@nestjs/common';
import {
  codeRemovalDue,
  compareVersion,
  effectiveBasisPoints,
  FLAG_CODE_REQUIRED_LIFECYCLES,
  FLAG_COVERAGE_STATUSES,
  flagReleaseGate,
  flagSourceUrl,
  reconcileFlag,
  summarizeFlagCoverage,
  type FeatureVersionRow,
  type FlagCoverageDetail,
  type FlagCoverageInput,
  type FlagCoverageQuery,
  type FlagCoverageResponse,
  type FlagCoverageResult,
  type FlagCoverageRow,
  type FlagCoverageStatus,
  type FlagFileFinding,
  type FlagRegistryState,
  type FlagReleaseGate,
  type FlagSourceLocation,
  type FlagRepository,
  type Policy,
  type Publication,
} from '@ff/contracts';
import { IfCallRepo } from '../../../adapters/if-call/if-call.repo';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo } from '../repos';
import { FlagCodeStore, type PlanRow, type StoredResult } from './flag-code.store';

/** 코드 원천 상태 — 출시·정책 게시를 막는 코드 쪽 어긋남(Unleash 불일치는 게시 뒤 동기화로 해소하므로 정책 게시 관문에서 보지 않는다) */
export const FLAG_CODE_STATUSES: readonly FlagCoverageStatus[] = ['NO_CODE', 'CALL_DELETED', 'PR_OPEN', 'UNREGISTERED_KEY'];

interface Retire {
  approvedAt: string;
  nextReleaseAt: string | null;
  codeRemoved: boolean;
}
interface Snapshot {
  now: string;
  repos: FlagRepository[];
  latest: Map<string, StoredResult & { runAt: string }>;
  usages: Map<string, FlagCoverageRow['code']['usages']>;
  plans: Map<string, PlanRow>;
  policiesByFlag: Map<string, Policy[]>;
  featureVersions: Map<string, FeatureVersionRow[]>;
  registry: Map<string, { featureId: string; retiredAt: string | null }>;
  retirements: Map<string, Retire>;
  prs: ReturnType<FlagCodeStore['prs']>;
  waivers: ReturnType<FlagCodeStore['waivers']>;
  publications: Map<string, Publication>;
  lastReport: Map<string, string>;
  unleash: Map<string, { policyId: string; revision: number | null; outcome: 'SYNCED' | 'FAILED'; archived: boolean }>;
  unleashConfigured: boolean;
  lastEval: Map<string, string>;
}

const policyRank = (p: Policy) => (p.status === 'DEPLOYED' ? 0 : p.status === 'APPROVED' ? 1 : p.status === 'RETIRED' || p.status === 'REJECTED' ? 3 : 2);

@Injectable()
@PlatformComponent('D01-06')
export class FlagCoverageService {
  /** 파일 단위 동적 키는 결과가 추가만 되므로 최신 결과 ID·실행 시각으로 기억한다 */
  private readonly fileCache = new Map<string, FlagFileFinding[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: FlagCodeStore,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly ifCalls: IfCallRepo,
    private readonly clock: Clock,
  ) {}

  /** 연결된 저장소가 있는가 — 없으면 코드 원천을 판단하지 않는다 */
  connected(): boolean {
    return !!this.db.get('SELECT 1 FROM flag_code_repository LIMIT 1');
  }

  private snapshot(): Snapshot {
    const now = this.clock.iso();
    const repos = this.store.repos();
    const latest = new Map<string, StoredResult & { runAt: string }>();
    const usages = new Map<string, FlagCoverageRow['code']['usages']>();
    for (const repo of repos) {
      const r = this.store.latestResult(repo.repoId, repo.defaultBranch);
      if (!r) continue;
      latest.set(repo.repoId, r);
      const scanId = this.store.runByResult(r.resultId)?.scanId ?? null;
      const m = r.manifest;
      const provenance = r.provenance === 'DEMO' ? 'DEMO' : r.provenance;
      for (const u of m.usages) {
        const { flagKey, via: _via, ...loc } = u;
        const list = usages.get(flagKey) ?? [];
        list.push({ ...loc, repository: m.repository, provider: m.provider, commit: m.commit, url: flagSourceUrl({ provider: m.provider, repository: m.repository, commit: m.commit, path: u.path, line: u.line }), importedAt: r.scannedAt, importedBy: scanId ? `scan:${scanId}` : 'scan', provenance, repoId: repo.repoId, scanId });
        usages.set(flagKey, list);
      }
    }
    const policiesByFlag = new Map<string, Policy[]>();
    for (const p of this.policies.all()) policiesByFlag.set(p.flagKey, [...(policiesByFlag.get(p.flagKey) ?? []), p]);
    const featureVersions = new Map<string, FeatureVersionRow[]>();
    for (const f of this.features.all()) featureVersions.set(f.featureId, [...(featureVersions.get(f.featureId) ?? []), f]);
    const retirements = new Map<string, Retire>();
    for (const row of this.db.all<{ doc: string }>("SELECT doc FROM flag_retirement WHERE status IN ('APPROVED','RETIRED') ORDER BY retirement_id")) {
      const d = JSON.parse(row.doc) as { flagKey: string; approvedAt: string | null; nextReleaseAt: string | null; steps?: Record<string, unknown> };
      if (d.approvedAt) retirements.set(d.flagKey, { approvedAt: d.approvedAt, nextReleaseAt: d.nextReleaseAt, codeRemoved: !!d.steps?.CODE_REMOVED });
    }
    const publications = new Map<string, Publication>();
    for (const row of this.db.all<{ doc: string; publication_id: string }>("SELECT publication_id, doc FROM publication WHERE kind = 'POLICY' ORDER BY created_at DESC, publication_id DESC")) {
      const p = JSON.parse(row.doc) as Publication;
      const key = p.payload.policy?.flagKey ?? p.payload.flagKey;
      if (key && !publications.has(key)) publications.set(key, p);
    }
    const lastReport = new Map<string, string>();
    const pubIds = [...publications.values()].map((p) => p.publicationId);
    if (pubIds.length)
      for (const r of this.db.all<{ publication_id: string; last_at: string }>(`SELECT publication_id, max(at) AS last_at FROM readback WHERE publication_id IN (${pubIds.map(() => '?').join(', ')}) GROUP BY publication_id`, ...pubIds)) lastReport.set(r.publication_id, r.last_at);
    // Unleash — 실제 동기화 기록(IF-04)이 있으면 그것, 없으면 시연 동기화 기록
    const unleash = new Map<string, { policyId: string; revision: number | null; outcome: 'SYNCED' | 'FAILED'; archived: boolean }>();
    const byPolicy = new Map(this.policies.all().map((p) => [p.policyId, p]));
    // 시연 동기화 기록(픽스처)의 정책 ID는 생성기 실행(전시 차량군 포함) 기준 — 다른 시드 조합(전시 없음)에서는 그 ID가 없거나 다른 Flag의 정책이라,
    // 그때는 이 키의 현재 정책 기록으로 본다(통합 12단계). 실제 기록(IF-04)은 아래에서 덮는다
    const latestOf = (key: string) => this.policies.all().filter((p) => p.flagKey === key).sort((a, b) => policyRank(a) - policyRank(b) || (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0))[0];
    for (const o of this.store.unleashObservations()) {
      const own = byPolicy.get(o.policyId);
      const policyId = !own || own.flagKey !== o.flagKey ? (latestOf(o.flagKey)?.policyId ?? o.policyId) : o.policyId;
      unleash.set(o.flagKey, { policyId, revision: o.revision, outcome: o.outcome, archived: o.archived });
    }
    // list는 최근 순(id 내림차순) — 뒤집어 기록 순서로 두고 시각순으로 정렬한다(안정 정렬: 같은 시각이면 나중 기록이 덮는다)
    for (const c of this.ifCalls.list({ ifId: 'IF-04' }).reverse().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
      const req = c.request as { policyId?: string; revision?: number };
      const res = c.response as { outcome?: string } | null;
      const p = req?.policyId ? byPolicy.get(req.policyId) : undefined;
      if (!p || !res?.outcome || res.outcome === 'BLOCKED') continue;
      unleash.set(p.flagKey, { policyId: p.policyId, revision: req.revision ?? null, outcome: res.outcome === 'SYNCED' ? 'SYNCED' : 'FAILED', archived: false });
    }
    return {
      now,
      repos,
      latest,
      usages,
      plans: new Map(this.store.plans().map((p) => [p.flagKey, p])),
      policiesByFlag,
      featureVersions,
      registry: this.store.registry(),
      retirements,
      prs: this.store.prs(),
      waivers: this.store.waivers(),
      publications,
      lastReport,
      unleash,
      unleashConfigured: (process.env.UNLEASH_MODE ?? 'mock') !== 'off',
      lastEval: this.store.lastEvaluated(),
    };
  }

  /** 대표 Version — 코드가 필요한 Lifecycle 중 가장 새 Version, 없으면 PROPOSED가 아닌 가장 새 Version */
  private repVersion(versions: FeatureVersionRow[] | undefined): FeatureVersionRow | undefined {
    const sorted = [...(versions ?? [])].sort((a, b) => compareVersion(b.version, a.version));
    return sorted.find((f) => FLAG_CODE_REQUIRED_LIFECYCLES.includes(f.lifecycle)) ?? sorted.find((f) => f.lifecycle !== 'PROPOSED') ?? sorted[0];
  }

  private currentPolicy(s: Snapshot, flagKey: string, featureId?: string, version?: string): Policy | null {
    const list = (s.policiesByFlag.get(flagKey) ?? []).filter((p) => (!featureId || p.featureId === featureId) && (!version || p.featureVersion === version));
    if (!list.length) return null;
    return [...list].sort((a, b) => policyRank(a) - policyRank(b) || (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0))[0];
  }

  /** 한 Flag의 대사 — version을 주면 그 Feature Version의 Lifecycle로 판단한다(출시 관문) */
  private evaluate(s: Snapshot, flagKey: string, at?: { featureId: string; version: string }): { row: FlagCoverageRow; result: FlagCoverageResult; waiverExpiresAt: string | null; waiverId: string | null } {
    const plan = s.plans.get(flagKey) ?? null;
    const policy = at ? this.currentPolicy(s, flagKey, at.featureId, at.version) ?? this.currentPolicy(s, flagKey, at.featureId) : this.currentPolicy(s, flagKey);
    const bound = s.registry.get(flagKey);
    const featureId = at?.featureId ?? plan?.featureId ?? policy?.featureId ?? bound?.featureId ?? null;
    const versions = featureId ? s.featureVersions.get(featureId) : undefined;
    const feature = at ? versions?.find((f) => f.version === at.version) : !plan && policy ? (versions?.find((f) => f.version === policy.featureVersion) ?? this.repVersion(versions)) : this.repVersion(versions);
    const registered = !!(plan || policy || bound) && !!feature;
    const retire = s.retirements.get(flagKey) ?? null;
    const codeUsages = s.usages.get(flagKey) ?? [];
    const repoIds = [...s.latest.keys()];
    let lastSeen: { repoId: string; commit: string; at: string } | null = null;
    if (!codeUsages.length)
      for (const repoId of repoIds) {
        const repo = s.repos.find((r) => r.repoId === repoId)!;
        const seen = this.store.lastSeen(repoId, repo.defaultBranch, flagKey, s.latest.get(repoId)!.runAt);
        if (seen && (!lastSeen || seen.at > lastSeen.at)) lastSeen = { repoId, ...seen };
      }
    const lastScanAt = [...s.latest.values()].reduce<string | null>((m, r) => (!m || r.scannedAt > m ? r.scannedAt : m), null);
    const prs = s.prs.filter((p) => p.flagKeys.includes(flagKey));
    const scaffold = prs.find((p) => p.kind === 'SCAFFOLD') ?? null;
    const un = s.unleash.get(flagKey);
    const pub = s.publications.get(flagKey) ?? null;
    // 해제는 요청한 Feature Version에만 — 키는 Feature 단위라 다른 Version의 해제가 이 Version의 출시를 풀면 안 된다
    const waivers = s.waivers.filter((w) => w.flagKey === flagKey && (!featureId || w.featureId === featureId) && (!feature || w.version === feature.version) && Date.parse(w.expiresAt) > Date.parse(s.now));
    const approvedWaiver = waivers.find((w) => w.state === 'APPROVED') ?? null;
    const openWaiver = approvedWaiver ?? waivers.find((w) => w.state === 'REQUESTED') ?? null;
    const rolloutPercent = policy?.status === 'DEPLOYED' ? effectiveBasisPoints(policy) / 100 : null;
    const input: FlagCoverageInput = {
      now: s.now,
      flagKey,
      registry: registered
        ? {
            featureId: feature!.featureId,
            version: feature!.version,
            lifecycle: feature!.lifecycle,
            plannedAt: plan?.plannedAt ?? policy?.createdAt ?? null,
            policy: policy ? { policyId: policy.policyId, status: policy.status, revision: policy.revision } : null,
            retirement: retire ? { approvedAt: retire.approvedAt, codeRemovalDueAt: codeRemovalDue(retire.approvedAt, retire.nextReleaseAt), codeRemoved: retire.codeRemoved } : null,
            registryRetiredAt: bound?.retiredAt ?? null,
          }
        : null,
      code: { current: codeUsages.length, lastSeen: lastSeen ? { commit: lastSeen.commit, at: lastSeen.at } : null, lastScanAt },
      pullRequest: scaffold ? { state: scaffold.state, openedAt: scaffold.createdAt } : null,
      unleash: { configured: s.unleashConfigured && !!un, present: !!un && un.outcome === 'SYNCED', revision: un && policy && un.policyId === policy.policyId ? un.revision : null, archived: !!un?.archived },
      deploy: pub ? { status: pub.status, policyRevision: pub.payload.policy?.revision ?? 0 } : null,
      report: pub ? { confirmed: pub.confirmed, denominator: pub.denominator } : null,
      rollout: rolloutPercent == null ? null : { percent: rolloutPercent, since: policy!.stagedAt ?? policy!.deployedAt ?? policy!.approvedAt ?? null },
      lastEvaluatedAt: s.lastEval.get(flagKey) ?? null,
      waiver: approvedWaiver ? { waiverId: approvedWaiver.waiverId, expiresAt: approvedWaiver.expiresAt, coverageStatus: approvedWaiver.coverageStatus } : null,
    };
    // 연결 저장소가 없으면 코드 원천을 판단하지 않는다 — 코드 쪽 어긋남·출시 관문 없음
    const result = s.repos.length ? reconcileFlag(input) : unconnected(reconcileFlag(input));
    const pr = prs[0] ?? null;
    const row: FlagCoverageRow = {
      flagKey,
      featureId: registered ? feature!.featureId : null,
      version: registered ? feature!.version : null,
      featureName: registered ? feature!.name : null,
      lifecycle: registered ? feature!.lifecycle : null,
      package: plan?.package ?? null,
      controlPoint: plan?.controlPoint ?? policy?.controlPoint ?? null,
      planSource: plan?.source ?? null,
      policy: policy ? { policyId: policy.policyId, status: policy.status, revision: policy.revision } : null,
      code: { usages: codeUsages, lastScanAt, lastSeen },
      pullRequest: pr ? { prId: pr.prId, kind: pr.kind, state: pr.state, number: pr.number, url: pr.url } : null,
      unleash: input.unleash,
      deploy: pub ? { publicationId: pub.publicationId, status: pub.status, policyRevision: pub.payload.policy?.revision ?? 0 } : null,
      report: pub ? { confirmed: pub.confirmed, denominator: pub.denominator, lastReportAt: s.lastReport.get(pub.publicationId) ?? null } : null,
      status: result.status,
      severity: result.severity,
      findings: result.findings,
      lanes: result.lanes,
      codeRequired: result.codeRequired,
      releaseBlocking: result.releaseBlocking,
      waiver: openWaiver ? { waiverId: openWaiver.waiverId, state: openWaiver.state as 'REQUESTED' | 'APPROVED', expiresAt: openWaiver.expiresAt } : null,
    };
    return { row, result, waiverId: approvedWaiver?.waiverId ?? null, waiverExpiresAt: approvedWaiver?.expiresAt ?? null };
  }

  /** 대사 대상 키 — 계획·정책·코드에 있는 키와 시연 Unleash 기록의 키 */
  private keys(s: Snapshot): string[] {
    return [...new Set([...s.plans.keys(), ...s.policiesByFlag.keys(), ...s.usages.keys(), ...s.unleash.keys()])].sort();
  }

  private fileFindings(s: Snapshot): FlagFileFinding[] {
    const out: FlagFileFinding[] = [];
    for (const repo of s.repos) {
      const latest = s.latest.get(repo.repoId);
      if (!latest || !latest.manifest.unresolved.length) continue;
      let cached = this.fileCache.get(`${latest.resultId}|${latest.runAt}`);
      if (!cached) {
        // 같은 파일·호출식이 처음 나타난 결과 시각(줄 이동은 무시)
        const since = new Map<string, string>();
        const history = this.store.branchResults(repo.repoId, repo.defaultBranch, latest.runAt);
        const current = new Set(latest.manifest.unresolved.map((u) => `${u.path}\u0000${u.symbol}`));
        for (const h of history) {
          const m = this.store.result(h)!;
          const present = new Set(m.manifest.unresolved.map((u) => `${u.path}\u0000${u.symbol}`));
          for (const k of [...since.keys()]) if (!present.has(k)) since.delete(k);
          for (const k of present) if (current.has(k) && !since.has(k)) since.set(k, m.scannedAt);
        }
        cached = latest.manifest.unresolved.map((call) => ({ repoId: repo.repoId, commit: latest.commit, status: 'DYNAMIC_KEY' as const, call, since: since.get(`${call.path}\u0000${call.symbol}`) ?? latest.scannedAt }));
        this.fileCache.set(`${latest.resultId}|${latest.runAt}`, cached);
      }
      out.push(...cached);
    }
    return out;
  }

  coverage(q: FlagCoverageQuery = {}): FlagCoverageResponse {
    const s = this.snapshot();
    const evaluated = this.keys(s).map((k) => this.evaluate(s, k));
    const summary = summarizeFlagCoverage(evaluated.map((e) => e.result));
    // Feature Version을 주면 그 Version의 Lifecycle·해제로 판정한 행 — 출시 관문(gate)과 같은 판정. 없으면 Flag마다 대표 Version
    const scoped = q.featureId && q.version && this.features.get(q.featureId, q.version) ? this.versionKeys(q.featureId, q.version).map((k) => this.evaluate(s, k, { featureId: q.featureId!, version: q.version! })) : null;
    const statuses = q.status ? new Set<string>(q.status) : null;
    const needle = q.q?.trim().toLowerCase();
    const repoPackages = q.repoId ? new Set(s.repos.find((r) => r.repoId === q.repoId)?.packages.map((p) => p.name) ?? []) : null;
    const rows = (scoped ?? evaluated)
      .map((e) => e.row)
      .filter((r) => (!q.featureId || r.featureId === q.featureId) && (!q.version || r.version === q.version))
      .filter((r) => !statuses || statuses.has(r.status) || r.findings.some((f) => statuses.has(f.status)))
      .filter((r) => !q.package || r.package === q.package)
      .filter((r) => !repoPackages || r.code.usages.some((u) => u.repoId === q.repoId) || (!!r.package && repoPackages.has(r.package)))
      .filter((r) => !needle || [r.flagKey, r.featureId ?? '', r.featureName ?? ''].some((x) => x.toLowerCase().includes(needle)));
    const files = this.fileFindings(s).filter((f) => !q.repoId || f.repoId === q.repoId);
    return {
      generatedAt: s.now,
      summary: {
        ...summary,
        byStatus: Object.fromEntries(FLAG_COVERAGE_STATUSES.map((st) => [st, summary.byStatus[st] ?? 0])) as Record<FlagCoverageStatus, number>,
        repositories: s.repos.map((r) => ({ repoId: r.repoId, displayName: r.displayName, lastScanAt: s.latest.get(r.repoId)?.scannedAt ?? null, commit: s.latest.get(r.repoId)?.commit ?? null, webhook: r.webhook.state })),
      },
      rows,
      fileFindings: !statuses || statuses.has('DYNAMIC_KEY') ? files : [],
    };
  }

  detail(flagKey: string): FlagCoverageDetail {
    const s = this.snapshot();
    if (!this.keys(s).includes(flagKey) && !s.registry.has(flagKey)) throw new DomainError('NOT_FOUND', `${flagKey} Flag를 찾을 수 없습니다.`);
    const { row } = this.evaluate(s, flagKey);
    const history = this.store.historyOf(flagKey).filter((h) => s.repos.some((r) => r.repoId === h.repoId && r.defaultBranch === h.ref)).map((h) => ({ repoId: h.repoId, scanId: this.store.runByResult(h.resultId)?.scanId ?? null, commit: h.commit, at: h.at, usages: h.usages }));
    return { row, history, pullRequests: s.prs.filter((p) => p.flagKeys.includes(flagKey)), waivers: this.store.waivers({ flagKey }).map(({ decisions: _d, ...w }) => ({ ...w, state: effectiveWaiverState(w, s.now) })) };
  }

  /** Feature Version의 Flag(계획·정책) 키 */
  versionKeys(featureId: string, version: string): string[] {
    const plans = this.store.plans().filter((p) => p.featureId === featureId).map((p) => p.flagKey);
    const policies = this.policies.forFeature(featureId, version).map((p) => p.flagKey);
    return [...new Set([...plans, ...policies])].sort();
  }

  /** 출시 관문 — 이 Version의 Flag 중 코드 연결 때문에 출시를 막는 것과 승인된 해제. 연결 저장소가 없으면 통과 */
  gate(featureId: string, version: string): FlagReleaseGate {
    if (!this.features.get(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const checkedAt = this.clock.iso();
    if (!this.connected()) return { featureId, version, pass: true, blockers: [], waived: [], checkedAt };
    const s = this.snapshot();
    const rows = this.versionKeys(featureId, version).map((k) => {
      const e = this.evaluate(s, k, { featureId, version });
      return { flagKey: k, result: e.result, waiverId: e.waiverId, waiverExpiresAt: e.waiverExpiresAt };
    });
    return { featureId, version, ...flagReleaseGate(rows), checkedAt };
  }

  /** 정책 게시 관문 — 같은 Flag의 코드 쪽 출시 차단(해제 승인이면 통과). 연결 저장소가 없으면 막지 않는다 */
  deployBlockers(policy: Pick<Policy, 'flagKey' | 'featureId' | 'featureVersion'>): { flagKey: string; status: FlagCoverageStatus; message: string }[] {
    if (!this.connected()) return [];
    const s = this.snapshot();
    const { result } = this.evaluate(s, policy.flagKey, { featureId: policy.featureId, version: policy.featureVersion });
    if (!result.releaseBlocking) return [];
    return result.findings.filter((f) => FLAG_CODE_STATUSES.includes(f.status) && (f.severity === 'BLOCKER' || f.status === 'PR_OPEN')).map((f) => ({ flagKey: policy.flagKey, status: f.status, message: f.message }));
  }

  /** PR 검사용 등록 원장 상태 — ACTIVE(코드 필요·계획), RETIRING(Retirement 승인~퇴역 전), RETIRED, null(미등록) */
  registryState(): (flagKey: string) => FlagRegistryState {
    const s = this.snapshot();
    return (flagKey) => {
      const bound = s.registry.get(flagKey);
      if (bound?.retiredAt) return 'RETIRED';
      if (s.retirements.has(flagKey)) return 'RETIRING';
      if (s.plans.has(flagKey) || s.policiesByFlag.has(flagKey) || bound) return 'ACTIVE';
      return null;
    };
  }

  /** Feature Flag 탭 1단계용 v2 사용처 — 연결 저장소 기본 브랜치의 최신 서명 결과(FlagSourceLocation 모양) */
  codeSources(): Map<string, FlagSourceLocation[]> {
    if (!this.connected()) return new Map();
    const out = new Map<string, FlagSourceLocation[]>();
    for (const [k, list] of this.snapshot().usages) out.set(k, list.map(({ repoId: _r, scanId: _s, ...loc }) => loc));
    return out;
  }

  plans(): PlanRow[] {
    return this.store.plans();
  }

  /** 코드에 지금 있는 키(연결 저장소 기본 브랜치 최신 결과) */
  keysInCode(): Set<string> {
    return new Set(this.snapshot().usages.keys());
  }
}

/** 해제의 현재 상태 — 만료 시각이 지난 요청·승인은 EXPIRED */
export function effectiveWaiverState<T extends { state: string; expiresAt: string }>(w: T, now: string): T['state'] {
  return (w.state === 'REQUESTED' || w.state === 'APPROVED') && Date.parse(w.expiresAt) <= Date.parse(now) ? 'EXPIRED' : w.state;
}

const CODE_FINDINGS: readonly FlagCoverageStatus[] = ['NO_CODE', 'CALL_DELETED', 'PR_OPEN', 'UNREGISTERED_KEY', 'STALE', 'REMOVAL_DUE'];
const PRIORITY: readonly FlagCoverageStatus[] = ['UNREGISTERED_KEY', 'CALL_DELETED', 'NO_CODE', 'UNLEASH_MISMATCH', 'REMOVAL_DUE', 'PR_OPEN', 'STALE', 'DYNAMIC_KEY', 'OK'];
/** 연결 저장소 0개 — 코드 칸은 '미연결'(NOT_APPLICABLE), 코드에서 나온 어긋남을 빼고 다시 정한다. 출시 관문은 적용하지 않는다 */
function unconnected(r: FlagCoverageResult): FlagCoverageResult {
  const findings = r.findings.filter((f) => !CODE_FINDINGS.includes(f.status));
  const status = PRIORITY.find((s) => findings.some((f) => f.status === s)) ?? 'OK';
  const severity = (['BLOCKER', 'WARNING', 'INFO'] as const).find((s) => findings.some((f) => f.severity === s)) ?? 'OK';
  return { ...r, findings, status, severity, lanes: { ...r.lanes, CODE: 'NOT_APPLICABLE' }, releaseBlocking: false, waived: false };
}
