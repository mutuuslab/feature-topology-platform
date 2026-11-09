// 전시 빈 화면 채우기(ShowcaseFillSeeder, 2026-11-05) — 공개 정적 데모 감사에서 '표본 없음'·빈 표로 보이던 화면의 조회 API가
// 시드 뒤 비어 있지 않은지 본다. 데이터는 담당자의 실제 서비스 경로로 만든다(감사·이벤트·불변식 유지).
// 차량 회신(배포·차단·복원)을 기다리므로 실제 시계로 띄우고, 시뮬레이터 시간은 줄인다(모듈을 읽기 전에).
// 회신 기한(PUBLICATION_TIMEOUT_MS·KILL_TIMEOUT_MS)은 줄이지 않는다 — 제품 기본값 그대로(공개 시드와 같은 조건, 시험 결정성 deadline-wait 2026-11-06)
import { vi } from 'vitest';
vi.hoisted(() => {
  // 가상검증 실행기 — 같은 계약의 시험 대역(e2e·정적 스냅샷과 같다). 가상검증 대상 Feature의 새 판도 8종 검증 GO를 받는다
  process.env.CARLA_RUNNER = `${process.cwd()}/test/fixtures/fake-carla/ffcarla_cli.mjs`;
  process.env.FF_EVIDENCE_DIR = `${process.cwd()}/../.evidence/test-showcase-fill`;
  Object.assign(process.env, { GLEO_MODE: 'internal', FLEET_SIM_TIME_SCALE: '0.2', FLEET_SIM_LATENCY_MS: '100', FLEET_SIM_STAGGER_MS: '1', FLEET_SIM_IDLE_MS: '300', FLEET_SIM_CYCLE_MS: '400' });
  delete process.env.FF_SCHEDULER;
});
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { simStagger } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { HERO, HERO_HOURS, HERO_SIGNAL, SHOWCASE_FILL_META, ShowcaseFillSeeder, showcaseFillEnabled } from '../../src/demo-activity/showcase-fill.seeder';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const OPS = actor('usr-operator', 'OPERATOR');
const REG = actor('usr-steward', 'REGULATORY_OWNER');
const COST = actor('usr-viewer', 'COST_ESTIMATOR');
const H = 3600_000;

/**
 * 시연 주인공(2026-11-06 사용자 결정, Flag 노출 계획 G2·G3·G4) — 기본 시드·전시 모두 같은 이야기:
 * 첫 판 → 개정판 Canary 5% → 관측 24 h마다 25%·50%(넓힌 사람 ≠ 배포한 사람) → 적용군 DTC → 이상 징후 → 단계 축소·적용군 차단
 * → 개선 Version 4.1.1(등록 → Flag 코드 MR → 검증 → 승인, 같은 Flag 키) → 재검증 근거로 복원 요청
 */
