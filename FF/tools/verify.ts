// npm run verify — 단일 품질 게이트. 순서대로 실행하고 첫 실패에서 멈춘다(--keep-going 이면 끝까지).
// --full: 시각 회귀 등 로컬 전용 단계 포함. --only <id,...>: 일부 단계만(npm 스크립트 이름도 받는다 — build:contracts → contracts:build).
// 건너뛰기 약속: 도구가 스스로 건너뛰면 종료 코드 77(SKIP_EXIT)로 끝내고 요약에 SKIP으로 보인다. CI에서는 ALLOWED_SKIP에 있는 단계만 건너뛸 수 있다(나머지는 FAIL).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, SKIP_EXIT } from './lib.ts';

export interface Step {
  id: string;
  title: string;
  cmd: string;
  cwd?: string;
  full?: boolean; // --full 에서만
  when?: () => boolean; // 해당 단계가 아직 준비되지 않았으면 건너뜀(CI에서는 ALLOWED_SKIP이 아니면 FAIL)
  env?: Record<string, string>;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export const STEPS: Step[] = [
  { id: 'contracts:build', title: 'contracts 빌드 (tsc)', cmd: `${npm} run build -w @ff/contracts` },
  { id: 'typecheck:backend', title: '백엔드 타입 검사', cmd: `${npx} tsc -p tsconfig.json --noEmit`, cwd: 'backend' },
  { id: 'typecheck:frontend', title: '프론트 타입 검사', cmd: `${npx} tsc -b`, cwd: 'frontend' },
  { id: 'typecheck:tools', title: '도구 스크립트 타입 검사 (tools/tsconfig.json 래칫) + 스냅샷 백엔드 종료 문구', cmd: `${npx} tsc -p tools/tsconfig.json && node --test tools/snapshot-api.test.ts` },
  { id: 'lint:tokens', title: '디자인 토큰 lint', cmd: `node tools/lint-tokens.ts` },
  { id: 'lint:spacing', title: '간격·반경 lint (스케일·반경 토큰)', cmd: `node --test tools/spacing-scale.test.ts && node tools/lint-spacing.ts` },
  { id: 'lint:copy', title: '문구 lint (+ 보고서 v1.1 용어 규칙 래칫)', cmd: `node --test tools/guide-terms.test.ts tools/platform-terms.test.ts tools/twin-terms.test.ts tools/lead-copy.test.ts tools/particle-copy.test.ts tools/ads-copy-terms.test.ts && node tools/lint-copy.ts` },
  { id: 'sim:test', title: 'CARLA 실행기 판정 핵심 (서버 없는 pytest — 기준 운동학 재현·Guard·CLI 계약, LearnCarla venv 없으면 건너뜀)', cmd: `node --test tools/carla-doctor.test.ts && node tools/carla-doctor.ts --pytest` },
  { id: 'guide:check', title: '보고서 v1.1 코드 패키지 정합 (허용 목록·해시·규칙 카탈로그)', cmd: `node --test tools/guide-sync.test.ts && node tools/guide-sync.ts --check` },
  { id: 'workflow:check', title: '담당자 업무 절차 정합 (docs/65-workflows 생성 모듈)', cmd: `node --test tools/workflow-sync.test.ts && node tools/workflow-sync.ts --check` },
  { id: 'docs:meta', title: '문서 메타데이터 (프런트매터 스키마·추적 ID 등록·Feature DB 문서 수치, 기존 위반 래칫 docs/_meta/docs-meta-baseline.json)', cmd: `node --test tools/docs-meta.test.ts && node tools/docs-meta.ts` },
  { id: 'deadcode', title: '프론트 고아 모듈 0 (진입점에서 닿지 않는 모듈 금지)', cmd: `node tools/dead-modules.ts --check` },
  { id: 'siblings', title: '형제 저장소 버전 고정 (FF_IMP GLEO v2 pin·LearnCarla CARLA 설치 존재)', cmd: `node --test tools/siblings.test.ts && node tools/siblings.ts` },
  { id: 'openfeature:check', title: 'OpenFeature 규율 (SDK 고정·Experimental·기본값 Safe State)', cmd: `node --test tools/flag-sources.test.ts examples/feature-flag-consumer/distance.test.ts examples/feature-flag-consumer/infotainment.test.ts examples/feature-flag-consumer/snapshot-client.test.ts && npx tsc -p examples/feature-flag-consumer/tsconfig.json && node tools/openfeature-check.ts` },
  { id: 'flag-code:check', title: 'Flag 코드 연결 시연 저장소 (차량 기능 앱 생성기 — 다시 만들어 커밋 해시·픽스처 바이트 동일 · 생성 저장소 node --test·tsc · 스캔 서명 · 계획 Flag 누락 0 · 백엔드 대사 수, 20-97 §8.1)', cmd: `${npm} run build --workspace @ff/contracts && node --test tools/flag-code/generate-vehicle-apps.test.ts && ${npm} run build -w feature-topology-backend && node tools/flag-code/generate-vehicle-apps.ts --check` },
  { id: 'data:check', title: '데이터셋 픽스처 정합 (+ 필수 질의 조회는 enabled로 막힘 — 정적 데모 스냅샷 누락 방지 · Feature DB 이전 점검이 망가진 사본을 잡는다)', cmd: `node --test tools/dataset/static-queries.test.ts tools/refdb/check.test.ts tools/cost/check.test.ts && node tools/dataset/check.ts` },
  { id: 'unleash:check', title: 'Unleash 고정·로컬 런타임·SQLite 이전 보호', cmd: `node --test tools/unleash/runtime.test.mjs tools/unleash/legacy-migration.test.mjs` },
  { id: 'grafana:check', title: 'Grafana 연동 (OTLP 인코딩·가짜 수신기 · 시연 시계열 결정성·무료 한도 · 쿼리 지표 이름 = 카탈로그 · 공개본 변수 없음 · 가짜 Grafana API 프로비저닝 · 워크플로·Alloy·compose, 80-80)', cmd: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tools/grafana/grafana.test.ts && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/grafana/build-dashboards.ts --check` },
  { id: 'cloud:check', title: '클라우드 VM 공개 시연 키트 (호스트 포트·내부망·게이트 우회 방지 preflight·비밀 생성·이미지 다이제스트·서명·백업 암호화·SSH 강화 — docker CLI가 없으면 compose 해석만 건너뜀, 20-99)', cmd: `node --test deploy/cloud-vm/test/compose.test.mjs` },
  { id: 'packaging', title: '배포본 구성 (데스크톱 ui에 정적 데모 스냅샷 없음·경로 길이 · 백엔드가 읽는 data/ 폴더가 이미지·데스크톱에 실림 · 이미지 CI가 Feature DB 준비 점검 · 공개 스냅샷에 로컬 PC 흔적(localhost·사설 IP·절대 경로·사용자 이름) 없음 · 화면 조회의 필터 키·키 순서가 스냅샷에 있음)', cmd: `${npm} run build -w feature-topology-backend && node tools/snapshot-api.ts && node --test tools/packaging.test.mjs tools/demo-publish.test.ts && node --test tools/local-leaks.test.ts tools/static-build.test.ts tools/snapshot-coverage.test.ts && node tools/local-leaks.ts frontend/public/api-snapshot && node tools/snapshot-coverage.ts frontend/public/api-snapshot` },
  { id: 'test:hygiene', title: '시험 결정성 (고정 포트·잠자기·실시간 기한·Date.now 비교·waitForTimeout·삼킨 대기 래칫, 건너뛴 시험 수 래칫, vitest 제한 시간·작업자 상한)', cmd: `node --test tools/test-hygiene.test.ts tools/flaky.test.ts tools/pg-test-config.test.ts tools/pg-test-lease.test.ts tools/pg-test-result.test.ts && node tools/test-hygiene.ts` },
  { id: 'openapi', title: 'OpenAPI 최신 여부', cmd: `node tools/openapi.ts --check` },
  { id: 'ext:check', title: '외부 연계 연결 점검 도구 (가짜 fetch — 네트워크 없음 · GET만 · 토큰 비출력 · 못 맞춘 상태는 실패)', cmd: `node --test tools/ext-check.test.ts` },
  { id: 'pages:gate', title: '공개 사이트 접속 게이트 (Pages Functions 미들웨어 — 쿠키 없음 302·401·서명 쿠키·위조·만료·next·자산 예외·비밀 키 없으면 닫힘)', cmd: `node --test tools/pages-gate.test.ts` },
  { id: 'export:verify', title: '감사·검증 이력 내보내기 독립 검증 도구 (공개 키만으로 데이터 SHA-256·머리 줄·Ed25519 서명 확인 · 바꾼 파일·다른 키는 실패, contracts 빌드 뒤)', cmd: `node --test tools/verify-export.test.ts` },
  { id: 'ota:conformance', title: 'OTA 서버 연동 규격 IF-05 (시험 OTA 서버가 적합성 검사 통과 · 규격 위반을 검사가 잡는다 · OpenAPI 정합, 80-45)', cmd: `node --test tools/ota-reference/conformance.test.ts` },
  { id: 'test:contracts', title: 'contracts 테스트', cmd: `${npm} test -w @ff/contracts` },
  { id: 'test:backend', title: '백엔드 테스트', cmd: `${npm} test -w feature-topology-backend` },
  { id: 'test:frontend', title: '프론트 테스트', cmd: `${npm} test -w feature-topology-frontend` },
  { id: 'conformance', title: '42 컴포넌트 준수 (--strict: 42/42가 아니면 실패 · 화면·시험 역방향 검사)', cmd: `node --test tools/verify.test.ts tools/conformance.test.ts && node tools/conformance.ts --strict` },
  { id: 'standards', title: '보고서 v1.1 규칙 추적 (ID 실재·플랫폼 규칙 구현·시험 래칫 · 예산·래칫 완화는 사유 기록)', cmd: `node --test tools/standards.test.ts tools/ratchet.test.ts tools/budget-history.test.ts && node tools/standards.ts` },
  { id: 'req', title: '기능명세서 요구사항 반영 추적 (원본 해시·판정 628건·@req 표식·결함 기록 it.fails·래칫)', cmd: `node --test tools/xlsx.test.ts tools/requirements.test.ts && node tools/requirements.ts` },
  { id: 'ads', title: 'ADS·UNECE v3.0 + Orca R3 반영 추적 (카탈로그 무결성·원본 해시·판정 완비·근거 줄 내용·근거 줄 잠금 해시·결함 기록·설계 계획 ID·문서 숫자·보고서 최신)', cmd: `node --test tools/ads-sync.test.ts tools/orca-sync.test.ts tools/defect-probes.test.ts tools/anchors.test.ts tools/ads-trace.test.ts && node tools/ads-sync.ts --check && node tools/ads-trace.ts --check && node tools/orca-sync.ts --check && node tools/ads-report.ts --check` },
  { id: 'ads:team', title: '하네스 멤버 검토 (UI/UX 디자이너·업무 절차 담당·설계 적합성 — 검토가 지금 설계 판 기준인지, 열린 blocker 0, 화면 문구 규칙)', cmd: `node --test tools/ads-team.test.ts && node tools/ads-team.ts --check` },
  { id: 'ads:probes', title: '결함 기록(it.fails)이 재현 단계가 아니라 요구 단언에서 실패하는지 (사본을 it로 바꿔 실행)', cmd: `node tools/defect-probes.ts` },
  { id: 'readiness', title: '출시 준비 게이트 (harness/readiness.json — 완료 항목 되돌아감 0·목록 뒤처짐 0·열린 P0·P1 래칫 · PG 측정 뒤 마이그레이션 경고)', cmd: `node --test tools/readiness.test.ts && node tools/readiness.ts` },
  { id: 'build:frontend', title: '프론트 빌드', cmd: `${npx} vite build`, cwd: 'frontend' },
  { id: 'build:prod', title: '운영 빌드 (VITE_AUTH=oidc — 데모 로그인·데모 역할 선택기가 번들에 없다, dist-prod는 검사 뒤 지움)', cmd: `node --test tools/prod-bundle.test.ts` },
  { id: 'budget', title: '성능 예산 (첫 화면·화면 묶음 gzip, harness/budgets.json)', cmd: `node --test tools/browser-routes.test.ts tools/bundle-budget.test.ts && node tools/bundle-budget.ts` },
  // 부하 시험(RD-P2-01) — 축소 데이터로 주요 API 예산(harness/perf-budgets.json)·질의 계획은 backend 시험(query-plans.spec)이 본다. 포트 E2E_LOAD_PORT(기본 9659)
  { id: 'perf', title: '부하 시험 light (Feature 200·차량 5천·감사 5만 — 시나리오별 p95 예산, 빌드된 백엔드 별도 프로세스)', cmd: `${npm} run build -w feature-topology-backend && node --test tools/load/stats.test.ts && node tools/load/run.ts --profile light` },
  { id: 'perf:full', title: '부하 시험 full (Feature 2천·차량 10만·감사 100만·이벤트 50만·알림 10만 — 첫 실행은 시드 2~3분, .sim/load에 캐시)', cmd: `node tools/load/run.ts --profile full`, full: true },
  { id: 'e2e', title: 'e2e (기능·접근성·레이아웃 — chromium 전체 + firefox·webkit 핵심 흐름 스모크 + 768·390 좁은 폭)', cmd: `${npx} playwright test --grep-invert @visual`, cwd: 'e2e', env: { E2E_WEB: 'preview' } },
  { id: 'e2e:static', title: '정적 데모 (공개 사이트 방식 빌드 — 모든 메뉴·하위 화면·탭이 스냅샷만으로 열린다)', cmd: `${npx} playwright test -c playwright.static.config.ts`, cwd: 'e2e' },
  { id: 'e2e:oidc', title: 'SSO 로그인 (시험 IdP·FF_AUTH=oidc 백엔드·VITE_AUTH=oidc 빌드 — 로그인·부여 역할·승인·로그아웃·헤더 위조 401)', cmd: `${npx} playwright test -c playwright.oidc.config.ts`, cwd: 'e2e' },
  { id: 'e2e:firstrun', title: '빈 DB 첫 실행 (FF_SEED=none 파일 DB — 모든 메뉴 오류·영원한 로딩·데모 식별자 없음 · 화면으로 첫 Feature 등록, RD-OPS-02)', cmd: `${npx} playwright test -c playwright.firstrun.config.ts`, cwd: 'e2e' },
  { id: 'unleash:live', title: '공식 Unleash·Edge·Native PG 격리 실행 및 차량 인증·서명·실제 변경 불일치 E2E', cmd: `node tools/unleash/live-check.mjs`, full: true },
  { id: 'test:pg', title: '백엔드 PostgreSQL 호환 (기본 Docker16 또는 분리된 로컬 Native PG · 실제 버전 기록 · 통과 수 래칫 pgBackendPass, 20-92 §6)', cmd: `node tools/test-pg.ts`, full: true },
  { id: 'e2e:engines', title: '좁은 폭을 다른 엔진으로 (tablet 768 firefox · mobile 390 webkit, RD-P2-03)', cmd: `${npx} playwright test --project=tablet-firefox --project=mobile-webkit`, cwd: 'e2e', env: { E2E_WEB: 'preview', E2E_ALL_ENGINES: '1' }, full: true },
  { id: 'e2e:visual', title: '시각 회귀', cmd: `${npx} playwright test --grep @visual`, cwd: 'e2e', env: { E2E_WEB: 'preview' }, full: true },
];

/** CI에서도 건너뛰어도 되는 단계와 이유 — 여기에 없는 단계가 CI에서 건너뛰면(when 거짓·종료 77) FAIL */
export const ALLOWED_SKIP: Record<string, string> = {
  'sim:test': 'LearnCarla venv(CARLA Python)가 CI에 없다 — 서버 없는 pytest는 로컬에서만',
  siblings: '형제 저장소(FF_IMP)가 CI에 없다 — GLEO 실연동 시험도 함께 건너뛴다',
};

/** npm 스크립트 이름이 단계 ID와 다른데 명령 내용으로 찾을 수 없는 것 — 나머지는 scriptAliases가 명령 내용으로 찾는다 */
const EXPLICIT_ALIASES: Record<string, string[]> = {
  'refdb:check': ['data:check'], // dataset/check.ts가 checkRefdb를 함께 부른다
};

const norm = (cmd: string) => cmd.replace(/\bnpm\.cmd\b/g, 'npm').replace(/\bnpx\.cmd\b/g, 'npx').trim();

/** npm 스크립트 이름 → 단계 ID들. 스크립트 명령이 단계 명령 안에 그대로 있으면 그 단계(예: build:contracts → contracts:build) */
export function scriptAliases(scripts: Record<string, string>, steps: Step[] = STEPS): Record<string, string[]> {
  const ids = new Set(steps.map((s) => s.id));
  const out: Record<string, string[]> = {};
  for (const [name, cmd] of Object.entries(scripts)) {
    if (ids.has(name)) continue;
    const c = norm(cmd);
    const hit = steps.filter((s) => norm(s.cmd).includes(c)).map((s) => s.id);
    if (hit.length) out[name] = hit;
  }
  for (const [name, to] of Object.entries(EXPLICIT_ALIASES)) if (!ids.has(name)) out[name] = to.filter((t) => ids.has(t));
  return out;
}

function defaultAliases(): Record<string, string[]> {
  try {
    return scriptAliases(JSON.parse(readFileSync(join(FF, 'package.json'), 'utf8')).scripts ?? {});
  } catch {
    return scriptAliases({});
  }
}

/** 편집 거리 — 모르는 단계 ID에 가장 가까운 이름을 제안한다 */
export function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
export const nearest = (name: string, names: string[]) => [...names].sort((x, y) => distance(name, x) - distance(name, y) || x.localeCompare(y))[0];

/** --only 해석 — 없으면 only=null(전체), 값이 없거나 모르는 ID면 error(종료 2) */
export function resolveOnly(args: string[], steps: Step[] = STEPS, aliases: Record<string, string[]> = defaultAliases()): { only: Set<string> | null; error?: string } {
  const eq = args.find((a) => a.startsWith('--only='));
  const idx = args.indexOf('--only');
  if (!eq && idx < 0) return { only: null };
  const raw = eq ? eq.slice('--only='.length) : args[idx + 1];
  if (raw === undefined || raw.startsWith('--') || !raw.trim()) return { only: null, error: '--only 다음에 단계 ID를 쉼표로 적는다 (예: --only lint:copy,test:hygiene)' };
  const ids = new Set(steps.map((s) => s.id));
  const names = [...ids, ...Object.keys(aliases)];
  const only = new Set<string>();
  const unknown: string[] = [];
  for (const name of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (ids.has(name)) only.add(name);
    else if (aliases[name]?.length) for (const t of aliases[name]) only.add(t);
    else unknown.push(`'${name}' — 혹시 '${nearest(name, names)}'?`);
  }
  if (unknown.length) return { only: null, error: `모르는 단계 ${unknown.join(', ')} (단계 ID: ${[...ids].join(', ')})` };
  if (!only.size) return { only: null, error: '--only에 단계 ID가 없다' };
  return { only };
}

export type Status = 'PASS' | 'FAIL' | 'SKIP';
/** 건너뜀 판정 — CI에서는 ALLOWED_SKIP에 있는 단계만 SKIP, 나머지는 FAIL(준비 안 된 단계가 통과처럼 보이지 않게) */
export function skipOutcome(step: Pick<Step, 'id'>, why: string, ci: boolean): { status: Status; why: string } {
  if (ci && !(step.id in ALLOWED_SKIP)) return { status: 'FAIL', why: `${why} — CI에서는 건너뛸 수 없는 단계(tools/verify.ts ALLOWED_SKIP)` };
  return { status: 'SKIP', why };
}
/** 단계 명령의 종료 코드 → 결과. 77은 도구가 스스로 건너뛴 것 */
export function outcome(step: Pick<Step, 'id'>, code: number | null, ci: boolean): { status: Status; why?: string } {
  if (code === 0) return { status: 'PASS' };
  if (code === SKIP_EXIT) return skipOutcome(step, '도구가 건너뜀(종료 77)', ci);
  return { status: 'FAIL' };
}

function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const keepGoing = args.includes('--keep-going');
  const ci = !!process.env.CI;
  const { only, error } = resolveOnly(args);
  if (error) {
    console.error(`verify: ${error}`);
    process.exit(2);
  }

  const results: { id: string; title: string; status: Status; ms: number; why?: string }[] = [];
  let failed = false;
  for (const s of STEPS) {
    if (only && !only.has(s.id)) continue;
    if (s.full && !full) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '--full 전용' }); continue; }
    if (failed && !keepGoing) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '앞 단계 실패' }); continue; }
    if (s.when && !s.when()) {
      const r = skipOutcome(s, '아직 없음', ci);
      results.push({ id: s.id, title: s.title, ms: 0, ...r });
      if (r.status === 'FAIL') failed = true;
      continue;
    }
    console.log(`\n▶ ${s.title}  (${s.id})`);
    const t0 = Date.now();
    // FF_VERIFY=1 — 스스로 건너뛰는 도구가 종료 77로 알린다(npm 스크립트로 직접 돌리면 0)
    const r = spawnSync(s.cmd, { cwd: join(FF, s.cwd ?? '.'), stdio: 'inherit', shell: true, env: { ...process.env, FORCE_COLOR: '0', FF_VERIFY: '1', ...s.env } });
    const o = outcome(s, r.status, ci);
    results.push({ id: s.id, title: s.title, ms: Date.now() - t0, ...o });
    if (o.status === 'FAIL') failed = true;
  }

  const icon = { PASS: '✓', FAIL: '✕', SKIP: '·' } as const;
  console.log('\n──────── verify 요약 ────────');
  for (const r of results) {
    const time = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '';
    console.log(`${icon[r.status]} ${r.status.padEnd(4)} ${r.id.padEnd(20)} ${time.padStart(7)}  ${r.why ?? ''}`);
  }
  console.log(failed ? '\n✕ verify 실패' : '\n✓ verify 통과');
  process.exit(failed ? 1 : 0);
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('tools/verify.ts')) main();
