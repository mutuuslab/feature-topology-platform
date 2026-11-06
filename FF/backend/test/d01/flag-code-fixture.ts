// 시험용 최소 Flag 코드 픽스처(20-97 §9) — 생성기 픽스처(data/fixtures/demo/flag-code)와 같은 형식을 임시 폴더에 쓴다.
// 결정적: 고정 커밋·시각, 시연 공개키(ff-demo-scan-1) 서명. 상태별 의도(시각 2026-11-06T01:00Z 기준):
//   OK: care_00022_signal·ivi_00024_guide·adas_00001_enable·adas_00001_param · UNLEASH_MISMATCH: care_00022_param
//   NO_CODE(BLOCKER, VERIFIED): adas_00001_signal · PR_OPEN: ivi_00014_enable·ivi_00014_signal · CALL_DELETED: adas_00002_enable
//   STALE: adas_00002_signal · UNREGISTERED_KEY: adas_00002_experiment · REMOVAL_DUE(기한 경과): ivi_00024_signal · DYNAMIC_KEY: ivi 파일 1개
import { flagScaffoldFiles, flagScaffoldBranch, flagScanSigningPayload, FlagSourceManifestV2, type FlagPlanEntry } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFlagFiles } from '../../src/domains/d01-policy/flag-code/scanner';
import { DEMO_SCAN_KEY_ID, demoScanPrivateKey, signScanPayload } from '../../src/domains/d01-policy/flag-code/scan-signing';

export const FIXTURE_REPO = 'https://github.com/mutuuslab/vehicle-feature-apps';
const sha = (s: string) => createHash('sha1').update(s).digest('hex');
export const COMMITS = { c1: sha('fixture-c1'), c2: sha('fixture-c2'), tampered: sha('fixture-tampered') };

const plan = (featureId: string, version: string, pkg: FlagPlanEntry['package'], entries: [string, FlagPlanEntry['controlPoint'], 'POLICY' | 'PLANNED'][]) =>
  entries.map(([flagKey, controlPoint, source], i) => ({ flagKey, featureId, version, controlPoint, ordinal: entries.slice(0, i).filter((e) => e[1] === controlPoint).length + 1, package: pkg, source }));

export const PLANS = {
  f22: plan('FEAT-00022', '1.0.0', 'adas', [['care_00022_signal', 'Signal', 'POLICY'], ['care_00022_param', 'Parameter', 'POLICY']]),
  f24: plan('FEAT-00024', '1.0.0', 'ivi', [['ivi_00024_guide', 'Flag', 'POLICY'], ['ivi_00024_signal', 'Signal', 'PLANNED']]),
  f01: plan('FEAT-00001', '2.1.0', 'adas', [['adas_00001_enable', 'Flag', 'PLANNED'], ['adas_00001_param', 'Parameter', 'PLANNED'], ['adas_00001_signal', 'Signal', 'PLANNED']]),
  f14: plan('FEAT-00014', '1.0.0', 'ivi', [['ivi_00014_enable', 'Flag', 'PLANNED'], ['ivi_00014_signal', 'Signal', 'PLANNED']]),
  f02: plan('FEAT-00002', '1.5.0', 'adas', [['adas_00002_enable', 'Flag', 'PLANNED'], ['adas_00002_signal', 'Signal', 'PLANNED']]),
};

const scaffold = (featureId: string, version: string, entries: FlagPlanEntry[]) => flagScaffoldFiles({ featureId, version, name: featureId }, entries);

