// 공개 시연 사이트의 브라우저 안 쓰기 — policy-ops 묶음(api/sim/handlers/policy-ops, 설계 20-60).
// 배포본과 같은 스냅샷(public/api-snapshot) 위에서: 정책 작성 → 가상검증 → 8종 검증 → 승인 → 배포(Canary 5%) → 확대 판정(관측 기간·배포자≠확대자·중단 기준)
// → 차량 회신, 롤백 요청·승인·실행 → 회신 → 완료, 이상 대응·사후 검토·레거시 해제 거부, Unleash 동기화·대조가 서버와 같은 규칙으로 판정되는지 본다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl } from '@ff/contracts';
import { gxLegacyFacts } from './fixtures/gx-legacy-facts';

// 스냅샷 묶음 — 정적 배포본 스냅샷(public/api-snapshot, 빌드 산출물이라 저장소 밖) 중 이 시험이 읽는 파일만 담았다.
// 스냅샷을 새로 찍은 뒤 다시 담기: SIM_FIXTURE_REFRESH=1 npx vitest run src/__tests__/simPolicyOps.test.ts
const BUNDLE = resolve(__dirname, 'fixtures/sim-policy-ops.json.gz');
const PUBLIC = resolve(__dirname, '../../public') + '/';
const REFRESH = !!process.env.SIM_FIXTURE_REFRESH;
const files: Record<string, unknown> = REFRESH ? {} : JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString('utf8'));
const load = (rel: string): unknown => {
  if (REFRESH && !(rel in files) && existsSync(PUBLIC + rel)) files[rel] = JSON.parse(readFileSync(PUBLIC + rel, 'utf8'));
  return files[rel];
};
afterAll(() => {
  if (REFRESH) writeFileSync(BUNDLE, gzipSync(JSON.stringify(Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]])))));
});
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
/** 정적 사이트와 같은 파일 — 배포본 스냅샷 그대로 */
const snapshotFetch = async (u: string) => {
  const path = decodeURIComponent(u.replace(/^\//, ''));
  const v = gxLegacyFacts(path, load(path), load);
  return v === undefined ? html() : json(v);
};
const snap = (name: string) => structuredClone(load(`api-snapshot/${name}.json`)) as any;

type Sim = typeof import('../api/sim');
let sim: Sim;
let engine: typeof import('../api/sim/engine');
const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const run = (name: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; role?: string; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role: o.role, actorRole: o.actorRole });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(snapshotFetch));
  localStorage.clear();
  sim = await import('../api/sim');
  engine = await import('../api/sim/engine');
});
afterEach(() => {
  engine.__resetSimForTest();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const NEW = { featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '위험 단계 감속 요청 파라미터 — 감속 시작 거리 조정판', enabled: true, safeDefault: false, entitlementCatalogId: 'CAT-00019', rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' } };

describe('새 정책 게시본의 차량 수렴 읽기', () => {
  it('되돌리기 새 게시본도 미수신 → 회신 5/6 → 재제출 → 적용 확인 6/6을 같은 게시본으로 읽는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await run('decideRollbackRequest', { params: { id: 'RBR-00005' }, role: 'opslead', body: { decision: 'APPROVE', comment: '앞 판 복구 승인' } });
    const execution = await run('executeRollbackRequest', { params: { id: 'RBR-00005' }, role: 'operator', body: {} });
    const id = execution.artifactId;
    const initial = await run('adsConvergence', { params: { id } });
    expect(initial).toMatchObject({ publicationId: id, status: 'DISPATCHED', total: 6, notApplied: 6, bins: { APPLIED: 0, NOT_RECEIVED: 6 }, cumulative: { received: 0, accepted: 0 } });
    await vi.advanceTimersByTimeAsync(8000);
    const partial = await run('adsConvergence', { params: { id } });
    expect(partial).toMatchObject({ publicationId: id, total: 6, notApplied: 1, bins: { APPLIED: 5, NOT_RECEIVED: 1 }, cumulative: { received: 5, accepted: 5 } });
    expect(Object.values(partial.bins).reduce((sum: number, n) => sum + Number(n), 0)).toBe(6);
    const detail = await run('publicationDetail', { params: { id } });
    expect(detail.delivery.state).toBe('RETRY_WAIT');
    await run('otaJobRetry', { params: { jobId: detail.delivery.jobId }, role: 'operator', body: { reason: '통신 복구 차량 재제출' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await run('adsConvergence', { params: { id } })).toMatchObject({ publicationId: id, status: 'CONFIRMED', total: 6, notApplied: 0, bins: { APPLIED: 6, NOT_RECEIVED: 0 }, cumulative: { received: 6, accepted: 6 } });
    expect(await run('rollbackExecution', { params: { id: execution.executionId } })).toMatchObject({ status: 'COMPLETED', result: 'SUCCESS' });
  });

  it('ACK와 거부는 적용 확인으로 세지 않으며, 없는 게시본은 정상 빈 집계로 만들지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await run('decideRollbackRequest', { params: { id: 'RBR-00005' }, role: 'opslead', body: { decision: 'APPROVE', comment: '앞 판 복구 승인' } });
    const execution = await run('executeRollbackRequest', { params: { id: 'RBR-00005' }, role: 'operator', body: {} });
    const id = execution.artifactId;
    const overlay = engine.__overlayForTest()!;
    const publication = overlay.entities.publication[id] as any;
    const [ackVin, rejectedVin] = publication.payload.targets;
    // Inject only report facts to isolate the reader's server-equivalent classification boundary.
    publication.nodes.find((n: any) => n.nodeId === ackVin).state = 'CONFIRMED';
    overlay.data.killDelivery[id].readbacks = [
      { vin: ackVin, publicationId: id, metricType: 'ACK', at: new Date().toISOString() },
      { vin: rejectedVin, publicationId: id, metricType: 'READBACK', rejectReason: 'POLICY_HASH_MISMATCH', at: new Date().toISOString() },
    ];
    expect(await run('adsConvergence', { params: { id } })).toMatchObject({ total: 6, notApplied: 6, bins: { APPLIED: 0, RECEIVED_ONLY: 1, REJECTED: 1, NOT_RECEIVED: 4 } });
    await expect(run('adsConvergence', { params: { id: 'PUB-99999' } })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('서버와 같은 판정', () => {
  it('정책 내용 해시는 서버 policyHash와 같다', async () => {
    const { policyHash } = await import('../api/sim/handlers/policy-ops');
    for (const id of ['POL-00002', 'POL-00005', 'POL-00008']) {
      const p = snap(`policies_${id}`).policy;
      expect(await policyHash(p)).toBe(p.contentHash);
    }
  });
  it('분야별 검증 8종 — 스냅샷 정책(POL-00005)을 다시 검증하면 서버 기록(VAL-000002)과 같은 결과', async () => {
    const server = snap('policies_validations').items.find((r: any) => r.runId === 'VAL-000002');
    const out = await run('validatePolicy', { params: { id: 'POL-00005' }, role: 'author', body: {} });
    expect(out.run.decision).toBe('GO');
    expect(out.run.results.map((r: any) => [r.componentId, r.result])).toEqual(server.results.map((r: any) => [r.componentId, r.result]));
    // 근거 문장도 같다 — 서버 검증 뒤 바뀐 사실(같은 제어점의 배포 정책 POL-00004 → POL-00008, 구성 상품 CAT-00064 추가)만 지금 상태로
    const now = (s: string) => s.replace('POL-00004', 'POL-00008').replace('영향 상품 1건', '영향 상품 2건');
    expect(out.run.results.map((r: any) => r.summary)).toEqual(server.results.map((r: any) => now(r.summary)));
    expect(out.run.runId).toBe('VAL-000025');
    const list = await run('validations');
    expect(list.items[0].runId).toBe('VAL-000025');
  });
});

describe('정책 작성 → 검증 → 승인 → 배포(Canary) → 확대 판정 → 차량 회신', () => {
  it('서버와 같은 순서·규칙으로 바뀌고 모든 화면이 같은 상태를 본다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // 작성 — 다른 Feature에 묶인 flag는 거부(FFG-CODE-020)
    await expect(run('createPolicy', { role: 'author', body: { ...NEW, flagKey: 'ivi_00024_guide' } })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    const p = await run('createPolicy', { role: 'author', body: NEW });
    expect(p).toMatchObject({ policyId: 'POL-00025', status: 'DRAFT', revision: 1, createdBy: 'usr-author' });
    expect((await run('listPolicies')).items[0].policyId).toBe('POL-00025');
    // 가상검증 전에는 D06-03·D06-06이 보완 필요 → HOLD
    const held = await run('validatePolicy', { params: { id: p.policyId }, role: 'author', body: {} });
    expect(held.run.decision).toBe('HOLD');
    expect(held.policy.status).toBe('DRAFT');
    // 가상검증 — 같은 시나리오의 기록된 CARLA 실행을 결정적으로 다시 쓴다
    const vv = await run('runVirtual', { role: 'author', body: { policyId: p.policyId } });
    expect(vv.items.map((r: any) => [r.scenarioId, r.source, r.gateResult])).toEqual([
      ['SCN-FEAT00022-NOMINAL', 'carla', 'PASS'],
      ['SCN-FEAT00022-FAULT-ONBOARD', 'carla', 'PASS'],
      ['SCN-FEAT00022-FAULT-REMOTE-DC2', 'carla', 'FAIL'],
    ]);
    expect(vv.items[0].evidence.sourceRunId).toMatch(/^VV-\d{5}$/);
    expect((await run('virtualRuns', { query: { policyId: p.policyId } })).items).toHaveLength(3);
    const go = await run('validatePolicy', { params: { id: p.policyId }, role: 'author', body: {} });
    expect(go.run.decision).toBe('GO');
    expect(go.policy.status).toBe('VALIDATED');
    // 승인자 알림 — 정책 승인 요청(작성자 제외)
    const bell = await run('notifications', { role: 'approver', query: { limit: 200 } });
    expect(bell.items.some((n: any) => n.title.startsWith(`정책 승인 요청 — ${p.policyId}`))).toBe(true);
    // 승인 — 작성자는 승인할 수 없다(FEATURE_APPROVER 역할이 없는 작성자는 403, 역할이 있어도 자기 승인은 직무 분리)
    await expect(run('decidePolicy', { params: { id: p.policyId }, role: 'author', body: { decision: 'APPROVE', reason: '검증 완료' } })).rejects.toMatchObject({ status: 403 });
    const detail = await run('policyDetail', { params: { id: p.policyId }, role: 'approver' });
    expect(detail).toMatchObject({ hashMatchesValidation: true, approval: { eligible: true } });
    const ok = await run('decidePolicy', { params: { id: p.policyId }, role: 'approver', body: { decision: 'APPROVE', reason: '8종 GO 확인' } });
    expect(ok.policy).toMatchObject({ status: 'APPROVED', approvedBy: 'usr-approver' });
    // 배포 — F3 Feature라 Canary 5%에서 시작, 같은 flag의 이전 배포본은 RETIRED, 서명 게시본(OTA)
    const dep = await run('deployPolicy', { params: { id: p.policyId }, role: 'coordinator', body: { reason: '감속 시작 거리 조정판 배포' } });
    expect(dep).toMatchObject({ status: 'DEPLOYED', stageBasisPoints: 500, deployedBy: 'usr-coordinator', publicationId: 'PUB-00023' });
    const pols = (await run('listPolicies')).items;
    expect(pols.find((x: any) => x.policyId === 'POL-00022').status).toBe('RETIRED');
    const pub = (await run('publicationDetail', { params: { id: 'PUB-00023' } })).publication;
    expect(pub).toMatchObject({ kind: 'POLICY', channel: 'OTA', status: 'DISPATCHED', denominator: 6 });
    expect(pub.payload.desired).toBe(p.contentHash);
    // 차량 회신 — 통신되는 5대, 끊긴 1대는 전달 작업이 재시도 가능
    await vi.advanceTimersByTimeAsync(8000);
    const after = await run('publicationDetail', { params: { id: 'PUB-00023' } });
    expect(after.publication.confirmed).toBe(5);
    expect(after.delivery.state).toBe('RETRY_WAIT');
    expect(after.readbacks).toHaveLength(5);
    // 재전송(같은 OTA 작업) → 남은 차량 회신 → 확인 6/6
    await run('otaJobRetry', { params: { jobId: after.delivery.jobId }, role: 'operator', body: { reason: '통신 복구 차량 재전송' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await run('publicationDetail', { params: { id: 'PUB-00023' } })).publication).toMatchObject({ status: 'CONFIRMED', confirmed: 6 });
    // 확대 판정 — 배포자는 넓힐 수 없다(직무 분리), 다른 사람도 관측 24시간·중단 기준(열린 이상 ANM-00001) 전에는 거부
    await expect(run('stageRollout', { params: { id: p.policyId }, role: 'coordinator', body: { basisPoints: 2000, reason: '확대' } })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    const blocked = await run('stageRollout', { params: { id: p.policyId }, role: 'operator', body: { basisPoints: 2000, reason: '확대' } }).catch((e) => e);
    expect(blocked).toMatchObject({ status: 422, code: 'GUARD_FAILED' });
    expect(blocked.message).toContain('관측 기간');
    expect(blocked.message).toContain('ANM-00001');
    // 관측 기간이 지나고 이상 건을 조치(기각)하면 다른 사람이 넓힐 수 있다
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await run('dismissAnomaly', { params: { id: 'ANM-00001' }, role: 'operator', body: { reason: '현장 재현 안 됨 — 오보고' } });
    const wide = await run('stageRollout', { params: { id: p.policyId }, role: 'operator', body: { basisPoints: 2000, reason: '관측 완료 후 20% 확대' } });
    expect(wide.stageBasisPoints).toBe(2000);
    // 감사·이벤트 — 같은 흐름이 남는다
    const audit = (await run('audit', { query: { limit: 100 } })).items.map((a: any) => `${a.action}:${a.result}`);
    for (const a of ['POLICY_CREATE:ALLOWED', 'POLICY_VALIDATE:ALLOWED', 'VIRTUAL_VALIDATION:ALLOWED', 'POLICY_APPROVE:ALLOWED', 'POLICY_RETIRE:ALLOWED', 'POLICY_DEPLOY:ALLOWED', 'ROLLOUT_STAGE:FAILED', 'ROLLOUT_STAGE:ALLOWED', 'ANOMALY_DISMISS:ALLOWED']) expect(audit).toContain(a);
    // 운영 담당 알림 — 정책 배포(Control Point 상태 변경)
    const ops = await run('notifications', { role: 'operator', query: { limit: 200 } });
    expect(ops.items.some((n: any) => n.title.includes('care_00022_param 정책 배포'))).toBe(true);
    // 개정본·변경 이력
    expect((await run('policyRevisions', { params: { id: p.policyId } })).items).toHaveLength(1);
  });

  it('Unleash — 배포 정책의 계획(Canary 코호트)·동기화·차량별 대조가 같은 규칙', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const p = await run('createPolicy', { role: 'author', body: NEW });
    await run('runVirtual', { role: 'author', body: { policyId: p.policyId } });
    await run('validatePolicy', { params: { id: p.policyId }, role: 'author', body: {} });
    // 배포 전에는 내보낼 수 없다(UL-OSS)
    const before = await run('policyUnleash', { params: { id: p.policyId } });
    expect(before.plan.ready).toBe(false);
    expect((await run('syncUnleash', { params: { id: p.policyId }, role: 'coordinator', body: {} })).outcome).toBe('BLOCKED');
    await run('decidePolicy', { params: { id: p.policyId }, role: 'approver', body: { decision: 'APPROVE', reason: '검증 GO' } });
    await run('deployPolicy', { params: { id: p.policyId }, role: 'coordinator', body: { reason: 'Canary 배포' } });
    const view = await run('policyUnleash', { params: { id: p.policyId } });
    expect(view.plan.ready).toBe(true);
    // Canary 5% — 부분 롤아웃은 서명 코호트 목록(vehicleKey IN …), 지정 Canary 차량(ego-01·lead-01)은 늘 포함
    const cohort = view.plan.strategies[0].constraints.find((c: any) => c.contextName === 'vehicleKey');
    expect(cohort.values).toEqual(expect.arrayContaining(['ego-01', 'lead-01']));
    // 같은 flag의 앞 배포본(POL-00022)이 이미 반영돼 있다 — flag는 있고 새 정책의 태그만 다르다(unleashDrift)
    expect(view.drift).toEqual(expect.arrayContaining([`태그 fp-policy=${p.policyId}@r1 없음`]));
    const synced = await run('syncUnleash', { params: { id: p.policyId }, role: 'coordinator', body: {} });
    expect(synced.outcome).toBe('SYNCED');
    const fresh = await run('policyUnleash', { params: { id: p.policyId } });
    expect(fresh.drift).toEqual([]);
    expect(fresh.lastSync.response.outcome).toBe('SYNCED');
    // 차량별 대조 — 문맥 품질이 낮은 차량은 비교 제외, 나머지는 플랫폼 판단과 일치
    const ev = await run('unleashEvaluation', { params: { id: p.policyId } });
    expect(ev.summary.mismatch).toBe(0);
    expect(ev.summary.noContext).toBe(2);
    expect(ev.summary.agree).toBe(10);
  });
});

describe('롤백 — 요청·지정 승인·실행(재검증) → 차량 회신 → 완료', () => {
  it('스냅샷의 대기 요청(RBR-00002)을 승인·실행하면 복구 기준 버전이 다시 게시되고 회신으로 완료된다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // 미리보기(기록 없음) — 적용 가능, 영향 차량 2대
    const pv = await run('previewRollback', { role: 'operator', body: { deploymentId: 'PUB-00009', recovery: { policyId: 'POL-00004' }, scope: { featureIds: ['FEAT-00027'] } } });
    expect(pv).toMatchObject({ applicable: true, vins: ['TMA-NX4-0001', 'TMA-NX4-0002'] });
    // 진행 중 요청이 있으면 정책 상세의 되돌리기 요청은 409
    await expect(run('requestPolicyRollback', { params: { id: 'POL-00008' }, role: 'operator', body: { recovery: { policyId: 'POL-00004' }, expectedDeploymentId: 'PUB-00009', reason: '되돌리기', approvers: ['usr-opslead'] } })).rejects.toMatchObject({ status: 409 });
    // 지정 승인대상자만 — 다른 승인 역할(안전)은 403, 요청자 본인은 역할이 없어 403
    await expect(run('decideRollbackRequest', { params: { id: 'RBR-00002' }, role: 'quality', body: { decision: 'APPROVE', comment: '확인' } })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const ok = await run('decideRollbackRequest', { params: { id: 'RBR-00002' }, role: 'opslead', body: { decision: 'APPROVE', comment: '현장 의견 반영 승인' } });
    expect(ok).toMatchObject({ status: 'APPROVED', decision: { by: 'usr-opslead' } });
    const x = await run('executeRollbackRequest', { params: { id: 'RBR-00002' }, role: 'operator', body: {} });
    expect(x).toMatchObject({ status: 'RUNNING', mode: 'MANUAL', before: { policyId: 'POL-00008' }, after: { policyId: 'POL-00004' }, artifactId: 'PUB-00023' });
    await expect(run('executeRollbackRequest', { params: { id: 'RBR-00002' }, role: 'operator', body: {} })).rejects.toMatchObject({ status: 409 });
    const pols = (await run('listPolicies')).items;
    expect(pols.find((p: any) => p.policyId === 'POL-00004').status).toBe('DEPLOYED');
    expect(pols.find((p: any) => p.policyId === 'POL-00008').status).toBe('RETIRED');
    // 차량 회신 → 게시본 확인 → 실행 완료(성공)
    await vi.advanceTimersByTimeAsync(5000);
    const done = await run('rollbackExecution', { params: { id: x.executionId } });
    expect(done).toMatchObject({ status: 'COMPLETED', result: 'SUCCESS' });
    expect((await run('rollbacks')).items[0].executionId).toBe(x.executionId);
    const deps = (await run('rollbackDeployments')).items.find((d: any) => d.flagKey === 'ivi_00027_detail');
    expect(deps).toMatchObject({ deploymentId: 'PUB-00023', deployed: { policyId: 'POL-00004' }, publication: { status: 'CONFIRMED' } });
    const hist = await run('policyHistory', { params: { id: 'POL-00004' } });
    expect(hist.deployments[0]).toMatchObject({ publicationId: 'PUB-00023', current: true, rollbackExecutionId: x.executionId });
    // 결과 알림 — 요청자·승인자에게
    const bell = await run('notifications', { role: 'operator', query: { limit: 200 } });
    expect(bell.items.some((n: any) => n.eventType === 'rollback.completed')).toBe(true);
    // 감사 — 실행·정책 전환·결과(시스템)
    const audit = (await run('audit', { query: { limit: 100 } })).items;
    expect(audit.find((a: any) => a.action === 'ROLLBACK_RESULT')).toMatchObject({ actorId: 'system:rollback', result: 'ALLOWED' });
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['ROLLBACK_REQUEST_DECIDE', 'ROLLBACK_EXECUTE', 'POLICY_RETIRE', 'POLICY_DEPLOY']));
  });

  it('같은 값의 새 판 되돌리기 — 거부·승인 양쪽, 복구 후보·배포 목록은 서버 계산과 같고 실행하면 앞 판이 다시 게시된다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // 거부 — 지정 승인대상자(운영 리더)가 앞 판 되돌리기(RBR-00004)를 거부한다
    const no = await run('decideRollbackRequest', { params: { id: 'RBR-00004' }, role: 'opslead', body: { decision: 'REJECT', comment: '현장 확인 완료 — 되돌릴 필요 없음' } });
    expect(no).toMatchObject({ status: 'REJECTED', decision: { by: 'usr-opslead', decision: 'REJECT' } });
    await expect(run('executeRollbackRequest', { params: { id: 'RBR-00004' }, role: 'operator', body: {} })).rejects.toMatchObject({ status: 422, code: 'GUARD_FAILED' });
    // 시연 엔진이 다시 계산한 배포 목록·복구 후보 = 서버가 찍은 스냅샷(같은 값의 새 판 → 앞 판이 복구 후보)
    expect(await run('rollbackDeployments')).toEqual(snap('rollbacks_deployments'));
    const server = snap('rollbacks_deployments_PUB-00020');
    expect(server.candidates.map((c: any) => [c.policyId, c.eligible])).toEqual([['POL-00002', true]]);
    expect(await run('rollbackDeployment', { params: { deploymentId: 'PUB-00020' } })).toEqual(server);
    // 승인 → 실행 — 지금 판(POL-00022) RETIRED, 앞 판(POL-00002) 다시 DEPLOYED, 차량 값이 같은 내용으로 재서명 게시
    await run('decideRollbackRequest', { params: { id: 'RBR-00005' }, role: 'opslead', body: { decision: 'APPROVE', comment: '앞 판으로 되돌림 승인' } });
    const x = await run('executeRollbackRequest', { params: { id: 'RBR-00005' }, role: 'operator', body: {} });
    expect(x).toMatchObject({ status: 'RUNNING', before: { policyId: 'POL-00022' }, after: { policyId: 'POL-00002' }, artifactId: 'PUB-00023' });
    const pols = (await run('listPolicies')).items;
    expect(pols.find((p: any) => p.policyId === 'POL-00002').status).toBe('DEPLOYED');
    expect(pols.find((p: any) => p.policyId === 'POL-00022').status).toBe('RETIRED');
    const pub = (await run('publicationDetail', { params: { id: 'PUB-00023' } })).publication;
    const prev = snap('policies_POL-00002').policy;
    expect(pub.payload.desired).toBe(prev.contentHash);
    const value = (q: any) => ({ enabled: q.enabled, safeDefault: q.safeDefault, strategies: q.strategies, rollout: q.rollout });
    expect(value(pub.payload.policy)).toEqual(value(snap('rollbacks_deployments_PUB-00020').policyChanges[0].after));
    // 회신 — 끊긴 1대 재전송 뒤 모두 확인 → 완료(성공). 대기 목록에는 남은 요청만
    await vi.advanceTimersByTimeAsync(8000);
    const mid = await run('publicationDetail', { params: { id: 'PUB-00023' } });
    expect(mid.publication.confirmed).toBe(5);
    expect((await run('rollbackExecution', { params: { id: x.executionId } })).status).toBe('RUNNING');
    await run('otaJobRetry', { params: { jobId: mid.delivery.jobId }, role: 'operator', body: { reason: '통신 복구 차량 재전송' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await run('rollbackExecution', { params: { id: x.executionId } })).toMatchObject({ status: 'COMPLETED', result: 'SUCCESS' });
    expect((await run('rollbackRequests', { query: { status: 'REQUESTED' } })).items.map((r: any) => r.requestId)).toEqual(['RBR-00007', 'RBR-00006', 'RBR-00003', 'RBR-00002']);
    // 실행 이력 상태 거르기 — 서버 규칙(같은 상태)
    expect((await run('rollbacks', { query: { status: 'COMPLETED' } })).items.map((r: any) => r.executionId)).toEqual([x.executionId, 'RBX-00001']);
    expect((await run('rollbacks', { query: { status: 'REQUESTED' } })).items).toEqual([]);
  });

  it('쓰기 전에도 실행 이력 상태 거르기는 오류가 아니다 — 기본 목록을 서버 규칙(같은 상태)으로 거른다', async () => {
    // 회귀(2026-11-06): /ops/rollback 상태 필터(요청 등)를 고르면 질의 스냅샷이 없어 오류 상자가 떴다(list-filter rollbacks)
    const all = snap('rollbacks').items;
    for (const status of ['REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED']) expect((await run('rollbacks', { query: { status } })).items).toEqual(all.filter((x: any) => x.status === status));
    expect((await run('rollbacks', { query: { result: 'SUCCESS' } })).items.map((x: any) => x.executionId)).toEqual(['RBX-00001']);
  });

  it('복구할 수 없는 버전은 재검증에서 막히고(422) 거부도 감사에 남는다', async () => {
    const pv = await run('previewRollback', { role: 'operator', body: { deploymentId: 'PUB-00002', recovery: { policyId: 'POL-00001' }, scope: { featureIds: ['FEAT-00022'] } } });
    expect(pv.applicable).toBe(false);
    expect(pv.blockers.map((b: any) => b.code)).toEqual(expect.arrayContaining(['RECOVERY_OTHER_FLAG']));
    await expect(run('createRollbackRequest', { role: 'operator', body: { deploymentId: 'PUB-00002', targetTypes: ['POLICY_VERSION'], recovery: { policyId: 'POL-00001' }, scope: { featureIds: ['FEAT-00022'] }, reason: '되돌리기', approvers: ['usr-opslead'] } })).rejects.toMatchObject({ status: 422 });
    // 요청자를 승인대상자로 지정하면 직무 분리
    await expect(run('createRollbackRequest', { role: 'operator', body: { deploymentId: 'PUB-00009', targetTypes: ['POLICY_VERSION'], recovery: { policyId: 'POL-00004' }, scope: { featureIds: ['FEAT-00027'] }, reason: '되돌리기', approvers: ['usr-operator'] } })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    const failed = (await run('audit', { query: { limit: 100 } })).items.filter((a: any) => a.result === 'FAILED').map((a: any) => a.action);
    expect(failed.slice(0, 2)).toEqual(['ROLLBACK_REQUEST', 'ROLLBACK_REQUEST']);
  });
});

describe('이상 대응·사후 검토·레거시 해제', () => {
  it('이상 건 확인 → 조치(닫힘), 닫힌 건은 다시 확인할 수 없다', async () => {
    const a = await run('acknowledgeAnomaly', { params: { id: 'ANM-00005' }, role: 'operator', body: { reason: '재전송 대상 확인' } });
    expect(a).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: 'usr-operator' });
    await expect(run('acknowledgeAnomaly', { params: { id: 'ANM-00005' }, role: 'operator', body: { reason: '다시' } })).rejects.toMatchObject({ status: 422 });
    const m = await run('mitigateAnomaly', { params: { id: 'ANM-00005' }, role: 'operator', body: { reason: '재전송으로 회신 확보' } });
    expect(m).toMatchObject({ status: 'MITIGATED', closedBy: 'usr-operator' });
    expect((await run('anomalies', { query: { status: 'OPEN' } })).items.map((x: any) => x.anomalyId)).not.toContain('ANM-00005');
    expect((await run('anomalyDetail', { params: { id: 'ANM-00005' } })).status).toBe('MITIGATED');
  });
  it('사후 독립 검토 — 승인자는 검토할 수 없고, 독립 검토는 한 번만', async () => {
    // Fixture facts are captured at checkedAt. Wall-clock time would legitimately turn PENDING into OVERDUE.
    // Only this case fixes Date; the existing afterEach restores real timers even when an assertion fails.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(snap('audit_chain').checkedAt));
    await expect(run('recordKillPostReview', { params: { id: 'KILL-00001' }, role: 'quality', body: { summary: '승인 근거 확인' } })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    const r = await run('recordKillPostReview', { params: { id: 'KILL-00001' }, role: 'viewer', body: { summary: '긴급 권한 사용 근거·범위 적정' } });
    expect(r).toMatchObject({ status: 'REVIEWED', review: { reviewer: 'usr-viewer', role: 'AUDITOR' } });
    await expect(run('recordKillPostReview', { params: { id: 'KILL-00001' }, role: 'viewer', body: { summary: '다시 검토' } })).rejects.toMatchObject({ status: 409 });
    expect((await run('iamSodAudit')).postReviews).toMatchObject({ issued: 3, reviewed: 1, pending: 2 });
  });
  it('v2 차단은 혼자 해제할 수 없다 — 409와 실패 감사', async () => {
    await expect(run('releaseKill', { params: { id: 'KILL-00001' }, role: 'operator', body: { reason: '현장 조치 완료' } })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    const audit = (await run('audit', { query: { limit: 100 } })).items;
    expect(audit[0]).toMatchObject({ action: 'KILL_RELEASE', result: 'FAILED', componentId: 'D03-04' });
  });
});
