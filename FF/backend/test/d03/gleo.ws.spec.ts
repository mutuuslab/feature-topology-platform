// GLEO 실연동 (GLEO_MODE=ws) — FF_IMP의 실제 모의 브로커(python -m gleo.mock_broker)와 실제 DecisionEngine·VehicleGuard(v2) 차량 에이전트를 띄워
// 긴급 차단이 차량마다 서명된 kill_command v2 봉투로 나가고, 차량 Guard가 검증한 뒤 state_auth로 서명한 status_report v2가
// 6단계 수신 검사를 거쳐 회신 집계(CONFIRMED)로 돌아오는지 본다. 차량 키는 같은 모의 공장 루트(FF_HSM_VEHICLE_ROOT, 시험 전용)에서 파생.
// FF_IMP 저장소·python websockets가 없으면 건너뛴다(CI). 브로커 포트는 시험마다 OS가 비어 있는 것을 고른다 —
// 고정 포트(8798)는 여러 작업 폴더의 verify가 함께 돌 때 "주소 사용 중"으로 실패했다(2026-10-24).
// FFG-PLT-012 · FFG-TEL-003 · FFG-VEH-002
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { actor, bootApp, killV2, restoreV2 } from '../helpers';

const FF_IMP_MAIN = resolve(__dirname, '../../../../../2026-09-23_FF_IMP');
const FF_IMP = process.env.FF_IMP_DIR ?? FF_IMP_MAIN;
/** 비어 있는 로컬 포트 하나 — 잠깐 열었다 닫아 번호만 얻는다 */
function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}
let URL = '';
// 시험 전용 모의 공장 루트 — gleo-v2-vectors.spec과 같은 값(운영 루트 아님)
const TEST_ROOT_B64 = createHash('sha256').update('ffp-test-vehicle-root-v1').digest('base64');
// FF_IMP는 자기 .venv(websockets 17)를 쓴다 — 시스템 python의 다른 websockets 버전으로 돌리면 접속 인자가 맞지 않는다.
// worktree(FF_IMP_DIR)에는 .venv가 없으니 기본 checkout의 것을 쓴다
const VENV = [FF_IMP, FF_IMP_MAIN].flatMap((d) => [join(d, '.venv', 'Scripts', 'python.exe'), join(d, '.venv', 'bin', 'python')]).find((p) => existsSync(p));
const PY = VENV ?? 'python';
const ready = existsSync(join(FF_IMP, 'gleo', 'mock_broker.py')) && spawnSync(PY, ['-c', 'import websockets'], { cwd: FF_IMP }).status === 0;

