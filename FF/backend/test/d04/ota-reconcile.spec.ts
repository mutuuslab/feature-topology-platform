// OTA 전달 대사(P9, 80-45 §14) — FF + 시험 OTA 서버(tools/ota-reference, 별도 프로세스).
// 1) webhook이 끝내 오지 않아 SUBMITTED에 남은 작업을 GET /ota/v1/jobs/{jobId} 조회로 메운다(자동 sweep·수동 대사, 같은 결과 두 번 반영 안 함).
// 2) OTA 사실과 차량 결과가 어긋나면(넘겼다는데 차량 결과 없음·못 넘겼다는데 결과 있음) 전달 이상 징후 — 끝 상태(회신 집계)는 바꾸지 않는다.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OtaReconcileService } from '../../src/adapters/ota/ota-reconcile.service';
import { SecureDeployService } from '../../src/domains/d06-qsec/secure-deploy/secure-deploy.service';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

vi.hoisted(() => {
  process.env.PUBLICATION_TIMEOUT_MS = '600000';
});

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPS = actor('park.opslead', 'OPS_LEAD');
const CLIENT_SECRET = 'ota-reference-client-secret';
const WEBHOOK_SECRET = 'ota-reference-webhook-secret-change-me-0000';
const ENV = {
  FF_OTA_CLIENT_ID: 'ff-platform',
  FF_OTA_CLIENT_SECRET: CLIENT_SECRET,
  FF_OTA_WEBHOOK_SECRET: WEBHOOK_SECRET,
  FF_OTA_TIMEOUT_MS: '60000',
  FF_BOOT_PUBLISH: '0',
  GLEO_MODE: 'internal',
  CARLA_RUNNER: join(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'ff-ota-rec-')),
};

async function startReference(): Promise<{ url: string; proc: ChildProcess }> {
  const script = join(__dirname, '..', '..', '..', 'tools', 'ota-reference', 'server.ts');
  const proc = spawn(process.execPath, [script, '--port', '0', '--delay-ms', '50', '--webhook-url', 'http://127.0.0.1:1/unset'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: proc.stdout! });
  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('시험 OTA 서버가 시작하지 않았습니다')), 15_000);
    lines.on('line', (l) => {
      if (l.startsWith('{') && JSON.parse(l).event === 'listening') (clearTimeout(t), resolve(JSON.parse(l).url));
    });
    proc.once('exit', (c) => reject(new Error(`시험 OTA 서버 종료 ${c}`)));
  });
  return { url, proc };
}

type Boot = Awaited<ReturnType<typeof bootApp>>;

