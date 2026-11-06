// Flag 코드 연결 대사(20-97 §3)·PR 검사·Flag 계획·뼈대·출시 관문 — 판정 표를 고정한다.
import { describe, expect, it } from 'vitest';
import { CreateFlagRepositoryBody, FlagCoverageQuery, FlagEvaluationStat, FlagGateWaiverBody, FlagSourceManifestV2, UpdateFlagRepositoryBody } from '../schemas/flag-code';
import type { FeatureVersionRow } from '../schemas/dataset';
import { loadDataset } from '../testing/fixtures';
import { evaluateFlagPrCheck, flagPackageOf, flagReleaseGate, flagScanSigningPayload, planFeatureFlags, reconcileFlag, summarizeFlagCoverage, type FlagCoverageInput } from './flag-coverage';
import { flagGuardName, flagScaffoldFiles } from './flag-scaffold';
import { evaluateTransition } from './lifecycle';

const NOW = '2026-11-06T00:00:00.000Z';
const C1 = 'a'.repeat(40);
const base = (p: Partial<FlagCoverageInput> = {}): FlagCoverageInput => ({
  now: NOW,
  flagKey: 'adas_00001_enable',
  registry: { featureId: 'FEAT-00001', version: '2.1.0', lifecycle: 'VERIFIED', plannedAt: '2026-03-02T00:00:00.000Z', policy: { policyId: 'POL-1', status: 'DEPLOYED', revision: 2 }, retirement: null, registryRetiredAt: null },
  code: { current: 1, lastSeen: null, lastScanAt: '2026-11-05T00:00:00.000Z' },
  pullRequest: null,
  unleash: { configured: true, present: true, revision: 2, archived: false },
  deploy: { status: 'CONFIRMED', policyRevision: 2 },
  report: { confirmed: 3, denominator: 4 },
  rollout: { percent: 30, since: '2026-10-01T00:00:00.000Z' },
  lastEvaluatedAt: '2026-11-05T12:00:00.000Z',
  waiver: null,
  ...p,
});
const reg = (p: Partial<NonNullable<FlagCoverageInput['registry']>>) => ({ ...base().registry!, ...p });

