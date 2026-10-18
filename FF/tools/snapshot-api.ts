// npm run snapshot:api — 정적 데모(Cloudflare, VITE_DATA_MODE=static)용 GET 응답 스냅샷.
// 빌드된 백엔드를 보조 포트에 띄워(메모리 DB·v0.81 시드) v2 화면이 실제로 보내는 요청 모양 그대로 받아 둔다.
// 요청 URL·파일 이름 규칙은 @ff/contracts의 routeUrl·snapshotFile 하나를 프론트와 공유한다.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
const { ROUTES, routeUrl, snapshotFile, LIFECYCLE, TRIAL_STATES, SEGMENT_DIMENSIONS, trialListQuery, trialAnalyticsQuery } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const PORT = Number(process.env.SNAPSHOT_PORT ?? 9199); // 8000 금지
const BASE = `http://localhost:${PORT}`;
const OUT = join(FF, 'frontend', 'public');

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], {
  env: { ...process.env, PORT: String(PORT), FF_DB: ':memory:', FF_SEED: 'v0.81' },
  stdio: 'ignore',
});

// 역할이 걸린 조회(보안 이벤트·Data Act·차량 상태 등)는 그 경로가 허용하는 첫 역할로 받는다 — 정적 데모는 읽기 전용 공개본이다
async function get<T = any>(url: string, name?: string): Promise<T> {
  const role = (ROUTES.find((x: { name: string }) => x.name === name) as { roles?: string[] } | undefined)?.roles?.[0];
  const r = await fetch(BASE + url, { headers: role ? { 'X-Actor-Id': 'usr-snapshot', 'X-Actor-Role': role } : {} });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      await get('/api/health');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  rmSync(join(OUT, 'api-snapshot'), { recursive: true, force: true });
  let n = 0;
  const save = async (name: string, params: Record<string, string> = {}, query: Record<string, any> = {}) => {
    const url = routeUrl(name, params, query);
    const body = await get(url, name);
    const file = join(OUT, snapshotFile(url));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    n++;
    return body;
  };

  // 공통
  await save('health');
  await save('components');
  await save('precheck');
  await save('events', {}, { limit: 500 });
  await save('audit', {}, { limit: 500 });

  // Feature Registry 목록 — FeatureList의 질의 모양: { q, lifecycle, country, latestOnly }
  const all = await save('listFeatures', {}, { latestOnly: false });
  await save('listFeatures', {}, { latestOnly: true });
  for (const latestOnly of [true, false]) {
    for (const lifecycle of LIFECYCLE) await save('listFeatures', {}, { lifecycle, latestOnly });
    for (const country of Object.keys(all.facets.country)) await save('listFeatures', {}, { country, latestOnly });
  }

  // Feature Version 상세·Gate·체크리스트·감사·영향
  for (const f of all.items as { featureId: string; version: string }[]) {
    const p = { id: f.featureId, ver: f.version };
    await save('featureDetail', p);
    await save('gates', p);
    await save('baselineChecklist', p);
    await save('audit', {}, { target: `${f.featureId}@${f.version}`, limit: 100 });
    await save('impact', p);
  }
  // Feature 요약 서랍(FeaturePeek) — Version 없이 열면 최신 Version을 이 응답에서 고른다
  for (const id of new Set((all.items as { featureId: string }[]).map((f) => f.featureId))) await save('featureVersions', { id });

  // BOM·Catalog
  await save('baselineRequests');
  await save('baselines');
  const products = await save('listProducts');
  for (const p of products.items) await save('productDetail', { id: p.catalogId, ver: p.version });
  const scopes = new Set((all.items as any[]).map((f) => `${f.country}|${f.vehicleModel}|${f.trim}`));
  for (const s of scopes) {
    const [country, vehicleModel, trim] = s.split('|');
    await save('productCandidates', {}, { country, vehicleModel, trim });
  }
  // 정책·검증·사용 권한·활성화 판단 (PoC ②③) — ActivationScreen은 차량 × 배포 flagKey 조합을 모두 묻는다
  const policies = await save('listPolicies');
  await save('listPolicies', {}, { status: 'DEPLOYED' });
  for (const p of policies.items) {
    await save('policyDetail', { id: p.policyId });
    // 정책 상세의 버전 이력 — 목록과 변경 이력(버전 내용은 행을 열 때 읽으므로 개정본마다)
    const revs = await save('policyRevisions', { id: p.policyId });
    await save('policyChanges', { id: p.policyId });
    for (const r of revs.items) await save('policyRevision', { id: p.policyId, revision: String(r.revision) });
  }
  await save('validations');
  await save('entitlements');
  // 체험권 차량 목록(상태별 첫 쪽)·체험 전환 분석(나눠 보기 기준별) — 화면과 같은 질의 함수로 키를 맞춘다
  for (const source of ['ALL', 'DEMO', 'SYNTHETIC'] as const) {
    for (const state of ['', ...TRIAL_STATES]) await save('trials', {}, trialListQuery({ catalogId: 'CAT-00019', source, state }));
    for (const groupBy of ['', ...SEGMENT_DIMENSIONS]) {
      await save('trialAnalytics', {}, trialAnalyticsQuery({ catalogId: 'CAT-00019', source, groupBy }));
      // 기간 1년·5년 — 26주(기본)는 요청에 넣지 않는다
      for (const weeks of [52, 260]) await save('trialAnalytics', {}, { ...trialAnalyticsQuery({ catalogId: 'CAT-00019', source, groupBy }), weeks });
    }
  }
  const vehicles = await save('vehicles');
  const flagKeys = [...new Set((policies.items as { flagKey: string; status: string }[]).filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))];
  for (const v of vehicles.items) for (const flagKey of flagKeys) await save('activationDecide', {}, { vin: v.vin, flagKey });
  // 배포·차단 전달 (PoC ④⑥) — 부팅 동기화 게시본이 차량에 닿은 뒤의 상태를 찍는다
  await new Promise((r) => setTimeout(r, 2500));
  await save('fleetRuntime');
  // 전세계 차량 지도(D02-03) — 정적 데모는 찍은 시점 위치로 멈춰 있다(5초 갱신 없음)
  await save('fleetPopulation');
  const fm = await save('fleetMap', {}, { source: 'DEMO' });
  for (const flagKey of fm.flagKeys) await save('fleetMap', {}, { source: 'DEMO', flagKey });
  for (const c of fm.catalogs) await save('fleetMap', {}, { source: 'DEMO', catalogId: c.catalogId });
  const fs = await save('fleetMap', {}, { source: 'SYNTHETIC' });
  for (const c of fs.catalogs) await save('fleetMap', {}, { source: 'SYNTHETIC', catalogId: c.catalogId });
  for (const v of fm.items) await save('fleetMapVehicle', { vin: v.vin });
  await save('gleoStatus');
  await save('pkiKeys');
  for (const v of vehicles.items) await save('vehicleRuntime', { vin: v.vin });
  const pubs = await save('publications');
  for (const kind of ['POLICY', 'KILL', 'RESTORE']) await save('publications', {}, { kind });
  for (const p of pubs.items) await save('publicationDetail', { id: p.publicationId });
  await save('killRequests');
  // 롤백(D03-04) — 배포 목록·배포별 상세·이력(정적 데모에는 실행 기록이 없다)
  const rbDeps = await save('rollbackDeployments');
  for (const d of rbDeps.items) if (d.deploymentId) await save('rollbackDeployment', { deploymentId: d.deploymentId });
  await save('rollbacks');
  await save('rollbackRequests', {}, { status: 'REQUESTED' }); // 롤백 화면 핵심 메시지 — 승인 대기 건수
  await save('killRequests', {}, { status: 'ACTIVE' });
  await save('killPreview', {}, { featureId: 'FEAT-00022', featureVersion: '1.0.0' });
  // 가상검증(CARLA) — 정적 배포에는 검증 서버가 없다(상태는 미연결로 찍힌다)
  await save('simStatus');
  await save('virtualScenarios', {}, { featureId: 'FEAT-00022' });
  await save('virtualRuns');
  for (const p of policies.items as { policyId: string; featureId: string }[]) if (p.featureId === 'FEAT-00022') await save('virtualRuns', {}, { policyId: p.policyId });
  await save('listPolicies', {}, { featureId: 'FEAT-00022' });
  // P8b — 이상 징후·품질 피드백·IAM·Variant·지원 조건·Unleash(모의)
  await save('anomalies');
  await save('qualityFeedback');
  await save('iamRoles');
  await save('iamDenials');
  await save('variantMatrix', { featureId: 'FEAT-00022', version: '1.0.0' });
  for (const v of vehicles.items) await save('vehicleSupport', { vin: v.vin });
  await save('unleashStatus');
  for (const p of policies.items) await save('policyUnleash', { id: p.policyId });
  // P9 — PoC 실행 목록(정적 데모는 실행 불가)·42 컴포넌트 활동
  await save('pocRuns');
  await save('componentActivity', {}, { minutes: 60 });
  // P10·P11·보고서 v1.1 화면 — e2e:static(정적 데모 하네스)이 메뉴·하위 화면·탭을 열어 찾은 요청 모양 그대로
  for (const reasonCategory of ['SAFETY', 'SECURITY', 'REGULATORY', 'COMMERCIAL', 'OPERATIONAL']) await save('killPreview', {}, { featureId: 'FEAT-00022', featureVersion: '1.0.0', reasonCategory });
  await save('listPolicies', {}, { status: 'VALIDATED' });
  await save('baselineRequests', {}, { status: 'REQUESTED' });
  await save('auditChain');
  await save('versionChanges');
  await save('dependencies');
  await save('evidenceLedger');
  await save('safetyProfiles');
  for (const f of all.items as { featureId: string; version: string }[]) {
    const p = { id: f.featureId, ver: f.version };
    await save('safetyProfile', p);
    await save('releaseSignoff', p); // Feature 상세(VERIFIED)의 Release Sign-off 상태
    await save('designTrace', p);
    await save('gateSnapshot', p);
  }
  for (const featureId of new Set((all.items as { featureId: string }[]).map((f) => f.featureId))) await save('topologyGraph', {}, { featureId, depth: 2 });
  for (const m of ['masterUpg', 'masterSw', 'masterStructure', 'masterControlPoints', 'masterTaxonomy', 'masterEcu']) await save(m);
  for (const v of vehicles.items as { vin: string }[]) {
    await save('fieldVehicle', { vin: v.vin });
    await save('vehicleRequests', { vin: v.vin });
    await save('vehicleStatusView', { vin: v.vin });
    await save('vehicleOpenFeature', { vin: v.vin });
  }
  await save('readbacks');
  await save('experiments');
  await save('incidents');
  for (const m of ['syncTargets', 'legacyMappings', 'legacyOrders', 'legacyVehicles', 'integrationSystems', 'supplierDeliveries', 'openfeatureScope', 'openfeatureManifest', 'openfeatureFlagd', 'integrationCalls']) await save(m);
  for (const f of all.items as { featureId: string; version: string }[]) await save('almRequirements', {}, { featureId: f.featureId, version: f.version });
  await save('otelSpans', {}, { limit: 100 });
  const targets = await get('/api/sync/targets');
  for (const t of (targets.items ?? targets) as { targetId: string }[]) await save('syncRuns', {}, { targetId: t.targetId });
  await save('virtualCombinations', {}, { featureId: 'FEAT-00022' });
  await save('safetyKpi');
  await save('safetyKpiAnnex1', { featureId: 'FEAT-00022', version: '1.0.0' });
  // 보안·인증서 — SBOM serial은 부팅마다 달라 같은 실행의 목록에서 본문을 받는다
  await save('hsmStatus');
  const sboms = await save('sbomList');
  for (const b of sboms.items as { serial: string }[]) await save('sbomDetail', { serial: b.serial });
  await save('vexList');
  await save('securityEvents');
  // P11 — Flag Retirement·감독 기록·데이터·규제 기록
  for (const m of ['flagRetirements', 'iamSodAudit', 'killPostReviews', 'changeRecords', 'reharaRequests', 'sumsRecords', 'dataAccessRequests', 'retention']) await save(m);
  console.log(`snapshot:api — ${n}개 응답 → frontend/public/api-snapshot/`);
}

main()
  .catch((e) => {
    console.error('snapshot:api 실패:', e.message);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
