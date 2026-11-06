// npm run snapshot:api — 정적 데모(Cloudflare, VITE_DATA_MODE=static)용 GET 응답 스냅샷.
// 빌드된 백엔드를 보조 포트에 띄워(메모리 DB·v0.81 시드) v2 화면이 실제로 보내는 요청 모양 그대로 받아 둔다.
// 요청 URL·파일 이름 규칙은 @ff/contracts의 routeUrl·snapshotFile 하나를 프론트와 공유한다.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
const { ROUTES, routeUrl, snapshotFile, LIFECYCLE, TRIAL_STATES, SEGMENT_DIMENSIONS, trialListQuery, trialAnalyticsQuery, INTEGRATION_ERROR_SYSTEMS } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

/** 비어 있는 포트 — OS가 고른다. 고정 포트(예전 9199)는 여러 작업 폴더의 e2e:static이 함께 돌면 다른 폴더의 백엔드(다른 커밋·다른 데이터)에서 스냅샷을 받았다 */
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

let PORT = 0;
let BASE = '';
const OUT = join(FF, 'frontend', 'public');
/** 정적 데모 검색용 전체 목록 한 쪽 — frontend screens/refdb/refSearch.ts STATIC_SEARCH_PAGE(= 서버 REF_PAGE_MAX)와 같다 */
const STATIC_SEARCH_PAGE = 200;

/**
 * 파일 이름 → 요청 URL 장부 — snapshotFile은 URL의 영숫자 밖 글자를 '_'로 바꾸고 긴 이름을 줄이므로 다른 URL이 같은 파일이 될 수 있다(하네스 리뷰 H10).
 * 같은 URL을 두 번 찍는 것은 괜찮고, 다른 URL이 같은 파일을 덮으면 화면이 엉뚱한 응답을 읽으므로 멈춘다.
 */
export function claimSnapshotFile(written: Map<string, string>, file: string, url: string): void {
  const prev = written.get(file);
  if (prev !== undefined && prev !== url) throw new Error(`스냅샷 파일 이름 충돌 — ${file}: ${prev} ↔ ${url}`);
  written.set(file, url);
}

// 우리 백엔드가 먼저 끝나면(포트 충돌 등) 다른 서버에 묻지 않고 바로 멈춘다
let serverExit: number | null = null;

/** 보조 백엔드 시작 — 직접 실행할 때만(시험은 claimSnapshotFile만 읽는다) */
async function start() {
  PORT = process.env.SNAPSHOT_PORT ? Number(process.env.SNAPSHOT_PORT) : await freePort(); // 8000 금지
  BASE = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], {
    env: { ...process.env, PORT: String(PORT), FF_DB: ':memory:', FF_SEED: 'v0.81' },
    stdio: 'ignore',
  });
  server.once('exit', (code) => (serverExit = code ?? -1));
  return server;
}

