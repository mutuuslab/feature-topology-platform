// npm run flags:demo [-- --out <차량 저장소 폴더>] — 등록된 Feature의 Flag마다 실제로 동작하는 차량 SW 코드 저장소(20-97 §5)를 만든다.
// npm run flags:demo -- --check — 임시 폴더에 다시 만들어 커밋 해시·픽스처가 바이트 단위로 같은지, 생성 저장소의 시험·타입·스캔 서명·계획 누락을 본다.
// 빌드된 백엔드(메모리 DB·FF_SEED=v0.81·데모 활동·FF_SHOWCASE=1)를 포트 9187·9188에 두 번 띄워 같은 데이터인지 확인하고 GET으로만 읽는다.
// 출력: 플랫폼 저장소 밖 ../vehicle-feature-apps(기준·데모 활동), ../vehicle-feature-apps-fleet(전시 차량군) — 원격 없음·push 안 함. 픽스처 data/fixtures/demo/flag-code/*.json(LF).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { FF } from '../lib.ts';
import { DEMO_SCAN_KEY_ID, demoScanPrivateKey, signScanPayload, verifyScanPayload } from '../../backend/src/domains/d01-policy/flag-code/scan-signing.ts';
import { scanGitV2 } from '../flag-sources.ts';
import {
  alignEvents, alignmentOf, buildEvaluations, currentPolicyOf, buildEvents, buildFeatures, C, DEMO_FEATURES, NOW, REPO_START, REPOS, reconcileAll, renameAnomalies, selectAnomalies,
  type Alignment, type Anomalies, type FeatureP, type Model, type PolicyM, type PrFacts, type ScanFacts, type UnleashRecord, type VersionM,
} from './plan.ts';
import { git, isGeneratedRepo, scanCommits, writeRepo, type ManifestV2, type WrittenRepo } from './repo-writer.ts';

export const PLATFORM_ROOT = resolve(FF, '..');
export const DEFAULT_OUT = resolve(PLATFORM_ROOT, '..', 'vehicle-feature-apps');
export const FIXTURE_DIR = join(FF, 'data', 'fixtures', 'demo', 'flag-code');
/**
 * 이력 고정 모델 — GitHub에 올린 차량 저장소의 커밋 이력을 만든 등록 데이터. 이력은 이 모델로만 그려 해시가 바뀌지 않게 하고,
 * 그 뒤에 생긴 정책 키는 맞춤 PR로 덧붙인다(이력을 다시 쓰지 않는다). 파일을 바꾸면 이력이 바뀐다 — 강제 push가 필요한 결정이다.
 */
export const HISTORY_MODEL = join(FF, 'tools', 'flag-code', 'history-model.json');
/** 백엔드 두 번 띄울 포트 — 병렬 작업 트리는 FF_FLAG_DEMO_PORTS=a,b로 바꾼다 */
const PORTS = (process.env.FF_FLAG_DEMO_PORTS?.split(',').map(Number).filter((n) => n > 0) ?? []).length === 2 ? process.env.FF_FLAG_DEMO_PORTS!.split(',').map(Number) : [9187, 9188];
/**
 * GitHub에 실제로 만든 열린 Flag PR(2026-11-06 공개 저장소에 push한 뒤 생성) — 저장소 → 브랜치 → PR 주소.
 * 과거 PR은 GitHub에 PR 객체가 없어 url이 null이고 화면은 병합 커밋 링크로 대신한다. 번호(number)는 이력의 PR 번호를 유지한다.
 */
export const GITHUB_PULLS: Record<string, Record<string, string>> = {
  'FREPO-001': {
    'ff/flags/feat-00099-1.3.0': 'https://github.com/mutuuslab/vehicle-feature-apps/pull/1',
    'ff/flags/feat-00100-1.0.0': 'https://github.com/mutuuslab/vehicle-feature-apps/pull/2',
  },
};
const MIN = 60_000;

