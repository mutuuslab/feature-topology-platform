import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, collectBudgetAssets } from './bundle-budget.ts';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const K = 1024;
const B = { initialGzipKiB: 100, chunkGzipKiB: 10, allow: { VehicleTwinScene: 50 } };

test('첫 화면 합계가 예산을 넘으면 실패', () => {
  assert.equal(judge([{ file: 'main-abcdefgh.js', gzip: 80 * K }, { file: 'main-abcdefgh.css', gzip: 30 * K }], new Set(['main-abcdefgh.js', 'main-abcdefgh.css']), B).length, 1);
});
test('화면 묶음은 하나하나 예산 — 허용 목록은 그 값', () => {
  const r = judge([{ file: 'Policies-ABCDEFGH.js', gzip: 11 * K }, { file: 'VehicleTwinScene-BA4x7Hu-.js', gzip: 40 * K }], new Set(), B);
  assert.deepEqual(r, ['Policies-ABCDEFGH.js 11 KiB > 예산 10 KiB']);
});

test('public 복구 스크립트도 해시 자산과 같은 첫 화면 예산에 합산한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-entry-budget-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/main-abcdefgh.js'), 'main');
    writeFileSync(join(dir, 'boot-check.js'), 'recovery');
    writeFileSync(join(dir, 'index.html'), '<script src="/base/assets/main-abcdefgh.js"></script><script src="/base/boot-check.js?v=1"></script>');
    const { chunks, initial } = collectBudgetAssets(dir);
    assert.deepEqual([...initial].sort(), ['main-abcdefgh.js', 'public:boot-check.js']);
    const total = chunks.filter(c => initial.has(c.file)).reduce((n, c) => n + c.gzip, 0);
    assert.equal(total, gzipSync('main').length + gzipSync('recovery').length);
    assert.equal(judge(chunks, initial, { ...B, initialGzipKiB: (total - 1) / K }).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// 첫 화면 묶음(main 진입)이 정적으로 읽는 모듈은 그 모듈의 모든 내보내기(다른 화면이 쓰는 것까지)가 첫 화면에 들어간다.
// 그래서 첫 화면 코드는 무거운 규칙·문구 파일 대신 가벼운 정의 파일을 읽는다(2026-11-06 첫 화면 296.4 → 289.3 KiB)
test('첫 화면 코드는 알림 규칙표·지도 규칙·업무함 문구 파일을 직접 읽지 않는다', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const routes = src('contracts/src/routes.ts');
  assert.doesNotMatch(routes, /from '\.\/rules\/notification'/, 'API 경로 표는 notification-kinds만 읽는다');
  assert.doesNotMatch(routes, /from '\.\/rules\/fleet-map'/, 'API 경로 표는 location-view만 읽는다');
  assert.doesNotMatch(src('frontend/src/shell/NotificationBell.tsx'), /import \{[^}]*NOTIFICATION_RULES/, '상단바 종은 NOTIFICATION_EVENT_TYPES만 쓴다');
  assert.doesNotMatch(src('frontend/src/store.tsx'), /copy\/inbox/, '앱 상태는 copy/departments의 부서 전환 문구만 쓴다');
});

// 2026-11-06 하네스 리뷰: 화면 입구(contracts web.ts → core.ts)가 규칙 모듈을 모두 다시 내보내 Rollup이 그 모듈들을 '부수효과 있음'으로 보고
// 첫 화면에 통째로 실었다(정적 314 KiB). frontend/vite.config.ts는 contracts/src를 부수효과 없음으로 표시한다 — 그 전제(최상위 실행문 없음)를 지킨다
test('contracts는 최상위 실행문이 없다(보고서 카탈로그 설치 하나만) — vite 트리쉐이크 표시의 전제', async () => {
  const ts = (await import('typescript')).default;
  const { walk } = await import('./lib.ts');
  const root = join(import.meta.dirname, '..', 'contracts', 'src');
  const bad: string[] = [];
  for (const f of walk(root, ['.ts'])) {
    if (/\.test\.ts$/.test(f)) continue;
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      const decl = ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isVariableStatement(st) || ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isExportAssignment(st) || ts.isEmptyStatement(st);
      if (!decl && !f.replace(/\\/g, '/').endsWith('rules/report-catalog-installed.ts')) bad.push(`${f}:${sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1}`);
    }
  }
  assert.deepEqual(bad, [], '최상위 실행문이 생기면 vite.config.ts moduleSideEffects 예외에 넣거나 함수 안으로 옮긴다');
  const vite = readFileSync(join(import.meta.dirname, '..', 'frontend', 'vite.config.ts'), 'utf8');
  assert.match(vite, /path\.includes\('\/contracts\/src\/'\) && !path\.endsWith\('\/contracts\/src\/rules\/report-catalog-installed\.ts'\) \? false : null/);
  assert.doesNotMatch(readFileSync(join(root, 'web.ts'), 'utf8'), /report-catalog-installed/, '화면 입구는 카탈로그 설치를 거치지 않는다');
});

// 시연 엔진 입구(api/sim/index.ts)가 핸들러를 정적으로 읽으면 모든 흐름이 묶음 하나(97 KiB)에 섞인다 — 흐름별 지연 import만
test('시연 엔진 입구는 핸들러를 정적으로 읽지 않는다(흐름별 지연 묶음)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'frontend', 'src', 'api', 'sim', 'index.ts'), 'utf8');
  assert.doesNotMatch(src, /^import\s+['"]\.\/handlers\//m);
  assert.doesNotMatch(src, /^import\s[^;]*from\s+['"]\.\/handlers\//m);
  assert.match(src, /import\('\.\/handlers\/kill'\)/);
});
