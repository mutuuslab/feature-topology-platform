// 플랫폼 정책 게이트·명령 원장 (D03-02, 보고서 v1.1 8장·부록 D) — 보고서 예시 명령을 플랫폼 실데이터(Registry·안전 분류·원장)로 판정한다.
// FFG-PLT-001·002·005·017, FFG-SEC-003 · TC-FF-16 · TC-FF-45 · TC-FF-47 · TC-FF-48 · TC-FF-50
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KillCommandV2 } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { gateStatusOf, PolicyGateService } from '../../src/domains/d03-safety/deploy-safety/policy-gate.service';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { KillService } from '../../src/domains/d03-safety/kill-switch/kill.service';
import { DomainError } from '../../src/kernel/errors';
import { KILL_APPROVERS, KILL_REQUESTER, actor, bootApp } from '../helpers';
import { registerTestApprovers, signApprovals, testApproverKey } from '../approver-keys';

const EX = join(__dirname, '..', '..', '..', 'harness', 'guide', 'schema', 'examples');
const example = (name: string) => JSON.parse(readFileSync(join(EX, name), 'utf8'));
// D-RD-5 — 기준선 변경: 보고서 예시의 approval_sig는 자리표시 값이라 이제 PASS하지 않는다(아래 '자리표시 서명' 회귀 시험).
// PASS 기준선은 시험 승인자 키(등록된 공개키)로 승인 칸을 다시 서명한 예시다. 명령을 바꾸면 다시 서명한다 — 서명 대상이 명령에서 나온다.
const signed = (name: string) => signApprovals(example(name));
const TEST_APPROVERS = ['u-1001', 'u-2002', 'u-5005', 'u-6006'];
const OPS = actor('usr-ops', 'OPERATOR');

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
async function boot() {
  // 보고서 예시 명령의 게이트 시각(validity 2026-10-13T00:00~12:00Z, 원장 최근 조치 2026-10-12T20:00Z)
  const b = await bootApp({ at: '2026-10-13T00:30:00Z' });
  close = () => b.app.close();
  const hsm = b.get(HsmService);
  registerTestApprovers(hsm, TEST_APPROVERS);
  return { ...b, db: b.get<Db>(DB), gate: b.get(PolicyGateService), hsm };
}
const failed = (v: { findings: { rule: string; ok: boolean }[] }) => v.findings.filter((f) => !f.ok).map((f) => f.rule);

describe('Registry 스냅샷 — 기존 Feature Registry + 안전 분류에서 만든다(보고서 D.6)', () => {
  it('FEAT-00022@1.0.0은 보고서 예시와 같은 값으로 게이트에 보인다', async () => {
    const { http } = await boot();
    const s = (await http().get('/api/gate/features/FEAT-00022/versions/1.0.0').expect(200)).body;
    expect(s.feature).toMatchObject({
      status: 'RELEASED',
      version: '1.0.0',
      f_class: 'F3',
      deact_class: 'DC2',
      gsr_mandatory: false,
      max_vehicles: 50000,
      max_per_window: 5000,
      type_approval_relevant: true,
      ads_feature: false,
    });
    expect(s.feature.markets_approved).toEqual(['UNECE', 'EU', 'KR', 'CN', 'US', 'CA']);
    expect(s.feature.profile).toEqual({ takeover_ms: 4000, ramp_ms: 3000, fault_ramp_ms: 1500, max_pending_ms: 0, max_cycle_wait_ms: 28800000 });
    expect(s.ledger).toMatchObject({ last_order_seq: 10, last_kill_approvers: ['u-3003', 'u-4004'] });
    expect(s).toMatchObject({ nextSeq: 11, window: { hours: 24, deactivate: 3, cap: 5000 } });
  });
  it('지원 종료·Retirement는 폐기로 본다 — 비활성화만', () => {
    expect(['RELEASED', 'DEPRECATED', 'RETIRED', 'DEVELOPING'].map(gateStatusOf)).toEqual(['RELEASED', 'DECOMMISSIONED', 'DECOMMISSIONED', 'DEVELOPING']);
  });
});

