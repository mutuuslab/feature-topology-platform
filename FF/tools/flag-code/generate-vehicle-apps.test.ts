// 차량 기능 앱 생성기(20-97 §5) 시험 — 백엔드 없이 합성 등록 데이터로 계획·이력·스캔·템플릿을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFlagFiles } from '../../backend/src/domains/d01-policy/flag-code/scanner.ts';
import { alignEvents, alignmentOf, buildEvaluations, buildEvents, buildFeatures, C, REPO_START, REPOS, selectAnomalies, type Model, type PolicyM, type VersionM } from './plan.ts';
import { git, scanCommits, writeRepo } from './repo-writer.ts';
import { featureSource, featureTest, repoRootFiles } from './templates.ts';
import { generate, isFastForward, refsOf, registryOf, stringify, testRepo } from './generate-vehicle-apps.ts';

type CPs = VersionM['controlPoints'];
const v = (featureId: string, version: string, lifecycle: string, controlPoints: CPs, domainAbbr: string, approvedAt: string | null, extra: Partial<VersionM> = {}): VersionM => ({
  featureId, version, isLatest: true, name: `${featureId} 기능`, description: `${featureId} 설명`, lifecycle, ownerId: null, tags: [], asil: 'QM', controlPoints,
  refId: `${domainAbbr}-X-001`, domainAbbr, approvedAt, lastGateAt: approvedAt, showcase: false, ...extra,
});
/** 의도적 이상 상태 후보가 모두 있는 합성 데이터 */
function fakeModel(): Model {
  const d = (n: number) => `2026-0${3 + (n % 6)}-1${n % 9}T00:00:00.000Z`;
  const versions: VersionM[] = [
    v('FEAT-00101', '1.0.0', 'DEVELOPING', ['Flag', 'Parameter'], 'AD', d(1)),
    v('FEAT-00102', '1.0.0', 'DEVELOPING', ['Flag', 'Signal'], 'IN', d(2)),
    v('FEAT-00103', '1.0.0', 'DEVELOPING', ['Flag', 'DTC'], 'CH', d(3)),
    v('FEAT-00104', '1.0.0', 'DEVELOPING', ['Flag', 'Parameter'], 'BC', d(4)),
    v('FEAT-00105', '2.0.0', 'VERIFIED', ['Flag', 'Signal'], 'AD', d(5), { asil: 'B' }),
    v('FEAT-00106', '1.0.0', 'DEPRECATED', ['Flag', 'Flag'], 'IN', d(6)),
    v('FEAT-00107', '1.0.0', 'DEPRECATED', ['Flag', 'Flag'], 'IN', d(7)),
    v('FEAT-00108', '1.0.0', 'RETIRED', ['Flag', 'DTC'], 'CO', d(8)),
    v('FEAT-00120', '0.1.0', 'PROPOSED', ['Flag'], 'AD', null),
    v('FEAT-00130', '0.1.0', 'DEVELOPING', ['Flag'], 'BC', null, { showcase: true, tags: ['가상 전시'] }),
    v('FEAT-00131', '0.1.0', 'APPROVED', ['Flag'], 'PC', null, { showcase: true, tags: ['가상 전시'] }),
  ];
  for (let i = 0; i < 10; i++) versions.push(v(`FEAT-0011${i}`, '1.0.0', 'RELEASED', ['Flag', i % 2 ? 'Signal' : 'Parameter'], i % 3 ? 'AD' : 'IN', d(i), { asil: i % 4 ? 'QM' : 'C' }));
  // 같은 Feature의 새 Version — 판정 기록이 없어도 앞 Version보다 뒤에 와야 한다
  versions.push(v('FEAT-00110', '1.0.1', 'DEVELOPING', ['Flag', 'Parameter'], 'IN', null));
  versions.find((x) => x.featureId === 'FEAT-00110' && x.version === '1.0.0')!.isLatest = false;
  return {
    versions,
    policies: [{ policyId: 'POL-00001', flagKey: 'ivi_00111_banner', featureId: 'FEAT-00111', featureVersion: '1.0.0', controlPoint: 'Signal', status: 'DEPLOYED', revision: 1, basisPoints: 10_000, approvedAt: '2026-10-01T00:00:00.000Z', runtime: false },
      { policyId: 'POL-00002', flagKey: 'showcase_00130_review', featureId: 'FEAT-00130', featureVersion: '0.1.0', controlPoint: 'Flag', status: 'DRAFT', revision: 1, basisPoints: 0, approvedAt: null, runtime: true },
    ],
    retiring: [],
  };
}

