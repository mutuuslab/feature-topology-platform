// npm run snapshot:api — 정적 데모(Cloudflare, VITE_DATA_MODE=static)용 GET 응답 스냅샷.
// 빌드된 백엔드를 보조 포트에 띄워(메모리 DB·v0.81 시드) v2 화면이 실제로 보내는 요청 모양 그대로 받아 둔다.
// 요청 URL·파일 이름 규칙은 @ff/contracts의 routeUrl·snapshotFile 하나를 프론트와 공유한다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FF } from './lib.ts';
import { report, scanDirs, type Leak } from './local-leaks.ts';
import { snapshotP1 } from './snapshot-p1.ts';
import { snapshotP2 } from './snapshot-p2.ts';
import { snapshotP3 } from './snapshot-p3.ts';
import { snapshotP5 } from './snapshot-p5.ts';
import { snapshotP10 } from './snapshot-p10.ts';
import { snapshotTx } from './snapshot-tx.ts';
import { snapshotWorkflow } from './snapshot-workflow.ts';

const require = createRequire(import.meta.url);
const { ROUTES, routeUrl, snapshotFile, LIFECYCLE, TRIAL_STATES, SEGMENT_DIMENSIONS, trialListQuery, trialAnalyticsQuery, INTEGRATION_ERROR_SYSTEMS, ofrepSnapshotFile, DEMO_SDK_KEY, virtualEvidenceSnapshotFile, publicSimStatus, NOTIFICATION_CATEGORIES, trialTableQuery, TRIAL_TABLE_PAGE } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

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
// 출력 폴더(그 아래 api-snapshot/) — SNAPSHOT_OUT으로 바꾼다(tools/static-build.ts가 포트별 폴더로, 같은 폴더의 다른 작업과 겹치지 않게)
const OUT = process.env.SNAPSHOT_OUT ? resolve(process.env.SNAPSHOT_OUT) : join(FF, 'frontend', 'public');
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

/**
 * 로컬 PC 흔적 게이트 — 단독 실행(npm run snapshot:api, 배포 CI의 snapshot 단계)도 static-build와 같은 검사로 실패시킨다.
 * 흔적이 있는 스냅샷은 지워 공개 폴더(frontend/public → vite 빌드)에 남기지 않는다(2026-11-06 — 고치기 전 백엔드 dist로 찍은 스냅샷이 public에 남았다)
 */
export function assertSnapshotClean(dir: string, scan: (dirs: string[]) => Leak[] = scanDirs): void {
  const leaks = scan([dir]);
  if (!leaks.length) return;
  rmSync(dir, { recursive: true, force: true });
  throw new Error(`스냅샷에 빌드 PC 흔적이 있어 지웠습니다(${dir}) — 응답 경로를 고치고 백엔드를 다시 빌드한 뒤 다시 만드세요\n${report(leaks)}`);
}

/** 정적 공개본의 감사 다음 쪽 커서 — 쪽 순번(2부터). 서버 커서(마지막 id)는 감사 건수로 값이 달라져 파일 이름이 배포마다 바뀌었다(2026-11-06).
 *  정적 데모에서 커서는 다음 쪽 파일을 찾는 열쇠일 뿐이다(화면은 받은 nextCursor를 그대로 돌려보낸다) */
export const staticAuditCursor = (page: number) => `page-${page}`;

/** 가상검증 Evidence 임시 폴더(start가 만들고 끝나면 지운다) */
let EVIDENCE = '';

// 우리 백엔드가 먼저 끝나면(포트 충돌 등) 다른 서버에 묻지 않고 바로 멈춘다
let serverExit: number | null = null;
let serverSignal: string | null = null;
/** 우리 백엔드가 포트를 잡았다(시작 로그) — 같은 포트의 다른 서버 health에 속지 않게 */
let serverReady = false;
/** 백엔드 출력 마지막 줄들 — 도중에 끝나면 'fetch failed' 한 줄 대신 원인을 보인다(2026-11-06) */
const serverTail: string[] = [];
const TAIL_LINES = 30;
export function pushTail(tail: string[], chunk: string, max = TAIL_LINES): void {
  for (const line of chunk.split(/\r?\n/)) if (line.trim()) tail.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
  tail.splice(0, Math.max(0, tail.length - max));
}
/** 백엔드가 끝났을 때의 오류 문구 — 종료 코드·신호·포트·마지막 출력 */
export function backendGoneMessage(stage: string, exit: { code: number | null; signal: string | null }, port: number, tail: string[]): string {
  const how = exit.signal ? `신호 ${exit.signal}` : `종료 ${exit.code}`;
  const hint = tail.some((l) => /EADDRINUSE/.test(l)) ? ' — 포트가 이미 쓰이고 있습니다(SNAPSHOT_PORT를 비워 빈 포트를 쓰세요)' : exit.signal ? ' — 바깥에서 끝냈습니다(감싼 timeout·작업 관리자 등)' : '';
  return `스냅샷용 백엔드가 ${stage} 끝났습니다(${how}, 포트 ${port})${hint}\n마지막 출력:\n${tail.join('\n') || '(없음)'}`;
}
const gone = (stage: string) => new Error(backendGoneMessage(stage, { code: serverExit, signal: serverSignal }, PORT, serverTail));

/** 빌드 PC에서 넘기는 환경 — OS 기본값과 배포 시드(cloudflare.yml의 snapshot:api 앞 변수)만 */
const SNAPSHOT_ENV_PASS = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LANG|LC_ALL|FF_SHOWCASE|FF_SHOWCASE_VEHICLES|FF_SHOWCASE_SCALE|FF_SYNTHETIC|FF_BUILD_SHA)$/i;

