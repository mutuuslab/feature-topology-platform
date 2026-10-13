// GLEO 실연동 (GLEO_MODE=ws) — FF_IMP의 실제 모의 브로커(python -m gleo.mock_broker)와 실제 DecisionEngine 차량 에이전트를 띄워
// 긴급 차단이 kill_command(safe_mode)로 나가고, 차량 status_report가 회신 집계(CONFIRMED)로 돌아오는지 본다.
// FF_IMP 저장소·python websockets가 없으면 건너뛴다(CI). 포트 8798 — GLEO 기본 8765와 겹치지 않게.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, killV2, restoreV2 } from '../helpers';

const FF_IMP = process.env.FF_IMP_DIR ?? resolve(__dirname, '../../../../../2026-09-23_FF_IMP');
const PORT = 8798;
const URL = `ws://127.0.0.1:${PORT}`;
// FF_IMP는 자기 .venv(websockets 17)를 쓴다 — 시스템 python의 다른 websockets 버전으로 돌리면 접속 인자가 맞지 않는다
const VENV = [join(FF_IMP, '.venv', 'Scripts', 'python.exe'), join(FF_IMP, '.venv', 'bin', 'python')].find((p) => existsSync(p));
const PY = VENV ?? 'python';
const ready = existsSync(join(FF_IMP, 'gleo', 'mock_broker.py')) && spawnSync(PY, ['-c', 'import websockets'], { cwd: FF_IMP }).status === 0;

function start(args: string[], marker: string): Promise<ChildProcess> {
  return new Promise((ok, fail) => {
    const p = spawn(PY, ['-u', ...args], { cwd: FF_IMP, env: { ...process.env, PYTHONPATH: FF_IMP } });
    const timer = setTimeout(() => fail(new Error(`${args.join(' ')}: ${marker} 대기 시간 초과`)), 10_000);
    p.stdout!.on('data', (b) => String(b).includes(marker) && (clearTimeout(timer), ok(p)));
    p.on('exit', (c) => fail(new Error(`${args.join(' ')} 종료 ${c}`)));
  });
}
const until = async (fn: () => Promise<boolean>, ms = 8_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('조건 대기 시간 초과');
};

describe.skipIf(!ready)('GLEO 실연동 — FF_IMP 브로커·차량 에이전트', () => {
  let app: INestApplication;
  let http: () => any;
  const procs: ChildProcess[] = [];

  beforeAll(async () => {
    procs.push(await start(['-m', 'gleo.mock_broker', '--port', String(PORT)], 'listening'));
    procs.push(await start([join(__dirname, '..', 'fixtures', 'gleo_vehicle_agent.py'), URL], 'READY'));
    Object.assign(process.env, { GLEO_MODE: 'ws', GLEO_URL: URL, FF_SCHEDULER: 'manual' });
    ({ app, http } = await bootApp());
    await until(async () => (await http().get('/api/gleo/status')).body.connected);
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    for (const p of procs) p.kill();
    delete process.env.GLEO_MODE;
    delete process.env.GLEO_URL;
    delete process.env.FF_SCHEDULER;
  });

  it('긴급 차단(요청 → 2인 승인) → kill_command 송신 → 영상 키트 차량 status_report → CONFIRMED 2/2', async () => {
    const r = { body: await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '영상 키트 실연동', confirm: 'FEAT-00022' }, actor('seo.ops', 'OPERATOR')) };
    await until(async () => (await http().get(`/api/kill-requests/${r.body.killId}`)).body.delivery.status === 'CONFIRMED');
    const k = (await http().get(`/api/kill-requests/${r.body.killId}`).expect(200)).body;
    expect(k.delivery).toMatchObject({ confirmed: 2, denominator: 2 });
    const rb = (await http().get(`/api/telemetry/readbacks?publicationId=${k.publicationId}`).expect(200)).body.items;
    expect(rb.map((x: any) => [x.vin, x.observed, x.via]).sort()).toEqual([['ego-01', 'DISABLED', 'GLEO'], ['lead-01', 'DISABLED', 'GLEO']]); // v1 영상 키트 SAFE_DEFAULT → v2 끝 상태로 해석(미증명, WP5b에서 state_auth)
    const g = (await http().get('/api/gleo/status').expect(200)).body;
    expect(g.messages.find((m: any) => m.dir === 'out' && m.msg.type === 'kill_command').msg).toMatchObject({ type: 'kill_command', safe_mode: 'SAFE_DEFAULT', issued_by: 'usr-opslead' }); // 발행자 = 두 번째 승인자(게이트 통과 시점)
    expect(g.messages.some((m: any) => m.dir === 'in' && m.msg.type === 'status_report')).toBe(true);
    expect((await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.featureState['FEAT-00022']).toBe('DISABLED');
    expect((await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.log.at(-1).detail).toContain('v1 미증명');
  });

  it('해제 → 영상 키트에는 policy_push(enable)로 알리되 회신 의무 없음(ackOnly)', async () => {
    const k = (await http().get('/api/kill-requests?status=ACTIVE').expect(200)).body.items[0];
    await restoreV2(http, k.killId, '복구', actor('park.safety', 'SAFETY_OFFICER'));
    const d = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
    expect(d.restore).toMatchObject({ status: 'CONFIRMED', denominator: 0 });
    expect(d.restore.ackOnly.sort()).toEqual(['ego-01', 'lead-01']);
  });
});