test('계획 — 정책 키를 쓰고 같은 Feature의 새 Version은 키를 다시 쓴다, 새 Version은 앞 Version 뒤', () => {
  const fs = buildFeatures(fakeModel());
  const f111 = fs.find((f) => f.featureId === 'FEAT-00111')!;
  assert.deepEqual(f111.plan.map((e) => [e.flagKey, e.source]), [['adas_00111_enable', 'PLANNED'], ['ivi_00111_banner', 'POLICY']]);
  const f110 = fs.find((f) => f.featureId === 'FEAT-00110')!;
  assert.deepEqual(f110.versions.map((p) => p.v.version), ['1.0.0', '1.0.1']);
  assert.ok(f110.versions[1].approvedAt > f110.versions[0].approvedAt, '판정 기록 없는 1.0.1이 1.0.0보다 먼저 승인되면 안 된다');
  assert.ok(!fs.some((f) => f.featureId === 'FEAT-00120'), 'PROPOSED는 계획 전');
  assert.equal(fs.find((f) => f.featureId === 'FEAT-00130')!.repo, 'fleet');
  assert.equal(fs.find((f) => f.featureId === 'FEAT-00102')!.pkg, 'ivi');
});

test('계획 — 실행 중 승인된 Version은 승인 뒤 만든 정책 키를 승인 계획에 쓰지 않고 뒤에 붙인다(백엔드 승인 훅과 같은 키)', () => {
  const f = buildFeatures(fakeModel()).find((x) => x.featureId === 'FEAT-00130')!;
  assert.deepEqual(f.plan.map((e) => [e.flagKey, e.source, e.ordinal]), [['body_00130_enable', 'PLANNED', 1], ['showcase_00130_review', 'POLICY', 2]]);
});

test('의도적 이상 상태 — 결정적이고 서로 겹치지 않는다', () => {
  const fs = buildFeatures(fakeModel());
  const a = selectAnomalies(fs);
  assert.deepEqual(selectAnomalies(buildFeatures(fakeModel())), a);
  assert.equal(a.prOpen.length, 2);
  assert.equal(a.noCode.length, 3);
  assert.equal(a.callDeleted.length, 2);
  assert.equal(a.unregistered.length, 2);
  assert.equal(a.stale.length, 5);
  assert.equal(a.removalDue.length, 2);
  const featureOf = (k: string) => fs.find((f) => f.plan.some((e) => e.flagKey === k))!.featureId;
  const groups = [a.prOpen.map((x) => x.split('@')[0]), a.noCode.map(featureOf), a.callDeleted.map((c) => c.featureId), a.unregistered.map((u) => u.featureId), [a.dynamic], a.stale.map(featureOf)];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) assert.deepEqual(groups[i].filter((x) => groups[j].includes(x)), [], `이상 상태 ${i}·${j}가 같은 Feature`);
  assert.ok(!fs.find((f) => f.featureId === a.dynamic) || fs.find((f) => f.featureId === a.dynamic)!.pkg === 'ivi');
});