async function expectHero(get: (path: string, who?: Record<string, string>) => Promise<any>) {
  const all = (await get('/api/policies', OPS)).items as { policyId: string; flagKey: string; featureVersion: string; status: string; stageBasisPoints: number | null; rollout: { mode: string; basisPoints: number }; deployedBy?: string; deployedAt?: string; approvedAt?: string; createdAt: string }[];
  const mine = all.filter((p) => p.flagKey === HERO.flagKey);
  const live = mine.find((p) => p.status === 'DEPLOYED')!;
  expect(live.featureVersion).toBe(HERO.version);
  expect(live.rollout).toMatchObject({ mode: 'COHORT', basisPoints: HERO.cohort });
  // 지금은 문제 감지 뒤 Canary 5%로 줄였다(승인 범위 50%는 그대로)
  expect(live.stageBasisPoints).toBe(500);
  expect(mine.filter((p) => p.featureVersion === HERO.version && p.status === 'RETIRED')).toHaveLength(1);
  // 단계 이력 — 실제 판정(관측 기간·중단 기준)을 통과한 확대 2건과 축소 1건. 넓힌 사람(운영)은 배포한 사람(출시)이 아니다
  const stages = ((await get(`/api/audit?target=${live.policyId}&action=ROLLOUT_STAGE&limit=10`, REG)).items as { at: string; actorId: string; result: string; after: { stage: number; kind: string; criteria: { observedMs: number; requiredMs: number } | null } }[])
    .filter((a) => a.result === 'ALLOWED')
    .sort((a, b) => a.at.localeCompare(b.at));
  expect(stages.map((a) => a.after.stage)).toEqual([2500, 5000, 500]);
  expect(stages.map((a) => a.after.kind)).toEqual(['EXPAND', 'EXPAND', 'SHRINK']);
  for (const a of stages.slice(0, 2)) expect(a.after.criteria!.observedMs).toBeGreaterThanOrEqual(a.after.criteria!.requiredMs);
  expect(new Set(stages.map((a) => a.actorId))).toEqual(new Set(['usr-operator']));
  expect(live.deployedBy).toBe('usr-coordinator');
  // 지난 시각으로 실제 경로를 돌았다 — 작성 < 검증 < 승인 < 배포 < 25% < 50%
  const detail = await get(`/api/policies/${live.policyId}`, OPS);
  expect(detail.lastRun.decision).toBe('GO');
  const order = [live.createdAt, detail.lastRun.at, live.approvedAt!, live.deployedAt!, stages[0].at, stages[1].at];
  expect([...order].sort()).toEqual(order);
  expect(Date.parse(stages[1].at) - Date.parse(stages[0].at)).toBeGreaterThanOrEqual(24 * H);
  // 문제 감지 — 적용군 DTC 보고 → 이상 징후(긴급 차단으로 조치됨)
  const anomaly = ((await get(`/api/anomalies?featureId=${HERO.featureId}&kind=FEATURE_FAULT`, OPS)).items as { anomalyId: string; status: string; killId: string | null; signals: { code: string }[]; vins: string[] }[])[0];
  expect(anomaly).toBeTruthy();
  expect(anomaly.status).toBe('MITIGATED');
  expect(anomaly.signals.every((s) => s.code === HERO_SIGNAL.dtc)).toBe(true);
  // 긴급 차단 — 적용군 차량, 이상 건 연결, 진행 중(복원은 4.1.1 재검증 근거로 승인 대기)
  const kill = ((await get('/api/kill-requests', OPS)).items as { killId: string; featureId: string; featureVersion: string; status: string; anomalyId: string | null; flagKeys: string[]; vins: string[] }[]).find((k) => k.featureId === HERO.featureId)!;
  expect(kill).toMatchObject({ featureVersion: HERO.version, status: 'ACTIVE', anomalyId: anomaly.anomalyId });
  expect(kill.killId).toBe(anomaly.killId);
  expect(kill.flagKeys).toContain(HERO.flagKey);
  expect(kill.vins.length).toBeGreaterThan(0);
  // 배포는 차단 발령(지금)보다 70시간 넘게 앞 — 지난 시각으로 실제 경로를 돌았다(기록된 시각끼리 비교)
  expect(Date.parse((kill as unknown as { requestedAt: string }).requestedAt) - Date.parse(live.deployedAt!)).toBeGreaterThan((HERO_HOURS.now - HERO_HOURS.liveDeploy - 1) * H);
  const killDetail = await get(`/api/kill-requests/${kill.killId}`, OPS);
  expect(killDetail.restoreRequest).toMatchObject({ status: 'REQUESTED', evidenceRef: expect.stringContaining('4.1.1'.replace(/\./g, '')) });
  // 개선 Version 4.1.1 — 정의 승인, 같은 Flag 키의 정책 승인(재배포 대기), 구현 MR
  const next = await get(`/api/features/${HERO.featureId}/versions/${HERO.next}`, OPS);
  // 정의 승인(APPROVED) 뒤 개발 착수 — 보정 구현 MR과 Control Gate(G4) 근거가 있다
  expect(next.feature.lifecycle).toBe('DEVELOPING');
  const nextPolicy = mine.find((p) => p.featureVersion === HERO.next)!;
  expect(nextPolicy.status).toBe('APPROVED');
  const trace = await get(`/api/integrations/sync/features/${HERO.featureId}/${HERO.next}`, OPS);
  expect(JSON.stringify(trace)).toContain(HERO.flagKey);
}

