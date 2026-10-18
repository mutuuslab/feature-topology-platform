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
  '/products/:id/:ver': '/products/CAT-00001/3.0.0',
  '/policies/:id': '/policies/POL-00001',
  '/deployments/:id': '/deployments/PUB-00001',
  '/learn/:id': '/learn/CS-01',
  '/procedures/:id': '/procedures/FPW.7',
  '/twin/vehicle/:vin': '/twin/vehicle/VIN-DEMO-017',
};
export const DRILLDOWNS: { path: string; title: string; url: string }[] = [...src.matchAll(/\{ path: '([^']+)', element: ([^\n]*?), title: '([^']+)'[^\n]*parent: '/g)]
  .filter((m) => !/legacyTo\(|Redirect'/.test(m[2]))
  .map((m) => ({ path: m[1], title: m[3], url: SAMPLE[m[1]] ?? m[1] }));
