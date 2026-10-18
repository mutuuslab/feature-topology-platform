// ADS 요구사항(harness/ads/catalog.json) 결함 기록 — 코드 검토에서 찾은 요구 미충족을 재현한다.
// it.fails: 결함이 그대로면 통과한다. 고치면 이 시험이 실패한다 → it(으로 바꾸고, 판정을 갱신한다.
// 각 시험은 "요구되는 올바른 동작"을 단언한다 — 지금은 그 단언이 실패한다(설정 오류가 아니라 결함 단언에서).
// 시험마다 앱을 새로 띄운다 — 한 결함의 재현 단계(차단·복원·재-HARA 요청)가 다른 결함 기록에 새지 않게.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-ads-')) });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { KillCommandV2 } from '@ff/contracts';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { AuditService } from '../../src/kernel/audit.service';
import { actor, bootApp, confirmSafety, killV2, restoreV2 } from '../helpers';

const OPS = actor('usr-ops', 'OPERATOR');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const AT = '2026-10-12T01:00:00.000Z';
const KILL = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: 'ADS 결함 기록', confirm: 'FEAT-00022' };
const EX = join(__dirname, '..', '..', '..', 'harness', 'guide', 'schema', 'examples');

/** 부팅 동기화까지 흘려 보낸 앱 + 시계·스케줄러를 함께 미는 advance */
async function boot(at = AT) {
  const b = await bootApp({ at });
  b.app.get(Scheduler).flush();
  const clock = b.get(Clock);
  const advance = (ms: number) => {
    const until = clock.now().getTime() + ms;
    b.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  return { ...b, advance, db: b.get<Db>(DB) };
}

describe('ADS 요구사항 결함 기록 — 종료·해제·명령 전달·승인', () => {
  afterAll(() => {
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it.fails('FFP-F036 해제와 활성화 분리 — 승인된 복원 뒤 다음 시동에서도 차량은 저절로 ACTIVE가 되지 않는다', async () => {
    const { app, http, advance } = await boot();
    try {
      const k = await killV2(http, KILL);
      advance(8_000); // DC2 인계 4 s + 램프 3 s → DISABLED
      expect((await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0]).toMatchObject({ featureId: 'FEAT-00022', state: 'DISABLED' });
      await restoreV2(http, k.killId); // 차단 승인자와 다른 2인
      advance(1_000); // 복원 게시본 전달(회신 지연) — 차량 Guard가 받아들여 RESTORE_PENDING
      expect((await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].state).toBe('RESTORE_PENDING');
      advance(3_000); // 다음 시동
      const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0];
      // 요구: 해제는 활성화가 아니다 — ODD·형상·사용자 절차를 새로 통과하기 전까지 ACTIVE로 가지 않는다
      expect(st.state).not.toBe('ACTIVE');
    } finally {
      await app.close();
    }
  });

  it.fails('FFP-F019 명령 멱등성 — 같은 command_id 봉투를 그대로 다시 보내면 앞 결과를 돌려주고 보안 이벤트·전이는 없다', async () => {
    const { app, http, advance, db } = await boot();
    try {
      const k = await killV2(http, KILL);
      advance(8_000);
      const env: KillCommandV2 = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes.find((e: KillCommandV2) => e.scope.vehicle_ids[0] === 'ego-01');
      const securityEvents = () => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM security_event WHERE event_id = 'REPLAY_SEQUENCE'")!.n;
      const before = securityEvents();
      // 네트워크 재시도 — 차량 Guard가 같은 봉투(같은 command_id·내용)를 다시 받는다
      app.get(VehicleRuntimeService).guard('ego-01', k.publicationId, 'KILL', env, ['FEAT-00022']);
      const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0];
      expect(st.report.request_result).not.toBe('REJECTED'); // 요구: 멱등 ACK(앞 결과)
      expect(securityEvents()).toBe(before); // 요구: 재시도는 보안 이벤트가 아니다
      expect(st.state).toBe('DISABLED'); // 두 번째 전이 없음
    } finally {
      await app.close();
    }
  });

  it.fails('FFP-F059 일괄 명령 미리보기 — 대상 집합에 묶이지 않은 승인 서명(길이만 64자 이상)의 차단 명령은 게이트가 거부한다', async () => {
    const { app, http } = await boot('2026-10-13T00:30:00Z'); // 예시 명령 유효기간 안
    try {
      const ok: KillCommandV2 = JSON.parse(readFileSync(join(EX, 'kill_safety_dc2_eu.ok.json'), 'utf8'));
      expect((await http().post('/api/gate/preview').set(OPS).send(ok).expect(201)).body.result).toBe('PASS'); // 기준선
      // 대상 집합과 무관한 임의 문자열 — 어떤 차량에 대해서도 서명이 아니다
      const forged = { ...ok, approvals: ok.approvals.map((a) => ({ ...a, approval_sig: 'x'.repeat(86) })) };
      const v = (await http().post('/api/gate/preview').set(OPS).send(forged).expect(201)).body;
      expect(v.result).toBe('FAIL');
    } finally {
      await app.close();
    }
  });

  it.fails('FFP-F007 승인 영향 판정 — G8·G9 PASS·Release Sign-off 뒤 열린 재-HARA 요청이 있으면 출시 전이는 거부된다', async () => {
    const { app, http } = await boot('2026-10-18T01:00:00.000Z');
    try {
      const base = '/api/features/FEAT-00001/versions/2.1.0';
      await confirmSafety(http, 'FEAT-00001', '2.1.0');
      for (const gate of ['G8', 'G9']) await http().post(`${base}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
      await http().post(`${base}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인' }).expect(201);
      // 서명 뒤 새 Topology 관계 — 재-HARA 요청(TOPOLOGY)이 열린다.
      // 다른 Feature의 새 Version(초안)이 FEAT-00001@2.1.0에 의존 — 대상 쪽에도 TOPOLOGY 재-HARA 요청이 열린다(rehara.service)
      const src = (await http().post('/api/features/FEAT-00024/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '연동 추가', changes: { description: 'FEAT-00001 연동' } }).expect(201)).body.feature.version;
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00024', sourceVersion: src, targetFeatureId: 'FEAT-00001', targetVersion: '2.1.0' }).expect(201);
      const open = (await http().get('/api/rehara-requests?featureId=FEAT-00001&featureVersion=2.1.0&status=OPEN').expect(200)).body.items;
      expect(open).toEqual([expect.objectContaining({ condition: 'TOPOLOGY', status: 'OPEN' })]);
      // 요구: 영향 검토(재-HARA) 미완료 변경은 출시·서명 단계로 승격되지 않는다
      const r = await http().post(`${base}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' });
      expect(r.status).toBe(422);
    } finally {
      await app.close();
    }
  });

  it.fails('FFP-F060 감사 무결성 — 트리거를 우회해 마지막 감사 행을 지워도 체인 검증이 잡는다', async () => {
    const { app, http, db } = await boot();
    try {
      for (let i = 0; i < 3; i++) await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: `교체 ${i}` }).expect(201);
      const last = db.get<{ id: number }>('SELECT id FROM audit ORDER BY id DESC LIMIT 1')!.id;
      db.run('DROP TRIGGER audit_no_delete'); // 공격자가 DB 권한으로 트리거를 지웠다고 가정
      db.run('DELETE FROM audit WHERE id = ?', last);
      // 요구: 끝 행 삭제도 탐지한다 — 체인 끝(head)이 DB 밖에 고정돼 있어야 한다
      expect(app.get(AuditService).verifyChain().ok).toBe(false);
    } finally {
      await app.close();
    }
  });

  it.fails('ORCA-HT06 시각 신뢰도 — 발생 시각 없이 접수한 사건은 발생 시각을 비워 두고 수신 시각으로 채우지 않는다', async () => {
    const { app, http } = await boot();
    try {
      const r = (await http().post('/api/incidents').set(OPS).send({ source: 'FIELD', vin: 'ego-01', category: 'OTHER', severity: 'WARNING', summary: '발생 시각 미상 사건' }).expect(201)).body;
      // 요구: 누락을 정상값으로 대체하지 않는다 — 발생 시각 미상은 미상으로 남는다
      expect(r.occurredAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});
