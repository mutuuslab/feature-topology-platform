// 플랫폼 정책 게이트·명령 원장 (D03-02, 보고서 v1.1 8장·부록 D) — 보고서 예시 명령을 플랫폼 실데이터(Registry·안전 분류·원장)로 판정한다.
// FFG-PLT-001·002·005·017, FFG-SEC-003 · TC-FF-16 · TC-FF-45 · TC-FF-47 · TC-FF-48 · TC-FF-50
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KillCommandV2 } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { gateStatusOf, PolicyGateService } from '../../src/domains/d03-safety/deploy-safety/policy-gate.service';
import { actor, bootApp } from '../helpers';

const EX = join(__dirname, '..', '..', '..', 'harness', 'guide', 'schema', 'examples');
const example = (name: string) => JSON.parse(readFileSync(join(EX, name), 'utf8'));
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
  return { ...b, db: b.get<Db>(DB), gate: b.get(PolicyGateService) };
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
    const v = (await http().post('/api/gate/preview').set(OPS).send(example('kill_safety_dc2_eu.ok.json')).expect(201)).body;
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
    const kill = { ...example('kill_safety_dc2_eu.ok.json') };
    kill.target = { ...kill.target, market: 'CA' };
    const k = (await http().post('/api/gate/preview').set(OPS).send(kill).expect(201)).body;
    expect(k.findings.find((x: any) => x.rule === 'FFG-GEN-003')).toMatchObject({ ok: true });
    expect(k.profiles).toEqual([{ profileId: 'NA-CA', version: '1.0.0', status: 'VERIFY_REQUIRED' }]);
    const act = (await http().post('/api/gate/preview').set(OPS).send({ ...kill, request: 'activate' }).expect(201)).body;
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
    expect(failed((await http().post('/api/gate/preview').set(OPS).send(cmd).expect(201)).body)).toContain('FFG-PLT-002');
  });
  it('TC-FF-48 이번 명령으로 24시간 누적이 상한을 넘으면 FFG-SEC-003 (원장 3대 + 4998대 > 5000)', async () => {
    const { http } = await boot();
    const cmd = example('kill_safety_dc2_eu.ok.json');
    cmd.scope.vehicle_ids = Array.from({ length: 4998 }, (_, i) => `VHC-${String(i).padStart(6, '0')}`);
    cmd.scope.max_vehicles = 4998;
    expect(failed((await http().post('/api/gate/preview').set(OPS).send(cmd).expect(201)).body)).toEqual(['FFG-SEC-003']);
  });
});

describe('명령 원장 — PASS 명령만, 순번은 원장+1, 직전 Kill 승인자 기록', () => {
  it('TC-FF-47 기록하면 순번이 오르고 같은 명령 재전송은 FFG-PLT-017로 거부', async () => {
    const { http, gate, db } = await boot();
    const cmd = example('kill_safety_dc2_eu.ok.json') as KillCommandV2;
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
    gate.record(op, example('kill_safety_dc2_eu.ok.json'));
    const restore = example('kill_safety_dc2_eu.ok.json');
    restore.request = 'restore';
    restore.command_seq = 12;
    restore.command_id = '6f1c2b9e-3d4a-4e5f-8a7b-1c2d3e4f5a6c';
    restore.scope.max_vehicles = 2;
    expect(failed(gate.preview(restore))).toContain('FFG-PLT-005'); // u-1001·u-2002가 방금 Kill을 승인
    restore.approvals[0].approver_id = 'u-5005';
    restore.approvals[1].approver_id = 'u-6006';
    expect(failed(gate.preview(restore))).not.toContain('FFG-PLT-005');
  });
  it('이동 시간 창 기록은 추가만 — 고치거나 지울 수 없다', async () => {
    const { db } = await boot();
    expect(() => db.run("UPDATE command_window SET vehicles = 0 WHERE feature_id = 'FEAT-00022'")).toThrow('추가만');
    expect(() => db.run("DELETE FROM command_window WHERE feature_id = 'FEAT-00022'")).toThrow('추가만');
  });
});
