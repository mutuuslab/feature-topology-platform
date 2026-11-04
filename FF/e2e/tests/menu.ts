// 메뉴 목록 — 프론트 routes.tsx를 소스 그대로 읽는다(브라우저 테스트가 앱 코드를 import하지 않게).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', '..', 'frontend', 'src', 'routes.tsx'), 'utf8');

export interface MenuEntry {
  path: string;
  title: string;
  menu: string;
  group: string;
}

export const MENU_ENTRIES: MenuEntry[] = [...src.matchAll(/\{ path: '([^']+)',[^\n]*?title: '([^']+)', group: '(\w+)', menu: '([^']+)'/g)].map((m) => ({
  path: m[1],
  title: m[2],
  group: m[3],
  menu: m[4],
}));

/** 신규(재디자인) 화면 — 접근성 위반 0이 하드 규칙 */
export const V2_PATHS = [...src.matchAll(/\{ path: '([^']+)'[^\n]*v2: true/g)].map((m) => m[1]);

/** 메뉴 밖 하위 화면(부모가 있는 drill-down) — 이전 주소(legacyTo·*Redirect)는 빼고, 경로 인자는 시연 값으로 채운다 */
const SAMPLE: Record<string, string> = {
  '/features/:id/:ver': '/features/FEAT-00022/1.0.0',
  '/procurement/sw-cost/:estId': '/procurement/sw-cost/EST-0001',
  '/products/:id/:ver': '/products/CAT-00001/3.0.0',
  '/policies/:id': '/policies/POL-00001',
  '/deployments/:id': '/deployments/PUB-00001',
  '/learn/:id': '/learn/CS-01',
  '/procedures/:id': '/procedures/FPW.7',
  '/twin/vehicle/:vin': '/twin/vehicle/VIN-DEMO-017',
  '/fleet/vehicles/:vin': '/fleet/vehicles/ego-01',
  // Feature DB v1.3(엑셀 가져옴) 기준 행 — 오토 홀드
  '/master/feature-db/:refId': '/master/feature-db/CH-BRK-009',
  '/consults/:id': `/consults/CON-${(process.env.FF_CLOCK_AT ?? new Date().toISOString()).slice(0, 4)}-001`,
};
/**
 * 시드에 표본이 없는 하위 화면 — 새 DB에는 Feature DB 변경 요청이 하나도 없다(v1.3 가져옴은 요청 없이 발행).
 * 변경 요청 상세는 refdb.spec(작성 → 검토 → 승인 → 발행, axe)과 정적 데모 시험(목록에서 열기)이 따로 연다.
 */
const NO_SAMPLE = new Set(['/master/feature-db/changes/:id']);
export const DRILLDOWNS: { path: string; title: string; url: string }[] = [...src.matchAll(/\{ path: '([^']+)', element: ([^\n]*?), title: '([^']+)'[^\n]*parent: '/g)]
  .filter((m) => !/legacyTo\(|Redirect'/.test(m[2]) && !NO_SAMPLE.has(m[1]))
  .map((m) => ({ path: m[1], title: m[3], url: SAMPLE[m[1]] ?? m[1] }));
