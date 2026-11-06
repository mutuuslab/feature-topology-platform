// Flag 코드 연결·대사·통제(20-97 §8.1) — 시연 픽스처 시드·대사·출시 관문·출시 차단 해제(직무 분리)·시연 병합·운영 모드 거부,
// GitHub App(모의 GitHub) — 승인 시 계획·PR 생성, webhook 서명·재전송·잘못된 저장소, PR 검사 Check Run, Actions OIDC 업로드.
import { INestApplication } from '@nestjs/common';
import { FlagCoverageDetail, FlagCoverageResponse, FlagReleaseGate, FlagScanDetail, FLAG_COVERAGE_STATUSES, type FlagCoverageRow } from '@ff/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { githubWebhookRequest, startMockGithub, type MockGithub } from '../../../tools/flag-code/mock-github';
import { FlagCodeService } from '../../src/domains/d01-policy/flag-code/flag-code.service';
import { countEvaluations, noteLastEvaluated, recordReach } from '../../src/domains/d04-ops/telemetry-ingest/evaluation-stats.service';
import { GithubAdapter } from '../../src/domains/d01-policy/flag-code/github.adapter';
import { flagCodeDemoEnabled } from '../../src/domains/d01-policy/flag-code/flag-code.seed';
import { DB, type Db } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf, translate, translateMigration } from '../../src/kernel/pg-dialect';
import { actor, bootApp, confirmSafety, withRef } from '../helpers';
import { COMMITS, writeFlagCodeFixture } from './flag-code-fixture';

const NOW = '2026-11-06T01:00:00.000Z';
const DEV = actor('usr-dev', 'IMPLEMENTER');
const RM = actor('usr-rm', 'RELEASE_MANAGER');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

