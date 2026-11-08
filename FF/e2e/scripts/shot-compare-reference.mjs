// UX 검토용 — 기준 절차서(ref-*.png, shot-reference-workflow.mjs)와 FF 화면(procflow-*.png, shot-procedure-flow.mjs)을 같은 폭끼리 나란히 붙인다.
// 그림 도구 없이 브라우저로 합친다(새 의존성 없음). 결과: e2e/shots/compare-*.png. 실행: node e2e/scripts/shot-compare-reference.mjs
import { chromium } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dir = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const pairs = [];
for (const w of [1366, 1920]) {
  pairs.push(
    [`process-${w}`, `ref-SYS2-${w}.png`, `procflow-fpw1-${w}-full.png`, '기준: SYS.2 절의 머리·요약·흐름도·활동 카드', 'FF: FPW.1 절차 화면'],
    [`map-${w}`, `ref-overview-${w}.png`, `procflow-map-${w}.png`, '기준: 프로세스 고르기', 'FF: 전체 지도'],
    [`roles-${w}`, `ref-roles-${w}.png`, `procflow-roles-${w}-full.png`, '기준: 역할 표', 'FF: 담당자별 업무 흐름'],
    [`trigger-${w}`, `ref-SUP9-${w}.png`, `procflow-roles-operator-${w}.png`, '기준: SUP.9(사건 시작)', 'FF: 운영 담당 업무 흐름'],
  );
}
pairs.push(['diagram', 'ref-SYS2-diagram-1920.png', 'procflow-diagram-FPW1.png', '기준: SYS.2 흐름도', 'FF: FPW.1 흐름도']);
pairs.push(['diagram-large', 'ref-SYS2-diagram-1920.png', 'procflow-diagram-FPW8.png', '기준: SYS.2 흐름도', 'FF: FPW.8 흐름도(가장 넓음)']);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 2400, height: 1200 } });
for (const [name, left, right, lt, rt] of pairs) {
  if (!existsSync(dir + left) || !existsSync(dir + right)) {
    console.log('skip', name);
    continue;
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif;background:#fff}main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;align-items:start}figure{margin:0}figcaption{font-weight:700;padding:4px 0 8px}img{width:100%;border:1px solid #ccc}</style><main><figure><figcaption>${lt}</figcaption><img src="${pathToFileURL(dir + left).href}"></figure><figure><figcaption>${rt}</figcaption><img src="${pathToFileURL(dir + right).href}"></figure></main>`;
  const file = `${dir}compare-${name}.html`;
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.waitForLoadState('load');
  await page.screenshot({ path: `${dir}compare-${name}.png`, fullPage: true });
}
await b.close();
console.log('saved', dir);