describe('미리보기 — 원장은 바꾸지 않는다', () => {
  it('TC-FF-45 보고서 예시 안전 Kill이 플랫폼 실데이터로 PASS', async () => {
    const { http } = await boot();
    const v = (await http().post('/api/gate/preview').set(OPS).send(signed('kill_safety_dc2_eu.ok.json')).expect(201)).body;
    expect(failed(v)).toEqual([]);
    expect(v.result).toBe('PASS');
    expect(v.findings.map((f: { rule: string }) => f.rule)).toEqual([
      'FFG-PLT-002',
      'FFG-CLS-009',
      'FFG-PLT-003',
      'FFG-PLT-004',
      'FFG-PLT-005',
      'FFG-PLT-007',
      'FFG-PLT-017',
      'FFG-PLT-008',
      'FFG-SEC-003',
      'FFG-PLT-009',
      'FFG-GEN-003', // 플랫폼 규칙(패키지 게이트 대조 밖) — 시장 Compliance Profile
    ]);
    expect(v.profiles).toEqual([{ profileId: 'EU', version: '1.0.0', status: 'CONFIRMED' }]); // FFG-GEN-001 — 판정에 쓴 Profile 버전
  });
  it('FFG-GEN-003 미확인 시장(캐나다 검증 필요): 같은 명령을 활성화로 바꾸면 FAIL, 안전 Kill은 PASS', async () => {
    const { http } = await boot();
    const kill = { ...signed('kill_safety_dc2_eu.ok.json') };
    kill.target = { ...kill.target, market: 'CA' };
    const k = (await http().post('/api/gate/preview').set(OPS).send(kill).expect(201)).body;
    expect(k.findings.find((x: any) => x.rule === 'FFG-GEN-003')).toMatchObject({ ok: true });
    expect(k.profiles).toEqual([{ profileId: 'NA-CA', version: '1.0.0', status: 'VERIFY_REQUIRED' }]);
    const act = (await http().post('/api/gate/preview').set(OPS).send(signApprovals({ ...kill, request: 'activate' })).expect(201)).body;
    expect(act.findings.find((x: any) => x.rule === 'FFG-GEN-003')).toMatchObject({ ok: false, message: expect.stringMatching(/NA-CA 검증 필요/) });
    expect(act.result).toBe('FAIL');
  });
  it('Kill 관련 역할만 — 작성자는 403', async () => {
    const { http } = await boot();
    await http().post('/api/gate/preview').set(actor('usr-author', 'FEATURE_AUTHOR')).send(example('kill_safety_dc2_eu.ok.json')).expect(403);
  });
  it('TC-FF-50 v1 safe_mode 명령은 SCHEMA_FAIL(FFG-PLT-001)', async () => {
    const { http } = await boot();
    const v = (await http().post('/api/gate/preview').set(OPS).send(example('legacy_v1_kill_safe_stop.schema_fail.json')).expect(201)).body;
    expect(v.result).toBe('SCHEMA_FAIL');
    expect(v.errors.join('\n')).toContain('safe_mode');
  });
  it('개발 중 Feature Version은 FFG-PLT-002 — RELEASED만 대상', async () => {
    const { http } = await boot();
    const cmd = example('kill_safety_dc2_eu.ok.json');
    const dev = (await http().get('/api/features').query({ lifecycle: 'DEVELOPING' }).expect(200)).body.items[0];
    cmd.feature.id = dev.featureId;
    cmd.feature.version = dev.version;
    expect(failed((await http().post('/api/gate/preview').set(OPS).send(signApprovals(cmd)).expect(201)).body)).toContain('FFG-PLT-002');
  });
  it('TC-FF-48 이번 명령으로 24시간 누적이 상한을 넘으면 FFG-SEC-003 (원장 3대 + 4998대 > 5000)', async () => {
    const { http } = await boot();
    const cmd = example('kill_safety_dc2_eu.ok.json');
    cmd.scope.vehicle_ids = Array.from({ length: 4998 }, (_, i) => `VHC-${String(i).padStart(6, '0')}`);
    cmd.scope.max_vehicles = 4998;
    expect(failed((await http().post('/api/gate/preview').set(OPS).send(signApprovals(cmd)).expect(201)).body)).toEqual(['FFG-SEC-003']);
  });
});