describe('Flag 코드 연결 — 시연 픽스처(DEMO_MIRROR)', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let svc: FlagCodeService;
  let dir: string;
  const coverage = async (q = '') => FlagCoverageResponse.parse((await http().get(`/api/flag-code/coverage${q}`).expect(200)).body);
  const row = async (key: string) => (await coverage()).rows.find((r) => r.flagKey === key) as FlagCoverageRow;

  beforeAll(async () => {
    dir = writeFlagCodeFixture();
    let get: <T>(t: unknown) => T;
    ({ app, http, get } = (await bootApp({ at: NOW, flagCode: dir })) as any);
    db = get<Db>(DB);
    svc = get<FlagCodeService>(FlagCodeService);
    // PG 호환 — 이 묶음이 실행하는 Flag 코드 SQL을 모아 마지막에 PostgreSQL 방언으로 번역해 본다(이 PC에는 PG가 없다)
    for (const m of ['run', 'get', 'all'] as const) {
      const orig = (db[m] as (...a: unknown[]) => unknown).bind(db);
      (db as any)[m] = (sql: string, ...params: unknown[]) => (/flag_|flag_retirement/.test(sql) && issued.add(sql), orig(sql, ...params));
    }
  });
  const issued = new Set<string>();
  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('픽스처 시드 — 전시 전용 저장소는 FF_SHOWCASE=1일 때만, 서명이 맞지 않는 스캔은 거부 기록만 남는다', async () => {
    const repos = (await http().get('/api/flag-code/repositories').expect(200)).body.items;
    expect(repos.map((r: { repoId: string }) => r.repoId)).toEqual(['FREPO-001']);
    expect(repos[0].lastScan).toMatchObject({ commit: COMMITS.c2, status: 'SUCCEEDED' });
    const scans = (await http().get('/api/flag-code/scans?repoId=FREPO-001').expect(200)).body.items;
    expect(scans.map((s: { status: string }) => s.status)).toEqual(['REJECTED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(scans[0]).toMatchObject({ commit: COMMITS.tampered, resultId: null, error: { code: 'SIGNATURE_INVALID' } });
    expect(db.get('SELECT 1 FROM flag_scan_result WHERE commit_id = ?', COMMITS.tampered)).toBeUndefined();
    const detail = FlagScanDetail.parse((await http().get(`/api/flag-code/scans/${scans[1].scanId}`).expect(200)).body);
    expect(detail).toMatchObject({ provenance: 'DEMO', verified: true, manifest: { commit: COMMITS.c2, format: 'ff-flag-source/v2' } });
  });

  it('스캔 결과는 추가만 한다 — 고치기·지우기는 DB가 거부한다', () => {
    const id = db.get<{ result_id: string }>('SELECT result_id FROM flag_scan_result LIMIT 1')!.result_id;
    expect(() => db.run('UPDATE flag_scan_result SET ref = ? WHERE result_id = ?', 'x', id)).toThrow();
    expect(() => db.run('DELETE FROM flag_scan_result WHERE result_id = ?', id)).toThrow();
  });

  it('대사 행 — 상태·심각도·출시 차단이 판정 규칙대로, 요약은 행 상태 수와 같다', async () => {
    const c = await coverage();
    const by = Object.fromEntries(c.rows.map((r) => [r.flagKey, r]));
    const expectStatus: Record<string, [string, string, boolean]> = {
      care_00022_signal: ['OK', 'OK', false],
      ivi_00024_guide: ['OK', 'OK', false],
      adas_00001_enable: ['OK', 'OK', false],
      care_00022_param: ['UNLEASH_MISMATCH', 'BLOCKER', true],
      adas_00001_signal: ['NO_CODE', 'BLOCKER', true],
      ivi_00014_enable: ['PR_OPEN', 'INFO', true],
      adas_00002_enable: ['CALL_DELETED', 'BLOCKER', true],
      adas_00002_signal: ['STALE', 'WARNING', false],
      adas_00002_experiment: ['UNREGISTERED_KEY', 'BLOCKER', true],
      ivi_00024_signal: ['REMOVAL_DUE', 'BLOCKER', false],
    };
    for (const [k, [status, severity, blocking]] of Object.entries(expectStatus)) expect([k, by[k]?.status, by[k]?.severity, by[k]?.releaseBlocking]).toEqual([k, status, severity, blocking]);
    expect(by.adas_00002_enable.code.lastSeen).toMatchObject({ commit: COMMITS.c1 });
    expect(by.adas_00002_experiment).toMatchObject({ featureId: null, lanes: { REGISTRY: 'MISSING', CODE: 'MISMATCH' } });
    expect(by.adas_00001_enable.code.usages[0]).toMatchObject({ repoId: 'FREPO-001', path: 'packages/adas/src/features/feat-00001/flag-guards.ts', provenance: 'DEMO', commit: COMMITS.c2 });
    expect(by.ivi_00014_enable).toMatchObject({ lanes: { CODE: 'PENDING' }, pullRequest: { prId: 'FPR-000001', state: 'OPEN', number: 7 } });
    const counts = Object.fromEntries(FLAG_COVERAGE_STATUSES.map((s) => [s, c.rows.filter((r) => r.status === s).length]));
    expect(c.summary.byStatus).toEqual(counts);
    expect(c.summary.releaseBlocking).toBe(c.rows.filter((r) => r.releaseBlocking).length);
    expect(c.fileFindings).toEqual([expect.objectContaining({ repoId: 'FREPO-001', status: 'DYNAMIC_KEY', since: '2026-10-20T00:00:00.000Z', call: expect.objectContaining({ path: 'packages/ivi/src/features/feat-00024/feature.ts' }) })]);
    // 필터 — 상태 쉼표 목록·패키지·검색
    const blocked = await coverage('?status=NO_CODE,CALL_DELETED');
    expect(blocked.rows.map((r) => r.flagKey).sort()).toEqual(['adas_00001_signal', 'adas_00002_enable']);
    expect(blocked.fileFindings).toEqual([]);
    expect((await coverage('?package=ivi')).rows.every((r) => r.package === 'ivi')).toBe(true);
    expect((await coverage('?q=00014')).rows.map((r) => r.flagKey)).toEqual(['ivi_00014_enable', 'ivi_00014_signal']);
    await http().get('/api/flag-code/coverage?status=BOGUS').expect(400);
    const d = FlagCoverageDetail.parse((await http().get('/api/flag-code/coverage/adas_00002_enable').expect(200)).body);
    expect(d.history.map((h) => h.commit)).toEqual([COMMITS.c1]);
    await http().get('/api/flag-code/coverage/nope_00000_key').expect(404);
  });

  it('Feature Flag 탭 — v2 사용처와 계획만 있는 Flag가 함께 나온다', async () => {
    const rows = (await http().get('/api/feature-flags?featureId=FEAT-00001&version=2.1.0').expect(200)).body;
    expect(rows.map((r: { flagKey: string }) => r.flagKey)).toEqual(['adas_00001_enable', 'adas_00001_param', 'adas_00001_signal']);
    expect(rows[0]).toMatchObject({ policy: null, sources: [expect.objectContaining({ provenance: 'DEMO', commit: COMMITS.c2, url: expect.stringContaining('/blob/') })] });
    expect(rows[2].sources).toEqual([]);
  });

  it('출시 관문 — 코드 없는 Flag가 VERIFIED→RELEASED를 FLAG_CODE_MISSING으로 막고, 해제(직무 분리·F2 두 결정) 뒤 통과한다', async () => {
    const base = '/api/features/FEAT-00001/versions/2.1.0';
    await confirmSafety(http, 'FEAT-00001', '2.1.0');
    for (const g of ['G8', 'G9']) await http().post(`${base}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${g}` }).expect(201);
    await http().post(`${base}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인 — Flag 코드 연결 시험' }).expect(201);
    const gate = FlagReleaseGate.parse((await http().get(`${base}/flag-code-gate`).expect(200)).body);
    expect(gate).toMatchObject({ pass: false, blockers: [{ flagKey: 'adas_00001_signal', status: 'NO_CODE' }], waived: [] });
    const blocked = await http().post(`${base}/transitions`).set(RM).send({ to: 'RELEASED', reason: '출시' }).expect(422);
    expect(blocked.body.error.details.blockers.map((b: { code: string }) => b.code)).toEqual(['FLAG_CODE_MISSING']);
    // 막히지 않은 Flag는 해제할 것이 없다, 30일 넘는 만료는 거부
    const body = { flagKey: 'adas_00001_signal', featureId: 'FEAT-00001', version: '2.1.0', reason: '스캐너가 C 코드 호출을 못 읽어 다음 스캔 전까지 해제', expiresAt: '2026-11-13T00:00:00.000Z' };
    await http().post('/api/flag-code/waivers').set(RM).send({ ...body, flagKey: 'adas_00001_enable' }).expect(422);
    await http().post('/api/flag-code/waivers').set(RM).send({ ...body, expiresAt: '2026-12-31T00:00:00.000Z' }).expect(400);
    const w = (await http().post('/api/flag-code/waivers').set(RM).send(body).expect(201)).body;
    expect(w).toMatchObject({ waiverId: 'FWV-0001', state: 'REQUESTED', coverageStatus: 'NO_CODE', requestedBy: 'usr-rm' });
    // 직무 분리 — 요청자는 다른 역할로도 결정할 수 없다
    const sod = await http().post(`/api/flag-code/waivers/${w.waiverId}/decision`).set(actor('usr-rm', 'FEATURE_APPROVER')).send({ decision: 'APPROVE', comment: '승인' }).expect(403);
    expect(sod.body.error.code).toBe('SEPARATION_OF_DUTY');
    await http().post(`/api/flag-code/waivers/${w.waiverId}/decision`).set(DEV).send({ decision: 'APPROVE', comment: '승인' }).expect(403);
    const first = (await http().post(`/api/flag-code/waivers/${w.waiverId}/decision`).set(APPROVER).send({ decision: 'APPROVE', comment: '사유 확인' }).expect(200)).body;
    expect(first.state).toBe('REQUESTED'); // F2 — Safety Manager도 결정해야 한다
    const second = (await http().post(`/api/flag-code/waivers/${w.waiverId}/decision`).set(SAFETY).send({ decision: 'APPROVE', comment: '안전 영향 없음' }).expect(200)).body;
    expect(second).toMatchObject({ state: 'APPROVED', decidedBy: 'usr-safety' });
    expect(FlagReleaseGate.parse((await http().get(`${base}/flag-code-gate`).expect(200)).body)).toMatchObject({ pass: true, blockers: [], waived: [{ flagKey: 'adas_00001_signal', waiverId: 'FWV-0001' }] });
    // 해제는 요청한 Version(2.1.0)에만 — 같은 키를 쓰는 VERIFIED 2.2.0(대사표의 대표 Version)은 여전히 막힌다
    expect(await row('adas_00001_signal')).toMatchObject({ version: '2.2.0', waiver: null, releaseBlocking: true });
    expect(FlagReleaseGate.parse((await http().get('/api/features/FEAT-00001/versions/2.2.0/flag-code-gate').expect(200)).body)).toMatchObject({ pass: false, waived: [] });
    const released = await http().post(`${base}/transitions`).set(RM).send({ to: 'RELEASED', reason: '출시' }).expect(200);
    expect(released.body.feature?.lifecycle ?? released.body.lifecycle).toBe('RELEASED');
    const audit = db.all<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit WHERE target = 'FWV-0001' ORDER BY id");
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['FLAG_WAIVER_REQUEST', 'FLAG_WAIVER_DECIDE']));
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM events WHERE type = 'flag.waiver.approved'")!.n).toBe(1);
    expect((await http().get('/api/flag-code/waivers?featureId=FEAT-00001').expect(200)).body.items).toEqual([expect.objectContaining({ waiverId: 'FWV-0001', state: 'APPROVED' })]);
  });

  it('정책 게시 관문 — 코드 연결이 출시를 막는 Flag의 정책은 DEPLOYED로 게시하지 않는다', () => {
    const blockers = svc['coverage'].deployBlockers({ flagKey: 'ivi_00014_enable', featureId: 'FEAT-00014', featureVersion: '1.0.0' });
    expect(blockers).toEqual([expect.objectContaining({ flagKey: 'ivi_00014_enable', status: 'PR_OPEN' })]);
    // Unleash 불일치는 게시 뒤 동기화로 풀리므로 게시를 막지 않는다
    expect(svc['coverage'].deployBlockers({ flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0' })).toEqual([]);
  });

  it('시연 병합 — 열린 Flag PR을 병합하면 서버가 PUSH 스캔(서명 확인)을 남기고 상태가 정상이 된다', async () => {
    const r = (await http().post('/api/flag-code/pull-requests/FPR-000001/demo-merge').set(DEV).send({}).expect(200)).body;
    expect(r.pullRequest).toMatchObject({ state: 'MERGED', mergedBy: 'usr-dev', mergeCommit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(r.scan).toMatchObject({ trigger: 'PUSH', status: 'SUCCEEDED', attestation: { kind: 'FF_SCANNER', keyId: 'ff-demo-scan-1' } });
    expect(FlagScanDetail.parse((await http().get(`/api/flag-code/scans/${r.scan.scanId}`).expect(200)).body)).toMatchObject({ provenance: 'FF_SCAN', verified: true });
    for (const k of ['ivi_00014_enable', 'ivi_00014_signal']) expect((await row(k)).status).toBe('OK');
    // 이전 결과의 다른 Flag 상태는 그대로(삭제된 호출·미등록 키)
    expect((await row('adas_00002_enable')).status).toBe('CALL_DELETED');
    await http().post('/api/flag-code/pull-requests/FPR-000001/demo-merge').set(DEV).send({}).expect(422);
    const tab = (await http().get('/api/feature-flags?featureId=FEAT-00014&version=1.0.0').expect(200)).body;
    expect(tab[0].sources[0]).toMatchObject({ provenance: 'FF_SCAN', commit: r.pullRequest.mergeCommit });
  });

  it('제거 PR — Retirement가 승인된 Flag만, 시연 병합 뒤 코드 0이면 정상', async () => {
    const ret = db.get<{ retirement_id: string }>("SELECT retirement_id FROM flag_retirement WHERE flag_key = 'ivi_00024_signal'")!.retirement_id;
    await http().post('/api/flag-code/removal-pull-requests').set(DEV).send({ flagKey: 'ivi_00024_guide', repoId: 'FREPO-001', retirementId: ret }).expect(400);
    const pr = (await http().post('/api/flag-code/removal-pull-requests').set(DEV).send({ flagKey: 'ivi_00024_signal', repoId: 'FREPO-001', retirementId: ret }).expect(201)).body;
    expect(pr).toMatchObject({ kind: 'REMOVAL', state: 'OPEN', branch: 'ff/remove/ivi_00024_signal', retirementId: ret, files: [expect.objectContaining({ change: 'MODIFY' }), expect.objectContaining({ change: 'MODIFY' })] });
    expect((await row('ivi_00024_signal')).pullRequest).toMatchObject({ kind: 'REMOVAL', state: 'OPEN' });
    await http().post(`/api/flag-code/pull-requests/${pr.prId}/demo-merge`).set(DEV).send({}).expect(200);
    const after = await row('ivi_00024_signal');
    expect(after).toMatchObject({ status: 'OK', codeRequired: false, code: { usages: [] } });
    expect((await row('ivi_00024_guide')).status).toBe('OK');
  });

  it('운영 모드에서는 시연 병합을 거부한다(409)', async () => {
    const pr = (await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: 'FEAT-00002', version: '1.6.0', repoId: 'FREPO-001' }).expect(201)).body;
    expect(pr).toMatchObject({ state: 'OPEN', branch: 'ff/flags/feat-00002-1.6.0', flagKeys: ['adas_00002_enable', 'adas_00002_signal'] });
    process.env.FF_ENV = 'production';
    try {
      expect(() => svc.demoMerge({ id: 'usr-dev', role: 'IMPLEMENTER', correlationId: 't' }, pr.prId)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    } finally {
      delete process.env.FF_ENV;
    }
    expect((await http().get(`/api/flag-code/pull-requests?featureId=FEAT-00002`).expect(200)).body.items[0].state).toBe('OPEN');
  });

  it('평가 모니터링 — 창별 집계·폴백 이유·시계열(시드 시각 기준으로 옮긴 구간)', async () => {
    const e = (await http().get('/api/flag-code/evaluations?window=24h&flagKey=care_00022_signal').expect(200)).body;
    const edge = e.items.find((x: { source: string }) => x.source === 'UNLEASH_EDGE');
    expect(edge).toMatchObject({ evaluations: 1200, enabled: 1100, disabled: 97, errors: 3, vehicles: 100, fallbacks: [{ reason: 'SIGNATURE_INVALID', count: 40 }, { reason: 'TTL_EXPIRED', count: 4 }], lastEvaluatedAt: '2026-11-06T00:00:00.000Z' });
    const s = (await http().get('/api/flag-code/evaluations/care_00022_signal?window=1h').expect(200)).body;
    expect(s).toMatchObject({ bucketMinutes: 60, buckets: [expect.objectContaining({ bucketStart: '2026-11-06T00:00:00.000Z' }), expect.objectContaining({ source: 'VEHICLE_SDK' })] });
    await http().get('/api/flag-code/evaluations?window=2d').expect(400);
  });

  it('저장소 변경은 출시 담당만, 사유를 감사에 남긴다', async () => {
    await http().patch('/api/flag-code/repositories/FREPO-001').set(DEV).send({ scanIntervalMinutes: 60, reason: '주기 재스캔' }).expect(403);
    await http().patch('/api/flag-code/repositories/FREPO-001').set(RM).send({ scanIntervalMinutes: 5, reason: '너무 짧음' }).expect(400);
    const r = (await http().patch('/api/flag-code/repositories/FREPO-001').set(RM).send({ scanIntervalMinutes: 60, reason: '주기 재스캔 켬' }).expect(200)).body;
    expect(r.scanIntervalMinutes).toBe(60);
    const a = db.get<{ reason: string; after_doc: string }>("SELECT reason, after_doc FROM audit WHERE action = 'FLAG_REPO_UPDATE' AND target = 'FREPO-001'")!;
    expect(a.reason).toBe('주기 재스캔 켬');
    expect(JSON.parse(a.after_doc)).toEqual({ scanIntervalMinutes: 60 });
    // 시연 미러 재스캔 — 같은 커밋의 서명 결과를 다시 확인한다
    const scan = (await http().post('/api/flag-code/repositories/FREPO-001/scans').set(DEV).send({ reason: '확인' }).expect(201)).body;
    expect(scan).toMatchObject({ trigger: 'MANUAL', status: 'SUCCEEDED' });
  });

  it('PostgreSQL 호환 — 실행한 Flag 코드 SQL과 091~096·102 마이그레이션이 PG 방언으로 번역된다', () => {
    const ctx = dialectContextOf(MIGRATIONS);
    // 시드에서만 쓰는 쓰기 SQL도 한 번 실행해 모은다
    const store = svc['store'];
    db.tx(() => {
      // 평가 집계 한 저장소(102)의 쓰기 — 칸 더하기·고유 차량 최댓값·마지막 평가 시각
      countEvaluations(db, [{ at: NOW, flagKey: 'pg_00000_check', source: 'OFREP', appName: 'ofrep-client', environment: 'default', result: 'SAFE_DEFAULT', variant: 'safe_default', reason: 'TTL_EXPIRED', subject: 'abcdef0123456789' }]);
      recordReach(db, [{ hour: NOW, flagKey: 'pg_00000_check', source: 'OFREP', vehicles: 2 }]);
      noteLastEvaluated(db, 'pg_00000_check', NOW);
      store.insertUnleash({ flagKey: 'pg_00000_check', policyId: 'POL-99999', revision: 1, outcome: 'SYNCED', archived: false, at: NOW });
    });
    expect(issued.size).toBeGreaterThan(20);
    for (const sql of issued) {
      const t = translate(sql, ctx);
      expect(t.text, sql).not.toMatch(/\?|INSERT\s+OR\s+|RAISE\s*\(/i);
      if (/^\s*INSERT/i.test(sql)) expect(t.text, sql).toMatch(/RETURNING rowid$/);
    }
    const upsert = [...issued].find((s) => s.startsWith('INSERT INTO flag_eval_hourly'))!;
    expect(translate(upsert, ctx).text).toMatch(/ON CONFLICT \(hour, flag_key, source, app_name, environment, result, variant, reason\) DO UPDATE SET n = flag_eval_hourly\.n \+ excluded\.n RETURNING rowid$/);
    expect(translate([...issued].find((s) => s.startsWith('INSERT INTO flag_eval_reach'))!, ctx).text).toMatch(/DO UPDATE SET vehicles = excluded\.vehicles WHERE excluded\.vehicles > flag_eval_reach\.vehicles RETURNING rowid$/);
    expect(translate([...issued].find((s) => s.startsWith('INSERT OR IGNORE INTO flag_plan'))!, ctx).text).toMatch(/ON CONFLICT DO NOTHING RETURNING rowid$/);
    const ddl = MIGRATIONS.filter((m) => /^(09[1-6]|102)_/.test(m.name)).map((m) => translateMigration(m, ctx)).join('\n');
    expect(ddl).toMatch(/CREATE TRIGGER flag_scan_result_no_update BEFORE UPDATE ON flag_scan_result FOR EACH ROW EXECUTE FUNCTION/);
    expect(ddl).not.toMatch(/RAISE\s*\(\s*ABORT|AUTOINCREMENT/i);
  });
});

describe('Flag 코드 연결 — 시드 끔', () => {
  it('운영 모드·FF_SEED=none·5년 재생·FF_FLAG_CODE_DEMO=off는 시연 시드를 넣지 않는다', () => {
    expect(flagCodeDemoEnabled({})).toBe(true);
    expect(flagCodeDemoEnabled({ FF_ENV: 'production' })).toBe(false);
    expect(flagCodeDemoEnabled({ FF_SEED: 'none' })).toBe(false);
    expect(flagCodeDemoEnabled({ FF_DATASET: 'ops5y' })).toBe(false);
    expect(flagCodeDemoEnabled({ FF_FLAG_CODE_DEMO: 'off' })).toBe(false);
  });

  it('FF_FLAG_CODE_DEMO=off(시험 기본)·운영 모드에서는 시연 저장소·계획을 넣지 않는다', async () => {
    const { app, http } = await bootApp();
    try {
      expect((await http().get('/api/flag-code/repositories').expect(200)).body.items).toEqual([]);
      // 연결 저장소가 없으면 출시 관문은 코드 원천을 보지 않는다
      expect((await http().get('/api/features/FEAT-00001/versions/2.1.0/flag-code-gate').expect(200)).body).toMatchObject({ pass: true, blockers: [] });
      const c = FlagCoverageResponse.parse((await http().get('/api/flag-code/coverage').expect(200)).body);
      expect(c.rows.every((r) => r.lanes.CODE === 'NOT_APPLICABLE' && !r.releaseBlocking)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('Flag 코드 연결 — GitHub App(모의 GitHub)', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let gh: MockGithub;
  let svc: FlagCodeService;
  const SECRET = 'flag-code-test-secret';
  const FULL = 'mutuuslab/vehicle-apps-live';
  const URL_ = `https://github.com/${FULL}`;
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string) => ((saved[k] = process.env[k]), (process.env[k] = v));
  const hook = (event: string, payload: unknown, deliveryId?: string, secret = SECRET) => {
    const req = githubWebhookRequest(event, payload, secret, deliveryId);
    return http().post('/api/flag-code/webhooks/github').set(req.headers).send(req.raw);
  };

  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    gh = await startMockGithub({ appPublicKey: publicKey });
    env('FF_GITHUB_API_URL', gh.url);
    env('FF_GITHUB_APP_ID', '424242');
    env('FF_GITHUB_APP_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    env('FF_GITHUB_WEBHOOK_SECRET', SECRET);
    env('FF_GITHUB_OIDC_JWKS_URL', `${gh.url}/.well-known/jwks`);
    let get: <T>(t: unknown) => T;
    ({ app, http, get } = (await bootApp()) as any);
    db = get<Db>(DB);
    svc = get<FlagCodeService>(FlagCodeService);
    get<GithubAdapter>(GithubAdapter).reset();
    gh.addRepo(FULL, 'main', { 'packages/adas/src/a.ts': "export const a = (c) => c.getBooleanValue('care_00022_signal', false);\nexport const b = (c) => c.getBooleanValue('care_00022_param', false);\n", 'README.md': '# 차량 기능 앱\n' });
    const packages = ['adas', 'ivi', 'body', 'chassis', 'powertrain', 'safety', 'connectivity', 'platform'].map((name) => ({ name, path: `packages/${name}` }));
    await http().post('/api/flag-code/repositories').set(DEV).send({ repository: URL_, displayName: '실연결', mode: 'GITHUB_APP', packages, installationId: 77 }).expect(403);
    await http().post('/api/flag-code/repositories').set(RM).send({ repository: URL_, displayName: '실연결', mode: 'GITHUB_APP', packages }).expect(400); // 설치 번호 필수
    await http().post('/api/flag-code/repositories').set(RM).send({ repository: URL_, displayName: '실연결', mode: 'GITHUB_APP', packages, installationId: 77 }).expect(201);
  });
  afterAll(async () => {
    await app?.close();
    await gh?.close();
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });

  it('webhook — 서명이 맞는 push는 기본 브랜치를 서버가 스캔·서명하고, 같은 배달 ID는 한 번만 처리한다', async () => {
    const head = gh.head(FULL, 'main');
    const payload = { ref: 'refs/heads/main', before: '0'.repeat(40), after: head, repository: { html_url: URL_, default_branch: 'main' }, installation: { id: 77 } };
    const r = await hook('push', payload, 'delivery-1').expect(202);
    expect(r.body).toMatchObject({ deliveryId: 'delivery-1', outcome: 'SCANNED', status: 'SUCCEEDED' });
    const scan = FlagScanDetail.parse((await http().get(`/api/flag-code/scans/${r.body.scanId}`).expect(200)).body);
    expect(scan).toMatchObject({ provenance: 'FF_SCAN', verified: true, scan: { trigger: 'PUSH', deliveryId: 'delivery-1', commit: head }, manifest: { filesScanned: 1 } });
    expect(scan.manifest!.usages.map((u) => u.flagKey)).toEqual(['care_00022_signal', 'care_00022_param']);
    const again = await hook('push', payload, 'delivery-1').expect(200);
    expect(again.body).toMatchObject({ duplicate: true, scanId: r.body.scanId });
    expect((await http().get('/api/flag-code/scans').expect(200)).body.items.filter((s: { deliveryId: string }) => s.deliveryId === 'delivery-1')).toHaveLength(1);
  });

  it('webhook — 서명이 틀리면 401과 배달 기록(실패), 연결되지 않은 저장소는 404', async () => {
    const payload = { ref: 'refs/heads/main', after: gh.head(FULL, 'main'), repository: { html_url: URL_ } };
    const bad = await hook('push', payload, 'delivery-bad', 'wrong-secret').expect(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
    expect(db.get('SELECT signature_ok, outcome FROM flag_webhook_delivery WHERE delivery_id = ?', 'delivery-bad')).toEqual({ signature_ok: 0, outcome: 'SIGNATURE_INVALID' });
    const repo = (await http().get('/api/flag-code/repositories').expect(200)).body.items[0];
    expect(repo.webhook).toMatchObject({ state: 'FAILING', failureCount: 1 });
    await hook('push', { ...payload, repository: { html_url: 'https://github.com/someone/else' } }, 'delivery-unknown').expect(404);
    expect(db.get('SELECT outcome FROM flag_webhook_delivery WHERE delivery_id = ?', 'delivery-unknown')).toEqual({ outcome: 'UNKNOWN_REPOSITORY' });
    // 비밀을 고친 뒤 같은 배달 ID를 바른 서명으로 다시 보내면 중복이 아니라 처리한다
    expect((await hook('push', payload, 'delivery-bad').expect(202)).body).toMatchObject({ outcome: 'SCANNED' });
    expect(db.get('SELECT signature_ok, outcome FROM flag_webhook_delivery WHERE delivery_id = ?', 'delivery-bad')).toEqual({ signature_ok: 1, outcome: 'SCANNED' });
    // 다음 정상 배달로 다시 ACTIVE
    await hook('push', { ...payload, ref: 'refs/heads/feature/x' }, 'delivery-other-branch').expect(202);
    expect((await http().get('/api/flag-code/repositories').expect(200)).body.items[0].webhook.state).toBe('ACTIVE');
  });

  it('PR 검사 — 미등록 키·등록 Flag 호출 삭제·새 동적 키는 Check Run 실패', async () => {
    const base = gh.head(FULL, 'main');
    gh.commit(FULL, 'feature/try', { 'packages/adas/src/a.ts': "export const a = (c) => c.getBooleanValue('care_00022_signal', false);\nexport const x = (c, k) => c.getBooleanValue(k, false);\nexport const y = (c) => c.isEnabled('adas_99999_new');\n" });
    const head = gh.head(FULL, 'feature/try');
    const payload = { action: 'opened', repository: { html_url: URL_ }, pull_request: { number: 3, head: { sha: head, ref: 'feature/try' }, base: { sha: base, ref: 'main' } } };
    const r = (await hook('pull_request', payload).expect(202)).body;
    expect(r).toMatchObject({ outcome: 'PR_CHECKED', conclusion: 'failure' });
    const scan = (await http().get(`/api/flag-code/scans/${r.scanId}`).expect(200)).body.scan;
    expect(scan).toMatchObject({ trigger: 'PULL_REQUEST', prNumber: 3, baseCommit: base, ref: 'feature/try' });
    expect(scan.prCheck.findings.map((f: { code: string }) => f.code).sort()).toEqual(['DYNAMIC_KEY', 'REGISTERED_CALL_REMOVED', 'UNREGISTERED_KEY']);
    expect(gh.checkRuns.at(-1)).toMatchObject({ name: 'FF Flag 검사', head_sha: head, conclusion: 'failure' });
    expect(gh.checkRuns.at(-1)!.output.summary).toContain('/flag-code/flags/adas_99999_new');
    // PR 브랜치 스캔은 기본 브랜치 대사 원천이 아니다
    const c = FlagCoverageResponse.parse((await http().get('/api/flag-code/coverage').expect(200)).body);
    expect(c.rows.some((x) => x.flagKey === 'adas_99999_new')).toBe(false);
  });

  it('Feature Version 승인 — Flag 계획(flag_plan·flag_registry)과 뼈대 PR을 GitHub에 연다', async () => {
    const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: 'Flag 코드 연결 시험 Feature', description: '20-97', requirementIds: ['REQ-FC-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag', 'Signal'] })).expect(201);
    const fid = f.body.featureId as string;
    await confirmSafety(http, fid, '0.1.0');
    for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
    await svc.idle();
    const plans = db.all<{ flag_key: string; package: string; source: string }>('SELECT flag_key, package, source FROM flag_plan WHERE feature_id = ? ORDER BY ordinal, flag_key', fid);
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.source === 'PLANNED' && p.flag_key.startsWith(`${p.package}_${fid.slice(5)}_`))).toBe(true);
    expect(db.all('SELECT flag_key FROM flag_registry WHERE feature_id = ?', fid)).toHaveLength(2);
    const prs = (await http().get(`/api/flag-code/pull-requests?featureId=${fid}`).expect(200)).body.items;
    expect(prs).toEqual([expect.objectContaining({ kind: 'SCAFFOLD', state: 'OPEN', number: 1, url: `https://github.com/${FULL}/pull/1`, branch: `ff/flags/${fid.toLowerCase()}-0.1.0`, createdBy: 'system:flag-code' })]);
    expect(gh.pulls[0]).toMatchObject({ head: `ff/flags/${fid.toLowerCase()}-0.1.0`, base: 'main' });
    const files = gh.filesAt(gh.head(FULL, `ff/flags/${fid.toLowerCase()}-0.1.0`));
    const guards = Object.entries(files).find(([p]) => p.endsWith('/flag-guards.ts'))![1];
    expect(guards).toContain(`getBooleanValue(${plans[0].flag_key.toUpperCase()}, false, ctx)`);
    // 같은 브랜치 PR이 열려 있으면 다시 만들지 않는다, 계획에 없는 키는 거부
    await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: fid, version: '0.1.0', repoId: 'FREPO-001' }).expect(409);
    await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: fid, version: '0.1.0', repoId: 'FREPO-001', flagKeys: ['other_00001_enable'] }).expect(400);
    // 실제 연결 저장소의 PR은 시연 병합할 수 없다
    await http().post(`/api/flag-code/pull-requests/${prs[0].prId}/demo-merge`).set(DEV).send({}).expect(409);
    // PR 닫힘(병합) webhook — 상태 MERGED
    await hook('pull_request', { action: 'closed', repository: { html_url: URL_ }, pull_request: { number: 1, merged: true, merge_commit_sha: 'a'.repeat(40), head: { sha: gh.head(FULL, `ff/flags/${fid.toLowerCase()}-0.1.0`), ref: `ff/flags/${fid.toLowerCase()}-0.1.0` }, base: { sha: gh.head(FULL, 'main'), ref: 'main' } } }).expect(202);
    expect((await http().get(`/api/flag-code/pull-requests?featureId=${fid}`).expect(200)).body.items[0]).toMatchObject({ state: 'MERGED', mergeCommit: 'a'.repeat(40) });
  });

  it('App 설정이 없으면 PR은 FAILED로 남고, 다시 만들기를 요청할 수 있다', async () => {
    const appId = process.env.FF_GITHUB_APP_ID;
    delete process.env.FF_GITHUB_APP_ID;
    app.get(GithubAdapter).reset();
    try {
      const pr = (await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: 'FEAT-00022', version: '1.0.0', repoId: 'FREPO-001' }).expect(201)).body;
      expect(pr).toMatchObject({ state: 'FAILED', failure: expect.stringContaining('FF_GITHUB_APP_ID') });
    } finally {
      process.env.FF_GITHUB_APP_ID = appId;
      app.get(GithubAdapter).reset();
    }
    const retry = (await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: 'FEAT-00022', version: '1.0.0', repoId: 'FREPO-001' }).expect(201)).body;
    expect(retry).toMatchObject({ state: 'OPEN', prId: expect.stringMatching(/^FPR-/) });
  });

  it('CI 업로드 — Actions OIDC 신원(저장소·커밋·브랜치)이 맞아야 받는다', async () => {
    const ci = 'https://github.com/mutuuslab/vehicle-apps-ci';
    await http().post('/api/flag-code/repositories').set(RM).send({ repository: ci, displayName: 'CI 업로드', mode: 'ACTIONS_OIDC', packages: [{ name: 'body', path: 'packages/body' }] }).expect(201);
    const commit = 'b'.repeat(40);
    const manifest = { format: 'ff-flag-source/v2', provider: 'GITHUB', repository: ci, ref: 'main', commit, scannedAt: '2026-11-06T00:00:00.000Z', scanner: { name: 'ff-flag-scan', version: '2.0.0' }, filesScanned: 1, usages: [{ flagKey: 'care_00022_signal', path: 'packages/body/src/x.ts', line: 1, symbol: 'c.getBooleanValue', method: 'getBooleanValue', safeDefault: 'EXPLICIT_FALSE', contentHash: 'sha256:' + 'c'.repeat(64), via: 'LITERAL' }], unresolved: [] };
    const good = gh.issueOidc({ repository: 'mutuuslab/vehicle-apps-ci', sha: commit, ref: 'refs/heads/main', sub: 'repo:mutuuslab/vehicle-apps-ci:ref:refs/heads/main', run_id: '99', workflow_ref: 'mutuuslab/vehicle-apps-ci/.github/workflows/ff-flag-check.yml@refs/heads/main' });
    const wrong = gh.issueOidc({ repository: 'mutuuslab/vehicle-apps-ci', sha: 'd'.repeat(40), ref: 'refs/heads/main' });
    await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest, oidcToken: wrong }).expect(403);
    await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest, oidcToken: good.slice(0, -4) + 'AAAA' }).expect(401);
    const r = (await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest, oidcToken: good }).expect(201)).body;
    expect(r).toMatchObject({ trigger: 'CI_UPLOAD', status: 'SUCCEEDED', attestation: { kind: 'GITHUB_OIDC', runId: '99' } });
    expect(JSON.stringify(db.all('SELECT doc FROM flag_scan_run'))).not.toContain(good);
    expect(FlagScanDetail.parse((await http().get(`/api/flag-code/scans/${r.scanId}`).expect(200)).body)).toMatchObject({ provenance: 'CI_ATTESTED', verified: true });
  });
});