describe('대사 판정 — 5원천', () => {
  it('모든 원천이 맞으면 정상, 다섯 칸 모두 OK', () => {
    const r = reconcileFlag(base());
    expect(r).toMatchObject({ status: 'OK', severity: 'OK', codeRequired: true, releaseBlocking: false, findings: [] });
    expect(r.lanes).toEqual({ REGISTRY: 'OK', CODE: 'OK', UNLEASH: 'OK', DEPLOY: 'OK', REPORT: 'OK' });
  });

  it('등록됐지만 호출이 없으면 코드 없음 — 출시 단계는 BLOCKER, 개발 단계·정책 전이면 WARNING', () => {
    const v = reconcileFlag(base({ code: { current: 0, lastSeen: null, lastScanAt: NOW } }));
    expect(v).toMatchObject({ status: 'NO_CODE', severity: 'BLOCKER', releaseBlocking: true });
    expect(v.lanes.CODE).toBe('MISSING');
    const d = reconcileFlag(base({ registry: reg({ lifecycle: 'DEVELOPING', policy: null }), code: { current: 0, lastSeen: null, lastScanAt: NOW }, deploy: null, report: null }));
    expect(d).toMatchObject({ status: 'NO_CODE', severity: 'WARNING', releaseBlocking: false });
  });

  it('이전 스캔에 있던 호출이 사라지면 삭제된 호출(코드 없음보다 우선)', () => {
    const r = reconcileFlag(base({ code: { current: 0, lastSeen: { commit: C1, at: '2026-10-01T00:00:00.000Z' }, lastScanAt: NOW } }));
    expect(r).toMatchObject({ status: 'CALL_DELETED', severity: 'BLOCKER', releaseBlocking: true });
    expect(r.findings[0].since).toBe('2026-10-01T00:00:00.000Z');
  });

  it('Flag PR이 열린 지 10일 안이면 검토 중(출시는 막음), 지나면 코드 없음', () => {
    const open = reconcileFlag(base({ registry: reg({ lifecycle: 'APPROVED', policy: null }), code: { current: 0, lastSeen: null, lastScanAt: NOW }, pullRequest: { state: 'OPEN', openedAt: '2026-11-01T00:00:00.000Z' }, deploy: null, report: null }));
    expect(open).toMatchObject({ status: 'PR_OPEN', severity: 'INFO', releaseBlocking: true });
    expect(open.lanes.CODE).toBe('PENDING');
    const late = reconcileFlag(base({ code: { current: 0, lastSeen: null, lastScanAt: NOW }, pullRequest: { state: 'OPEN', openedAt: '2026-10-01T00:00:00.000Z' } }));
    expect(late.status).toBe('NO_CODE');
  });

  it('등록 원장에 없는 키가 코드에 있으면 미등록 키, 코드에도 없으면 정상', () => {
    const r = reconcileFlag(base({ registry: null, unleash: { configured: true, present: false, revision: null, archived: false }, deploy: null, report: null }));
    expect(r).toMatchObject({ status: 'UNREGISTERED_KEY', severity: 'BLOCKER', codeRequired: false });
    expect(r.lanes.REGISTRY).toBe('MISSING');
    expect(reconcileFlag(base({ registry: null, code: { current: 0, lastSeen: null, lastScanAt: NOW }, unleash: { configured: true, present: false, revision: null, archived: false }, deploy: null, report: null })).status).toBe('OK');
  });

  it('Unleash 개정·존재 불일치, 미설정이면 보지 않는다', () => {
    expect(reconcileFlag(base({ unleash: { configured: true, present: true, revision: 1, archived: false } }))).toMatchObject({ status: 'UNLEASH_MISMATCH', releaseBlocking: true });
    expect(reconcileFlag(base({ unleash: { configured: true, present: false, revision: null, archived: false } })).lanes.UNLEASH).toBe('MISMATCH');
    const off = reconcileFlag(base({ unleash: { configured: false, present: false, revision: null, archived: false } }));
    expect(off.status).toBe('OK');
    expect(off.lanes.UNLEASH).toBe('NOT_APPLICABLE');
  });

  it('Retirement 승인 뒤 코드가 남으면 제거 대상 — 기한이 지나면 BLOCKER지만 출시는 막지 않는다', () => {
    const retirement = { approvedAt: '2026-05-01T00:00:00.000Z', codeRemovalDueAt: '2026-12-01T00:00:00.000Z', codeRemoved: false };
    const due = reconcileFlag(base({ registry: reg({ retirement }) }));
    expect(due).toMatchObject({ status: 'REMOVAL_DUE', severity: 'WARNING', codeRequired: false, releaseBlocking: false });
    expect(due.lanes.CODE).toBe('MISMATCH');
    const over = reconcileFlag(base({ registry: reg({ retirement: { ...retirement, codeRemovalDueAt: '2026-11-01T00:00:00.000Z' } }) }));
    expect(over).toMatchObject({ status: 'REMOVAL_DUE', severity: 'BLOCKER', releaseBlocking: false });
    expect(over.findings[0].dueAt).toBe('2026-11-01T00:00:00.000Z');
    expect(reconcileFlag(base({ registry: reg({ retirement }), code: { current: 0, lastSeen: { commit: C1, at: NOW }, lastScanAt: NOW } })).status).toBe('OK');
  });

  it('퇴역 Flag가 Unleash에 남으면 WARNING 불일치', () => {
    const r = reconcileFlag(base({ registry: reg({ registryRetiredAt: '2026-10-01T00:00:00.000Z', lifecycle: 'RETIRED' }), code: { current: 0, lastSeen: null, lastScanAt: NOW } }));
    expect(r).toMatchObject({ status: 'UNLEASH_MISMATCH', severity: 'WARNING', releaseBlocking: false, codeRequired: false });
  });

  it('정책 전면 배포 90일 경과·출시 Feature의 평가 90일 없음은 오래된 Flag(WARNING)', () => {
    expect(reconcileFlag(base({ rollout: { percent: 100, since: '2026-07-01T00:00:00.000Z' } }))).toMatchObject({ status: 'STALE', severity: 'WARNING', releaseBlocking: false });
    expect(reconcileFlag(base({ registry: reg({ lifecycle: 'RELEASED', policy: null }), lastEvaluatedAt: '2026-07-01T00:00:00.000Z', deploy: null, report: null, unleash: { configured: false, present: false, revision: null, archived: false } })).status).toBe('STALE');
    expect(reconcileFlag(base({ lastEvaluatedAt: '2026-07-01T00:00:00.000Z' })).status).toBe('OK'); // 출시 전(VERIFIED)은 평가가 없어도 오래된 Flag가 아니다
    expect(reconcileFlag(base({ registry: reg({ lifecycle: 'RELEASED' }), lastEvaluatedAt: null })).status).toBe('OK'); // 평가 기록 없음은 판단하지 않는다
    expect(reconcileFlag(base({ rollout: { percent: 100, since: '2026-10-01T00:00:00.000Z' } })).status).toBe('OK');
  });

  it('여러 어긋남은 우선순위로 주 상태를 정하고 모두 남긴다', () => {
    const r = reconcileFlag(base({ code: { current: 0, lastSeen: null, lastScanAt: NOW }, unleash: { configured: true, present: false, revision: null, archived: false } }));
    expect(r.status).toBe('NO_CODE');
    expect(r.findings.map((f) => f.status)).toEqual(['NO_CODE', 'UNLEASH_MISMATCH']);
  });

  it('배포·회신 칸 — 다른 개정·분기·대기·미수신', () => {
    expect(reconcileFlag(base({ deploy: { status: 'CONFIRMED', policyRevision: 1 } })).lanes.DEPLOY).toBe('MISMATCH');
    expect(reconcileFlag(base({ deploy: { status: 'DIVERGED', policyRevision: 2 } })).lanes.DEPLOY).toBe('MISMATCH');
    expect(reconcileFlag(base({ deploy: { status: 'DISPATCHED', policyRevision: 2 }, report: null })).lanes).toMatchObject({ DEPLOY: 'PENDING', REPORT: 'PENDING' });
    expect(reconcileFlag(base({ deploy: null, report: null })).lanes).toMatchObject({ DEPLOY: 'MISSING', REPORT: 'NOT_APPLICABLE' });
  });

  it('출시 차단 해제 — 만료 전·같은 상태일 때만 통과, 다른 어긋남이 새로 생기면 다시 막는다', () => {
    const missing = { code: { current: 0, lastSeen: null, lastScanAt: NOW } };
    expect(reconcileFlag(base({ ...missing, waiver: { waiverId: 'FWV-0001', expiresAt: '2026-11-20T00:00:00.000Z', coverageStatus: 'NO_CODE' } }))).toMatchObject({ releaseBlocking: false, waived: true, status: 'NO_CODE' });
    expect(reconcileFlag(base({ ...missing, waiver: { waiverId: 'FWV-0001', expiresAt: '2026-11-01T00:00:00.000Z', coverageStatus: 'NO_CODE' } })).releaseBlocking).toBe(true);
    const both = reconcileFlag(base({ ...missing, unleash: { configured: true, present: false, revision: null, archived: false }, waiver: { waiverId: 'FWV-0001', expiresAt: '2026-11-20T00:00:00.000Z', coverageStatus: 'NO_CODE' } }));
    expect(both).toMatchObject({ releaseBlocking: true, waived: false });
  });

  it('출시 관문·요약·Lifecycle 출시 차단', () => {
    const ok = reconcileFlag(base());
    const bad = reconcileFlag(base({ code: { current: 0, lastSeen: null, lastScanAt: NOW } }));
    const gate = flagReleaseGate([{ flagKey: 'a_00001_enable', result: ok }, { flagKey: 'b_00001_enable', result: bad }]);
    expect(gate).toMatchObject({ pass: false, blockers: [{ flagKey: 'b_00001_enable', status: 'NO_CODE' }], waived: [] });
    expect(summarizeFlagCoverage([ok, bad])).toMatchObject({ flags: 2, codeRequired: 2, connected: 1, releaseBlocking: 1, byStatus: { OK: 1, NO_CODE: 1 } });
    const f = loadDataset().features.find((x) => x.featureId === 'FEAT-00022')!;
    const v: FeatureVersionRow = { ...f, lifecycle: 'VERIFIED' };
    const ctx = { latestGates: {}, dependencies: [], policyCoverage: 9, releaseSignoff: { signedBy: 'x', signedAt: NOW } };
    expect(evaluateTransition(v, 'RELEASED', { ...ctx, flagCodeGate: gate }).blockers).toContainEqual(expect.objectContaining({ code: 'FLAG_CODE_MISSING', ref: 'b_00001_enable' }));
    expect(evaluateTransition(v, 'RELEASED', ctx).blockers.some((b) => b.code === 'FLAG_CODE_MISSING')).toBe(false);
  });
});