function start(args: string[], marker: string): Promise<ChildProcess> {
  return new Promise((ok, fail) => {
    const p = spawn(PY, ['-u', ...args], { cwd: FF_IMP, env: { ...process.env, PYTHONPATH: FF_IMP } });
    let err = '';
    const timer = setTimeout(() => fail(new Error(`${args.join(' ')}: ${marker} 대기 시간 초과`)), 10_000);
    p.stdout!.on('data', (b) => String(b).includes(marker) && (clearTimeout(timer), ok(p)));
    p.stderr!.on('data', (b) => (err += String(b)));
    p.on('exit', (c) => fail(new Error(`${args.join(' ')} 종료 ${c}\n${err.slice(-800)}`)));
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

describe.skipIf(!ready)('GLEO 실연동 — FF_IMP 브로커·차량 Guard(v2)', () => {
  let app: INestApplication;
  let http: () => any;
  const procs: ChildProcess[] = [];

  beforeAll(async () => {
    const port = await freePort();
    URL = `ws://127.0.0.1:${port}`;
    procs.push(await start(['-m', 'gleo.mock_broker', '--port', String(port)], 'listening'));
    Object.assign(process.env, { GLEO_MODE: 'ws', GLEO_URL: URL, FF_SCHEDULER: 'manual', FF_HSM_VEHICLE_ROOT: TEST_ROOT_B64 });
    ({ app, http } = await bootApp());
    // 차량 신뢰 저장소 = 플랫폼 공개키(용도별), Feature 안전 분류 = Registry 확정값, 대상 = 봉투 target과 같은 값
    const keys = app.get(PkiService).vehicleTrust().map((k) => ({ kid: k.keyId, purpose: k.purpose, pem: k.publicKeyPem }));
    const p = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body.profile;
    const f = (await http().get('/api/features/FEAT-00022').expect(200)).body.versions.find((v: any) => v.version === '1.0.0');
    const dir = mkdtempSync(join(tmpdir(), 'ff-gleo-'));
    const config = join(dir, 'vehicle.json');
    writeFileSync(config, JSON.stringify({
      root_b64: TEST_ROOT_B64,
      epoch: (await http().get('/api/pki/hsm').expect(200)).body.epoch,
      keys,
      profiles: [{ feature_id: p.featureId, version: p.version, deact_class: p.deactClass, takeover_ms: p.takeoverMs, ramp_ms: p.rampMs, max_pending_ms: p.maxPendingMs }],
      ecu_id: f.ecuPnos?.[0] ?? 'UNSPECIFIED',
      sw_version: f.swVersions?.[0] ?? f.version,
      vins: ['ego-01', 'lead-01'],
    }));
    procs.push(await start([join(__dirname, '..', 'fixtures', 'gleo_vehicle_agent.py'), URL, config], 'READY'));
    await until(async () => (await http().get('/api/gleo/status')).body.connected);
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    for (const p of procs) p.kill();
    for (const k of ['GLEO_MODE', 'GLEO_URL', 'FF_SCHEDULER', 'FF_HSM_VEHICLE_ROOT']) delete process.env[k];
  });

  it('긴급 차단(요청 → 2인 승인) → 차량별 v2 봉투 → Guard 검증 → DC2 단계 보고(state_auth) → CONFIRMED 2/2', async () => {
    const r = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '영상 키트 실연동', confirm: 'FEAT-00022' }, actor('seo.ops', 'OPERATOR'));
    // DC2: 인계 경고 4 s → 램프 3 s → DISABLED (벽시계)
    await until(async () => (await http().get(`/api/kill-requests/${r.killId}`)).body.delivery.status === 'CONFIRMED', 20_000);
    const k = (await http().get(`/api/kill-requests/${r.killId}`).expect(200)).body;
    expect(k.delivery).toMatchObject({ confirmed: 2, denominator: 2 });
    const g = (await http().get('/api/gleo/status').expect(200)).body;
    const out = g.messages.filter((m: any) => m.dir === 'out' && m.msg.type === 'kill_command').map((m: any) => m.msg);
    expect(out.map((e: any) => [e.schema_version, e.request, e.scope.vehicle_ids])).toEqual([
      ['2.0', 'deactivate', ['ego-01']],
      ['2.0', 'deactivate', ['lead-01']],
    ]);
    expect(out[0].safe_mode).toBeUndefined();
    const states = g.messages.filter((m: any) => m.dir === 'in' && m.msg.type === 'status_report').map((m: any) => m.msg.state);
    expect(new Set(states)).toEqual(new Set(['DEACT_WARNING', 'DEACT_RAMP', 'DISABLED']));
    const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body;
    expect(st.recent.every((x: any) => x.accepted && x.via === 'GLEO')).toBe(true);
    expect((await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.featureState['FEAT-00022']).toBe('DISABLED');
  }, 30_000);

  // FFP-F036(해제와 활성화 분리)로 바뀐 기대: 복원의 수렴 상태는 INACTIVE(차단 해제)이고 ACTIVE는 활성화 절차로만 간다.
  // 플랫폼은 복원 뒤 저절로 ACTIVE가 된 보고를 복원 확인(CONFIRMED)으로 세지 않는다. FF_IMP 차량 Guard(gleo/vehicle_guard.py)가 아직
  // 복원 → ACTIVE로 가면(구현 전) 플랫폼은 확인하지 않은 채로 둔다 — 두 경우 모두 이 시험이 지킨다(FF_IMP 갱신은 그 저장소의 일).
  it('복원(2인 승인) → v2 restore 봉투 → RESTORE_PENDING → 다음 시동 차단 해제(INACTIVE — 활성화는 따로, FFP-F036) → CONFIRMED 2/2', async () => {
    const k = (await http().get('/api/kill-requests?status=ACTIVE').expect(200)).body.items[0];
    await restoreV2(http, k.killId, '복구', actor('park.safety', 'SAFETY_OFFICER'));
    const state = async () => (await http().get('/api/vehicles/lead-01/runtime').expect(200)).body.runtime.featureState['FEAT-00022'];
    await until(async () => ['INACTIVE', 'ACTIVE'].includes(await state()), 15_000);
    if ((await state()) === 'INACTIVE') {
      await until(async () => (await http().get(`/api/kill-requests/${k.killId}`)).body.restore?.status === 'CONFIRMED', 15_000);
      expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.restore).toMatchObject({ confirmed: 2, denominator: 2 });
    } else {
      // FF_IMP Guard가 해제를 활성화로 처리 — 플랫폼은 이를 복원 확인으로 세지 않는다
      await new Promise((r) => setTimeout(r, 500));
      expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.restore?.status).not.toBe('CONFIRMED');
    }
  }, 40_000);
});