describe('명령 원장 — PASS 명령만, 순번은 원장+1, 직전 Kill 승인자 기록', () => {
  it('TC-FF-47 기록하면 순번이 오르고 같은 명령 재전송은 FFG-PLT-017로 거부', async () => {
    const { http, gate, db } = await boot();
    const cmd = signed('kill_safety_dc2_eu.ok.json') as KillCommandV2;
    const op = { id: 'usr-ops', role: 'OPERATOR', correlationId: 'c-1' } as never;
    gate.record(op, cmd);
    const s = (await http().get('/api/gate/features/FEAT-00022/versions/1.0.0').expect(200)).body;
    expect(s).toMatchObject({ nextSeq: 12, ledger: { last_order_seq: 11, last_kill_approvers: ['u-1001', 'u-2002'] }, window: { deactivate: 5 } });
    expect(() => gate.record(op, cmd)).toThrow('정책 게이트를 통과하지 못한');
    expect(db.get<{ result: string; reason: string }>("SELECT result, reason FROM audit WHERE action = 'GATE_RECORD' ORDER BY id DESC LIMIT 1")).toMatchObject({
      result: 'FAILED',
      reason: 'FFG-PLT-017',
    });
    expect(failed(gate.preview(cmd))).toEqual(['FFG-PLT-017']);
  });
  it('TC-FF-16 Kill 승인자는 다음 복원을 승인할 수 없다(원장 기준)', async () => {
    const { gate } = await boot();
    const op = { id: 'usr-ops', role: 'OPERATOR', correlationId: 'c-2' } as never;
    gate.record(op, signed('kill_safety_dc2_eu.ok.json'));
    const restore = example('kill_safety_dc2_eu.ok.json');
    restore.request = 'restore';
    restore.command_seq = 12;
    restore.command_id = '6f1c2b9e-3d4a-4e5f-8a7b-1c2d3e4f5a6c';
    restore.scope.max_vehicles = 2;
    expect(failed(gate.preview(signApprovals(restore)))).toContain('FFG-PLT-005'); // u-1001·u-2002가 방금 Kill을 승인
    restore.approvals[0].approver_id = 'u-5005';
    restore.approvals[1].approver_id = 'u-6006';
    expect(failed(gate.preview(signApprovals(restore)))).not.toContain('FFG-PLT-005');
  });
  it('이동 시간 창 기록은 추가만 — 고치거나 지울 수 없다', async () => {
    const { db } = await boot();
    expect(() => db.run("UPDATE command_window SET vehicles = 0 WHERE feature_id = 'FEAT-00022'")).toThrow('추가만');
    expect(() => db.run("DELETE FROM command_window WHERE feature_id = 'FEAT-00022'")).toThrow('추가만');
  });
});