describe('OTA 전달 대사 — webhook 유실 보충·OTA 사실 ↔ 차량 결과 불일치', { timeout: 60_000 }, () => {
  let b: Boot;
  let ref: { url: string; proc: ChildProcess };
  const sim = (body: unknown, path = '/_sim/config') => fetch(`${ref.url}${path}`, { method: 'POST', headers: { 'x-sim-admin': CLIENT_SECRET, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const job = async (publicationId: string) => (await b.http().get(`/api/ota/jobs?publicationId=${publicationId}`).set(OPS).expect(200)).body.items[0];
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000) => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v)) {
      if (Date.now() > end) throw new Error(`기다리던 상태가 오지 않았습니다: ${JSON.stringify(v).slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, 100));
      v = await fn();
    }
    return v;
  };
  let n = 0;
  const deploy = async () => {
    n++;
    const c = await b.http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: `care_00022_rec${n}`, description: `OTA 대사 시험 ${n}`, safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    await b.http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    await b.http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200);
    await b.http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    return (await b.http().post(`/api/policies/${c.body.policyId}/deploy`).set(RELEASE).send({ reason: 'OTA 배포' }).expect(200)).body.publicationId as string;
  };
  const anomalies = async () => (await b.http().get('/api/anomalies?kind=DELIVERY').set(OPS).expect(200)).body.items as any[];

  beforeAll(async () => {
    ref = await startReference();
    Object.assign(process.env, ENV, { FF_OTA_URL: ref.url, FF_OTA_TOKEN_URL: `${ref.url}/oauth/token` });
    b = await bootApp();
    // webhook을 보내지 않는 OTA 서버(유실) — 차량 결과(Lake 경로)도 흉내 내지 않는다
    expect((await sim({ scenario: 'silent' })).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await b?.app.close();
    ref?.proc.kill();
    for (const k of [...Object.keys(ENV), 'FF_OTA_URL', 'FF_OTA_TOKEN_URL', 'PUBLICATION_TIMEOUT_MS']) delete process.env[k];
  });

  let pubId: string;
  it('webhook이 오지 않으면 SUBMITTED에 남는다 → 조회 대사가 차량별 OTA 사실·끝 상태를 채운다(수동 대사 — 감사)', async () => {
    pubId = await deploy();
    const j0 = await until(() => job(pubId), (j) => j?.state === 'SUBMITTED');
    expect(j0.vehicles).toEqual([]);
    // OTA 서버 쪽은 기한 처리까지 끝났다(차량에 넘김) — FF는 모른다
    expect((await sim({ jobId: j0.jobId }, '/_sim/expire')).status).toBe(200);
    const r = await b.http().post(`/api/ota/jobs/${j0.jobId}/reconcile`).set(OPS).send({ reason: 'webhook 유실 확인' }).expect(200);
    expect(r.body).toMatchObject({ jobId: j0.jobId, filled: expect.any(Number), state: 'COMPLETED', serverState: 'COMPLETED' });
    const j1 = await job(pubId);
    expect(j1.state).toBe('COMPLETED');
    expect(j1.vehicles.length).toBeGreaterThan(0);
    expect(j1.vehicles.every((v: any) => v.outcome === 'DELIVERED')).toBe(true);
    // 다시 대사해도 새로 채우는 것이 없다(멱등)
    expect((await b.http().post(`/api/ota/jobs/${j0.jobId}/reconcile`).set(OPS).send({ reason: '다시' }).expect(200)).body.filled).toBe(0);
  });

  it('회신 기한에 닫히면 — OTA는 넘겼는데 차량 결과가 없는 차량마다 전달 이상(판정은 TIMEOUT 그대로, 차량 결과만 끝 상태를 정한다)', async () => {
    b.get(SecureDeployService).close(pubId);
    const p = (await b.http().get(`/api/publications/${pubId}`).expect(200)).body.publication;
    expect(p.status).toBe('TIMEOUT');
    const a = await until(anomalies, (xs) => xs.some((x) => x.signals.some((s: any) => s.code === 'OTA_DELIVERED_NO_VEHICLE_RESULT' && s.ref === pubId)));
    const all = a.flatMap((x) => x.signals).filter((s: any) => s.ref === pubId);
    // 기존 전달 이상(TIMEOUT)은 그대로 — 대사 신호가 덧붙을 뿐 판정을 바꾸지 않는다
    expect(new Set(all.map((s: any) => s.code))).toEqual(new Set(['TIMEOUT', 'OTA_DELIVERED_NO_VEHICLE_RESULT']));
    const sig = all.filter((s: any) => s.code === 'OTA_DELIVERED_NO_VEHICLE_RESULT');
    expect(sig.length).toBe((await job(pubId)).vehicles.length);
  });

  it('자동 대사 — webhook 없이 기준 시간(FF_OTA_RECONCILE_MS)이 지난 SUBMITTED 작업만 조회한다', async () => {
    const id = await deploy();
    const j0 = await until(() => job(id), (j) => j?.state === 'SUBMITTED');
    await sim({ jobId: j0.jobId }, '/_sim/expire');
    const svc = b.get(OtaReconcileService);
    expect((await svc.sweep()).map((r) => r.jobId)).not.toContain(j0.jobId); // 아직 기준 시간 전
    b.get(Clock).set(new Date(Date.now() + 10 * 60_000).toISOString());
    try {
      const swept = await svc.sweep();
      expect(swept.find((r) => r.jobId === j0.jobId)).toMatchObject({ state: 'COMPLETED' });
    } finally {
      b.get(Clock).set(null);
    }
  });

  it('대사는 운영 역할만 — 열람 역할은 403, 없는 작업은 404', async () => {
    await b.http().post('/api/ota/jobs/OTJ-NONE/reconcile').set(actor('v', 'AUDITOR')).send({ reason: '권한 없음' }).expect(403);
    await b.http().post('/api/ota/jobs/OTJ-NONE/reconcile').set(OPS).send({ reason: '없는 작업' }).expect(404);
  });
});