test('기능 분기 템플릿 — Flag는 뼈대 함수로만 읽고, 상수 호출은 v2 스캐너가 키로 푼다, 동적 키는 풀지 못한다', () => {
  const fs = buildFeatures(fakeModel());
  const f = fs.find((x) => x.featureId === 'FEAT-00105')!;
  const info = { featureId: f.featureId, version: '2.0.0', name: '기능', description: '설명', pkg: f.pkg, safetyRelated: true };
  const flags = f.plan.map((e) => ({ flagKey: e.flagKey, controlPoint: e.controlPoint, ordinal: e.ordinal }));
  const removed = new Set([flags[1].flagKey]);
  const scaffold = C.flagScaffoldFiles({ featureId: f.featureId, version: '2.0.0', name: '기능' }, f.plan.filter((e) => !removed.has(e.flagKey)));
  const src = featureSource({ info, flags, removed, dynamic: true });
  assert.match(src, /시연용 생성 코드/);
  assert.doesNotMatch(src, /getBooleanValue\(ADAS/, '기능 코드는 SDK를 상수로 직접 부르지 않는다');
  const dir = C.flagFeatureDir(f.pkg as never, f.featureId);
  const found = scanFlagFiles([...scaffold, { path: `${dir}/feature.ts`, content: src }].map((x) => ({ path: x.path, source: x.content })));
  assert.deepEqual(found.usages.map((u) => [u.flagKey, u.via, u.safeDefault]), [[flags[0].flagKey, 'CONST', 'EXPLICIT_FALSE']], '정리한 Flag는 호출이 없다');
  assert.equal(found.unresolved.length, 2, '지역 배너 실험 — 템플릿 치환 키 2호출');
  assert.match(featureTest({ info, flags, removed, dynamic: true }), /regionalBanner/);
});

test('저장소 — 같은 입력이면 같은 커밋 해시, 시험·타입 검사 통과, 스캔·PR 검사가 이상 상태를 잡는다', () => {
  const model = fakeModel();
  const fs = buildFeatures(model);
  const a = selectAnomalies(fs);
  const tmp = mkdtempSync(join(tmpdir(), 'ff-flag-apps-test-'));
  try {
    const one = writeRepo(join(tmp, 'a'), REPOS[0], fs, buildEvents(fs, a, 'main'), REPO_START);
    const two = writeRepo(join(tmp, 'b'), REPOS[0], fs, buildEvents(fs, a, 'main'), REPO_START);
    const refs = (d: string) => git(d, ['for-each-ref', '--format=%(refname) %(objectname)']);
    assert.equal(refs(one.dir), refs(two.dir));
    // push 뒤 생긴 원격 추적 브랜치는 결정성 대조에서 뺀다(회귀: GitHub에 올린 저장소가 --check에서 다르다고 나오던 것)
    git(one.dir, ['update-ref', 'refs/remotes/origin/main', 'main']);
    assert.equal(refsOf(one.dir), refsOf(two.dir));
    assert.equal(git(one.dir, ['status', '--porcelain']), '', '작업 트리는 main과 같다');
    assert.deepEqual(testRepo(one.dir), []);
    const last = one.main.at(-1)!;
    const [m] = scanCommits(one.dir, REPOS[0].repository, [{ commit: last.sha, ref: 'main', scannedAt: new Date(last.at).toISOString() }]);
    const keys = new Set(m.usages.map((u) => u.flagKey));
    for (const u of a.unregistered) assert.ok(keys.has(u.flagKey), `${u.flagKey} 미등록 키 호출`);
    for (const k of [...a.noCode, ...a.callDeleted.map((c) => c.flagKey)]) assert.ok(!keys.has(k), `${k}는 코드에 없어야 한다`);
    assert.equal(m.unresolved.length, 2);
    assert.ok(!m.usages.some((u) => u.path.startsWith('packages/runtime/')), 'runtime은 Flag를 부르지 않는다');
    // 퇴역 커밋 전 PR은 퇴역 키 사용으로 실패하지 않는다(회귀: 시각과 무관하게 RETIRED로 보던 결함)
    const state = registryOf(fs, model, a);
    const retired = fs.find((f) => f.latest.lifecycle === 'RETIRED')!;
    const retiredAt = retired.versions[0].retiredAt!;
    assert.equal(state(retiredAt - 1)(retired.plan[0].flagKey), 'ACTIVE');
    assert.equal(state(retiredAt)(retired.plan[0].flagKey), 'RETIRED');
    assert.equal(state(retiredAt)('nobody_00001_enable'), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('평가 지표 — 계약 형식(경로는 평가 집계 한 저장소 값), 켜짐·꺼짐·오류 합 = 평가 수·폴백 ≤ 꺼짐, 오래된 Flag는 구간 0, 서명 오류 급증은 하루', () => {
  const fs = buildFeatures(fakeModel());
  const a = selectAnomalies(fs);
  const e = buildEvaluations(fs, a);
  assert.deepEqual(buildEvaluations(fs, a), e);
  for (const f of e.flags) {
    if (a.stale.includes(f.flagKey)) {
      assert.deepEqual(f.buckets, []);
      assert.ok(f.lastEvaluatedAt! < '2026-07-01');
      continue;
    }
    assert.equal(f.buckets.length, 7 * 24 * 2);
    for (const b of f.buckets) {
      C.FlagEvaluationBucket.parse({ bucketStart: b.bucketStart, source: b.source, evaluations: b.evaluations, enabled: b.enabled, fallbacks: b.fallbacks.reduce((s, x) => s + x.count, 0), errors: b.errors });
      assert.equal(b.enabled + b.disabled + b.errors, b.evaluations);
      assert.ok(b.fallbacks.reduce((s, x) => s + x.count, 0) <= b.disabled, '폴백은 꺼짐의 일부');
      const sig = b.fallbacks.find((x) => x.reason === 'SIGNATURE_INVALID');
      if (sig) assert.ok(f.flagKey === a.signatureSpike && b.bucketStart.startsWith('2026-11-04'));
    }
  }
  const banner = e.flags.find((f) => f.flagKey === 'ivi_00111_banner')!;
  assert.ok(banner.buckets.some((b) => b.enabled > 0), '전면 배포 정책은 켜짐이 있다');
});

test('픽스처 직렬화 — 정해진 깊이까지 들여 쓰고 그 아래는 한 줄', () => {
  assert.equal(stringify({ a: [{ b: 1 }, { b: 2 }] }, 2), '{\n  "a": [\n    {"b":1},\n    {"b":2}\n  ]\n}');
  assert.equal(stringify([], 1), '[]');
});

test('저장소 공통 파일 — 비밀 없이 연결 정보만, 줄 끝 LF', () => {
  const files = repoRootFiles({ name: 'x', repository: 'https://github.com/mutuuslab/x', displayName: 'x', showcase: false });
  for (const [p, c] of Object.entries(files)) assert.ok(!c.includes('\r'), `${p} CRLF`);
  const cfg = JSON.parse(files['ff-flags.config.json']);
  assert.deepEqual(Object.keys(cfg).sort(), ['defaultBranch', 'flagConstants', 'generatedBy', 'packages', 'provider', 'repository', 'scanPaths', 'sdkMethods']);
  assert.match(files['.github/workflows/ff-flag-check.yml'], /id-token: write/);
});

/** 이력 뒤에 생긴 정책 — FEAT-00113(출시, Flag·Signal)의 Flag 제어점 정책 키와, 제어점이 없는 DTC 정책 키 */
const laterPolicies: PolicyM[] = [
  { policyId: 'POL-00010', flagKey: 'ivi_00113_assist', featureId: 'FEAT-00113', featureVersion: '1.0.0', controlPoint: 'Flag', status: 'DEPLOYED', revision: 1, basisPoints: 5000, approvedAt: null, runtime: true },
  { policyId: 'POL-00011', flagKey: 'ivi_00113_fault', featureId: 'FEAT-00113', featureVersion: '1.0.0', controlPoint: 'DTC', status: 'VALIDATED', revision: 1, basisPoints: 0, approvedAt: null, runtime: true },
];
const withLater = (): Model => {
  const m = fakeModel();
  return { ...m, policies: [...m.policies, ...laterPolicies] };
};

test('정책 키 맞춤 — 이력 뒤 정책 키가 같은 제어점의 생성 키를 대신하고, 이력 커밋은 그대로 두고 맞춤 PR 병합만 덧붙는다', () => {
  const history = fakeModel();
  const base = buildFeatures(history);
  const a = selectAnomalies(base);
  const current = buildFeatures(withLater());
  assert.deepEqual(alignmentOf(base, base, a), [], '계획이 같으면 맞춤 없음');
  const al = alignmentOf(base, current, a);
  assert.deepEqual(al.map((x) => [x.featureId, x.rename, x.added]), [['FEAT-00113', [['ivi_00113_enable', 'ivi_00113_assist']], ['ivi_00113_fault']]]);
  assert.ok(!current.find((f) => f.featureId === 'FEAT-00113')!.plan.some((e) => e.flagKey === 'ivi_00113_enable'), '같은 Feature에 생성 키와 정책 키가 두 벌 남지 않는다');
  const tmp = mkdtempSync(join(tmpdir(), 'ff-flag-align-test-'));
  try {
    const past = buildEvents(base, a, 'main');
    const one = writeRepo(join(tmp, 'past'), REPOS[0], base, past, REPO_START);
    const two = writeRepo(join(tmp, 'next'), REPOS[0], base, [...past, ...alignEvents(al, past)], REPO_START, current);
    assert.deepEqual(two.main.slice(0, one.main.length), one.main, '올린 이력의 커밋 해시는 그대로');
    assert.equal(two.main.length, one.main.length + 1, '맞춤 PR 병합 커밋 하나를 덧붙인다');
    assert.ok(two.main.at(-1)!.at > one.main.at(-1)!.at);
    assert.equal(isFastForward(one.dir, two.dir), true, '올린 저장소에서 일반 push로 이어진다');
    assert.equal(isFastForward(two.dir, one.dir), false);
    const scan = (w: typeof one) => new Set(scanCommits(w.dir, REPOS[0].repository, [{ commit: w.main.at(-1)!.sha, ref: 'main', scannedAt: new Date(w.main.at(-1)!.at).toISOString() }])[0].usages.map((u) => u.flagKey));
    const before = scan(one);
    const after = scan(two);
    const expected = new Set([...[...before].map((k) => (k === 'ivi_00113_enable' ? 'ivi_00113_assist' : k)), 'ivi_00113_fault']);
    assert.deepEqual([...after].sort(), [...expected].sort());
    assert.ok(!after.has('ivi_00113_enable'));
    assert.deepEqual(testRepo(two.dir), [], '맞춘 저장소도 시험·타입 검사를 통과한다');
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('정책 키 맞춤 — 픽스처는 현재 계획(정책 키)·맞춤 PR(병합)을 싣고, 같은 데이터면 맞춤이 없다', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ff-flag-align-gen-'));
  try {
    const same = generate(fakeModel(), join(tmp, 'a'), join(tmp, 'a-fleet'), fakeModel());
    assert.deepEqual(same.aligned, []);
    const g = generate(withLater(), join(tmp, 'b'), join(tmp, 'b-fleet'), fakeModel());
    assert.deepEqual(same.repos.main.main, g.repos.main.main.slice(0, same.repos.main.main.length), '이력 부분은 같은 해시');
    const plans = JSON.parse(g.fixtures['plans.json']).plans as { flagKey: string; source: string }[];
    assert.ok(plans.some((p) => p.flagKey === 'ivi_00113_assist' && p.source === 'POLICY'));
    assert.ok(!plans.some((p) => p.flagKey === 'ivi_00113_enable'));
    const prs = JSON.parse(g.fixtures['pull-requests.json']) as { branch: string; state: string; flagKeys: string[]; mergeCommit: string | null }[];
    const pr = prs.find((p) => p.branch === 'ff/flags/align-feat-00113')!;
    assert.deepEqual([pr.state, pr.flagKeys], ['MERGED', ['ivi_00113_assist', 'ivi_00113_fault']]);
    assert.equal(pr.mergeCommit, g.repos.main.main.at(-1)!.sha);
    const status = (k: string) => g.report.results.find((r) => r.flagKey === k)!.result;
    assert.equal(status('ivi_00113_fault').lanes.CODE, 'OK', '대응 제어점이 없던 정책 키도 코드에 생긴다');
    // 합성 데이터에서 FEAT-00113 Flag는 '삭제된 호출' 시연 키다 — 정책 키로 바뀌면 그 키는 코드에 없던 키라 '코드 없음'(백엔드 대사와 같은 판정)
    assert.equal(status('ivi_00113_assist').status, 'NO_CODE');
    const intentional = JSON.parse(g.fixtures['plans.json']).summary.intentional as Record<string, string[]>;
    assert.ok(intentional.NO_CODE.includes('ivi_00113_assist') && !intentional.CALL_DELETED.includes('ivi_00113_assist'));
    assert.equal(g.report.summary.byStatus.NO_CODE, g.anomalies.noCode.length);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});