// FFP-F059 — 발행 때 서버가 명령의 대상 집합으로 승인 대상을 다시 만들어 승인자 키로 검증한다(길이만 보지 않는다).
// 회귀: 예전 게이트는 approval_sig 길이(64자 이상)만 봤다 — 승인 뒤 대상 차량이 바뀌어도(내부자 변경·저장소 조작) 발행됐다.
describe('승인 서명의 대상 집합 결속 (FFP-F059 · FFG-PLT-005)', () => {
  it('첫 승인 뒤 대상 차량을 바꾸면 두 번째 승인(발행)은 게이트가 거부하고 차단은 발행되지 않는다', async () => {
    const { http, db } = await boot();
    const r = await http()
      .post('/api/kill-requests')
      .set(KILL_REQUESTER)
      .send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '결속 시험', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' })
      .expect(201);
    await http().post(`/api/kill-requests/${r.body.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
    // 승인 서명은 ego-01 한 대에 대한 것 — 저장된 요청의 대상을 두 대로 늘린다
    const row = db.get<{ doc: string }>('SELECT doc FROM kill_request WHERE kill_id = ?', r.body.killId)!;
    db.run('UPDATE kill_request SET doc = ? WHERE kill_id = ?', JSON.stringify({ ...JSON.parse(row.doc), vins: ['ego-01', 'lead-01'] }), r.body.killId);
    const two = await http().post(`/api/kill-requests/${r.body.killId}/approvals`).set(KILL_APPROVERS[1]).send({});
    expect((await http().get(`/api/kill-requests/${r.body.killId}`).expect(200)).body.status).not.toBe('ACTIVE');
    expect(JSON.stringify(two.body)).toMatch(/FFG-PLT-005/);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kill_command WHERE kill_id = ?', r.body.killId)!.n).toBe(0);
  });

  it('형식 — 정준 64바이트 표기가 아니거나 두 승인자의 서명 값이 같으면 FFG-PLT-005 FAIL', async () => {
    const { gate } = await boot();
    const ok = signed('kill_safety_dc2_eu.ok.json');
    expect(failed(gate.preview(ok))).toEqual([]);
    const same = { ...ok, approvals: ok.approvals.map((a: any) => ({ ...a, approval_sig: ok.approvals[0].approval_sig })) };
    expect(failed(gate.preview(same))).toEqual(['FFG-PLT-005']);
    const noncanonical = { ...ok, approvals: [{ ...ok.approvals[0], approval_sig: `${ok.approvals[0].approval_sig.slice(0, 85)}h` }, ok.approvals[1]] };
    expect(failed(gate.preview(noncanonical))).toEqual(['FFG-PLT-005']);
  });
});

// D-RD-5 — 승인자 키 등록 의무. 플랫폼이 발행한 명령이든 외부에서 낸 명령이든 모든 승인 칸을 그 승인자의 등록된 공개키로,
// 명령에서 다시 만든 대상(기능·요청·사유·차량 집합·승인자·역할·서명 시각)에 대해 검증한다. 실패는 모두 같은 규칙(FFG-PLT-005).
describe('승인자 키 등록 의무 — 외부 명령의 승인 서명 (D-RD-5 · FFG-PLT-005)', () => {
  const sig005 = (v: { findings: { rule: string; ok: boolean; message: string }[] }) => v.findings.find((f) => f.rule === 'FFG-PLT-005')!;

  it('회귀: 보고서 예시의 자리표시 서명은 더는 PASS하지 않는다(키가 등록되지 않은 승인자)', async () => {
    const b = await bootApp({ at: '2026-10-13T00:30:00Z' });
    close = () => b.app.close();
    const v = (await b.http().post('/api/gate/preview').set(OPS).send(example('kill_safety_dc2_eu.ok.json')).expect(201)).body;
    expect(v.result).toBe('FAIL');
    expect(failed(v)).toEqual(['FFG-PLT-005']);
    expect(sig005(v).message).toMatch(/u-1001: 등록된 승인자 키가 없습니다/);
  });

  it('키가 등록된 승인자여도 자리표시 서명은 검증되지 않아 FAIL', async () => {
    const { gate } = await boot();
    const v = gate.preview(example('kill_safety_dc2_eu.ok.json'));
    expect(failed(v)).toEqual(['FFG-PLT-005']);
    expect(sig005(v).message).toMatch(/등록된 키로 검증되지 않거나/);
  });

  it('한 승인자만 키가 없어도 FAIL', async () => {
    const { gate } = await boot();
    const ok = example('kill_safety_dc2_eu.ok.json');
    const cmd = signApprovals({ ...ok, approvals: [ok.approvals[0], { ...ok.approvals[1], approver_id: 'u-9009' }] }); // u-9009 — 키 미등록
    expect(failed(gate.preview(cmd))).toEqual(['FFG-PLT-005']);
    expect(sig005(gate.preview(cmd)).message).toMatch(/u-9009: 등록된 승인자 키가 없습니다/);
  });

  it('서명한 대상과 명령의 대상 집합이 다르면 FAIL — 서명 뒤 차량·사유·승인 칸을 바꾼 명령', async () => {
    const { gate } = await boot();
    const ok = signed('kill_safety_dc2_eu.ok.json');
    expect(failed(gate.preview(ok))).toEqual([]);
    const moreVins = { ...ok, scope: { ...ok.scope, vehicle_ids: [...ok.scope.vehicle_ids, 'VHC-000125'], max_vehicles: 3 } };
    expect(failed(gate.preview(moreVins))).toEqual(['FFG-PLT-005']);
    expect(sig005(gate.preview(moreVins)).message).toMatch(/차량 3대/);
    expect(failed(gate.preview({ ...ok, reason: { ...ok.reason, category: 'SECURITY' } }))).toContain('FFG-PLT-005');
    // 승인 칸의 서명 시각도 서명 대상 — 서명 뒤 바꾸면 FAIL
    expect(failed(gate.preview({ ...ok, approvals: [{ ...ok.approvals[0], signed_at: '2026-10-12T23:55:00Z' }, ok.approvals[1]] }))).toEqual(['FFG-PLT-005']);
  });

  it('다른 승인자 키로 만든 서명(위조)은 FAIL', async () => {
    const { gate } = await boot();
    const ok = signed('kill_safety_dc2_eu.ok.json');
    // u-1001 칸에 u-5005 키로 만든 서명 — 형식은 정준이지만 u-1001의 등록 키로 검증되지 않는다
    const other = signApprovals({ ...ok, approvals: [{ ...ok.approvals[0], approver_id: 'u-5005' }, ok.approvals[1]] });
    const forged = { ...ok, approvals: [{ ...ok.approvals[0], approval_sig: other.approvals[0].approval_sig }, ok.approvals[1]] };
    expect(failed(gate.preview(forged))).toEqual(['FFG-PLT-005']);
  });

  it('서명 시각이 발효 시각보다 뒤이거나 24시간 넘게 앞선 승인은 FAIL(오래된 승인 재사용 차단)', async () => {
    const { gate } = await boot();
    const ok = example('kill_safety_dc2_eu.ok.json');
    const late = signApprovals({ ...ok, approvals: [{ ...ok.approvals[0], signed_at: '2026-10-13T00:10:00Z' }, ok.approvals[1]] });
    expect(sig005(gate.preview(late)).message).toMatch(/발효 시각보다 뒤/);
    const stale = signApprovals({ ...ok, approvals: [{ ...ok.approvals[0], signed_at: '2026-10-11T23:00:00Z' }, ok.approvals[1]] });
    expect(failed(gate.preview(stale))).toEqual(['FFG-PLT-005']);
    expect(sig005(gate.preview(stale)).message).toMatch(/오래된 승인/);
  });

  it('외부 승인자 공개키 등록 — 보안 책임자만, 같은 승인자 덮어쓰기 거부, Ed25519만, 목록은 지문만', async () => {
    const { http } = await boot();
    const SEC = actor('usr-csm', 'SECURITY_OFFICER');
    const pem = testApproverKey('u-7007').publicKeyPem;
    await http().post('/api/pki/approver-keys').set(OPS).send({ userId: 'u-7007', publicKeyPem: pem, reason: '외부 승인자' }).expect(403);
    const r = (await http().post('/api/pki/approver-keys').set(SEC).send({ userId: 'u-7007', publicKeyPem: pem, reason: '외부 승인자' }).expect(201)).body;
    expect(r).toMatchObject({ userId: 'u-7007', kid: 'EXT-u-7007', source: 'EXTERNAL', fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/) });
    await http().post('/api/pki/approver-keys').set(SEC).send({ userId: 'u-7007', publicKeyPem: testApproverKey('u-1001').publicKeyPem, reason: '바꿔치기' }).expect(409);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await http().post('/api/pki/approver-keys').set(SEC).send({ userId: 'u-8008', publicKeyPem: rsa, reason: 'RSA 키' }).expect(400);
    const list = (await http().get('/api/pki/approver-keys').set(OPS).expect(200)).body.items;
    expect(list.find((k: { userId: string }) => k.userId === 'u-7007')).toMatchObject({ status: 'ACTIVE', source: 'EXTERNAL' });
    expect(JSON.stringify(list)).not.toMatch(/PRIVATE KEY|BEGIN PUBLIC KEY/);
  });

  it('외부 장치 키 승인자는 플랫폼이 대신 서명할 수 없다(APPROVER_KEY_EXTERNAL)', async () => {
    const { hsm } = await boot();
    expect(() => hsm.approve('u-1001', '{}')).toThrow(/외부 장치/);
  });
});

describe('운영 모드 — 키가 등록되지 않은 승인자의 긴급 차단 승인 거부 (D-RD-5)', () => {
  it('FF_ENV=production이면 승인 중 키를 즉석으로 만들지 않고 403 APPROVER_KEY_NOT_ENROLLED로 거부한다', async () => {
    const { http, db, get } = await boot();
    const kills = get(KillService);
    const r = await http()
      .post('/api/kill-requests')
      .set(KILL_REQUESTER)
      .send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '운영 모드 키 의무', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' })
      .expect(201);
    const prev = process.env.FF_ENV;
    process.env.FF_ENV = 'production';
    try {
      // 운영 모드는 데모 헤더 인증을 받지 않으므로(401) 서비스로 직접 승인한다 — 승인 경로가 키 조회에서 멈춘다
      let err: unknown;
      try {
        kills.approve({ id: 'usr-safety', role: 'SAFETY_OFFICER', correlationId: 'prod-1' }, r.body.killId, {});
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: 'FORBIDDEN', details: { code: 'APPROVER_KEY_NOT_ENROLLED' } });
      expect((err as Error).message).toMatch(/승인 서명 키가 등록되지 않은 계정/);
    } finally {
      if (prev === undefined) delete process.env.FF_ENV;
      else process.env.FF_ENV = prev;
    }
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM approver_key WHERE user_id = 'usr-safety'")!.n).toBe(0);
    // 데모 모드에서는 같은 승인이 통한다(즉석 생성 — 데모 대역)
    await http().post(`/api/kill-requests/${r.body.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
  });
});