describe('시뮬레이터 회신 간격', () => {
  it('대상이 많아도 마지막 회신이 게시본 기한 안에 든다(전시 480대·기한 8초)', () => {
    const gap = simStagger(480, 8000, 350, 120);
    expect(350 + 479 * gap).toBeLessThan(8000);
    // 적은 대상은 원래 간격 그대로(시연 화면에서 집계가 차오르는 모습)
    expect(simStagger(12, 8000, 350, 120)).toBe(120);
  });
});

describe('전시 빈 화면 채우기 — 켜짐 조건', () => {
  it('데모 활동과 같은 조건(FF_SEED=none·운영 모드·FF_DEMO_ACTIVITY=0이면 끔), FF_SHOWCASE_FILL=0은 이것만 끈다', () => {
    expect(showcaseFillEnabled({ FF_SEED: 'v0.81' })).toBe(true);
    expect(showcaseFillEnabled({ FF_SEED: 'none', FF_DEMO_ACTIVITY: '1' })).toBe(false);
    expect(showcaseFillEnabled({ FF_ENV: 'production', FF_SEED: 'v0.81', FF_DEMO_ACTIVITY: '1' })).toBe(false);
    expect(showcaseFillEnabled({ FF_DEMO_ACTIVITY: '0' })).toBe(false);
    expect(showcaseFillEnabled({ FF_SHOWCASE_FILL: '0' })).toBe(false);
  });
});

