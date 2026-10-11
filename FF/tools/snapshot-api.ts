// npm run snapshot:api — 정적 데모(Cloudflare, VITE_DATA_MODE=static)용 GET 응답 스냅샷.
// 빌드된 백엔드를 보조 포트에 띄워(메모리 DB·v0.81 시드) v2 화면이 실제로 보내는 요청 모양 그대로 받아 둔다.
// 요청 URL·파일 이름 규칙은 @ff/contracts의 routeUrl·snapshotFile 하나를 프론트와 공유한다.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
const { routeUrl, snapshotFile, LIFECYCLE } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const PORT = Number(process.env.SNAPSHOT_PORT ?? 9199); // 8000 금지
const BASE = `http://localhost:${PORT}`;
const OUT = join(FF, 'frontend', 'public');

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], {
  env: { ...process.env, PORT: String(PORT), FF_DB: ':memory:', FF_SEED: 'v0.81' },
  stdio: 'ignore',
});

async function get<T = any>(url: string): Promise<T> {
  const r = await fetch(BASE + url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      await get('/api/health');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  rmSync(join(OUT, 'api-snapshot'), { recursive: true, force: true });
  let n = 0;
  const save = async (name: string, params: Record<string, string> = {}, query: Record<string, any> = {}) => {
    const url = routeUrl(name, params, query);
    const body = await get(url);
    const file = join(OUT, snapshotFile(url));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    n++;
    return body;
  };

  // 공통
  await save('health');
  await save('components');
  await save('precheck');
  await save('events', {}, { limit: 500 });
  await save('audit', {}, { limit: 500 });

  // Feature Registry 목록 — FeatureList의 질의 모양: { q, lifecycle, country, latestOnly }
  const all = await save('listFeatures', {}, { latestOnly: false });
  await save('listFeatures', {}, { latestOnly: true });
  for (const latestOnly of [true, false]) {
    for (const lifecycle of LIFECYCLE) await save('listFeatures', {}, { lifecycle, latestOnly });
    for (const country of Object.keys(all.facets.country)) await save('listFeatures', {}, { country, latestOnly });
  }

  // Feature Version 상세·Gate·체크리스트·감사·영향
  for (const f of all.items as { featureId: string; version: string }[]) {
    const p = { id: f.featureId, ver: f.version };
    await save('featureDetail', p);
    await save('gates', p);
    await save('baselineChecklist', p);
    await save('audit', {}, { target: `${f.featureId}@${f.version}`, limit: 100 });
    await save('impact', p);
  }

  // BOM·Catalog
  await save('baselineRequests');
  await save('baselines');
  const products = await save('listProducts');
  for (const p of products.items) await save('productDetail', { id: p.catalogId, ver: p.version });
  const scopes = new Set((all.items as any[]).map((f) => `${f.country}|${f.vehicleModel}|${f.trim}`));
  for (const s of scopes) {
    const [country, vehicleModel, trim] = s.split('|');
    await save('productCandidates', {}, { country, vehicleModel, trim });
  }
  console.log(`snapshot:api — ${n}개 응답 → frontend/public/api-snapshot/`);
}

main()
  .catch((e) => {
    console.error('snapshot:api 실패:', e.message);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