function filesAt(commit: 'c1' | 'c2'): { path: string; source: string }[] {
  const out = [
    ...scaffold('FEAT-00022', '1.0.0', PLANS.f22),
    ...scaffold('FEAT-00024', '1.0.0', PLANS.f24),
    ...scaffold('FEAT-00001', '2.1.0', PLANS.f01.filter((p) => p.flagKey !== 'adas_00001_signal')),
    ...scaffold('FEAT-00002', '1.5.0', commit === 'c1' ? PLANS.f02 : PLANS.f02.filter((p) => p.flagKey !== 'adas_00002_enable')),
  ].map((f) => ({ path: f.path, source: f.content }));
  out.push({ path: 'packages/runtime/src/flag-client.ts', source: 'export interface FlagContext { targetingKey: string }\nexport interface FlagClient { getBooleanValue(key: string, def: boolean, ctx?: FlagContext): Promise<boolean> }\n' });
  if (commit === 'c2') {
    out.push({ path: 'packages/adas/src/features/feat-00002/experiment.ts', source: "export const tryIt = (client) => client.getBooleanValue('adas_00002_experiment', false);\n" });
    out.push({ path: 'packages/ivi/src/features/feat-00024/feature.ts', source: 'export const dyn = (client, n) => client.getBooleanValue(`ivi_${n}_x`, false);\n' });
  }
  return out;
}

export function manifestAt(commit: 'c1' | 'c2', scannedAt: string): FlagSourceManifestV2 {
  const files = filesAt(commit);
  const found = scanFlagFiles(files);
  return FlagSourceManifestV2.parse({ format: 'ff-flag-source/v2', provider: 'GITHUB', repository: FIXTURE_REPO, ref: 'main', commit: COMMITS[commit], scannedAt, scanner: { name: 'ff-flag-scan', version: '2.0.0' }, filesScanned: files.length, usages: found.usages, unresolved: found.unresolved });
}

const signed = (m: FlagSourceManifestV2) => ({ kind: 'FF_SCANNER' as const, keyId: DEMO_SCAN_KEY_ID, signature: signScanPayload(flagScanSigningPayload(m), demoScanPrivateKey()) });

