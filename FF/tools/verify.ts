// npm run verify — 단일 품질 게이트. 순서대로 실행하고 첫 실패에서 멈춘다(--keep-going 이면 끝까지).
// --full: 시각 회귀 등 로컬 전용 단계 포함. --only <id,...>: 일부 단계만.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

interface Step {
  id: string;
  title: string;
  cmd: string;
  cwd?: string;
  full?: boolean; // --full 에서만
  when?: () => boolean; // 해당 단계가 아직 준비되지 않았으면 건너뜀
  env?: Record<string, string>;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const STEPS: Step[] = [
  { id: 'contracts:build', title: 'contracts 빌드 (tsc)', cmd: `${npm} run build -w @ff/contracts` },
  { id: 'typecheck:backend', title: '백엔드 타입 검사', cmd: `${npx} tsc -p tsconfig.json --noEmit`, cwd: 'backend' },
  { id: 'typecheck:frontend', title: '프론트 타입 검사', cmd: `${npx} tsc -b`, cwd: 'frontend' },
  { id: 'lint:tokens', title: '디자인 토큰 lint', cmd: `node tools/lint-tokens.ts` },
  { id: 'lint:spacing', title: '간격·반경 lint (스케일·반경 토큰)', cmd: `node --test tools/spacing-scale.test.ts && node tools/lint-spacing.ts` },
  { id: 'lint:copy', title: '문구 lint (+ 보고서 v1.1 용어 규칙 래칫)', cmd: `node --test tools/guide-terms.test.ts tools/platform-terms.test.ts tools/twin-terms.test.ts tools/lead-copy.test.ts && node tools/lint-copy.ts` },
  { id: 'sim:test', title: 'CARLA 실행기 판정 핵심 (서버 없는 pytest — 기준 운동학 재현·Guard·CLI 계약, LearnCarla venv 없으면 건너뜀)', cmd: `node --test tools/carla-doctor.test.ts && node tools/carla-doctor.ts --pytest` },
  { id: 'guide:check', title: '보고서 v1.1 코드 패키지 정합 (허용 목록·해시·규칙 카탈로그)', cmd: `node --test tools/guide-sync.test.ts && node tools/guide-sync.ts --check` },
  { id: 'workflow:check', title: '담당자 업무 절차 정합 (docs/65-workflows 생성 모듈)', cmd: `node --test tools/workflow-sync.test.ts && node tools/workflow-sync.ts --check` },
  { id: 'deadcode', title: '프론트 고아 모듈 0 (진입점에서 닿지 않는 모듈 금지)', cmd: `node tools/dead-modules.ts --check` },
  { id: 'siblings', title: '형제 저장소 버전 고정 (FF_IMP GLEO v2 pin·LearnCarla CARLA 설치 존재)', cmd: `node --test tools/siblings.test.ts && node tools/siblings.ts` },
  { id: 'openfeature:check', title: 'OpenFeature 규율 (SDK 고정·Experimental·기본값 Safe State)', cmd: `node tools/openfeature-check.ts` },
  { id: 'data:check', title: '데이터셋 픽스처 정합', cmd: `node tools/dataset/check.ts`, when: () => existsSync(join(FF, 'tools', 'dataset', 'check.ts')) },
  { id: 'openapi', title: 'OpenAPI 최신 여부', cmd: `node tools/openapi.ts --check` },
  { id: 'ext:check', title: '외부 연계 연결 점검 도구 (가짜 fetch — 네트워크 없음 · GET만 · 토큰 비출력 · 못 맞춘 상태는 실패)', cmd: `node --test tools/ext-check.test.ts` },
  { id: 'ota:conformance', title: 'OTA 서버 연동 규격 IF-05 (시험 OTA 서버가 적합성 검사 통과 · 규격 위반을 검사가 잡는다 · OpenAPI 정합, 80-45)', cmd: `node --test tools/ota-reference/conformance.test.ts` },
  { id: 'test:contracts', title: 'contracts 테스트', cmd: `${npm} test -w @ff/contracts` },
  { id: 'test:backend', title: '백엔드 테스트', cmd: `${npm} test -w feature-topology-backend` },
  { id: 'test:frontend', title: '프론트 테스트', cmd: `${npm} test -w feature-topology-frontend` },
  { id: 'conformance', title: '42 컴포넌트 준수 (--strict: 42/42가 아니면 실패)', cmd: `node --test tools/verify.test.ts && node tools/conformance.ts --strict` },
  { id: 'standards', title: '보고서 v1.1 규칙 추적 (ID 실재·플랫폼 규칙 구현·시험 래칫)', cmd: `node --test tools/standards.test.ts tools/ratchet.test.ts && node tools/standards.ts` },
  { id: 'req', title: '기능명세서 요구사항 반영 추적 (원본 해시·판정 628건·@req 표식·결함 기록 it.fails·래칫)', cmd: `node --test tools/xlsx.test.ts tools/requirements.test.ts && node tools/requirements.ts` },
  { id: 'ads', title: 'ADS·UNECE v3.0 + Orca R3 반영 추적 (카탈로그 무결성·원본 해시·판정 완비·근거 줄 내용·결함 기록·설계 계획 ID·문서 숫자·보고서 최신)', cmd: `node --test tools/ads-sync.test.ts tools/orca-sync.test.ts tools/defect-probes.test.ts && node tools/ads-sync.ts --check && node tools/orca-sync.ts --check && node tools/ads-report.ts --check` },
  { id: 'ads:team', title: '하네스 멤버 검토 (UI/UX 디자이너·업무 절차 담당·설계 적합성 — 검토가 지금 설계 판 기준인지, 열린 blocker 0, 화면 문구 규칙)', cmd: `node --test tools/ads-team.test.ts && node tools/ads-team.ts --check` },
  { id: 'ads:probes', title: '결함 기록(it.fails)이 재현 단계가 아니라 요구 단언에서 실패하는지 (사본을 it로 바꿔 실행)', cmd: `node tools/defect-probes.ts` },
  { id: 'readiness', title: '출시 준비 게이트 (harness/readiness.json — 완료 항목 되돌아감 0·목록 뒤처짐 0·열린 P0·P1 래칫)', cmd: `node --test tools/readiness.test.ts && node tools/readiness.ts` },
  { id: 'build:frontend', title: '프론트 빌드', cmd: `${npx} vite build`, cwd: 'frontend' },
  { id: 'build:prod', title: '운영 빌드 (VITE_AUTH=oidc — 데모 로그인·데모 역할 선택기가 번들에 없다, dist-prod는 검사 뒤 지움)', cmd: `node --test tools/prod-bundle.test.ts` },
  { id: 'budget', title: '성능 예산 (첫 화면·화면 묶음 gzip, harness/budgets.json)', cmd: `node --test tools/bundle-budget.test.ts && node tools/bundle-budget.ts` },
  { id: 'e2e', title: 'e2e (기능·접근성·레이아웃)', cmd: `${npx} playwright test --grep-invert @visual`, cwd: 'e2e', env: { E2E_WEB: 'preview' }, when: () => existsSync(join(FF, 'e2e', 'playwright.config.ts')) },
  { id: 'e2e:static', title: '정적 데모 (공개 사이트 방식 빌드 — 모든 메뉴·하위 화면·탭이 스냅샷만으로 열린다)', cmd: `${npx} playwright test -c playwright.static.config.ts`, cwd: 'e2e', when: () => existsSync(join(FF, 'e2e', 'playwright.static.config.ts')) },
  { id: 'e2e:oidc', title: 'SSO 로그인 (시험 IdP·FF_AUTH=oidc 백엔드·VITE_AUTH=oidc 빌드 — 로그인·부여 역할·승인·로그아웃·헤더 위조 401)', cmd: `${npx} playwright test -c playwright.oidc.config.ts`, cwd: 'e2e', when: () => existsSync(join(FF, 'e2e', 'playwright.oidc.config.ts')) },
  { id: 'e2e:firstrun', title: '빈 DB 첫 실행 (FF_SEED=none 파일 DB — 모든 메뉴 오류·영원한 로딩·데모 식별자 없음 · 화면으로 첫 Feature 등록, RD-OPS-02)', cmd: `${npx} playwright test -c playwright.firstrun.config.ts`, cwd: 'e2e', when: () => existsSync(join(FF, 'e2e', 'playwright.firstrun.config.ts')) },
  { id: 'test:pg', title: '백엔드 시험을 PostgreSQL 16에서 (Docker postgres:16 127.0.0.1:9690 — 통과 수 래칫 pgBackendPass, 20-92 §6)', cmd: `node tools/test-pg.ts`, full: true },
  { id: 'e2e:visual', title: '시각 회귀', cmd: `${npx} playwright test --grep @visual`, cwd: 'e2e', env: { E2E_WEB: 'preview' }, full: true, when: () => existsSync(join(FF, 'e2e', 'playwright.config.ts')) },
];

const args = process.argv.slice(2);
const full = args.includes('--full');
const keepGoing = args.includes('--keep-going');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

const results: { id: string; title: string; status: 'PASS' | 'FAIL' | 'SKIP'; ms: number; why?: string }[] = [];
let failed = false;
for (const s of STEPS) {
  if (only && !only.includes(s.id)) continue;
  if (s.full && !full) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '--full 전용' }); continue; }
  if (s.when && !s.when()) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '아직 없음' }); continue; }
  if (failed && !keepGoing) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '앞 단계 실패' }); continue; }
  console.log(`\n▶ ${s.title}  (${s.id})`);
  const t0 = Date.now();
  const r = spawnSync(s.cmd, { cwd: join(FF, s.cwd ?? '.'), stdio: 'inherit', shell: true, env: { ...process.env, FORCE_COLOR: '0', ...s.env } });
  const ok = r.status === 0;
  results.push({ id: s.id, title: s.title, status: ok ? 'PASS' : 'FAIL', ms: Date.now() - t0 });
  if (!ok) failed = true;
}

const icon = { PASS: '✓', FAIL: '✕', SKIP: '·' } as const;
console.log('\n──────── verify 요약 ────────');
for (const r of results) {
  const time = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '';
  console.log(`${icon[r.status]} ${r.status.padEnd(4)} ${r.id.padEnd(20)} ${time.padStart(7)}  ${r.why ?? ''}`);
}
console.log(failed ? '\n✕ verify 실패' : '\n✓ verify 통과');
process.exit(failed ? 1 : 0);