// ── 백엔드에서 현재 데이터 읽기 ─────────────────────────────
async function readModel(port: number): Promise<Model> {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), FF_DB: ':memory:', FF_SEED: 'v0.81', FF_SHOWCASE: '1', FF_FLAG_CODE_DEMO: 'off' };
  for (const k of ['FF_DEMO_ACTIVITY', 'FF_DATASET', 'FF_ENV', 'FF_AUTH', 'FF_SHOWCASE_VEHICLES', 'FF_FIXTURES', 'FF_DEMO_FIXTURES', 'FF_SYNTHETIC']) delete env[k];
  const main = join(FF, 'backend', 'dist', 'main.js');
  if (!existsSync(main)) throw new Error('빌드된 백엔드가 없습니다 — npm run build -w feature-topology-backend');
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main], { env, stdio: 'ignore' });
  let exited: number | null = null;
  server.once('exit', (code) => (exited = code ?? -1));
  const base = `http://127.0.0.1:${port}`;
  const get = async <T = any>(path: string): Promise<T> => {
    const r = await fetch(base + path, { headers: { 'X-Actor-Id': 'usr-flag-generator', 'X-Actor-Role': 'FEATURE_AUTHOR' } });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json() as Promise<T>;
  };
  try {
    for (let i = 0; ; i++) {
      if (exited !== null) throw new Error(`백엔드가 종료됐습니다(코드 ${exited}) — 포트 ${port}가 비어 있는지 확인하세요.`);
      try {
        await get('/api/health');
        break;
      } catch {
        if (i > 600) throw new Error(`포트 ${port} 백엔드가 5분 안에 뜨지 않았습니다.`);
        await new Promise((ok) => setTimeout(ok, 500));
      }
    }
    const list = await get<{ items: any[] }>('/api/features');
    const details: any[] = [];
    for (let i = 0; i < list.items.length; i += 8) details.push(...await Promise.all(list.items.slice(i, i + 8).map((x) => get(`/api/features/${x.featureId}/versions/${x.version}`))));
    const refIds = [...new Set(details.map((d) => d.feature.featureRefs?.find((r: any) => r.role === 'PRIMARY')?.refId).filter(Boolean))].sort() as string[];
    const domainOf = new Map<string, string | null>();
    for (const refId of refIds) {
      const r = await get<any>(`/api/refdb/refs/${refId}`);
      const domain = r.domain ?? r.ref?.domain ?? r.row?.domain ?? r.item?.domain ?? null;
      domainOf.set(refId, (domain && C.domainAbbrOf(domain)) ?? refId.split('-')[0] ?? null);
    }
    // 실행 중 만든 기록(전시·데모 활동의 판정, 정책 승인)은 시각이 실행마다 달라 쓰지 않는다 — 번호 기반 대체 시각
    const fresh = (s: string | null) => !!s && Date.now() - Date.parse(s) < 7 * 86_400_000;
    const trusted = (g: any) => g && g.status === 'PASS' && typeof g.judgedAt === 'string' && !fresh(g.judgedAt);
    const iso = (s: string) => new Date(s).toISOString();
    const versions: VersionM[] = list.items.map((x, i) => {
      const d = details[i];
      const gates = Object.entries(d.gates ?? {}) as [string, any][];
      const g13 = ['G1', 'G2', 'G3'].map((k) => d.gates?.[k]);
      const refId = d.feature.featureRefs?.find((r: any) => r.role === 'PRIMARY')?.refId ?? null;
      const passed = gates.filter(([, g]) => trusted(g)).map(([, g]) => Date.parse(g.judgedAt));
      return {
        featureId: x.featureId, version: x.version, isLatest: !!x.isLatest, name: d.feature.name, description: d.feature.description ?? '', lifecycle: x.lifecycle,
        ownerId: d.feature.ownerId ?? null, tags: [...(d.feature.tags ?? [])], asil: d.feature.asil ?? null, controlPoints: [...(d.feature.controlPoints ?? [])],
        refId, domainAbbr: refId ? domainOf.get(refId) ?? null : null,
        approvedAt: g13.every(trusted) ? iso(new Date(Math.max(...g13.map((g) => Date.parse(g.judgedAt)))).toISOString()) : null,
        lastGateAt: passed.length ? new Date(Math.max(...passed)).toISOString() : null,
        showcase: (d.feature.tags ?? []).includes('가상 전시'),
      };
    }).sort((a, b) => a.featureId.localeCompare(b.featureId) || a.version.localeCompare(b.version));
    const pol = await get<any>('/api/policies');
    const policies: PolicyM[] = (pol.items ?? pol).map((p: any) => ({
      policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, controlPoint: p.controlPoint, status: p.status, revision: p.revision,
      basisPoints: p.rollout?.basisPoints ?? null, approvedAt: p.approvedAt && !fresh(p.approvedAt) ? iso(p.approvedAt) : null, runtime: fresh(p.createdAt ?? null),
    })).sort((a: PolicyM, b: PolicyM) => a.policyId.localeCompare(b.policyId));
    const ret = await get<any>('/api/flag-retirements');
    const retiring = [...new Set((ret.items ?? ret).map((r: any) => r.flagKey as string))].sort() as string[];
    return { versions, policies, retiring };
  } finally {
    server.kill();
  }
}

