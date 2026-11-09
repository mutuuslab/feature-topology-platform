// 운영 빌드(VITE_AUTH=oidc) 번들 검사 — 데모 로그인(ID/PW)·데모 역할 선택기가 실리지 않았는가. verify 단계 `build:prod`.
// 프론트를 frontend/dist-prod에 따로 빌드하고(끝나면 지운다) 모든 JS·HTML을 읽는다. 데모 빌드(frontend/dist)가 있으면 같은 검사가
// 그쪽에서는 걸리는지(표식이 있다) 함께 확인한다 — 검사가 아무것도 못 찾는 빈 검사가 되지 않게.
// readiness: RD-SEC-02, RD-SEC-03
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { FF } from './lib.ts';

const FRONT = join(FF, 'frontend');
const OUT = join(FRONT, 'dist-prod');
const DEMO = join(FRONT, 'dist');

const LOGIN_MARKER = 'ff-demo-login-v1';
const ROLES_MARKER = 'ff-demo-roles-v1';
// 데모·개발 전용 화면(결정 D-RD-8) — 디자인 시스템 갤러리·표준 따라하기 화면의 표식
const GALLERY_MARKER = 'ff-design-gallery-v1';
const LEARN_MARKER = 'ff-learn-v1';
const DEPT_MARKER = 'ff-dept-view-v1';
const WORKSPACE_MARKER = 'data-workspace-home';
const EXTERNAL_MARKER = 'ff-external-demo-v1';
/** Detect an actual route field, not a translation dictionary key or a navigation comparison. */
const DESIGN_ROUTE = /(?:\bpath|["'`]path["'`])\s*:\s*["'`]\/_design["'`]/;
/** FF는 제품 약어이기도 하다. 문자열 대신 실제로 번들에 남은 데모 인증 모듈을 검사한다. */
const demoAuthModule = (id: string) => /\/src\/(?:auth-demo\.ts|screens\/auth\/DemoLoginForm\.tsx)(?:$|\?)/.test(id.replaceAll('\\', '/'));

function bundleText(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

let prod = '';
let prodModules: string[] = [];
before(() => {
  rmSync(OUT, { recursive: true, force: true });
  // 기존 운영 빌드 한 번에서 Rollup의 renderedLength도 받는다. 공개 계정 FF/FF가
  // 제품 표기와 겹쳐도 실제 인증 구현의 포함 여부를 놓치거나 오탐하지 않는다.
  const code = [
    "import { build } from 'vite';",
    "import { writeFileSync } from 'node:fs';",
    "const result = await build({ build: { outDir: 'dist-prod', emptyOutDir: true }, logLevel: 'error' });",
    "const outputs = (Array.isArray(result) ? result : [result]).flatMap(x => x.output);",
    "const ids = [...new Set(outputs.filter(x => x.type === 'chunk').flatMap(x => Object.entries(x.modules).filter(([, m]) => m.renderedLength > 0).map(([id]) => id)))];",
    "writeFileSync('dist-prod/auth-build-modules.json', JSON.stringify(ids));",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: FRONT, encoding: 'utf8', env: { ...process.env, VITE_AUTH: 'oidc', VITE_DATA_MODE: '' } });
  assert.equal(r.status, 0, `운영 빌드 실패:\n${(r.stderr || r.stdout).slice(-2000)}`);
  prod = bundleText(OUT);
  prodModules = JSON.parse(readFileSync(join(OUT, 'auth-build-modules.json'), 'utf8'));
});
after(() => rmSync(OUT, { recursive: true, force: true }));

test('운영 빌드에 데모 로그인 표식·자격 검증 모듈이 없다', () => {
  assert.ok(prod.length > 100_000, '번들을 읽지 못했다');
  assert.equal(prod.includes(LOGIN_MARKER), false, '데모 로그인 모듈(auth-demo·DemoLoginForm)이 운영 빌드에 실렸다');
  assert.ok(prodModules.length > 0, '운영 빌드의 실제 렌더링 모듈 목록을 읽지 못했다');
  assert.deepEqual(prodModules.filter(demoAuthModule), [], '데모 자격 검증 구현이 운영 빌드에 실렸다');
});

test('데모 인증 모듈 판별은 Windows·Linux·가상 모듈 경로에서 동작한다', () => {
  for (const path of ['C:\\repo\\frontend\\src\\auth-demo.ts', '/repo/frontend/src/screens/auth/DemoLoginForm.tsx', '/repo/frontend/src/auth-demo.ts?commonjs-proxy']) assert.ok(demoAuthModule(path), path);
  for (const path of ['/repo/frontend/src/auth.ts', '/repo/frontend/src/screens/auth/Login.tsx', '/repo/frontend/src/auth-demo-other.ts']) assert.equal(demoAuthModule(path), false, path);
});

test('design route detection distinguishes route definitions from copy keys', () => {
  for (const code of ['{path:"/_design",element:Gallery}', '{"path":"/_design"}', "{path:'/_design'}"]) assert.ok(DESIGN_ROUTE.test(code), code);
  for (const code of ['{"/_design":"Design system"}', 'href==="/_design"', '"/_design"']) assert.equal(DESIGN_ROUTE.test(code), false, code);
});

test('운영 빌드에 데모 역할 선택기(데모 계정 전체 목록)가 없고 SSO 로그인이 있다', () => {
  assert.equal(prod.includes(ROLES_MARKER), false, '데모 역할 선택기가 운영 빌드에 실렸다');
  assert.ok(prod.includes('/api/auth/login'), 'SSO 로그인 경로가 없다');
  assert.ok(prod.includes('/api/auth/me'), '로그인 상태 조회가 없다');
});

test('운영 빌드에 디자인 시스템 갤러리(/_design)·표준 따라하기(/learn) 화면이 없다(D-RD-8)', () => {
  assert.equal(prod.includes(GALLERY_MARKER), false, '디자인 갤러리 화면 묶음이 운영 빌드에 실렸다');
  assert.equal(prod.includes(LEARN_MARKER), false, '표준 따라하기 화면 묶음이 운영 빌드에 실렸다');
  assert.equal(prod.includes(DEPT_MARKER), false, '데모 부서 보기(부서 메뉴)가 운영 빌드에 실렸다');
  assert.equal(prod.includes(WORKSPACE_MARKER), false, '데모 부서 작업공간 홈 묶음이 운영 빌드에 실렸다');
  assert.equal(prod.includes(EXTERNAL_MARKER), false, '가상 외부 시스템 화면이 운영 빌드에 실렸다');
  assert.equal(DESIGN_ROUTE.test(prod), false, '/_design 라우트가 운영 빌드에 있다');
});

test('데모 빌드(있으면)에는 같은 표식이 있다 — 검사가 실제로 무언가를 찾는다', (t) => {
  if (!existsSync(join(DEMO, 'index.html'))) return t.skip('frontend/dist 없음 — verify의 build:frontend 뒤에 돈다');
  const demo = bundleText(DEMO);
  assert.ok(demo.includes(LOGIN_MARKER), '데모 빌드에 데모 로그인 표식이 없다');
  assert.ok(demo.includes(ROLES_MARKER), '데모 빌드에 데모 역할 선택기 표식이 없다');
  assert.ok(demo.includes(GALLERY_MARKER), '데모 빌드에 디자인 갤러리 표식이 없다');
  assert.ok(demo.includes(LEARN_MARKER), '데모 빌드에 표준 따라하기 표식이 없다');
  assert.ok(demo.includes(EXTERNAL_MARKER), '데모 빌드에 가상 외부 시스템 표식이 없다');
  assert.ok(DESIGN_ROUTE.test(demo), '데모 빌드에 /_design 라우트가 없다');
});
