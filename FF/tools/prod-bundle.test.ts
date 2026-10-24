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
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const LOGIN_MARKER = 'ff-demo-login-v1';
const ROLES_MARKER = 'ff-demo-roles-v1';
// 데모·개발 전용 화면(결정 D-RD-8) — 디자인 시스템 갤러리·표준 따라하기 화면의 표식
const GALLERY_MARKER = 'ff-design-gallery-v1';
const LEARN_MARKER = 'ff-learn-v1';
/** 라우트 표의 경로 문자열 '/_design'(따옴표로 감싼 값) */
const DESIGN_ROUTE = /["'`]\/_design["'`]/;
/** 데모 비밀번호 문자열 — SSE 이벤트 이름 addEventListener("platform")은 같은 글자라 빼고 센다 */
const passwordLiteral = (text: string) => /(["'`])platform\1/.test(text.replace(/addEventListener\((["'`])platform\1/g, ''));

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
before(() => {
  rmSync(OUT, { recursive: true, force: true });
  const r = spawnSync(`${npx} vite build --outDir dist-prod --emptyOutDir --logLevel error`, { cwd: FRONT, shell: true, encoding: 'utf8', env: { ...process.env, VITE_AUTH: 'oidc', VITE_DATA_MODE: '' } });
  assert.equal(r.status, 0, `운영 빌드 실패:\n${(r.stderr || r.stdout).slice(-2000)}`);
  prod = bundleText(OUT);
});
after(() => rmSync(OUT, { recursive: true, force: true }));

test('운영 빌드에 데모 로그인 표식·데모 비밀번호가 없다', () => {
  assert.ok(prod.length > 100_000, '번들을 읽지 못했다');
  assert.equal(prod.includes(LOGIN_MARKER), false, '데모 로그인 모듈(auth-demo·DemoLoginForm)이 운영 빌드에 실렸다');
  assert.equal(passwordLiteral(prod), false, '데모 비밀번호 문자열이 운영 빌드에 있다');
});

test('운영 빌드에 데모 역할 선택기(데모 계정 전체 목록)가 없고 SSO 로그인이 있다', () => {
  assert.equal(prod.includes(ROLES_MARKER), false, '데모 역할 선택기가 운영 빌드에 실렸다');
  assert.ok(prod.includes('/api/auth/login'), 'SSO 로그인 경로가 없다');
  assert.ok(prod.includes('/api/auth/me'), '로그인 상태 조회가 없다');
});

test('운영 빌드에 디자인 시스템 갤러리(/_design)·표준 따라하기(/learn) 화면이 없다(D-RD-8)', () => {
  assert.equal(prod.includes(GALLERY_MARKER), false, '디자인 갤러리 화면 묶음이 운영 빌드에 실렸다');
  assert.equal(prod.includes(LEARN_MARKER), false, '표준 따라하기 화면 묶음이 운영 빌드에 실렸다');
  assert.equal(DESIGN_ROUTE.test(prod), false, '/_design 라우트가 운영 빌드에 있다');
});

test('데모 빌드(있으면)에는 같은 표식이 있다 — 검사가 실제로 무언가를 찾는다', (t) => {
  if (!existsSync(join(DEMO, 'index.html'))) return t.skip('frontend/dist 없음 — verify의 build:frontend 뒤에 돈다');
  const demo = bundleText(DEMO);
  assert.ok(demo.includes(LOGIN_MARKER), '데모 빌드에 데모 로그인 표식이 없다');
  assert.ok(demo.includes(ROLES_MARKER), '데모 빌드에 데모 역할 선택기 표식이 없다');
  assert.ok(passwordLiteral(demo), '데모 빌드에 데모 비밀번호가 없다(검사 규칙이 낡았다)');
  assert.ok(demo.includes(GALLERY_MARKER), '데모 빌드에 디자인 갤러리 표식이 없다');
  assert.ok(demo.includes(LEARN_MARKER), '데모 빌드에 표준 따라하기 표식이 없다');
  assert.ok(DESIGN_ROUTE.test(demo), '데모 빌드에 /_design 라우트가 없다');
});