/** 두 번 띄워 읽고 같은지 본다(등록 ID·판정 시각이 실행마다 같아야 결정적 이력이 된다) */
export async function readStableModel(): Promise<Model> {
  const [a, b] = await Promise.all(PORTS.map(readModel));
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) {
    const dir = mkdtempSync(join(tmpdir(), 'ff-flag-model-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(a, null, 2));
    writeFileSync(join(dir, 'b.json'), JSON.stringify(b, null, 2));
    throw new Error(`두 번 읽은 등록 데이터가 다릅니다 — ${dir}의 a.json·b.json을 비교하세요.`);
  }
  // 정책 개정은 데모 활동이 차량 확인 뒤 만든다 — 같은 flagKey는 첫 정책만 쓰므로 영향 없다
  return a;
}

// ── 픽스처 ─────────────────────────────────────────────
/** depth까지 들여 쓰고 그 아래는 한 줄 JSON — 큰 배열(스캔·평가)을 한 항목 한 줄로 둔다 */
export function stringify(v: unknown, depth: number, indent = ''): string {
  if (depth <= 0 || v === null || typeof v !== 'object') return JSON.stringify(v);
  const next = indent + '  ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => next + stringify(x, depth - 1, next)).join(',\n')}\n${indent}]` : '[]';
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  return entries.length ? `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${stringify(x, depth - 1, next)}`).join(',\n')}\n${indent}}` : '{}';
}

interface Generated {
  repos: Record<'main' | 'fleet', WrittenRepo>;
  fixtures: Record<string, string>;
  features: FeatureP[];
  anomalies: Anomalies;
  report: ReturnType<typeof reconcileAll>;
  scans: { repoId: string; manifest: ManifestV2; attestation: { kind: 'FF_SCANNER'; keyId: string; signature: string } }[];
  /** 고정 이력 뒤에 덧붙인 정책 키 맞춤 */
  aligned: Alignment[];
}

/** history — 이력을 그린 등록 데이터(이력 고정 모델). 현재 데이터(model)와 계획이 다르면 맞춤 PR을 덧붙이고, 픽스처·대사는 현재 데이터로 만든다 */
export function generate(model: Model, outMain: string, outFleet: string, history: Model = model): Generated {
  const base = buildFeatures(history);
  const baseAnomalies = selectAnomalies(base);
  const features = history === model ? base : buildFeatures(model);
  const aligned = alignmentOf(base, features, baseAnomalies);
  const anomalies = renameAnomalies(baseAnomalies, new Map(aligned.flatMap((x) => x.rename)));
  const repos = {} as Record<'main' | 'fleet', WrittenRepo>;
  for (const def of REPOS) {
    const past = buildEvents(base, baseAnomalies, def.key);
    repos[def.key] = writeRepo(def.key === 'main' ? outMain : outFleet, def, base, [...past, ...alignEvents(aligned.filter((x) => x.repo === def.key), past)], REPO_START, features);
  }

  // 스캔 — 기본 브랜치의 모든 커밋(push) + PR 머리(검사 기록을 남길 PR)
  const key = demoScanPrivateKey();
  const scanItems: any[] = [];
  const mainScans: ScanFacts[] = [];
  const signed: Generated['scans'] = [];
  const scanTime = (at: number) => new Date(at + MIN).toISOString();
  for (const def of REPOS) {
    const w = repos[def.key];
    const prScanned = w.prs.filter((p) => p.pr.scanHead);
    const targets = [
      ...w.main.map((c) => ({ commit: c.sha, ref: 'main', scannedAt: scanTime(c.at), at: c.at, pr: null as null | (typeof prScanned)[number] })),
      ...prScanned.map((p) => ({ commit: p.headSha, ref: p.pr.branch, scannedAt: scanTime(p.pr.commits.at(-1)!.at), at: p.pr.commits.at(-1)!.at, pr: p })),
    ];
    const manifests = scanCommits(w.dir, def.repository, targets);
    const byCommit = new Map(manifests.slice(0, w.main.length).map((m) => [m.commit, m]));
    // PR 검사는 그 PR 시각의 등록 원장 — 이력 PR은 이력 데이터로(맞춤 PR은 머리 스캔이 없다)
    const registryState = registryOf(base, history, baseAnomalies);
    manifests.forEach((raw, i) => {
      const t = targets[i];
      const manifest = C.FlagSourceManifestV2.parse(raw) as ManifestV2;
      const attestation = { kind: 'FF_SCANNER' as const, keyId: DEMO_SCAN_KEY_ID, signature: signScanPayload(C.flagScanSigningPayload(manifest as never), key) };
      let prCheck = null;
      if (t.pr) {
        const base = byCommit.get(t.pr.baseSha) ?? scanCommits(w.dir, def.repository, [{ commit: t.pr.baseSha, ref: 'main', scannedAt: manifest.scannedAt }])[0];
        prCheck = C.evaluateFlagPrCheck({ base: base.usages, head: manifest.usages, baseUnresolved: base.unresolved, headUnresolved: manifest.unresolved, registryState: registryState(t.at) });
      }
      scanItems.push({
        repoId: def.repoId, trigger: t.pr ? 'PULL_REQUEST' : 'PUSH', ref: t.ref, commit: t.commit, baseCommit: t.pr?.baseSha ?? null, prNumber: t.pr?.number ?? null,
        queuedAt: new Date(t.at + MIN / 2).toISOString(), manifest, attestation, prCheck,
      });
      signed.push({ repoId: def.repoId, manifest, attestation });
      if (!t.pr) mainScans.push({ repo: def.key, ref: 'main', commit: t.commit, at: manifest.scannedAt, usages: manifest.usages, unresolved: manifest.unresolved });
    });
  }
  scanItems.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.repoId.localeCompare(b.repoId));

  // FF가 연 Flag PR(뼈대) 기록
  let prSeq = 0;
  const pullRequests: any[] = [];
  const prFacts: PrFacts[] = [];
  for (const def of REPOS) for (const p of [...repos[def.key].prs].sort((a, b) => a.number - b.number)) {
    if (p.pr.kind !== 'SCAFFOLD') continue;
    const item = C.FlagPullRequest.parse({
      prId: `FPR-${String(++prSeq).padStart(6, '0')}`, repoId: def.repoId, kind: 'SCAFFOLD', featureId: p.pr.featureId, version: p.pr.version, flagKeys: p.pr.flagKeys,
      branch: p.pr.branch, number: p.number, url: GITHUB_PULLS[def.repoId]?.[p.pr.branch] ?? null, title: p.pr.title, state: p.pr.state, checkConclusion: 'SUCCESS', files: p.files,
      createdAt: new Date(p.createdAt).toISOString(), createdBy: 'ff-flag-bot', mergedAt: p.pr.mergeAt ? new Date(p.pr.mergeAt).toISOString() : null,
      mergedBy: p.pr.state === 'MERGED' ? 'usr-integrator' : null, mergeCommit: p.mergeSha, retirementId: null, failure: null,
    });
    const offset = p.pr.state === 'OPEN' ? { openedAtOffsetHours: -48 } : {};
    pullRequests.push({ ...item, ...offset });
    prFacts.push({ flagKeys: p.pr.flagKeys, state: p.pr.state, createdAt: item.createdAt, ...offset });
  }

  // Unleash 시연 동기화 기록 — 키의 현재 승인·배포 정책(백엔드 대사와 같은 정책). 의도적 불일치 시연은 없다(통합 12단계: 시연 데이터가 그 Flag를
  // 실행 중에 다시 배포·동기화해 백엔드가 실제 동기화 결과로 덮는다 — 불일치 시연 Flag는 사용자 결정 대기)
  const unleash: UnleashRecord[] = features.flatMap((f) => [...new Set(f.allPolicies.map((p) => p.flagKey))].map((k) => currentPolicyOf(f.allPolicies, k)!)).filter((p) => p.status === 'APPROVED' || p.status === 'DEPLOYED')
    .sort((a, b) => a.policyId.localeCompare(b.policyId))
    .map((p) => ({ flagKey: p.flagKey, policyId: p.policyId, revision: p.revision, outcome: 'SYNCED' as const, archived: false, at: '2026-11-05T00:00:00.000Z' }));
  const evaluations = buildEvaluations(features, anomalies);
  const report = reconcileAll(features, model, anomalies, mainScans, prFacts, unleash, evaluations.flags, ['main', 'fleet']);
  const mainOnly = reconcileAll(features, model, anomalies, mainScans, prFacts, unleash, evaluations.flags, ['main']);
  const fleetOnly = reconcileAll(features, model, anomalies, mainScans, prFacts, unleash, evaluations.flags, ['fleet']);

  const repositories = REPOS.map((def) => {
    const w = repos[def.key];
    const last = w.main.at(-1)!;
    const repo = C.FlagRepository.parse({
      repoId: def.repoId, provider: 'GITHUB', repository: def.repository, displayName: def.displayName, mode: 'DEMO_MIRROR', defaultBranch: 'main', scanPaths: ['packages'],
      packages: C.FLAG_PACKAGES.filter((p) => w.packages.includes(p)).map((name) => ({ name, path: `packages/${name}` })),
      scanIntervalMinutes: 0, status: 'ACTIVE', installationId: null,
      webhook: { state: 'ACTIVE', lastDeliveryId: `demo-${last.sha.slice(0, 12)}`, lastDeliveryAt: new Date(last.at).toISOString(), failureCount: 0, lastError: null },
      lastScan: null, createdAt: new Date(REPO_START).toISOString(), createdBy: 'usr-coordinator',
    });
    return { ...repo, showcaseOnly: def.showcase };
  });
  const repoOf = new Map(REPOS.map((d) => [d.key, d.repoId]));
  const prOpenFlags = features.filter((f) => anomalies.prOpen.some((k) => k.startsWith(f.featureId + '@'))).flatMap((f) => f.plan.map((e) => e.flagKey));
  const plans = {
    asOf: NOW,
    summary: {
      ...report.summary,
      fileFindings: { DYNAMIC_KEY: report.dynamic },
      // 저장소별 요약 — 시드한 저장소의 합이 그 실행의 대사 요약이다(전시 저장소는 FF_SHOWCASE=1일 때만 시드)
      byRepo: {
        [repoOf.get('main')!]: { ...mainOnly.summary, fileFindings: { DYNAMIC_KEY: mainOnly.dynamic } },
        [repoOf.get('fleet')!]: { ...fleetOnly.summary, fileFindings: { DYNAMIC_KEY: fleetOnly.dynamic } },
      },
      intentional: {
        PR_OPEN: prOpenFlags,
        NO_CODE: anomalies.noCode,
        CALL_DELETED: anomalies.callDeleted.map((c) => c.flagKey),
        UNREGISTERED_KEY: anomalies.unregistered.map((u) => u.flagKey),
        DYNAMIC_KEY: [anomalies.dynamic],
        STALE: anomalies.stale,
        REMOVAL_DUE: [...anomalies.removalDue.map((r) => r.flagKey), ...model.retiring.filter((k) => features.some((f) => f.plan.some((e) => e.flagKey === k)))],
        SIGNATURE_INVALID_SPIKE: [anomalies.signatureSpike],
      },
    },
    plans: features.flatMap((f) => f.plan.map((e) => {
      const entry = C.FlagPlanEntry.parse({ flagKey: e.flagKey, featureId: e.featureId, version: e.version, controlPoint: e.controlPoint, ordinal: e.ordinal, package: e.package, source: e.source });
      return { ...entry, plannedAt: e.plannedAt, repoId: repoOf.get(f.repo)! };
    })),
    retirements: anomalies.removalDue.map((r) => ({ flagKey: r.flagKey, featureId: r.featureId, featureVersion: r.featureVersion, approvedAt: r.approvedAt, nextReleaseAt: null, reason: 'Feature 단종 — 대체 기능으로 통합, 차량 코드에서 Flag 분기 제거 예정' })),
  };
  const fixtures: Record<string, string> = {
    'repositories.json': stringify(repositories, 3) + '\n',
    'plans.json': stringify(plans, 4) + '\n',
    'scans.json': stringify(scanItems, 1) + '\n',
    'pull-requests.json': stringify(pullRequests, 1) + '\n',
    'evaluations.json': stringify(evaluations, 4) + '\n',
    'unleash-sync.json': stringify(unleash, 1) + '\n',
  };
  return { repos, fixtures, features, anomalies, report, scans: signed, aligned };
}

/** PR 검사의 등록 원장 상태(그 PR 시각 기준) — 계획·정책 키는 ACTIVE, Retirement 승인 뒤면 RETIRING, 퇴역 커밋 뒤의 퇴역 Feature 키는 RETIRED */
export function registryOf(features: FeatureP[], model: Model, a: Anomalies) {
  const retiredAt = new Map<string, number>();
  const retiringAt = new Map<string, number>();
  const keys = new Set<string>(model.policies.map((p) => p.flagKey));
  for (const f of features) for (const e of f.plan) {
    keys.add(e.flagKey);
    const r = f.versions.map((p) => p.retiredAt).find((x) => x !== null);
    if (f.latest.lifecycle === 'RETIRED' && r != null) retiredAt.set(e.flagKey, r);
  }
  for (const k of model.retiring) retiringAt.set(k, Date.parse(NOW));
  for (const r of a.removalDue) retiringAt.set(r.flagKey, Date.parse(r.approvedAt));
  return (at: number) => (k: string): 'ACTIVE' | 'RETIRING' | 'RETIRED' | null => {
    if (!keys.has(k)) return null;
    if ((retiredAt.get(k) ?? Infinity) <= at) return 'RETIRED';
    if ((retiringAt.get(k) ?? Infinity) <= at) return 'RETIRING';
    return 'ACTIVE';
  };
}

// ── 검사 ───────────────────────────────────────────────
/** §5.5 표의 수 — 정상이 아닌 Flag 상태별 기대값 */
export function expectedStatus(g: Pick<Generated, 'features' | 'anomalies'>, model: Model) {
  const naturalRemoval = model.retiring.filter((k) => g.features.some((f) => f.plan.some((e) => e.flagKey === k))).length;
  const prOpenFlags = g.features.filter((f) => g.anomalies.prOpen.some((k) => k.startsWith(f.featureId + '@'))).reduce((s, f) => s + f.plan.length, 0);
  // 코드 없음 3·삭제된 호출 2(selectAnomalies가 보장) — 정책 키 맞춤이 삭제된 호출의 키를 바꾸면 그만큼 코드 없음으로 옮긴다(renameAnomalies)
  return { PR_OPEN: prOpenFlags, NO_CODE: g.anomalies.noCode.length, CALL_DELETED: g.anomalies.callDeleted.length, UNREGISTERED_KEY: 2, DYNAMIC_KEY: 0, UNLEASH_MISMATCH: 0, STALE: 5, REMOVAL_DUE: 2 + naturalRemoval };
}

export function checkGenerated(g: Generated, model: Model): string[] {
  const problems: string[] = [];
  const by = g.report.summary.byStatus as Record<string, number>;
  for (const [status, n] of Object.entries(expectedStatus(g, model))) if (by[status] !== n) problems.push(`대사 ${status} ${by[status]}개 — 기대 ${n}개`);
  if (g.anomalies.noCode.length + g.anomalies.callDeleted.length !== 5) problems.push(`의도적 코드 없음·삭제된 호출 ${g.anomalies.noCode.length}+${g.anomalies.callDeleted.length}개 — 기대 합 5개(§5.5)`);
  // 저장소별 요약의 합 = 전체 요약(백엔드는 시드한 저장소의 합과 대조한다)
  const byRepo = Object.values(JSON.parse(g.fixtures['plans.json']).summary.byRepo) as { flags: number; codeRequired: number; connected: number; releaseBlocking: number; byStatus: Record<string, number> }[];
  const total = g.report.summary as unknown as { flags: number; codeRequired: number; connected: number; releaseBlocking: number; byStatus: Record<string, number> };
  for (const k of ['flags', 'codeRequired', 'connected', 'releaseBlocking'] as const) if (byRepo.reduce((n, r) => n + r[k], 0) !== total[k]) problems.push(`저장소별 요약 ${k} 합이 전체와 다르다`);
  for (const [k, n] of Object.entries(total.byStatus)) if (byRepo.reduce((x, r) => x + (r.byStatus[k] ?? 0), 0) !== n) problems.push(`저장소별 요약 ${k} 합이 전체와 다르다`);
  if (g.report.dynamic.files !== 1 || g.report.dynamic.calls !== 2) problems.push(`동적 키 ${g.report.dynamic.files}파일·${g.report.dynamic.calls}호출 — 기대 1파일·2호출`);
  // 계획 Flag 누락 0 — 코드에 있거나, 의도적 이상 목록이거나, 코드가 필요 없는(퇴역·Retirement) Flag
  const allowed = new Set([...g.anomalies.noCode, ...g.anomalies.callDeleted.map((c) => c.flagKey), ...(g.features.filter((f) => g.anomalies.prOpen.some((k) => k.startsWith(f.featureId + '@'))).flatMap((f) => f.plan.map((e) => e.flagKey)))]);
  for (const r of g.report.results) if (r.result.codeRequired && r.result.lanes.CODE !== 'OK' && !allowed.has(r.flagKey)) problems.push(`계획 Flag ${r.flagKey}가 코드에 없다`);
  // 정책 원장 키 — 등록된 Feature의 정책 키는 모두 Flag 계획에 있다(계획은 정책 키를 먼저 쓴다 — 같은 Feature에 키가 두 벌 생기지 않는다)
  const planKeys = new Set(g.features.flatMap((f) => f.plan.map((e) => e.flagKey)));
  for (const p of model.policies) if (g.features.some((f) => f.featureId === p.featureId) && !planKeys.has(p.flagKey)) problems.push(`정책 키 ${p.flagKey}(${p.featureId})가 Flag 계획에 없다`);
  // 기존 시연 Flag — 코드 연결 정상(ivi_00027_banner는 Retirement로 제거 대상)
  for (const r of g.report.results.filter((x) => g.features.some((f) => DEMO_FEATURES.has(f.featureId) && f.plan.some((e) => e.flagKey === x.flagKey) && f.policies.some((p) => p.flagKey === x.flagKey)))) {
    const want = r.flagKey === 'ivi_00027_banner' ? 'REMOVAL_DUE' : 'OK';
    if (r.result.status !== want) problems.push(`시연 Flag ${r.flagKey} 상태 ${r.result.status} — 기대 ${want}`);
    if (r.flagKey !== 'ivi_00027_banner' && r.result.lanes.CODE !== 'OK') problems.push(`시연 Flag ${r.flagKey} 코드 칸 ${r.result.lanes.CODE}`);
  }
  // GitHub에 만든 PR 주소 — 모두 열린 Flag PR에 붙어야 한다(브랜치가 바뀌면 잡는다)
  const prs = JSON.parse(g.fixtures['pull-requests.json']) as { repoId: string; branch: string; state: string; url: string | null }[];
  for (const [repoId, byBranch] of Object.entries(GITHUB_PULLS)) for (const [branch, url] of Object.entries(byBranch)) {
    if (!prs.some((p) => p.repoId === repoId && p.branch === branch && p.state === 'OPEN' && p.url === url)) problems.push(`GitHub PR ${url}가 열린 Flag PR(${repoId} ${branch})에 붙지 않았다`);
  }
  // 서명 — 시연 공개키로 모두 검증
  const pub = createPublicKey(demoScanPrivateKey());
  const bad = g.scans.filter((s) => !verifyScanPayload(C.flagScanSigningPayload(C.FlagSourceManifestV2.parse(s.manifest) as never), s.attestation.signature, pub));
  if (bad.length) problems.push(`스캔 서명 검증 실패 ${bad.length}건`);
  return problems;
}

/** 생성 저장소의 시험(node --test)·타입 검사(tsc) */
export function testRepo(dir: string): string[] {
  const problems: string[] = [];
  const t = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=dot', 'packages/**/*.test.ts'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (t.status !== 0) problems.push(`${dir} node --test 실패\n${(t.stdout + t.stderr).slice(-4000)}`);
  const tsc = spawnSync(process.execPath, [join(FF, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(dir, 'tsconfig.json'), '--typeRoots', join(FF, 'node_modules', '@types')], { cwd: dir, encoding: 'utf8' });
  if (tsc.status !== 0) problems.push(`${dir} tsc 실패\n${(tsc.stdout + tsc.stderr).slice(-4000)}`);
  return problems;
}

/** 기존 스캐너(tools/flag-sources.ts scanGitV2)로 마지막 커밋을 다시 스캔해 생성기 스캔과 같은지 본다 */
function crossCheckScanner(g: Generated): string[] {
  const problems: string[] = [];
  for (const def of REPOS) {
    const w = g.repos[def.key];
    const last = w.main.at(-1)!;
    const mine = g.scans.find((s) => s.repoId === def.repoId && s.manifest.commit === last.sha && s.manifest.ref === 'main')!.manifest;
    const theirs = scanGitV2(w.dir, def.repository, last.sha, ['packages'], 'main', mine.scannedAt);
    if (JSON.stringify(C.FlagSourceManifestV2.parse(theirs)) !== JSON.stringify(mine)) problems.push(`${def.name}: tools/flag-sources.ts scanGitV2 결과가 생성기 스캔과 다르다`);
  }
  return problems;
}

/** 백엔드 대사(시드된 픽스처) 상태별 수가 plans.json 요약과 같은지 — 경로가 없거나(404) 실패하면 문제로 낸다(건너뛰지 않는다) */
async function checkBackendCoverage(expected: Record<string, number>): Promise<string[]> {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORTS[0]), FF_DB: ':memory:', FF_SEED: 'v0.81', FF_SHOWCASE: '1' };
  for (const k of ['FF_DEMO_ACTIVITY', 'FF_DATASET', 'FF_ENV', 'FF_AUTH', 'FF_FLAG_CODE_DEMO']) delete env[k];
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], { env, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${PORTS[0]}`;
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch { /* 기동 중 */ }
      if (i > 600) return ['대사 비교용 백엔드가 뜨지 않았다'];
      await new Promise((ok) => setTimeout(ok, 500));
    }
    const r = await fetch(base + '/api/flag-code/coverage', { headers: { 'X-Actor-Id': 'usr-flag-generator', 'X-Actor-Role': 'FEATURE_AUTHOR' } });
    if (!r.ok) return [`백엔드 대사 ${r.status}`];
    const got = (await r.json()).summary.byStatus as Record<string, number>;
    return Object.entries(expected).filter(([k, n]) => (got[k] ?? 0) !== n).map(([k, n]) => `백엔드 대사 ${k} ${got[k] ?? 0}개 — plans.json 요약 ${n}개`);
  } finally {
    server.kill();
  }
}

