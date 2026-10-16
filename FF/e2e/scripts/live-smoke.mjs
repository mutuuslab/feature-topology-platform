// 배포 확인용 — 운영 사이트의 체험 전환 분석·체험권·가상검증 화면(정적 배포: 검증 서버 없음 → 미연결 표시)
import { chromium } from '@playwright/test';
const B = process.env.BASE ?? 'https://feature-topology.pages.dev';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/biz/trials`);
console.log('funnel:', await p.getByRole('group', { name: /^제안 → 수락 → 구매/ }).getAttribute('aria-label', { timeout: 20000 }));
await p.goto(`${B}/entitlements`);
await p.getByRole('table', { name: '체험권 차량' }).waitFor({ timeout: 20000 });
console.log('trial rows:', await p.getByRole('table', { name: '체험권 차량' }).getByRole('row').count());
await p.goto(`${B}/validations/virtual`);
console.log('sim status:', (await p.locator('[data-tour="sim-status"]').innerText({ timeout: 20000 })).replace(/\s+/g, ' ').slice(0, 160));
console.log('sim report:', await p.getByTestId('sim-report').innerText());
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