/** 임시 폴더에 픽스처를 쓰고 경로를 돌려준다 */
export function writeFlagCodeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-flag-code-fixture-'));
  const w = (name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v, null, 2) + '\n');
  w('repositories.json', [{
    repoId: 'FREPO-001', provider: 'GITHUB', repository: FIXTURE_REPO, displayName: '차량 기능 앱', mode: 'DEMO_MIRROR', defaultBranch: 'main', scanPaths: ['packages'],
    packages: [{ name: 'adas', path: 'packages/adas' }, { name: 'ivi', path: 'packages/ivi' }], scanIntervalMinutes: 0, status: 'ACTIVE', installationId: null,
    webhook: { state: 'NOT_CONFIGURED', lastDeliveryId: null, lastDeliveryAt: null, failureCount: 0, lastError: null }, lastScan: null, createdAt: '2026-01-02T00:00:00.000Z', createdBy: 'usr-coordinator',
  }, {
    repoId: 'FREPO-002', provider: 'GITHUB', repository: 'https://github.com/mutuuslab/vehicle-feature-apps-fleet', displayName: '차량 기능 앱(전시)', mode: 'DEMO_MIRROR', defaultBranch: 'main', scanPaths: [],
    packages: [{ name: 'body', path: 'packages/body' }], scanIntervalMinutes: 0, status: 'ACTIVE', installationId: null,
    webhook: { state: 'NOT_CONFIGURED', lastDeliveryId: null, lastDeliveryAt: null, failureCount: 0, lastError: null }, lastScan: null, createdAt: '2026-01-02T00:00:00.000Z', createdBy: 'usr-coordinator', showcaseOnly: true,
  }]);
  const all = [...PLANS.f22, ...PLANS.f24, ...PLANS.f01, ...PLANS.f14, ...PLANS.f02];
  w('plans.json', {
    summary: { note: '시험용 최소 픽스처' },
    plans: all.map((p) => ({ ...p, plannedAt: '2026-09-01T00:00:00.000Z' })),
    retirements: [{ flagKey: 'ivi_00024_signal', featureId: 'FEAT-00024', featureVersion: '1.0.0', approvedAt: '2026-04-01T00:00:00.000Z', nextReleaseAt: null, reason: '시연 — 기한 지난 제거 대상' }],
  });
  const m1 = manifestAt('c1', '2026-10-01T00:00:00.000Z');
  const m2 = manifestAt('c2', '2026-10-20T00:00:00.000Z');
  const tampered = { ...manifestAt('c2', '2026-10-21T00:00:00.000Z'), commit: COMMITS.tampered };
  w('scans.json', [
    { repoId: 'FREPO-001', trigger: 'PUSH', ref: 'main', commit: m1.commit, baseCommit: null, prNumber: null, queuedAt: m1.scannedAt, manifest: m1, attestation: signed(m1), prCheck: null },
    { repoId: 'FREPO-001', trigger: 'PUSH', ref: 'main', commit: m2.commit, baseCommit: null, prNumber: null, queuedAt: m2.scannedAt, manifest: m2, attestation: signed(m2), prCheck: null },
    // 서명 뒤 커밋을 바꾼 결과 — 시드가 거부해야 한다
    { repoId: 'FREPO-001', trigger: 'PUSH', ref: 'main', commit: COMMITS.tampered, baseCommit: null, prNumber: null, queuedAt: '2026-10-21T00:00:00.000Z', manifest: tampered, attestation: signed(manifestAt('c2', '2026-10-21T00:00:00.000Z')), prCheck: null },
  ]);
  w('pull-requests.json', [{
    prId: 'FPR-000001', repoId: 'FREPO-001', kind: 'SCAFFOLD', featureId: 'FEAT-00014', version: '1.0.0', flagKeys: ['ivi_00014_enable', 'ivi_00014_signal'], branch: flagScaffoldBranch('FEAT-00014', '1.0.0'),
    number: 7, url: null, title: '[FF] FEAT-00014 1.0.0 Flag 상수·호출 뼈대', state: 'OPEN', checkConclusion: 'SUCCESS',
    files: scaffold('FEAT-00014', '1.0.0', PLANS.f14).map((f) => ({ path: f.path, change: 'ADD' })), createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'system:flag-code',
    mergedAt: null, mergedBy: null, mergeCommit: null, retirementId: null, failure: null, openedAtOffsetHours: -48,
  }]);
  // 시 칸 — 평가 = 켜짐 + 꺼짐 + 오류, 폴백은 꺼짐의 일부(시드가 검사한다)
  const bucket = (h: number, extra: Record<string, unknown> = {}) => ({ bucketStart: new Date(Date.parse('2026-11-05T00:00:00.000Z') + h * 3_600_000).toISOString(), source: 'UNLEASH_EDGE', evaluations: 400, enabled: 380, disabled: 19, errors: 1, vehicles: 100, fallbacks: [{ reason: 'TTL_EXPIRED', count: 2 }], ...extra });
  w('evaluations.json', {
    windowEnd: '2026-11-06T00:00:00.000Z',
    flags: [
      { flagKey: 'care_00022_signal', lastEvaluatedAt: '2026-11-05T23:00:00.000Z', buckets: [bucket(0), bucket(22), bucket(23, { enabled: 340, disabled: 59, fallbacks: [{ reason: 'SIGNATURE_INVALID', count: 40 }] }), bucket(23, { source: 'VEHICLE_SDK', evaluations: 90, enabled: 85, disabled: 4, vehicles: 30 })] },
      { flagKey: 'adas_00002_signal', lastEvaluatedAt: '2026-06-01T00:00:00.000Z', buckets: [bucket(23, { evaluations: 0, enabled: 0, disabled: 0, errors: 0, vehicles: 0, fallbacks: [] })] },
    ],
  });
  w('unleash-sync.json', [{ flagKey: 'care_00022_param', policyId: 'POL-00002', revision: 0, outcome: 'SYNCED', archived: false, at: '2026-10-30T00:00:00.000Z' }]);
  return dir;
}