/** 로컬 브랜치의 커밋 — push 뒤 생긴 원격 추적 브랜치(refs/remotes)는 보지 않는다 */
export const refsOf = (dir: string) => git(dir, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']).trim();
const hasRemote = (dir: string) => git(dir, ['remote']).trim().length > 0;

/** 기존 저장소(올린 이력)가 새로 만든 이력의 앞부분인가 — main만 앞으로 나아가고 다른 브랜치(열림·닫힘 PR)는 같다. 읽기만 한다 */
export function isFastForward(real: string, made: string): boolean {
  const others = (d: string) => refsOf(d).split('\n').filter((l) => !l.startsWith('refs/heads/main '));
  if (JSON.stringify(others(real)) !== JSON.stringify(others(made))) return false;
  try {
    git(made, ['merge-base', '--is-ancestor', git(real, ['rev-parse', 'main']).trim(), 'main']);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const check = args.includes('--check');
  const outMain = resolve(arg('--out') ?? DEFAULT_OUT);
  const outFleet = outMain + '-fleet';
  if (!check && (outMain.toLowerCase().startsWith(PLATFORM_ROOT.toLowerCase() + '\\') || outMain.toLowerCase().startsWith(PLATFORM_ROOT.toLowerCase() + '/'))) throw new Error('차량 저장소는 플랫폼 저장소 밖에 만든다(--out).');
  console.log(`· 백엔드 두 번 띄워 현재 데이터 읽기(포트 ${PORTS.join('·')})`);
  const model = await readStableModel();
  const history = existsSync(HISTORY_MODEL) ? (JSON.parse(readFileSync(HISTORY_MODEL, 'utf8')) as Model) : model;
  const work = mkdtempSync(join(tmpdir(), 'ff-flag-apps-'));
  try {
    if (!check) for (const d of [outMain, outFleet]) if (existsSync(d) && !isGeneratedRepo(d)) throw new Error(`${d}가 이미 있고 생성기가 만든 저장소가 아닙니다 — 지우지 않는다.`);
    // 늘 임시 폴더에 만든다 — 기존 저장소(원격·push 기록)는 커밋이 같으면 그대로 둔다
    const g = generate(model, join(work, 'vehicle-feature-apps'), join(work, 'vehicle-feature-apps-fleet'), history);
    if (g.aligned.length) console.log(`· 정책 키 맞춤 PR ${g.aligned.length}건(고정 이력 뒤에 덧붙임) — ${g.aligned.map((x) => `${x.featureId} ${[...x.rename.map(([a, b]) => `${a}→${b}`), ...x.added.map((k) => `+${k}`)].join(' ')}`).join(' · ')}`);
    const problems = [...checkGenerated(g, model), ...crossCheckScanner(g)];
    console.log(`· 저장소 ${REPOS.map((d) => `${d.name} 커밋 ${g.repos[d.key].main.length}(기본 브랜치)·PR ${g.repos[d.key].prs.length}`).join(' / ')}`);
    console.log(`· Flag ${g.report.summary.flags}개 — ${Object.entries(g.report.summary.byStatus).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log('· 생성 저장소 시험·타입 검사');
    for (const def of REPOS) problems.push(...testRepo(g.repos[def.key].dir));
    if (check) {
      for (const [name, content] of Object.entries(g.fixtures)) {
        const p = join(FIXTURE_DIR, name);
        if (!existsSync(p) || readFileSync(p, 'utf8') !== content) problems.push(`픽스처 ${name}가 다시 만든 결과와 다르다 — npm run flags:demo`);
      }
      for (const def of REPOS) {
        const real = def.key === 'main' ? outMain : outFleet;
        if (existsSync(real)) {
          if (refsOf(real) !== refsOf(g.repos[def.key].dir)) problems.push(isFastForward(real, g.repos[def.key].dir) ? `${real}에 덧붙일 정책 키 맞춤 커밋이 없다(이력은 같다) — npm run flags:demo 뒤 안내대로 가져와 push` : `${real}의 커밋 해시가 다시 만든 결과와 다르다 — npm run flags:demo`);
        } else console.log(`  · ${real} 없음 — 커밋 해시는 픽스처(scans·pull-requests)로 대조했다`);
      }
      problems.push(...await checkBackendCoverage(g.report.summary.byStatus as Record<string, number>));
    } else if (!problems.length) {
      for (const def of REPOS) {
        const real = def.key === 'main' ? outMain : outFleet;
        const made = g.repos[def.key].dir;
        if (existsSync(real) && refsOf(real) === refsOf(made)) {
          console.log(`· ${real} — 커밋이 같아 그대로 둔다(원격 설정 보존)`);
          continue;
        }
        if (existsSync(real) && hasRemote(real) && isFastForward(real, made)) {
          // 올린 저장소는 건드리지 않는다 — 덧붙인 이력을 옆 폴더에 두고 가져오기·push는 사람이 한다
          const next = `${real}.next`;
          if (existsSync(next)) rmSync(next, { recursive: true, force: true, maxRetries: 5 });
          cpSync(made, next, { recursive: true });
          console.log(`· ${real} — 이력은 그대로, 덧붙인 커밋을 ${next}에 만들었다. 가져와 올리기: git -C "${real}" fetch "${next}" main && git -C "${real}" merge --ff-only FETCH_HEAD && git -C "${real}" push`);
          continue;
        }
        if (existsSync(real) && hasRemote(real) && !args.includes('--replace')) throw new Error(`${real}는 원격에 올린 저장소인데 커밋이 달라졌다 — 이력을 바꾸려면 --replace(이후 강제 push 필요)`);
        if (existsSync(real)) rmSync(real, { recursive: true, force: true, maxRetries: 5 });
        cpSync(made, real, { recursive: true });
        console.log(`· ${real} — 새로 만들었다`);
      }
      mkdirSync(FIXTURE_DIR, { recursive: true });
      for (const [name, content] of Object.entries(g.fixtures)) writeFileSync(join(FIXTURE_DIR, name), content);
      console.log(`· 픽스처 ${FIXTURE_DIR}`);
    }
    if (problems.length) {
      console.error(`✕ ${problems.length}건\n- ${problems.join('\n- ')}`);
      process.exitCode = 1;
    } else console.log(check ? '✓ flag-code:check 통과 — 결정성·시험·타입·서명·계획 누락 0' : '✓ 생성 완료');
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('tools/flag-code/generate-vehicle-apps.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
