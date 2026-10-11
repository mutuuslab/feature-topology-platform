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