describe('PR 검사', () => {
  const state = (k: string) => (k.startsWith('reg_') ? 'ACTIVE' : k.startsWith('ret_') ? 'RETIRING' : k.startsWith('old_') ? 'RETIRED' : null);
  const u = (flagKey: string, path = 'packages/adas/src/a.ts', line = 3) => ({ flagKey, path, line });
  it('미등록 키·퇴역 키 재사용·등록 Flag 호출 삭제·새 동적 키는 실패', () => {
    const r = evaluateFlagPrCheck({ base: [u('reg_00001_a'), u('reg_00002_b')], head: [u('reg_00002_b'), u('new_00003_c'), u('old_00004_d')], baseUnresolved: [], headUnresolved: [{ path: 'packages/adas/src/a.ts', line: 9, symbol: 'client.getBooleanValue' }], registryState: state });
    expect(r.conclusion).toBe('failure');
    expect(r.findings.map((f) => f.code).sort()).toEqual(['DYNAMIC_KEY', 'REGISTERED_CALL_REMOVED', 'RETIRED_KEY_USED', 'UNREGISTERED_KEY']);
  });
  it('Retirement 중인 Flag의 삭제·기존 동적 키·같은 키 다른 파일 이동은 통과', () => {
    const dyn = { path: 'packages/ivi/src/b.ts', line: 4, symbol: 'client.isEnabled' };
    const r = evaluateFlagPrCheck({ base: [u('ret_00001_a'), u('reg_00002_b', 'x/a.ts')], head: [u('reg_00002_b', 'y/b.ts', 10)], baseUnresolved: [dyn], headUnresolved: [{ ...dyn, line: 40 }], registryState: state });
    expect(r.conclusion).toBe('success');
    expect(r.findings.map((f) => [f.code, f.level])).toEqual([['REMOVAL_ALLOWED', 'NOTICE'], ['EXISTING_DYNAMIC_KEY', 'WARNING']]);
  });
});

