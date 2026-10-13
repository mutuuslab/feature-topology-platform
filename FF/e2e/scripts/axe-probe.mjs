// 개발 확인용 — 한 화면의 axe 위반 대상 요소
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(`http://localhost:${process.argv[3] ?? 9122}${process.argv[2]}`);
await p.waitForTimeout(2500);
const r = await new AxeBuilder({ page: p }).analyze();
for (const v of r.violations.filter((x) => ['serious', 'critical'].includes(x.impact))) console.log(v.id, v.nodes.map((n) => n.target.join(' ') + ' :: ' + n.html.slice(0, 120)).join('\n  '));
await b.close();