// 역할이 걸린 조회(보안 이벤트·Data Act·차량 상태 등)는 그 경로가 허용하는 첫 역할로 받는다 — 정적 데모는 읽기 전용 공개본이다
async function get<T = any>(url: string, name?: string, headers?: Record<string, string>): Promise<T> {
  const role = (ROUTES.find((x: { name: string }) => x.name === name) as { roles?: string[] } | undefined)?.roles?.[0];
  const r = await fetch(BASE + url, { headers: { ...(role ? { 'X-Actor-Id': 'usr-snapshot', 'X-Actor-Role': role } : {}), ...headers } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

/** 쓰기 요청(보조 백엔드 전용) — 정적 데모에 보일 예시 데이터를 만든다 */
async function post<T = any>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `snapshot-${url}-${Date.now()}`, ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>) => Promise<any>;

/**
 * Feature DB 스냅샷 — 화면이 보내는 질의 모양 그대로(키 순서 포함):
 *  · 목록(RefList refListQuery): { q, domain, component, status, offset, limit: 50 } — 쪽·상태·도메인·컴포넌트
 *  · 등록 1단계(RefPicker): { q, domain, component, limit: 20 } · 세부기능 후보 { component }
 *  · 상세(RefDetail): refDetail + listRefChanges { refId } — 모든 기준 행
 *  · Feature 상세 '기준 행' 탭(FeatureRefsTab): refDetail + listRefChanges { refId, status: 'PUBLISHED' } — 시드 Feature가 쓰는 행.
 *    연결(featureRefs)은 목록 응답에 없다 — Version 상세(featureDetail)에서 모은다(목록에서 모아 '바뀐 버전'이 늘 '—'이던 결함, 하네스 리뷰 F4)
 *  · 정적 데모 검색(frontend screens/refdb/refSearch.ts): 검색어 스냅샷 대신 전체 목록 { offset, limit: 200 } 쪽을 받아 두고 화면이 찾는다(F5)
 */
async function refdbSnapshots(save: Save, versions: { featureRefs?: { refId: string }[] }[]) {
  // 예시 변경 요청 — 수정(대표 ASIL·T-shirt) + 도메인 검토 의견 하나(승인 전). 정적 데모는 읽기 전용이라 여기서만 만든다
  const AUTHOR = { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' };
  const REVIEWER = { 'X-Actor-Id': 'usr-approver', 'X-Actor-Role': 'DOMAIN_REVIEWER' };
  const demo = await post<{ changeId: string }>('/api/refdb/changes', AUTHOR, { kind: 'MODIFY', refId: 'CH-BRK-009', after: { tshirt: 'M' }, reason: '사내 실적(EPB 연계 2건) 반영 — 규모 S → M' });
  await post(`/api/refdb/changes/${demo.changeId}/reviews`, REVIEWER, { opinion: 'AGREE', comment: '사내 실적 근거 확인 — 동의' });

  await save('refQuality');
  const taxonomy = await save('refTaxonomy');
  await save('refSources');
  await save('refReleases');
  const changes = await save('listRefChanges');
  await save('listRefChanges', {}, { status: 'REVIEW' });
  for (const c of changes.items as { changeId: string }[]) {
    await save('refChangeDetail', { id: c.changeId });
    // 변경 요청 상세 '감사 이력' 패널(W5 P5-6)
    await save('refChangeAudit', { id: c.changeId });
  }
  // 발행 칸 미리 보기(W5 P5-4) — 관리자 화면
  await save('refReleasePreview');

  const nodes = taxonomy.items as { nodeId: string; level: string; parentId: string | null; nameEn: string }[];
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const componentsOf = (d: { nodeId: string }) => nodes.filter((n) => n.level === 'COMPONENT' && n.parentId === d.nodeId);
  const PAGE = 50;
  // 목록 첫 쪽 → 전체 수로 쪽 수를 정한다
  const first = await save('listRefs', {}, { limit: PAGE });
  for (let offset = PAGE; offset < first.total; offset += PAGE) await save('listRefs', {}, { offset, limit: PAGE });
  for (const status of ['ACTIVE', 'REVIEW', 'DEPRECATED', 'RETIRED', 'PENDING']) await save('listRefs', {}, { status, limit: PAGE });
  for (const d of domains) {
    await save('listRefs', {}, { domain: d.nameEn, limit: PAGE });
    await save('listRefs', {}, { domain: d.nameEn, limit: 20 });
    for (const c of componentsOf(d)) {
      await save('listRefs', {}, { domain: d.nameEn, component: c.nameEn, limit: PAGE });
      await save('listRefs', {}, { domain: d.nameEn, component: c.nameEn, limit: 20 });
    }
  }
  await save('listRefs', {}, { limit: 20 });
  for (const component of new Set(nodes.filter((n) => n.level === 'COMPONENT').map((n) => n.nameEn))) await save('refSubfunctions', {}, { component });

  // 상세 — 모든 기준 행(목록 행을 누르면 열린다). 같은 쪽(200개)을 정적 데모 검색용 전체 목록으로도 남긴다(refSearch STATIC_SEARCH_PAGE)
  const refIds: string[] = [];
  for (let offset = 0; offset < first.total; offset += STATIC_SEARCH_PAGE) {
    const page = await save('listRefs', {}, { offset: offset || undefined, limit: STATIC_SEARCH_PAGE });
    refIds.push(...(page.items as { refId: string }[]).map((r) => r.refId));
  }
  for (const refId of refIds) {
    await save('refDetail', { refId });
    await save('listRefChanges', {}, { refId });
  }
  // Feature 상세 '기준 행' 탭 — 연결 뒤 발행된 변경(발행됨만). 연결이 하나도 없으면 탭이 표본 없이 찍힌 것이다
  const linked = new Set(versions.flatMap((f) => (f.featureRefs ?? []).map((l) => l.refId)));
  if (!linked.size) throw new Error('Feature Version 상세에 기준 행 연결(featureRefs)이 하나도 없습니다 — 기준 행 탭 스냅샷을 만들 수 없습니다');
  for (const refId of linked) await save('listRefChanges', {}, { refId, status: 'PUBLISHED' });
  // 출처 점검 '개정 있음' → 영향 행 목록은 정적 데모에서 화면 검색(refSearch source)으로 찾는다
}

/** 검토 포털 협의 요청(W5 P5-1) — 포털 홈(받은 건)·부서 홈(보낸 건)·한 건 화면. 부서 ID는 시드가 쓰는 모든 부서 */
async function consultSnapshots(save: Save) {
  const all = await save('listConsultations');
  const items = all.items as { consultId: string; toDept: string; fromDept: string }[];
  for (const to of new Set(items.map((c) => c.toDept))) await save('listConsultations', {}, { to });
  // 보낸 건은 모든 부서 홈이 묻는다(보낸 건이 없으면 패널을 그리지 않는다)
  const { DEPARTMENT_IDS } = require(join(FF, 'contracts', 'dist', 'index.js')) as { DEPARTMENT_IDS: string[] };
  for (const from of DEPARTMENT_IDS) await save('listConsultations', {}, { from });
  for (const c of items) await save('consultationDetail', { id: c.consultId });
}
/**
 * SW 개발비 산정 스냅샷(20-94 §9) — 데모 시드(BCM 예시 과제 EST-0001·0002)와 계수 표. 조회 경로의 첫 역할(COST_ESTIMATOR)로 받아
 * 정적 데모는 금액이 보이는 구매 담당 화면이다(예시 과제·공개 단가만 있다). 엑셀 내보내기(파일)는 정적 데모에서 쓰지 않는다.
 */
async function costSnapshots(save: Save) {
  await save('costCalibration');
  const projects = await save('costProjects');
  for (const p of projects.items as { estId: string }[]) await save('costProject', { estId: p.estId });
  const basis = await save('costBasisList');
  for (const b of basis.items as { version: string }[]) await save('costBasis', { version: b.version });
}

async function main() {
  for (let i = 0; ; i++) {
    if (serverExit !== null) throw new Error(`스냅샷용 백엔드가 시작하지 못했습니다(종료 ${serverExit}, 포트 ${PORT})`);
    try {
      await get('/api/health');
      break;
    } catch (e) {
      if (i >= 120) throw new Error(`스냅샷용 백엔드가 응답하지 않습니다(포트 ${PORT}): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  rmSync(join(OUT, 'api-snapshot'), { recursive: true, force: true });
  let n = 0;
  const written = new Map<string, string>();
  const save = async (name: string, params: Record<string, string> = {}, query: Record<string, any> = {}, headers?: Record<string, string>) => {
    const url = routeUrl(name, params, query);
    const rel = snapshotFile(url);
    claimSnapshotFile(written, rel, url);
    const body = await get(url, name, headers);
    const file = join(OUT, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    n++;
    return body;
  };

  // 공통
  await save('health');
  await save('components');
  // 외부 연결 상태 — 모의 연계 표시(RD-UX-04). 정적 데모는 모든 연결이 모의다
  await save('systemConnections');
  await save('precheck');
  await save('workQueues');
  await save('events', {}, { limit: 500 });
  await save('events', {}, { limit: 500, recent: '1' });
  await save('featureFlags');
  await save('listFlagSources');
  await save('audit', {}, { limit: 500 });
  // 기능명세서 공백 보강(B1·B4·B6) — 수신자 규칙, 정책 운영 현황(감사 집계), 연계·과금·서명·파이프라인 오류 이력(시스템별)
  await save('notificationRules');
  await save('auditPolicyStats');
  await save('integrationErrors');
  for (const system of INTEGRATION_ERROR_SYSTEMS) await save('integrationErrors', {}, { system });

  // 업무 절차 — 개인 조회(내 차례·요약)라 데모 기본 역할(Feature 설계)로 찍는다. 정적 데모는 읽기 전용.
  const PROC = { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' };
  await save('procedureState', {}, {}, PROC);
  await save('procedureSummary', {}, {}, PROC);
  await save('procedureInbox', {}, {}, PROC);

  // Feature Registry 목록 — FeatureList의 질의 모양: { q, lifecycle, country, latestOnly }
  const all = await save('listFeatures', {}, { latestOnly: false });
  await save('listFeatures'); // Home operation overview uses the unfiltered contract.
  await save('listFeatures', {}, { latestOnly: true });
  for (const latestOnly of [true, false]) {
    for (const lifecycle of LIFECYCLE) await save('listFeatures', {}, { lifecycle, latestOnly });
    for (const country of Object.keys(all.facets.country)) await save('listFeatures', {}, { country, latestOnly });
  }

  // Feature Version 상세·Gate·체크리스트·감사·영향 — 상세의 feature(기준 행 연결 featureRefs 포함)를 모아 Feature DB 스냅샷에 넘긴다
  const versions: { featureRefs?: { refId: string }[] }[] = [];
  for (const f of all.items as { featureId: string; version: string }[]) {
    const p = { id: f.featureId, ver: f.version };
    versions.push((await save('featureDetail', p)).feature);
    await save('featureFlags', {}, { featureId: f.featureId, version: f.version });
    await save('gates', p);
    await save('analysisEvidence', p);
    // Feature 상세 '연계' 탭 — codeBeamer 요구·JIRA Epic/CR·GitLab MR 추적
    await save('extFeatureTrace', p);
    await save('baselineChecklist', p);
    await save('audit', {}, { target: `${f.featureId}@${f.version}`, limit: 100 });
    await save('impact', p);
  }
  // Feature 상세 '평가 운영' 탭(B5) — Feature마다 기본 기간(14일)
  for (const id of new Set((all.items as { featureId: string }[]).map((f) => f.featureId))) await save('featureEvaluations', { id });
  // Feature 요약 서랍(FeaturePeek) — Version 없이 열면 최신 Version을 이 응답에서 고른다
  for (const id of new Set((all.items as { featureId: string }[]).map((f) => f.featureId))) await save('featureVersions', { id });

  // Feature DB(기준 기능, 30-95) — 목록·상세·변경 요청·발행 이력, 등록 화면 1단계(기준 기능 고르기), Feature 상세 '기준 행' 탭.
  // 정적 데모에도 변경 요청 상세가 열리게 이 보조 백엔드(메모리 DB, 찍고 버린다)에 예시 수정 요청 하나와 도메인 검토 의견을 넣는다.
  await refdbSnapshots(save, versions);
  await consultSnapshots(save);
  await costSnapshots(save);
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
  await save('listPolicies', {}, { status: 'APPROVED' });
  for (const p of policies.items) {
    await save('policyDetail', { id: p.policyId });
    await save('policyExtLinks', { id: p.policyId });
    // 정책 상세의 버전 이력 — 목록과 변경 이력(버전 내용은 행을 열 때 읽으므로 개정본마다)
    const revs = await save('policyRevisions', { id: p.policyId });
    await save('policyChanges', { id: p.policyId });
    // 정책 상세의 배포 이력·되돌리기(RD-FN-02) — 정적 데모는 읽기 전용이라 이력만
    await save('policyHistory', { id: p.policyId });
    for (const r of revs.items) await save('policyRevision', { id: p.policyId, revision: String(r.revision) });
  }
  await save('validations');
  await save('entitlements');
  // 고객 기준 값(RD-OPS-03) — 사용 권한 성향 필터·차종·판매국 기준 값 화면. 개인정보 목록(RD-P2-05) — 데이터·규제 기록의 개인정보 탭
  await save('referenceValues');
  await save('privacyInventory');
  // 체험권 차량 목록(상태별 첫 쪽)·체험 전환 분석(나눠 보기 기준별) — 화면과 같은 질의 함수로 키를 맞춘다
  for (const source of ['ALL', 'FLEET', 'SYNTHETIC'] as const) {
    for (const state of ['', ...TRIAL_STATES]) await save('trials', {}, trialListQuery({ catalogId: 'CAT-00019', source, state }));
    for (const groupBy of ['', ...SEGMENT_DIMENSIONS]) {
      await save('trialAnalytics', {}, trialAnalyticsQuery({ catalogId: 'CAT-00019', source, groupBy }));
      // 기간 1년·5년 — 26주(기본)는 요청에 넣지 않는다
      for (const weeks of [52, 260]) await save('trialAnalytics', {}, { ...trialAnalyticsQuery({ catalogId: 'CAT-00019', source, groupBy }), weeks });
    }
  }
  const vehicles = await save('vehicles');
  // 대시보드 차량 가젯 — 수만 읽는다(limit=1 + total·sample)
  await save('vehicles', {}, { limit: 1 });
  const flagKeys = [...new Set((policies.items as { flagKey: string; status: string }[]).filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))];
  for (const v of vehicles.items) for (const flagKey of flagKeys) await save('activationDecide', {}, { vin: v.vin, flagKey });
  // 배포·차단 전달 (PoC ④⑥) — 부팅 동기화 게시본이 차량에 닿은 뒤의 상태를 찍는다
  await new Promise((r) => setTimeout(r, 2500));
  await save('fleetRuntime');
  // 전세계 차량 지도(D02-03) — 정적 데모는 찍은 시점 위치로 멈춰 있다(5초 갱신 없음)
  await save('fleetPopulation');
  const fm = await save('fleetMap', {}, { source: 'FLEET' });
  for (const flagKey of fm.flagKeys) await save('fleetMap', {}, { source: 'FLEET', flagKey });
  for (const c of fm.catalogs) await save('fleetMap', {}, { source: 'FLEET', catalogId: c.catalogId });
  const fs = await save('fleetMap', {}, { source: 'SYNTHETIC' });
  for (const c of fs.catalogs) await save('fleetMap', {}, { source: 'SYNTHETIC', catalogId: c.catalogId });
  for (const v of fm.items) await save('fleetMapVehicle', { vin: v.vin });
  await save('gleoStatus');
  await save('pkiKeys');
  await save('approverKeys');
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
  // 42 컴포넌트 활동(아키텍처 화면)
  await save('componentActivity', {}, { minutes: 60 });
  // P10·P11·보고서 v1.1 화면 — e2e:static(정적 데모 하네스)이 메뉴·하위 화면·탭을 열어 찾은 요청 모양 그대로
  for (const reasonCategory of ['SAFETY', 'SECURITY', 'REGULATORY', 'COMMERCIAL', 'OPERATIONAL']) await save('killPreview', {}, { featureId: 'FEAT-00022', featureVersion: '1.0.0', reasonCategory });
  await save('listPolicies', {}, { status: 'VALIDATED' });
  await save('baselineRequests', {}, { status: 'PENDING' }); // 검토함·콘솔 — 계약의 대기 상태(BaselineRequestStatus, P2-1)
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
  await save('integrationCalls', {}, { ifId: 'IF-04' }); // Home integration status.
  for (const f of all.items as { featureId: string; version: string }[]) await save('almRequirements', {}, { featureId: f.featureId, version: f.version });
  await save('otelSpans', {}, { limit: 100 });
  await save('otelSpans', {}, { limit: 300 });
  // GitLab·JIRA·codeBeamer 양방향 연계 — 외부 연계 현황 '양방향 연계' 탭·검토함 충돌·변경요청 목록
  await save('extSync');
  for (const system of ['jira', 'codebeamer', 'gitlab']) await save('mockExtItems', { system });
  await save('extFeatureEpics');
  await save('extConflicts', {}, { status: 'OPEN' });
  await save('extInbox');
  await save('extOutbox', {}, { status: 'FAILED' });
  await save('extChangeRequests');
  // Feature 상세 '양방향 연계' 탭 — 버전마다 추적을 읽는다(e2e:static이 모든 탭을 연다)
  for (const f of all.items as { featureId: string; version: string }[]) await save('extFeatureTrace', { id: f.featureId, ver: f.version });
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

// 직접 실행(npm run snapshot:api)일 때만 — Windows는 드라이브 글자 대소문자가 다를 수 있다
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const server = await start();
  await main()
    .catch((e) => {
      console.error('snapshot:api 실패:', e.message);
      process.exitCode = 1;
    })
    .finally(() => server.kill());
}