describe('전시 빈 화면 채우기 — 데모 활동·전시 시나리오와 함께 부팅', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const get = async (path: string, who: Record<string, string> = {}) => (await b.http().get(path).set(who).expect(200)).body;
  const previousScale=process.env.FF_SHOWCASE_SCALE,previousVehicles=process.env.FF_SHOWCASE_VEHICLES;
  beforeAll(async () => {
    // Keep >300 real simulated vehicle checks with a single-size fixture; publication verifies doubled data.
    process.env.FF_SHOWCASE_SCALE='1';process.env.FF_SHOWCASE_VEHICLES='480';
    process.env.FF_SHOWCASE = '1';
    b = await bootApp({ demoActivity: true, costDemo: true });
  }, 180_000);
  afterAll(async () => {
    await b?.app.close();
    for (const k of ['FF_SHOWCASE', 'FF_DEMO_ACTIVITY']) delete process.env[k];
    if(previousScale===undefined)delete process.env.FF_SHOWCASE_SCALE;else process.env.FF_SHOWCASE_SCALE=previousScale;
    if(previousVehicles===undefined)delete process.env.FF_SHOWCASE_VEHICLES;else process.env.FF_SHOWCASE_VEHICLES=previousVehicles;
  });

  it('모든 단계가 성공하고 meta에 요약이 남는다', () => {
    const run = b.get(ShowcaseFillSeeder).lastRun!;
    expect(Object.entries(run).filter(([, v]) => !v.ok)).toEqual([]);
    expect(b.get<Db>(DB).get('SELECT 1 FROM meta WHERE key = ?', SHOWCASE_FILL_META)).toBeTruthy();
  });

  it('Safety KPI — 배포 중 Version마다 적용 지연·on-board 고장 비율 표본이 있다', async () => {
    const kpi = (await get('/api/safety-kpi')).items as { featureId: string; metrics: { id: string; value: number | null }[] }[];
    expect(kpi.length).toBeGreaterThanOrEqual(5);
    for (const k of kpi) {
      const v = Object.fromEntries(k.metrics.map((m) => [m.id, m.value]));
      expect(v.KILL_LATENCY_P95, k.featureId).not.toBeNull();
      expect(v.ONBOARD_FAULT_RATIO, k.featureId).not.toBeNull();
    }
  });

  it('Feature DB — 발행 대기·발행됨·반려 변경 요청, 검토 의견, 기준 행을 쓰는 Feature', async () => {
    const changes = (await get('/api/refdb/changes')).items as { status: string; reviews: unknown[] }[];
    expect(new Set(changes.map((c) => c.status))).toEqual(expect.objectContaining(new Set(['APPROVED', 'PUBLISHED', 'REJECTED', 'REVIEW'])));
    for (const s of ['APPROVED', 'PUBLISHED', 'REJECTED']) expect(changes.filter((c) => c.status === s).every((c) => c.reviews.length > 0)).toBe(true);
    for (const refId of ['CH-BRK-009', 'CH-BRK-001', 'AD-ADS-001', 'AD-ADS-010']) expect((await get(`/api/refdb/refs/${refId}`)).usedBy.length, refId).toBeGreaterThan(0);
  });

  it('정책·되돌리기 — 새로 배포한 정책마다 되돌릴 수 있는 버전, 걸린 요청·계획, 근거 변경요청', async () => {
    const deployments = (await get('/api/rollbacks/deployments')).items as { flagKey?: string; policy?: { flagKey: string }; eligible: number }[];
    const flag = (d: (typeof deployments)[number]) => d.flagKey ?? d.policy?.flagKey;
    for (const key of ['ivi_00030_detail', 'adas_00004_assist', 'care_00023_limit', 'ivi_00027_detail']) expect(deployments.find((d) => flag(d) === key)?.eligible, key).toBeGreaterThan(0);
    expect((await get('/api/rollback-requests?status=REQUESTED')).items.length).toBeGreaterThanOrEqual(2);
    expect((await get('/api/rollback-plans?status=REQUESTED')).items.length).toBeGreaterThanOrEqual(2);
    const policies = (await get('/api/policies')).items as { policyId: string }[];
    for (const p of policies) expect((await get(`/api/policies/${p.policyId}/ext-links`)).items.some((l: { kind: string }) => l.kind === 'CHANGE_REQUEST'), p.policyId).toBe(true);
  });

  it('차량 — 정책이 있는 적용 범위의 연결 차량은 모두 게시본을 받았고, 기본 차량에 상태 보고 v2·현장 차단·장애 이력이 있다', async () => {
    const vehicles = (await get('/api/vehicles')).items as { vin: string; link: string; country: string; vehicleModel: string; trim: string }[];
    const covered = new Set(['KR|NX4 PE|Premium', 'EU|NX4 PE|Ultimate', 'US|NX4 PE|Limited', 'KR|GN7|Calligraphy']);
    const online = vehicles.filter((v) => v.link === 'ONLINE' && covered.has(`${v.country}|${v.vehicleModel}|${v.trim}`));
    expect(online.length).toBeGreaterThan(300);
    const empty: string[] = [];
    const noStatus: string[] = [];
    for (const v of online) {
      if (!Object.keys((await get(`/api/vehicles/${v.vin}/runtime`, OPS)).runtime.bundles).length) empty.push(v.vin);
      if (!(await get(`/api/vehicles/${v.vin}/status`, OPS)).features.length) noStatus.push(v.vin);
    }
    expect(empty).toEqual([]);
    expect(noStatus).toEqual([]);
    expect((await get('/api/vehicles/ego-01/status', OPS)).features.length).toBeGreaterThan(0);
    // 전시 차량은 모두 사용 권한이 있다(지원 상품이 있는 범위 — 없던 차량은 체험 제안)
    const noGrant: string[] = [];
    for (const v of vehicles.filter((x) => x.vin.startsWith('SHOWCASE-'))) if (!b.get(FleetRepo).grants(v.vin).length) noGrant.push(v.vin);
    expect((await get('/api/fleet/map/vehicles/SHOWCASE-0012', OPS)).grants.length).toBeGreaterThan(0);
    expect(noGrant).toEqual([]);
    const field = await get('/api/field/vehicles/ego-01', OPS);
    expect(field.kills.length).toBeGreaterThan(0);
    expect(field.incidents.some((i: { status: string }) => i.status === 'LINKED')).toBe(true);
    expect((await get('/api/anomalies/ANM-00001', OPS)).vins).toContain('ego-01');
  }, 60_000);

  it('데이터·규제·감독·산정·협의 기록', async () => {
    const act = await get('/api/data-access-requests', REG);
    expect(act.requests.length).toBeGreaterThanOrEqual(2);
    expect(act.contractBasis.length).toBeGreaterThanOrEqual(1);
    expect((await get('/api/change-records')).items.some((c: { findings: unknown[] }) => !c.findings.length)).toBe(true);
    expect((await get('/api/cost/projects/EST-0001', COST)).approvals.length).toBeGreaterThan(0);
    expect((await get('/api/consultations/CON-2026-006')).consultation.opinions.length).toBeGreaterThan(0);
  });

  it('Feature 상세 — 목록 첫 Feature에 Flag·분석 근거·감사 이력(이 Version 아래 대상 포함)', async () => {
    expect((await get('/api/feature-flags?featureId=FEAT-00001&version=2.2.0')).length).toBeGreaterThan(0);
    const an = await get('/api/features/FEAT-00001/versions/2.2.0/analysis');
    for (const k of ['HARA', 'TARA', 'SOTIF', 'HOMOLOGATION']) expect(an.current[k], k).toBeTruthy();
    expect((await get('/api/audit?targetPrefix=FEAT-00001%402.2.0&limit=100')).items.length).toBeGreaterThan(0);
    expect((await get('/api/features/FEAT-00145/versions/5.4.2/analysis')).current.HARA).toBeTruthy();
    expect((await get('/api/features/FEAT-00022/versions/1.0.0')).dependencies.incoming.length).toBeGreaterThan(0);
  });

  // 회귀(2026-11-06 정적 데모): 커널 시드가 배포 상태로 넣은 정책은 검증 기록이 없어 정책 상세 '분야별 검증 8종'이 비었다
  it('사후 검증 — 배포된 정책은 모두 8종 검증 기록이 있고, 정책 값·게시본은 그대로다', async () => {
    const list = (await get('/api/policies', OPS)).items as { policyId: string; status: string }[];
    for (const p of list.filter((x) => x.status === 'DEPLOYED')) {
      const d = await get(`/api/policies/${p.policyId}`, OPS);
      expect(d.lastRun, `${p.policyId} 검증 기록`).toBeTruthy();
      expect(d.lastRun.results).toHaveLength(8);
      expect(d.hashMatchesValidation).toBe(true);
      expect(d.policy.status).toBe('DEPLOYED');
    }
    // 사후 검증은 정책 문서를 고치지 않는다 — 서명 게시본이 정책 문서 전체를 담는다(Unleash 반영의 '서명 게시본과 같은 정책' 판정)
    expect((await get('/api/policies/POL-00001', OPS)).policy.lastValidationId).toBeNull();
  });

  // 회귀(2026-11-06 정적 데모): 커널 시드·데모 활동의 첫 배포 Flag는 앞 판이 없어 '복구 가능한 버전 없음'·'진행 중인 되돌리기 없음'이었다
  it('같은 값의 새 판 — 배포 Flag마다 복구 가능한 앞 판과 승인 대기 되돌리기 요청, 정책 값은 같다', async () => {
    const deployments = (await get('/api/rollbacks/deployments', OPS)).items as { flagKey: string; eligible: number; deployed: { policyId: string } }[];
    for (const d of deployments) expect(d.eligible, d.flagKey).toBeGreaterThan(0);
    for (const key of ['care_00022_signal', 'care_00022_param', 'ivi_00024_guide', 'ivi_00027_banner']) {
      const d = deployments.find((x) => x.flagKey === key)!;
      const h = await get(`/api/policies/${d.deployed.policyId}/history`, OPS);
      expect(h.requests.some((r: { status: string }) => r.status === 'REQUESTED'), key).toBe(true);
      const versions = h.versions as { policyId: string; current: boolean }[];
      const prev = versions.find((v) => !v.current)!;
      const [a, b] = await Promise.all([get(`/api/policies/${prev.policyId}`, OPS), get(`/api/policies/${d.deployed.policyId}`, OPS)]);
      for (const k of ['enabled', 'safeDefault', 'entitlementCatalogId', 'strategies', 'rollout', 'controlPoint']) expect(b.policy[k], `${key} ${k}`).toEqual(a.policy[k]);
    }
    // 시연 정책(F2)의 새 판은 Canary(5%)에서 시작하고(FFG-LCY-009), 앞 판(부팅 동기화 게시본)이 복구 후보다
    const signal = deployments.find((x) => x.flagKey === 'care_00022_signal')!;
    expect((await get(`/api/policies/${signal.deployed.policyId}`, OPS)).policy.stageBasisPoints).toBe(500);
    expect((await get(`/api/policies/${signal.deployed.policyId}/history`, OPS)).versions.find((v: { policyId: string }) => v.policyId === 'POL-00001').rollback.eligible).toBe(true);
    // Unleash 정의도 지금 효력 범위(Canary 코호트)만 고른다 — 차량별 대조 불일치 0
    const ev = await get(`/api/policies/${signal.deployed.policyId}/unleash/evaluation`, OPS);
    expect(ev.summary.mismatch).toBe(0);
    // 새 게시본은 Canary 코호트 차량에서도 회신이 들어온다(효력 ON인 차량)
    const on = new Set((ev.rows as { vin: string; platform: boolean | null }[]).filter((r) => r.platform).map((r) => r.vin));
    expect(on.size).toBeGreaterThan(0);
    const pubId = (await get(`/api/policies/${signal.deployed.policyId}/history`, OPS)).deploymentId as string;
    const replies = (await get(`/api/telemetry/readbacks?publicationId=${pubId}`, OPS)).items as { vin: string }[];
    expect(replies.some((r) => on.has(r.vin)), 'Canary 차량 회신').toBe(true);
  });

  // 회귀(2026-11-06 정적 데모): 데이터셋 상품은 승인자가 없어 '승인 기록 없음'이었다 — 데이터셋 이력과 새 버전의 실제 승인
  it('상품 승인 — 데이터셋 상품마다 작성자·구성 승인자(출시 상품은 고객 출시 승인자), 대표 상품 새 버전은 실제 승인 절차', async () => {
    const list = (await get('/api/products')).items as { catalogId: string; version: string; lifecycle: string }[];
    for (const p of list.filter((x) => x.lifecycle !== 'PROPOSED')) {
      const { meta } = await get(`/api/products/${p.catalogId}/versions/${p.version}`);
      expect(meta.createdBy, `${p.catalogId}@${p.version}`).toBeTruthy();
      expect(meta.configApprovedBy, `${p.catalogId}@${p.version}`).toBeTruthy();
      if (['RELEASED', 'DEPRECATED', 'RETIRED'].includes(p.lifecycle)) expect(meta.releaseApprovedBy).not.toBe(meta.configApprovedBy);
    }
    expect((await get('/api/products/CAT-00001/versions/3.0.0')).meta).toMatchObject({ createdBy: 'usr-commerce', configApprovedBy: 'usr-approver' });
    expect((await get('/api/products/CAT-00015/versions/1.2.0')).meta).toMatchObject({ configApprovedBy: 'usr-approver', releaseApprovedBy: 'usr-productowner' });
    const audit = (await get('/api/audit?target=CAT-00001%403.0.0&limit=20', REG)).items as { action: string }[];
    expect(audit.some((a) => a.action === 'PRODUCT_APPROVAL_IMPORT')).toBe(true);
  });

  // 회귀(2026-11-06 정적 데모): 새 설치에는 보존 기간이 지난 행이 없어 '삭제 기록'이 비었다
  it('보존·삭제 — 기간(30일)이 지난 차량 발신 기록을 보존 작업이 지운 삭제 기록이 있다', async () => {
    const r = await get('/api/retention', REG);
    const del = (r.deletions as { store: string; deleted: number }[]).find((x) => x.store === 'vehicle_request');
    expect(del?.deleted).toBeGreaterThan(0);
  });

  it('시연 주인공 — 단계 이력 5→25→50%, 문제 감지·긴급 차단, 개선 Version 4.1.1', async () => {
    await expectHero(get);
  });

  it('같은 DB에서 다시 부르면 아무것도 하지 않는다', async () => {
    const before = (await get('/api/policies')).items.length;
    expect(await b.get(ShowcaseFillSeeder).run()).toBeNull();
    expect((await get('/api/policies')).items.length).toBe(before);
  });
});

describe('시연 주인공 — 기본 시드(전시 없이)에서도 같은 이야기', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const get = async (path: string, who: Record<string, string> = {}) => (await b.http().get(path).set(who).expect(200)).body;
  beforeAll(async () => {
    delete process.env.FF_SHOWCASE;
    b = await bootApp({ demoActivity: true });
  }, 180_000);
  afterAll(async () => {
    await b?.app.close();
    delete process.env.FF_DEMO_ACTIVITY;
  });

  it('주인공 단계 이력·문제 감지·차단·개선 Version', async () => {
    expect(Object.entries(b.get(ShowcaseFillSeeder).lastRun!).filter(([, v]) => !v.ok)).toEqual([]);
    await expectHero(get);
  });
});