describe('Flag 계획·뼈대', () => {
  it('기준 도메인 → 패키지, 없으면 담당 조직·태그, 그래도 없으면 platform', () => {
    expect(flagPackageOf({ domainAbbr: 'IN' })).toBe('ivi');
    expect(flagPackageOf({ domainAbbr: null, ownerId: 'ADAS기획팀' })).toBe('adas');
    expect(flagPackageOf({ ownerId: 'Driving성능팀' })).toBe('chassis');
    expect(flagPackageOf({ ownerId: 'IVI상품기획팀' })).toBe('ivi');
    expect(flagPackageOf({ ownerId: 'EV Energy기획팀' })).toBe('powertrain');
    expect(flagPackageOf({ ownerId: 'Vehicle Dynamics팀', tags: ['ivi-sync'] })).toBe('chassis');
    expect(flagPackageOf({ ownerId: '알 수 없음', tags: [] })).toBe('platform');
  });
  it('정책 키 우선, 남는 제어점은 계획 키, 같은 유형은 순번, 남는 정책도 붙인다', () => {
    const p = planFeatureFlags({ featureId: 'FEAT-00024', version: '1.0.0', controlPoints: ['Flag', 'Signal'] }, 'ivi', [{ flagKey: 'ivi_00024_guide', controlPoint: 'Flag' }]);
    expect(p.map((x) => [x.flagKey, x.source])).toEqual([['ivi_00024_guide', 'POLICY'], ['ivi_00024_signal', 'PLANNED']]);
    const d = planFeatureFlags({ featureId: 'FEAT-00070', version: '1.0.0', controlPoints: ['Flag', 'Flag'] }, 'body', [{ flagKey: 'zz_extra', controlPoint: 'Signal' }]);
    expect(d.map((x) => x.flagKey)).toEqual(['body_00070_enable', 'body_00070_enable_2', 'zz_extra']);
  });
  it('뼈대는 상수 파일과 기본값 false 호출을 만들고, 스캐너가 상수 import를 키로 풀 수 있게 한 줄 상수로 쓴다', () => {
    const plan = planFeatureFlags({ featureId: 'FEAT-00022', version: '1.0.0', controlPoints: ['Signal', 'Parameter'] }, 'adas', [{ flagKey: 'care_00022_signal', controlPoint: 'Signal' }, { flagKey: 'care_00022_param', controlPoint: 'Parameter' }]);
    const files = flagScaffoldFiles({ featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계' }, plan);
    expect(files.map((f) => f.path)).toEqual(['packages/adas/src/features/feat-00022/flags.ts', 'packages/adas/src/features/feat-00022/flag-guards.ts']);
    expect(files[0].content).toContain("export const CARE_00022_SIGNAL = 'care_00022_signal' as const;");
    expect(files[1].content).toContain('client.getBooleanValue(CARE_00022_PARAM, false, ctx)');
    expect(flagGuardName('care_00022_signal')).toBe('care00022SignalEnabled');
    expect([...files[0].content.matchAll(/^export const [A-Z0-9_]+ = '([a-z0-9_]+)' as const;$/gm)].map((m) => m[1])).toEqual(['care_00022_signal', 'care_00022_param']);
    expect(files.every((f) => !f.content.includes('\r'))).toBe(true);
  });
  it('서명 페이로드는 도메인 접두 + JCS — 키 순서와 무관', () => {
    const m = FlagSourceManifestV2.parse({ format: 'ff-flag-source/v2', provider: 'GITHUB', repository: 'https://github.com/mutuuslab/vehicle-feature-apps', ref: 'main', commit: C1, scannedAt: NOW, scanner: { name: 'ff-flag-scan', version: '2.0.0' }, filesScanned: 1, usages: [], unresolved: [] });
    const reordered = Object.fromEntries(Object.entries(m).reverse()) as typeof m;
    expect(flagScanSigningPayload(m)).toBe(flagScanSigningPayload(reordered));
    expect(flagScanSigningPayload(m).startsWith('FF-FLAG-SCAN/1\n{')).toBe(true);
  });
});

describe('Flag 코드 계약 스키마', () => {
  const repo = { repository: 'https://github.com/mutuuslab/vehicle-feature-apps', displayName: '차량 기능 앱', mode: 'GITHUB_APP', installationId: 42, packages: [{ name: 'adas', path: 'packages/adas' }] };
  it('저장소 연결 — App은 설치 번호, 주기 15분 이상, 패키지 중복·자격 증명 URL 거부', () => {
    expect(CreateFlagRepositoryBody.parse(repo)).toMatchObject({ defaultBranch: 'main', scanIntervalMinutes: 0, scanPaths: [] });
    expect(CreateFlagRepositoryBody.safeParse({ ...repo, installationId: null }).success).toBe(false);
    expect(CreateFlagRepositoryBody.safeParse({ ...repo, scanIntervalMinutes: 5 }).success).toBe(false);
    expect(CreateFlagRepositoryBody.safeParse({ ...repo, packages: [repo.packages[0], repo.packages[0]] }).success).toBe(false);
    expect(CreateFlagRepositoryBody.safeParse({ ...repo, repository: 'https://x:token@github.com/a/b' }).success).toBe(false);
    expect(CreateFlagRepositoryBody.safeParse({ ...repo, defaultBranch: 'main..x' }).success).toBe(false);
    expect(UpdateFlagRepositoryBody.safeParse({ reason: '변경' }).success).toBe(false);
  });
  it('스캔 v2 — 같은 파일 다른 해시·파일 수 부족 거부, 대사 질의 상태 목록', () => {
    const usage = { flagKey: 'adas_00001_enable', path: 'p/a.ts', line: 1, symbol: 'client.getBooleanValue', method: 'getBooleanValue', safeDefault: 'EXPLICIT_FALSE', contentHash: `sha256:${'b'.repeat(64)}`, via: 'CONST' };
    const m = { format: 'ff-flag-source/v2', provider: 'GITHUB', repository: 'https://github.com/a/b', ref: 'main', commit: C1, scannedAt: NOW, scanner: { name: 'ff-flag-scan', version: '2.0.0' }, filesScanned: 1, usages: [usage], unresolved: [] };
    expect(FlagSourceManifestV2.safeParse(m).success).toBe(true);
    expect(FlagSourceManifestV2.safeParse({ ...m, usages: [usage, { ...usage, line: 2, contentHash: `sha256:${'c'.repeat(64)}` }] }).success).toBe(false);
    expect(FlagSourceManifestV2.safeParse({ ...m, unresolved: [{ path: 'p/b.ts', line: 1, symbol: 'c.isEnabled', method: 'isEnabled' }] }).success).toBe(false);
    expect(FlagCoverageQuery.parse({ status: 'NO_CODE,STALE' }).status).toEqual(['NO_CODE', 'STALE']);
    expect(FlagCoverageQuery.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
  it('해제 요청 사유 10자 이상·평가 수 정합', () => {
    expect(FlagGateWaiverBody.safeParse({ flagKey: 'adas_00001_enable', featureId: 'FEAT-00001', version: '2.1.0', reason: '짧음', expiresAt: NOW }).success).toBe(false);
    const stat = { flagKey: 'adas_00001_enable', window: '24h', source: 'UNLEASH_EDGE', evaluations: 10, enabled: 6, disabled: 5, variants: [], fallbacks: [], errors: 0, vehicles: 3, lastEvaluatedAt: NOW };
    expect(FlagEvaluationStat.safeParse(stat).success).toBe(false);
    expect(FlagEvaluationStat.safeParse({ ...stat, disabled: 4 }).success).toBe(true);
  });
});
