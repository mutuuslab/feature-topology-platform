// node tools/grafana/demo-catalog.ts [--check] — Grafana 시연 시계열이 쓰는 ID 목록(deploy/grafana/demo-catalog.json)을 FF 시연 데이터에서 뽑는다.
// 정적 데모(Cloudflare)와 같은 조건(메모리 DB·v0.81·FF_SHOWCASE=1·차량 480대)으로 빌드된 백엔드를 잠깐 띄워 읽는다 —
// Grafana 대시보드의 Feature·Flag·정책·국가·차종·SW·긴급 차단 ID가 FF 화면과 같다. 선행: npm run build -w feature-topology-backend
// --check: 지금 백엔드에서 뽑은 것과 저장본이 다르면 종료 1(시드가 바뀌면 다시 만든다).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { FF } from '../lib.ts';

export const CATALOG_PATH = join(FF, 'deploy', 'grafana', 'demo-catalog.json');

export interface DemoCatalog {
  source: { seed: string; showcase: boolean; showcaseVehicles: number };
  /** 국가·차종·SW 칸별 등록 차량 수 */
  fleet: { country: string; vehicleModel: string; swVersion: string; vehicles: number }[];
  policies: { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string; fClass: string; stageRatio: number }[];
  features: { featureId: string; version: string; name: string; country: string; vehicleModel: string; previous: string | null }[];
  kills: { killId: string; featureId: string; featureVersion: string; deactClass: string; reasonCategory: string; vehicles: number }[];
  experiments: { experimentId: string; flagKey: string; featureId: string; type: string; treatmentRatio: number; status: string }[];
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

export async function extractCatalog(): Promise<DemoCatalog> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), FF_DB: ':memory:', FF_SEED: 'v0.81', FF_SHOWCASE: '1', FF_SHOWCASE_VEHICLES: '480' };
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(FF, 'backend', 'dist', 'main.js')], { env, stdio: 'ignore' });
  let exited: number | null = null;
  server.once('exit', (c) => (exited = c ?? -1));
  const H = { 'X-Actor-Id': 'usr-snapshot', 'X-Actor-Role': 'OPS_LEAD' };
  const get = async <T>(u: string): Promise<T> => {
    const r = await fetch(base + u, { headers: H });
    if (!r.ok) throw new Error(`${u} → ${r.status}`);
    return (await r.json()) as T;
  };
  try {
    for (let i = 0; ; i++) {
      if (exited !== null) throw new Error(`백엔드가 끝났다(${exited}) — npm run build -w feature-topology-backend 뒤 다시`);
      try {
        await get('/api/health');
        break;
      } catch {
        if (i > 600) throw new Error('백엔드가 5분 안에 뜨지 않았다');
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const items = <T>(x: { items?: T[] } | T[]) => (Array.isArray(x) ? x : (x.items ?? []));
    const vehicles = items(await get<any>('/api/vehicles')) as { country: string; vehicleModel: string; swVersion: string }[];
    const cells = new Map<string, number>();
    for (const v of vehicles) {
      const k = JSON.stringify([v.country, v.vehicleModel, v.swVersion]);
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const fleet = [...cells].map(([k, n]) => {
      const [country, vehicleModel, swVersion] = JSON.parse(k) as string[];
      return { country, vehicleModel, swVersion, vehicles: n };
    });
    const features = items(await get<any>('/api/features')) as { featureId: string; version: string; name: string; country: string; vehicleModel: string; lifecycle: string }[];
    const released = features.filter((f) => f.lifecycle === 'RELEASED');
    const policiesRaw = items(await get<any>('/api/policies')) as { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string; stageBasisPoints: number | null; rollout: { mode: string; basisPoints: number } }[];
    const policies = [];
    for (const p of policiesRaw.filter((x) => ['DEPLOYED', 'VALIDATED', 'APPROVED'].includes(x.status))) {
      const sp = await get<any>(`/api/features/${p.featureId}/versions/${p.featureVersion}/safety`).catch(() => null);
      const approved = p.rollout.mode === 'NONE' ? 0 : p.rollout.mode === 'ALL' ? 10000 : p.rollout.basisPoints;
      const bp = p.stageBasisPoints == null ? approved : Math.min(approved, p.stageBasisPoints);
      policies.push({ policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, status: p.status, fClass: sp?.profile?.fClass ?? sp?.fClass ?? 'unknown', stageRatio: bp / 10000 });
    }
    const kills = (items(await get<any>('/api/kill-requests')) as any[]).map((k) => ({ killId: k.killId, featureId: k.featureId, featureVersion: k.featureVersion, deactClass: k.deactClass ?? 'DC0', reasonCategory: k.reasonCategory ?? 'SAFETY', vehicles: k.vins.length }));
    const experiments = (items(await get<any>('/api/experiments')) as any[]).map((e) => ({ experimentId: e.experimentId, flagKey: e.flagKey, featureId: e.featureId, type: e.type, treatmentRatio: e.treatmentBp / 10000, status: e.status }));
    const byId = new Map<string, string[]>();
    for (const f of released) byId.set(f.featureId, [...(byId.get(f.featureId) ?? []), f.version]);
    const cmp = (a: string, b: string) => a.split('.').map(Number).reduce((r, x, i) => r || x - Number(b.split('.')[i] ?? 0), 0);
    const latest = [...byId].map(([id, vs]) => {
      const sorted = vs.sort(cmp);
      const f = released.find((x) => x.featureId === id && x.version === sorted.at(-1))!;
      return { featureId: id, version: f.version, name: f.name, country: f.country, vehicleModel: f.vehicleModel, previous: sorted.length > 1 ? sorted.at(-2)! : null };
    });
    const sortBy = <T>(xs: T[], k: (x: T) => string) => xs.sort((a, b) => k(a).localeCompare(k(b)));
    return {
      source: { seed: 'v0.81', showcase: true, showcaseVehicles: 480 },
      fleet: sortBy(fleet, (c) => `${c.country}|${c.vehicleModel}|${c.swVersion}`),
      policies: sortBy(policies, (p) => p.policyId),
      features: sortBy(latest, (f) => f.featureId),
      kills: sortBy(kills, (k) => k.killId),
      experiments: sortBy(experiments, (e) => e.experimentId),
    };
  } finally {
    server.kill();
  }
}

export const readCatalog = (path = CATALOG_PATH): DemoCatalog => JSON.parse(readFileSync(path, 'utf8')) as DemoCatalog;

if (import.meta.main) {
  const c = await extractCatalog();
  const text = JSON.stringify(c, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const cur = readFileSync(CATALOG_PATH, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
    if (cur !== text) {
      console.error('deploy/grafana/demo-catalog.json이 FF 시연 데이터와 다르다 — node tools/grafana/demo-catalog.ts로 다시 만든다');
      process.exit(1);
    }
    console.log('demo-catalog: FF 시연 데이터와 같다');
  } else {
    writeFileSync(CATALOG_PATH, text);
    console.log(`demo-catalog: 차량 칸 ${c.fleet.length} · 정책 ${c.policies.length} · Feature ${c.features.length} · 차단 ${c.kills.length} → ${CATALOG_PATH}`);
  }
}