/**
 * 스냅샷 백엔드 환경 — 빌드 PC 환경(실 Unleash·GLEO 브로커·외부 연계 URL·토큰·DB·CARLA Python·운영 모드)이 공개 스냅샷에 섞이지 않게
 * 허용 목록만 넘기고, 스냅샷에 필요한 값은 강제한다(로컬 의존 점검 2026-11-06). TZ는 공개 배포(CI, UTC)와 같게
 */
export function snapshotServerEnv(src: Record<string, string | undefined>, port: number, sim: Record<string, string>): Record<string, string> {
  const pass = Object.fromEntries(Object.entries(src).filter((e): e is [string, string] => e[1] !== undefined && SNAPSHOT_ENV_PASS.test(e[0])));
  return { ...pass, TZ: 'UTC', UNLEASH_MODE: 'mock', GLEO_MODE: 'internal', PORT: String(port), FF_DB: ':memory:', FF_SEED: 'v0.81', ...sim };
}

/** 보조 백엔드 시작 — 직접 실행할 때만(시험은 claimSnapshotFile만 읽는다) */
async function start() {
  PORT = process.env.SNAPSHOT_PORT ? Number(process.env.SNAPSHOT_PORT) : await freePort(); // 8000 금지
  BASE = `http://127.0.0.1:${PORT}`;
  // 가상검증 실행 기록 — 정적 배포에는 CARLA 검증 서버가 없다. 같은 입출력 계약의 시험 대역(결정적)으로 실행 기록·Evidence를 만들고,
  // 서버 연결 탐침은 실패로 둔다(정적 데모의 검증 서버 상태는 '미연결'이 맞다). Evidence는 찍고 버리는 임시 폴더에 둔다
  EVIDENCE = mkdtempSync(join(tmpdir(), 'ff-snapshot-evidence-'));
  const sim = { SIM_MODE: 'auto', CARLA_RUNNER: join(FF, 'backend', 'test', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FAKE_SIM_PROBE_FAIL: '1', FF_EVIDENCE_DIR: EVIDENCE };
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], {
    env: snapshotServerEnv(process.env, PORT, sim),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onOut = (d: Buffer) => {
    const s = d.toString();
    if (s.includes('Feature Platform backend →')) serverReady = true;
    pushTail(serverTail, s);
  };
  server.stdout!.on('data', onOut);
  server.stderr!.on('data', onOut);
  server.once('exit', (code, signal) => {
    serverExit = code ?? -1;
    serverSignal = signal;
  });
  return server;
}

/** 우리 백엔드에 요청 — 도중에 끝났으면 바로, 연결이 끊기면 그 URL과 백엔드 상태를 담아 멈춘다 */
/** 다시 보낼 만한 연결 오류인가 — 유지 연결(keep-alive)을 서버가 닫는 순간 다시 쓴 읽기(GET)만. 쓰기·연결 거부는 그대로 실패 */
export function retryableFetchError(e: unknown, init?: Pick<RequestInit, 'method'>): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  return (init?.method ?? 'GET').toUpperCase() === 'GET' && (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE');
}

async function call(url: string, init?: RequestInit, retried = false): Promise<Response> {
  if (serverExit !== null) throw gone('도중에');
  try {
    return await fetch(BASE + url, init);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 200)); // 종료 이벤트가 따라 들어올 틈
    if (serverExit !== null) throw gone(`${url} 요청 중에`);
    if (!retried && retryableFetchError(e, init)) return call(url, init, true);
    throw new Error(`${url} 요청 실패: ${(e as Error).message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause: { code: string } }).cause.code})` : ''}`);
  }
}

// 역할이 걸린 조회(보안 이벤트·Data Act·차량 상태 등)는 그 경로가 허용하는 첫 역할로 받는다 — 정적 데모는 읽기 전용 공개본이다
async function get<T = any>(url: string, name?: string, headers?: Record<string, string>): Promise<T> {
  const role = (ROUTES.find((x: { name: string }) => x.name === name) as { roles?: string[] } | undefined)?.roles?.[0];
  const r = await call(url, { headers: { ...(role ? { 'X-Actor-Id': 'usr-snapshot', 'X-Actor-Role': role } : {}), ...headers } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

let posts = 0;
/** 쓰기 요청(보조 백엔드 전용) — 정적 데모에 보일 예시 데이터를 만든다 */
async function post<T = any>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const r = await call(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `snapshot-${url}-${Date.now()}-${++posts}`, ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

/** OFREP 평가(POST, 읽기 전용 조회) — 화면처럼 오류 응답(404 FLAG_NOT_FOUND 등)도 본문 그대로 둔다 */
async function ofrep(path: string, targetingKey: string): Promise<unknown> {
  const r = await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEMO_SDK_KEY}` }, body: JSON.stringify({ context: { targetingKey } }) }); // SDK 키 필수(결정 C8) — 데모 기본 키
  const body = await r.json();
  if (!r.ok && r.status !== 404) throw new Error(`POST ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}

/** 데모 기본 계정(Feature 설계) — 개인 조회(업무 절차·알림)는 이 계정으로 찍는다. 팀이 '*'라 모든 Owner 팀 알림을 받는다 */
const PROC_ACTOR = { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' };

/**
 * 알림 조회 — 화면이 보내는 질의 모양 그대로(키 순서 unread·category·limit): 상단 종 { limit: 6 }, 알림 센터 집계 { limit: 500 },
 * 목록 { unread?, category?, limit: 200 } — 안 읽음/전체 × 전체 범주/범주별
 */
/** Safety Case 응답에서 Evidence manifest ID(EVM-0001…) — 화면이 여는 manifest마다 스냅샷을 찍는다 */
export function evidenceManifestIds(doc: unknown): string[] {
  return [...new Set(JSON.stringify(doc).match(/EVM-\d{4}/g) ?? [])];
}

export function notificationQueries(categories: readonly string[]): Record<string, string | number | boolean | undefined>[] {
  const out: Record<string, string | number | boolean | undefined>[] = [{ limit: 6 }, { limit: 500 }];
  for (const unread of [true, undefined]) for (const category of [undefined, ...categories]) out.push({ unread, category, limit: 200 });
  return out;
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
  // 보완 의견 — 요청자(Feature 설계 계정)에게 '보완 필요' 알림(승인 범주)이 간다. 정적 데모 알림 센터·종에 보인다
  const own = (await get<{ items: { changeId: string; requestedBy: string; status: string; reviews: unknown[] }[] }>('/api/refdb/changes')).items.find((c) => c.requestedBy === AUTHOR['X-Actor-Id'] && c.status === 'REVIEW' && !c.reviews.length && c.changeId !== demo.changeId);
  if (!own) throw new Error('보완 의견을 남길 변경 요청(Feature 설계 계정, 검토 중)이 시드에 없습니다 — 알림 승인 범주를 채울 수 없습니다');
  await post(`/api/refdb/changes/${own.changeId}/reviews`, REVIEWER, { opinion: 'REVISE', comment: '근거 출처 보강 필요 — 사내 실적 자료를 붙여 다시 요청해 주세요' });

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
/**
 * Flag 코드 연결(20-97 §7.2) — 화면이 보내는 질의 모양 그대로(키 순서 포함):
 *  · 현황(/flag-code): flagCoverage {} · 대사판(/flag-code/reconcile): { status: FLAG_RECONCILE_QUERY } · 수명 관리: { status: 'STALE,REMOVAL_DUE' }
 *  · Feature 상세 Flag 탭: flagCoverage { featureId, version } + flagReleaseGate — 모든 Version
 *  · Flag 코드 상세: flagCoverageDetail + flagEvaluationSeries { window: '24h' } — 대사 행 전부(평가 모니터링 7일 창은 { window: '7d' }도)
 *  · 저장소·스캔(저장소별 { repoId } 포함, 스캔 상세 전부)·PR({ kind: 'REMOVAL' } 포함)·해제·평가 { window } 1h·24h·7d
 */
export const FLAG_RECONCILE_QUERY = 'NO_CODE,CALL_DELETED,UNREGISTERED_KEY,DYNAMIC_KEY,UNLEASH_MISMATCH,REMOVAL_DUE,STALE,PR_OPEN';
async function flagCodeSnapshots(save: Save, versions: { featureId: string; version: string }[]) {
  const all = await save('flagCoverage');
  await save('flagCoverage', {}, { status: FLAG_RECONCILE_QUERY });
  await save('flagCoverage', {}, { status: 'STALE,REMOVAL_DUE' });
  for (const f of versions) {
    await save('flagCoverage', {}, { featureId: f.featureId, version: f.version });
    await save('flagReleaseGate', { id: f.featureId, ver: f.version });
  }
  for (const r of all.rows as { flagKey: string }[]) {
    await save('flagCoverageDetail', { flagKey: r.flagKey });
    await save('flagEvaluationSeries', { flagKey: r.flagKey }, { window: '24h' });
    // 평가 모니터링은 7일 창이 기본(하루 넘게 이어진 폴백 급증) — 선택 Flag 시계열도 같은 창
    await save('flagEvaluationSeries', { flagKey: r.flagKey }, { window: '7d' });
  }
  const repos = await save('flagRepositories');
  const scans = await save('flagScans');
  for (const s of scans.items as { scanId: string }[]) await save('flagScanDetail', { id: s.scanId });
  for (const r of repos.items as { repoId: string }[]) {
    const own = await save('flagScans', {}, { repoId: r.repoId });
    for (const s of own.items as { scanId: string }[]) await save('flagScanDetail', { id: s.scanId });
  }
  await save('flagPullRequests');
  await save('flagPullRequests', {}, { kind: 'REMOVAL' });
  await save('flagGateWaivers');
  for (const window of ['1h', '24h', '7d']) await save('flagEvaluations', {}, { window });
}

async function costSnapshots(save: Save) {
  await save('costCalibration');
  const projects = await save('costProjects');
  for (const p of projects.items as { estId: string }[]) await save('costProject', { estId: p.estId });
  const basis = await save('costBasisList');
  for (const b of basis.items as { version: string }[]) await save('costBasis', { version: b.version });
}

/**
 * 보조 백엔드 기동 대기(ms) — 전시 시드(FF_SHOWCASE)는 기동에 45~50초 걸린다. 예전 60초(0.5초 × 120)는 느린 PC·동시 빌드에서 넘었다.
 * 기본 300초, SNAPSHOT_START_TIMEOUT_MS로 바꾼다(최소 180초)
 */
export function startDeadlineMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.SNAPSHOT_START_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? Math.max(v, 180_000) : 300_000;
}

async function main() {
  const deadline = Date.now() + startDeadlineMs();
  for (;;) {
    if (serverExit !== null) throw gone('시작하기 전에');
    try {
      await get('/api/health');
      // health가 와도 우리 백엔드가 시작 로그를 내기 전이면 같은 포트의 다른 서버다 — 기다린다
      if (serverReady) break;
      throw new Error('우리 백엔드가 아직 포트를 잡지 않았습니다');
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`스냅샷용 백엔드가 ${Math.round(startDeadlineMs() / 1000)}초 안에 응답하지 않습니다(포트 ${PORT}): ${(e as Error).message}`);
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
  /** 서버가 '없음'(404)으로 답하는 조회 — 화면이 비워 두는 같은 뜻의 본문을 둔다(정적 데모가 '스냅샷에 없음' 오류 대신 빈 패널, 통합 12단계) */
  const saveBody = (name: string, params: Record<string, string>, body: unknown) => {
    const url = routeUrl(name, params, {});
    const rel = snapshotFile(url);
    claimSnapshotFile(written, rel, url);
    const file = join(OUT, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    n++;
  };

  // 가상검증 실행 기록(시험 대역, start 참고) — 키트 Feature 정책마다 한 번. 다른 조회보다 먼저 만들어 이력·이벤트에 함께 찍힌다
  const KIT = 'FEAT-00022';
  // 전시 채우기(사후 검증)가 이미 돌린 정책은 건너뛴다 — 같은 실행을 두 번 남기지 않게
  for (const p of (await get<{ items: { policyId: string }[] }>(routeUrl('listPolicies', {}, { featureId: KIT }))).items)
    if (!(await get<{ items: unknown[] }>(routeUrl('virtualRuns', {}, { policyId: p.policyId }))).items.length) await post('/api/virtual-validations', PROC_ACTOR, { policyId: p.policyId });

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
  const PROC = PROC_ACTOR;
  await save('procedureState', {}, {}, PROC);
  await save('procedureSummary', {}, {}, PROC);
  await save('procedureInbox', {}, {}, PROC);
  await snapshotWorkflow(save);

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
  await flagCodeSnapshots(save, all.items as { featureId: string; version: string }[]);
  // BOM·Catalog
  const baselineRequests = await save('baselineRequests');
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
    // 성향·검색어·다음 쪽 — 전체 표(출처 ALL, 200건씩 모든 쪽)를 받아 두면 시연 엔진이 서버 규칙으로 계산한다(api/sim/trial-list.ts)
    if (source === 'ALL') {
      const first = (await save('trials', {}, trialTableQuery('CAT-00019', 1))) as { total: number };
      for (let page = 2; (page - 1) * TRIAL_TABLE_PAGE < first.total; page++) await save('trials', {}, trialTableQuery('CAT-00019', page));
    }
    for (const groupBy of ['', ...SEGMENT_DIMENSIONS] as const) {
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
  const kills = await save('killRequests');
  // 롤백(D03-04) — 배포 목록·배포별 상세·이력(실행 기록 상세는 아래 '상세 서랍')
  const rbDeps = await save('rollbackDeployments');
  for (const d of rbDeps.items) if (d.deploymentId) await save('rollbackDeployment', { deploymentId: d.deploymentId });
  const rollbacks = await save('rollbacks');
  await save('rollbackRequests', {}, { status: 'REQUESTED' }); // 롤백 화면 핵심 메시지 — 승인 대기 건수
  await save('killRequests', {}, { status: 'ACTIVE' });
  await save('killPreview', {}, { featureId: 'FEAT-00022', featureVersion: '1.0.0' });
  // 가상검증(CARLA) — 정적 배포에는 검증 서버가 없다(상태는 미연결로 찍힌다). 공개본에는 운영자용 연결 정보(호스트·포트·실행기·Python 경로)를 싣지 않는다
  const sim = await save('simStatus');
  writeFileSync(join(OUT, snapshotFile(routeUrl('simStatus'))), JSON.stringify(publicSimStatus(sim)));
  // 시나리오·조합 계획 — 정책 상세의 가상검증 패널(정책의 Feature)·조합 시험은 Feature마다 묻는다(키트 밖 Feature는 시나리오 0건 → 패널을 그리지 않는다)
  const featureIds = [...new Set((all.items as { featureId: string }[]).map((f) => f.featureId))];
  for (const featureId of featureIds) await save('virtualScenarios', {}, { featureId });
  const vruns = await save('virtualRuns');
  // 정책 상세 가상검증 패널 — 모든 정책(시나리오가 없는 Feature도 조회는 나간다)
  for (const p of policies.items as { policyId: string }[]) await save('virtualRuns', {}, { policyId: p.policyId });
  await save('listPolicies', {}, { featureId: 'FEAT-00022' });
  // P8b — 이상 징후·품질 피드백·IAM·Variant·지원 조건·Unleash(모의)
  const anomalies = await save('anomalies');
  await save('qualityFeedback');
  await save('iamRoles');
  await save('iamDenials');
  // Variant 지원 조건 — 차량별 지원 표의 Feature 링크·입력이 여는 모든 Feature Version
  for (const f of all.items as { featureId: string; version: string }[]) await save('variantMatrix', { featureId: f.featureId, version: f.version });
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
  const experiments = await save('experiments');
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
  // 주기 대사 기록(80-50 §4.5) — 보조 백엔드에서 실제로 증분·전체 대사를 한 번씩 돌린 결과
  for (const kind of ['FULL', 'INCREMENTAL']) await post('/api/integrations/sync/reconcile', { 'X-Actor-Id': 'usr-integrator', 'X-Actor-Role': 'IMPLEMENTER' }, { system: 'JIRA', kind });
  await save('extReconcileRuns');
  // 검토함 '산출물 변경 — 게이트 재판정'(80-50 §5.6)
  await save('almRejudge', {}, { status: 'OPEN' });
  // Feature 상세 '양방향 연계' 탭 — 버전마다 추적을 읽는다(e2e:static이 모든 탭을 연다)
  for (const f of all.items as { featureId: string; version: string }[]) await save('extFeatureTrace', { id: f.featureId, ver: f.version });
  // Feature 상세 '연계' 탭 — codeBeamer 산출물 8종(80-50 §5.4)
  for (const f of all.items as { featureId: string; version: string }[]) await save('almWorkProducts', { id: f.featureId, ver: f.version });
  const targets = await get('/api/sync/targets');
  for (const t of (targets.items ?? targets) as { targetId: string }[]) await save('syncRuns', {}, { targetId: t.targetId });
  for (const featureId of featureIds) await save('virtualCombinations', {}, { featureId });
  // 운행 중 감시 지표 — 행을 열면 부속서 1 정기 보고를 읽는다(목록의 모든 Feature Version)
  const kpi = await save('safetyKpi');
  for (const it of kpi.items as { featureId: string; version: string }[]) await save('safetyKpiAnnex1', { featureId: it.featureId, version: it.version });
  // 보안·인증서 — SBOM serial은 부팅마다 달라 같은 실행의 목록에서 본문을 받는다
  await save('hsmStatus');
  const sboms = await save('sbomList');
  for (const b of sboms.items as { serial: string }[]) await save('sbomDetail', { serial: b.serial });
  await save('vexList');
  await save('securityEvents');
  // P11 — Flag Retirement·감독 기록·데이터·규제 기록
  for (const m of ['flagRetirements', 'iamSodAudit', 'killPostReviews', 'changeRecords', 'reharaRequests', 'sumsRecords', 'dataAccessRequests', 'retention']) await save(m);

  // 상세 서랍·패널 — 목록에 나오는 모든 행(행을 열면 '데모에 없는 데이터' 오류 상자였다)
  for (const a of anomalies.items as { anomalyId: string }[]) await save('anomalyDetail', { id: a.anomalyId });
  for (const x of experiments.items as { experimentId: string }[]) await save('experiment', { id: x.experimentId });
  for (const k of kills.items as { killId: string; featureId: string }[]) {
    const d = await save('killDetail', { id: k.killId });
    // 명령이 발행된 차단만 봉투·시간 기록·사후 검토를 그린다
    if (d.command) {
      await save('killEnvelopes', { id: k.killId });
      await save('killTimeline', { id: k.killId });
    }
    // 복원 요청 폼의 재검증 Evidence 후보
    await save('evidenceLedger', {}, { featureId: k.featureId });
  }
  for (const r of baselineRequests.items as { requestId: string }[]) await save('baselineRequest', { rid: r.requestId });
  for (const x of rollbacks.items as { executionId: string }[]) await save('rollbackExecution', { id: x.executionId });
  // 알림 링크(?request=·?plan=)가 여는 요청·계획 — 상태와 상관없이 모두
  for (const r of (await get<{ items: { requestId: string }[] }>(routeUrl('rollbackRequests'))).items) await save('rollbackRequest', { id: r.requestId });
  for (const p of (await get<{ items: { planId: string }[] }>(routeUrl('rollbackPlans'))).items) await save('rollbackPlan', { id: p.planId });
  // 가상검증 실행 상세 + Evidence 파일(보고서·판정·기록)은 원래 형식 그대로
  if (!vruns.items.length) throw new Error('가상검증 실행 기록이 없습니다 — 정적 데모 가상검증 화면이 비어 보입니다');
  for (const r of vruns.items as { runId: string }[]) {
    const d = await save('virtualRunDetail', { id: r.runId });
    for (const f of (d.evidence?.files ?? []) as { name: string }[]) {
      const res = await call(routeUrl('virtualRunFile', { id: r.runId, name: f.name }));
      if (!res.ok) throw new Error(`가상검증 Evidence ${r.runId}/${f.name} → ${res.status}`);
      const file = join(OUT, virtualEvidenceSnapshotFile(r.runId, f.name));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
  }
  // Unleash 판단 비교(정책 상세 '판단 비교' 버튼) — 배포된 정책만 누를 수 있다
  for (const p of policies.items as { policyId: string; status: string }[]) if (p.status === 'DEPLOYED') await save('unleashEvaluation', { id: p.policyId });
  // 차량 전달 채널(배포 화면의 회신 멈춤 안내) — 설정 상태 읽기
  await save('vehicleChannel');

  // OFREP·OpenFeature(활성화 판단 화면) — 차량마다 한 파일: 배포 flag 단일 평가(OFREP 응답 패널)와 bulk 평가(웹 SDK가 받는 값). 평가 시각은 스냅샷 시각
  for (const v of vehicles.items as { vin: string }[]) {
    const flags: Record<string, unknown> = {};
    for (const flagKey of flagKeys) flags[flagKey] = await ofrep(`/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`, v.vin);
    const rel = ofrepSnapshotFile(v.vin);
    claimSnapshotFile(written, rel, `/ofrep/v1/evaluate#${v.vin}`);
    writeFileSync(join(OUT, rel), JSON.stringify({ bulk: await ofrep('/ofrep/v1/evaluate/flags', v.vin), flags, evaluatedAt: new Date().toISOString() }));
    n++;
  }

  // 알림 — 데모 기본 계정(PROC_ACTOR)이 받는 알림. 범주마다 안 읽은 건이 남게 오래된 것 하나씩만 읽음으로 두어 '안 읽음'·'전체'가 갈린다
  const inbox = (q: Record<string, unknown>) => get<{ items: { notificationId: string; category: string; readAt: string | null }[] }>(routeUrl('notifications', {}, q as Record<string, string>), 'notifications', PROC_ACTOR);
  const before = (await inbox({ limit: 500 })).items;
  for (const c of new Set(before.map((x) => x.category))) {
    const rows = before.filter((x) => x.category === c);
    if (rows.length > 1) await post(routeUrl('readNotification', { id: rows.at(-1)!.notificationId }), PROC_ACTOR, {});
  }
  const after = (await inbox({ limit: 500 })).items;
  if (!after.length || !after.some((x) => x.readAt) || !after.some((x) => !x.readAt)) throw new Error(`정적 데모 알림이 비었거나 한쪽뿐입니다(전체 ${after.length}) — 알림 센터가 빈 상태로 보입니다`);
  for (const c of new Set(after.map((x) => x.category))) if (!after.some((x) => x.category === c && !x.readAt)) throw new Error(`알림 범주 ${c}에 안 읽은 건이 없습니다`);
  for (const q of notificationQueries(NOTIFICATION_CATEGORIES)) await save('notifications', {}, q, PROC_ACTOR);

  // 표준 따라하기 — 시나리오 Feature의 차단 미리보기(요청 폼의 첫 질의 모양). 차단 상세·봉투·이상 건 상세는 위 상세 서랍 묶음
  for (const [featureId, featureVersion] of [['FEAT-00015', '1.2.0'], ['FEAT-00028', '1.0.0'], ['FEAT-00001', '2.2.0']])
    for (const reasonCategory of ['SAFETY', 'SECURITY', 'COMMERCIAL']) await save('killPreview', {}, { featureId, featureVersion, reasonCategory });
  // Data Lake 연계·Closed loop(80-70, TL-UI*) — 모의 Lake 조회·운영 점검(점검 결과마다)·Feature 운영 지표 탭·수집 정책(정책별 Canary는 확대 판정 응답에)
  for (const m of ['lakeStatus', 'lakeContracts', 'lakeModels', 'lakeLabels', 'lakeAnomalyEvidence', 'lakeExperiments', 'lakeTrials', 'collectionPolicies', 'canaryOverview']) await save(m);
  const health = await save('featureHealth');
  for (const f of health.findings as { findingId: string }[]) await save('featureHealthFinding', { id: f.findingId });
  for (const id of new Set((all.items as { featureId: string }[]).map((f) => f.featureId))) await save('featureOpsMetrics', { id });
  // ADS·UNECE·Orca 화면 — 새 화면·탭이 읽는 응답(질의 키 순서는 화면과 같게, e2e:static이 모든 탭을 연다)
  // 구성: ODD 프로파일·승인 구성 조합·VIN 지원 판정(차량 × 상품)
  const odd = await save('oddProfiles');
  for (const p of odd.items as { profileId: string }[]) await save('oddProfile', { id: p.profileId });
  const sets = await save('configSets');
  for (const c of sets.items as { setId: string }[]) await save('configSetVehicles', { id: c.setId });
  const catalogIds = [...new Set((products.items as { catalogId: string }[]).map((c) => c.catalogId))];
  for (const v of vehicles.items as { vin: string }[]) for (const catalogId of catalogIds) await save('vehicleEligibility', { vin: v.vin }, { catalogId });
  // 증거: ADS 사건 보고·정기 보고·Safety Case·Evidence manifest·요구 추적
  const reports = await save('adsIncidentReports');
  for (const r of reports.items as { reportId: string }[]) await save('adsIncidentReport', { id: r.reportId });
  const periodic = await save('adsPeriodicReport', { year: String(new Date(Date.now() + 9 * 3600_000).getUTCFullYear()) });
  for (const y of periodic.years as number[]) if (String(y) !== String(periodic.year)) await save('adsPeriodicReport', { year: String(y) });
  const sc = await save('adsSafetyCase', { featureId: 'FEAT-00004' });
  for (const x of sc.features as { featureId: string }[]) if (x.featureId !== 'FEAT-00004') await save('adsSafetyCase', { featureId: x.featureId });
  for (const id of evidenceManifestIds(sc)) await save('adsEvidenceManifest', { id });
  await save('adsTrace');
  // 상태: 차량별 6축·판정·고객에게 보이는 상태, 게시본 수렴, Fleet 축 분포, 주문 추적
  for (const v of vehicles.items as { vin: string }[]) for (const m of ['adsVehicleFeatureState', 'adsVehicleVerdicts', 'adsCustomerState']) await save(m, { vin: v.vin });
  for (const p of pubs.items as { publicationId: string }[]) await save('adsConvergence', { id: p.publicationId });
  const axis = await save('adsAxisDistribution');
  for (const x of axis.features as { featureId: string }[]) await save('adsAxisDistribution', {}, { featureId: x.featureId });
  const orders = await save('adsOrders');
  for (const o of orders.items as { orderId: string }[]) await save('adsOrderTimeline', { id: o.orderId });
  // 변경: 변경 영향·릴리스 비교·ADS 분류·확대 판정
  await save('adsChangeImpacts');
  for (const featureId of new Set((all.items as { featureId: string }[]).map((x) => x.featureId))) await save('adsChangeImpacts', {}, { featureId });
  const releases = await save('adsReleases');
  for (const r of releases.items as { releaseId: string }[]) await save('adsReleaseDiff', { id: r.releaseId });
  await save('adsUnclassified');
  for (const x of all.items as { featureId: string; version: string }[]) await save('adsClassification', { id: x.featureId, ver: x.version });
  // 확대 판정(통합 D-INT-4) — 배포 정책마다 Canary 관측·축별 근거를 한 응답으로. 판정을 못 읽으면 화면이 그리지 않는 빈 판정({decision: null})
  for (const p of policies.items as { policyId: string; status: string }[]) if (p.status === 'DEPLOYED') await save('policyExpansion', { id: p.policyId }).catch(() => saveBody('policyExpansion', { id: p.policyId }, { decision: null, canary: null, evidence: null, stage: null })); // ExpansionPanel은 decision이 없으면 그리지 않는다
  // ADS 구성 마감(P5) — 발행 후보·복구 결정·캠페인·출고 대조·OTA 설치 단계·지원 종료 연습
  await snapshotP5(save, { vehicles: vehicles.items, features: all.items, publications: pubs.items });
  // ISO/IEC 26580 정합(docs/20-architecture/20-60) — 카탈로그·Bill-of-Features(상품마다)·제품 구성기·공유 자산·등록 현황·Feature 프로필
  await save('featureCatalogue');
  const bof = await save('billOfFeaturesPortfolio');
  for (const p of bof.items as { catalogId: string; version: string }[]) {
    await save('billOfFeatures', { id: p.catalogId, ver: p.version });
    await save('productConfiguration', { id: p.catalogId, ver: p.version });
  }
  await save('sharedAssets');
  await save('featureRegistrations');
  for (const f of all.items as { featureId: string; version: string }[]) await save('featureVariability', { id: f.featureId, ver: f.version });
  // 미구현 묶음(2026-11-07) — 묶음별 새 화면의 GET 응답(tools/snapshot-pN.ts)
  const contracts = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');
  await snapshotP1(save, { contracts });
  await snapshotP2(save, { contracts });
  await snapshotP3(save, { features: all.items });
  await snapshotP10(save, { features: all.items });
  await snapshotTx(save, { features: all.items, policies: policies.items });

  // 운영 지표 탭 — Prometheus 텍스트(스냅샷을 찍는 동안 받은 요청)를 JSON으로 감싸 둔다. 마지막에 받아야 위 조회가 모두 들어간다
  const metricsUrl = routeUrl('healthMetrics');
  const metrics = await call(metricsUrl, { headers: { Accept: 'text/plain' } });
  const text = await metrics.text();
  if (!metrics.ok || !text.includes('# TYPE ff_http_')) throw new Error(`${metricsUrl} → ${metrics.status} (Prometheus 지표 없음)`);
  claimSnapshotFile(written, snapshotFile(metricsUrl), metricsUrl);
  writeFileSync(join(OUT, snapshotFile(metricsUrl)), JSON.stringify({ text, capturedAt: new Date().toISOString() }));
  n++;
  console.log(`snapshot:api — ${n}개 응답 → frontend/public/api-snapshot/`);
  // F2 — 읽기 권한 분리·정적 안내 제거(2026-11-05): 개인정보 요청 목록, 감사 이력 다음 쪽, Feature DB 내보내기 파일
  {
    const fs = await import('node:fs');
    const f2 = n;
    // 쓰기는 요청마다 다른 멱등 키로(같은 밀리초에 같은 주소를 두 번 보내도 앞 응답을 되받지 않게)
    const send = async <T = any>(url: string, headers: Record<string, string>, body: unknown): Promise<T> => {
      const r = await call(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `snapshot-f2-${crypto.randomUUID()}`, ...headers }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${await r.text()}`);
      return r.json() as Promise<T>;
    };
    // 개인정보 요청 — 처리 완료·거절·처리 대기 예시. 처리는 요청자와 다른 보안 담당자(4안 원칙). 찍고 버리는 보조 백엔드다
    const CSM = { 'X-Actor-Id': 'usr-integrator', 'X-Actor-Role': 'SECURITY_OFFICER' };
    const CSM2 = { 'X-Actor-Id': 'usr-security-deputy', 'X-Actor-Role': 'SECURITY_OFFICER' };
    const ask = (body: unknown) => send<{ requestId: string }>(routeUrl('createPrivacyRequest'), CSM, body);
    const done = await ask({ subjectKind: 'USER', subjectId: 'usr-retired-0412', basis: 'EMPLOYMENT_END', reason: '퇴직자 계정 정리 — 인사 통보' });
    await send(routeUrl('executePrivacyRequest', { id: done.requestId }), CSM2, {});
    const no = await ask({ subjectKind: 'USER', subjectId: 'usr-partner-0927', basis: 'CONTRACT_END', reason: '협력사 계약 종료' });
    await send(routeUrl('rejectPrivacyRequest', { id: no.requestId }), CSM2, { reason: '계약 분쟁 증빙 보존 기간 중 — 법무 확인 뒤 다시 요청' });
    await ask({ subjectKind: 'VEHICLE', subjectId: (vehicles.items as { vin: string }[])[0].vin, basis: 'DATA_SUBJECT_REQUEST', reason: '차량 소유자 본인 삭제 요청' });
    await save('privacyRequests');
    // 감사 이력 다음 쪽 — 화면 '더 불러오기'가 조건 없는 목록의 커서({ limit, cursor } 순서)로 읽는다. 커서는 id 키셋이라 첫 쪽 뒤에 쌓인 기록과 섞이지 않는다.
    // 서버 커서(마지막 id)는 그때까지 쌓인 감사 건수로 값이 달라져 파일 이름이 배포마다 바뀌었다 — 공개본에는 쪽 순번 커서(staticAuditCursor)로 바꿔 둔다(2026-11-06 시드 결정성)
    const auditPage = (cursor?: string) => routeUrl('audit', {}, cursor ? { limit: 500, cursor } : { limit: 500 });
    let prevUrl = auditPage();
    let prev = JSON.parse(fs.readFileSync(join(OUT, snapshotFile(prevUrl)), 'utf8')) as { nextCursor?: string | null };
    for (let i = 2; prev.nextCursor && i < 402; i++) {
      const body = await get<{ nextCursor?: string | null }>(auditPage(prev.nextCursor), 'audit');
      const alias = staticAuditCursor(i);
      fs.writeFileSync(join(OUT, snapshotFile(prevUrl)), JSON.stringify({ ...prev, nextCursor: alias }));
      prevUrl = auditPage(alias);
      claimSnapshotFile(written, snapshotFile(prevUrl), prevUrl);
      prev = body;
      n++;
    }
    fs.writeFileSync(join(OUT, snapshotFile(prevUrl)), JSON.stringify(prev));
    // Feature DB 내보내기 — 발행본마다 받은 파일(screens/refdb/common.tsx staticExportFile과 같은 이름). 금액 열은 산정 역할만이라 관리자 역할로 받는다
    const releases = await get<{ items: { release: string }[] }>(routeUrl('refReleases'), 'refReleases');
    for (const { release } of releases.items) {
      const url = routeUrl('exportRefdb', {}, { format: 'xlsx', release });
      const r = await call(url, { headers: { 'X-Actor-Id': 'usr-snapshot', 'X-Actor-Role': 'REFDB_ADMIN' } });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      fs.writeFileSync(join(OUT, snapshotFile(url).replace(/\.json$/, '.xlsx')), Buffer.from(await r.arrayBuffer()));
      n++;
    }
    console.log(`snapshot:api F2 — ${n - f2}개 더`);
  }
  // F4 — 홈 성능(2026-11-05): 홈은 차량·회신·게시본 전체 목록 대신 요약 하나(operationSummary)와 감사 이력 20건만 읽는다.
  //      위에서 찍은 전체 목록 파일로 서버와 같은 함수(contracts operationSummary)를 돌려 만든다 — 거르면 읽는 전체 목록과 숫자가 어긋나지 않게.
  //      정적 데모는 역할과 상관없이 회신을 보인다(회신 포함 요약). 감사 20건은 감사 화면 첫 쪽(limit 500)의 앞부분이다
  {
    const fs = await import('node:fs');
    const { adoptionEvaluations, operationSummary } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');
    // 'Feature 적용 현황'(2026-11-06) 실제 사용 단계 — 서버 요약과 같이 최근 평가 span 500건을 가명 subject로 차량에 되짚는다(가명 함수는 백엔드 그대로)
    const { vehiclePseudonym } = require(join(FF, 'backend', 'dist', 'kernel', 'crypto.js')) as { vehiclePseudonym: (vin: string) => string };
    const read = (name: string, query: Record<string, string | number> = {}) => JSON.parse(fs.readFileSync(join(OUT, snapshotFile(routeUrl(name, {}, query))), 'utf8'));
    const items = (name: string, query?: Record<string, string | number>) => read(name, query).items;
    const runtime = read('fleetRuntime');
    const spans = (await get<{ items: unknown[] }>(routeUrl('otelSpans', {}, { name: 'feature_flag.evaluation', limit: 500 }), 'otelSpans')).items as Parameters<typeof adoptionEvaluations>[0];
    const evaluations = adoptionEvaluations(spans, new Map((runtime.items as { vin: string }[]).map((r) => [vehiclePseudonym(r.vin), r.vin])));
    const input = { runtime: runtime.items, vehicles: items('vehicles'), policies: items('listPolicies'), features: items('listFeatures'), publications: items('publications'), readbacks: items('readbacks'), syncs: items('integrationCalls', { ifId: 'IF-04' }), evaluations };
    const write = (name: string, query: Record<string, string | number>, body: unknown) => {
      const url = routeUrl(name, {}, query);
      claimSnapshotFile(written, snapshotFile(url), url);
      fs.writeFileSync(join(OUT, snapshotFile(url)), JSON.stringify(body));
      n++;
    };
    write('operationSummary', {}, operationSummary(input, new Date().toISOString(), true));
    const audit = read('audit', { limit: 500 }) as { items: { id: number }[] };
    const first = audit.items.slice(0, 20);
    write('audit', { limit: 20 }, { items: first, nextCursor: first.length === 20 ? Buffer.from(JSON.stringify({ id: first[19].id })).toString('base64url') : null });
  }

  // F3 — 전시 빈 화면 채우기(2026-11-05): Feature 상세 '감사 이력' 탭은 이 Version 아래 대상(#safety 안전 분류·#G1 Gate·#hara 분석)까지
  //      접두어로 읽는다(화면 질의 순서 { targetPrefix, limit }). 채운 데이터 자체(배포·차단·복원·변경 요청 등)는 백엔드 시드가 만들어 위 조회가 담는다
  {
    const f3 = n;
    for (const f of all.items as { featureId: string; version: string }[]) await save('audit', {}, { targetPrefix: `${f.featureId}@${f.version}`, limit: 100 });
    console.log(`snapshot:api F3 — ${n - f3}개 더`);
  }

  // 시연 주인공(2026-11-06 사용자 결정, Flag 노출 계획 G2~G4) — adas_00004_assist 정책마다 단계 이력(감사 ROLLOUT_STAGE, 질의 순서
  //      { target, action, limit })과 정책 감사 이력, 주인공 Feature의 이상 징후(차단 목록은 위에서 찍었다). 데이터가 빠지면 정적 데모가 대본대로 안 되므로 실패시킨다
  {
    const hero = n;
    const FLAG = 'adas_00004_assist';
    const mine = (policies.items as { policyId: string; flagKey: string; featureVersion: string; status: string }[]).filter((p) => p.flagKey === FLAG);
    let stages = 0;
    for (const p of mine) {
      stages += ((await save('audit', {}, { target: p.policyId, action: 'ROLLOUT_STAGE', limit: 20 })).items as { result: string }[]).filter((a) => a.result === 'ALLOWED').length;
      await save('audit', {}, { target: p.policyId, limit: 100 });
    }
    await save('anomalies', {}, { featureId: 'FEAT-00004' });
    const versions = new Set(mine.map((p) => p.featureVersion));
    const killed = (kills.items as { featureId: string; status: string }[]).some((k) => k.featureId === 'FEAT-00004' && k.status === 'ACTIVE');
    if (stages < 3 || !versions.has('4.1.1') || !killed || !mine.some((p) => p.status === 'DEPLOYED'))
      throw new Error(`시연 주인공 데이터가 비었습니다(${FLAG} 단계 이력 ${stages}건, Version ${[...versions].join('·') || '없음'}, 차단 ${killed ? '있음' : '없음'})`);
    console.log(`snapshot:api 주인공 — ${n - hero}개 더(단계 이력 ${stages}건)`);
  }
}

// 직접 실행(npm run snapshot:api)일 때만 — Windows는 드라이브 글자 대소문자가 다를 수 있다
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const server = await start();
  await main()
    .then(() => {
      assertSnapshotClean(join(OUT, 'api-snapshot'));
      console.log('snapshot:api — 로컬 PC 흔적 0건');
    })
    .catch((e) => {
      console.error('snapshot:api 실패:', e.message);
      process.exitCode = 1;
    })
    .finally(() => {
      server.kill();
      rmSync(EVIDENCE, { recursive: true, force: true });
    });
}
