// GLEO v2 교차 언어 시험 벡터 — FF가 결정적으로 만들고(contracts/src/gleo-v2.vectors.json), FF_IMP(Python)가 같은 입력으로
// 차량 키(HKDF)·cmd_auth 블록·AES-CMAC·JCS·판정(Guard 순서, 수신 검사 6단계)을 직접 계산해 대조한다. 손으로 고치지 않는다.
// 다시 만들기: UPDATE_VECTORS=1 npx vitest run test/d03/gleo-v2-vectors.spec.ts
// FFG-VEH-002 · FFG-VEH-013 · FFG-TEL-003 · FFG-PLT-001
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approverRef,
  authBlock,
  checkStatusReport,
  crc32,
  guardCheck,
  jcs,
  KillCommandV2,
  requestFrame,
  statusAuthCanonical,
  StatusReportV2,
  wireErrors,
  type StatusCheckContext,
} from '@ff/contracts';
import { aesCmac, hkdf16, targetHashOf, vehiclePseudonym } from '../../src/kernel/crypto';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { bootApp } from '../helpers';

const FILE = join(__dirname, '..', '..', '..', 'contracts', 'src', 'gleo-v2.vectors.json');
const sha = (s: string) => createHash('sha256').update(s).digest();
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** 시험 전용 고정값 — 운영 키가 아니다 */
const ROOT = sha('ffp-test-vehicle-root-v1');
const EPOCH = 1;
const KILL_SEED = sha('ffp-test-kill-key-v1');
const killKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), KILL_SEED]), format: 'der', type: 'pkcs8' });
const vehicleKey = (vin: string) => hkdf16(ROOT, `epoch:${EPOCH}`, `ffp-vehicle-key|${vin}`);
const cmac = (vin: string, bytes: Buffer) => b64url(aesCmac(vehicleKey(vin), bytes));

function envelope(vin: string, vehicleSeq: number, over: { deactClass?: 'DC2' | 'DC0' } = {}) {
  const approvers = ['u-1001', 'u-2002'];
  const refs: [number, number] = [approverRef(approvers[0]), approverRef(approvers[1])];
  const body = {
    type: 'kill_command' as const,
    schema_version: '2.0' as const,
    command_id: '6f1c2b9e-3d4a-4e5f-8a7b-1c2d3e4f5a6b',
    command_seq: 11,
    request: 'deactivate' as const,
    feature: { id: 'FEAT-00022', version: '1.0.0', f_class: 'F3' as const, deact_class: over.deactClass ?? ('DC2' as const) },
    reason: { category: 'SAFETY' as const, code: 'DIST_EST_BIAS' },
    scope: { vehicle_ids: [vin], max_vehicles: 1 },
    target: { market: 'KR' as const, ecu_id: '99211-NX400', sw_id: 'SW-CARE-SDIST-APP', sw_version: '1.2.1', rxswin: 'NONE' },
    validity: { not_before: '2026-10-13T00:00:00Z', expires_at: '2026-10-13T12:00:00Z' },
    approvals: [
      { approver_id: approvers[0], role: 'FSM' as const, signed_at: '2026-10-12T23:50:00Z', approval_sig: 'A'.repeat(86) },
      { approver_id: approvers[1], role: 'OPS_LEAD' as const, signed_at: '2026-10-12T23:52:00Z', approval_sig: 'B'.repeat(86) },
    ],
    regulatory: { type_approval_impact: 'NONE' as const, r156_assessment_id: 'SUMS-IA-FEAT-00022-1.0.0', containment_justification: '원인 분석 전 봉쇄' },
    user_notice: { required: true, text_ref: 'HMI-TXT-FEAT00022-DEACT' },
    evidence: { evidence_manifest_id: 'EVM-FEAT-00022-1.0.0', bom_baseline_id: 'BL-00028' },
    issued_by: 'ff-platform',
    issued_at: '2026-10-12T23:55:00Z',
  };
  const block = Buffer.from(
    authBlock({
      featureId: body.feature.id,
      version: body.feature.version,
      request: body.request,
      reason: body.reason.category,
      deactClass: body.feature.deact_class,
      keyEpoch: EPOCH,
      vehicleSeq,
      notBefore: body.validity.not_before,
      expiresAt: body.validity.expires_at,
      targetHash: targetHashOf(vin, body.target.ecu_id, body.target.sw_version),
      approverRefs: refs,
    }),
  );
  const cmdAuth = cmac(vin, block);
  const unsigned = { ...body, vehicle_auth: { key_epoch: EPOCH, vehicle_seq: vehicleSeq, approver_refs: refs, cmd_auth: cmdAuth } };
  const signature = { alg: 'EdDSA' as const, kid: 'TEST-KILL-1', value: b64url(sign(null, Buffer.from(jcs(unsigned)), killKey)) };
  const frame = requestFrame(block, Buffer.from(cmdAuth.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), 0);
  return {
    envelope: { ...unsigned, signature },
    authBlockHex: block.toString('hex'),
    frameHex: Buffer.from(frame).toString('hex'),
    crc32: crc32(frame.subarray(0, 52)),
    targetHash: targetHashOf(vin, body.target.ecu_id, body.target.sw_version),
  };
}

function report(vin: string, over: Partial<StatusReportV2> = {}) {
  const base: Omit<StatusReportV2, 'state_auth'> = {
    type: 'status_report',
    schema_version: '2.0',
    vehicle_pseudonym: vehiclePseudonym(vin),
    feature: { id: 'FEAT-00022', version: '1.0.0' },
    state: 'DISABLED',
    reason: { category: 'SAFETY', source: 'REMOTE' },
    request_result: 'NONE',
    vehicle_seq: 1,
    durable: true,
    hmi: 'INFO_DISABLED',
    feature_weight_permille: 0,
    edr_aligned_state: 'OFF_BY_COMMAND',
    received_at: '2026-10-13T00:00:01Z',
    applied_at: '2026-10-13T00:00:08Z',
    observed_at: '2026-10-13T00:00:08Z',
    time_sync: 'SYNCED',
    offline_since: null,
    data_category: 'SAFETY_OPERATION',
    key_epoch: EPOCH,
    report_seq: (1 << 16) | 3,
    persistence: 'DURABLE',
    ...over,
  } as Omit<StatusReportV2, 'state_auth'>;
  const canonical = statusAuthCanonical(base as Record<string, unknown>);
  return { report: { ...base, state_auth: cmac(vin, Buffer.from(canonical)) } as StatusReportV2, canonical };
}

/** 벡터 전체 — 같은 입력이면 같은 바이트 */
function build() {
  const vins = ['ego-01', 'lead-01'];
  const ok = (vin: string) => envelope(vin, 1);
  const guardBase = {
    keyEpoch: EPOCH,
    currentEpoch: EPOCH,
    lastVehicleSeq: 0,
    now: Date.parse('2026-10-13T00:00:30Z'),
    notBefore: Date.parse('2026-10-13T00:00:00Z'),
    expiresAt: Date.parse('2026-10-13T12:00:00Z'),
    designClass: 'DC2',
    commandClass: 'DC2',
  };
  const e = ok('ego-01');
  const refs = e.envelope.vehicle_auth.approver_refs as [number, number];
  const ctx: StatusCheckContext = { authOk: true, lastReportSeq: (1 << 16) | 2, expectedVersion: '1.0.0', lastCommand: { request: 'deactivate', vehicleSeq: 1 } };
  const disabled = report('ego-01');
  const forged = { ...disabled.report, state: 'ACTIVE' as const, hmi: 'NONE' as const, edr_aligned_state: 'AVAILABLE' as const, feature_weight_permille: 1000 };
  const reboot = report('ego-01', {
    state: 'ACTIVE',
    reason: { category: 'SAFETY', source: 'STARTUP' },
    hmi: 'NONE',
    edr_aligned_state: 'AVAILABLE',
    feature_weight_permille: 1000,
    report_seq: (2 << 16) | 1,
  });
  return {
    _note: 'GLEO v2 교차 언어 시험 벡터 — backend/test/d03/gleo-v2-vectors.spec.ts가 만든다(손으로 고치지 않는다). 시험 전용 고정 키, 운영 키 아님.',
    keys: {
      vehicle_root_b64: ROOT.toString('base64'),
      epoch: EPOCH,
      hkdf: { hash: 'SHA-256', salt: `epoch:${EPOCH}`, info: 'ffp-vehicle-key|<VIN>', length: 16 },
      vehicle_keys_hex: Object.fromEntries(vins.map((v) => [v, vehicleKey(v).toString('hex')])),
      kill_signing: { alg: 'EdDSA', kid: 'TEST-KILL-1', public_key_pem: createPublicKey(killKey).export({ type: 'spki', format: 'pem' }).toString() },
      pseudonym: { algorithm: "sha256('ffp-pseudonym|' + VIN)[0:16] hex", values: Object.fromEntries(vins.map((v) => [v, vehiclePseudonym(v)])) },
    },
    envelopes: vins.map((vin) => {
      const x = ok(vin);
      return {
        vin,
        envelope: x.envelope,
        target_hash: x.targetHash,
        auth_block_hex: x.authBlockHex,
        frame56_hex: x.frameHex,
        crc32: x.crc32,
        jcs_signed_bytes: jcs((({ signature: _s, ...b }) => b)(x.envelope)),
        schema_errors: wireErrors(KillCommandV2, x.envelope),
      };
    }),
    guard_cases: [
      {
        name: '정상',
        input: { ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, approverRefs: refs },
        expected: guardCheck({ ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, approverRefs: refs }),
      },
      {
        name: '재전송',
        input: { ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, lastVehicleSeq: 1, approverRefs: refs },
        expected: guardCheck({ ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, lastVehicleSeq: 1, approverRefs: refs }),
      },
      {
        name: 'cmd_auth 불일치',
        input: { ...guardBase, jwsOk: true, cmdAuthOk: false, vehicleSeq: 1, approverRefs: refs },
        expected: guardCheck({ ...guardBase, jwsOk: true, cmdAuthOk: false, vehicleSeq: 1, approverRefs: refs }),
      },
      {
        name: '등급 불일치(운영자 DC0)',
        input: { ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, commandClass: 'DC0', approverRefs: refs },
        expected: guardCheck({ ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, commandClass: 'DC0', approverRefs: refs }),
      },
      {
        name: '만료',
        input: { ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, now: Date.parse('2026-10-13T12:00:00Z'), approverRefs: refs },
        expected: guardCheck({ ...guardBase, jwsOk: true, cmdAuthOk: true, vehicleSeq: 1, now: Date.parse('2026-10-13T12:00:00Z'), approverRefs: refs }),
      },
    ],
    status_cases: [
      { name: '정상 DISABLED', vin: 'ego-01', report: disabled.report, state_auth_canonical: disabled.canonical, context: ctx, expected: checkStatusReport(disabled.report, ctx) },
      { name: '위조(상태 바꾸고 state_auth 그대로)', vin: 'ego-01', report: forged, context: { ...ctx, authOk: false }, expected: checkStatusReport(forged, { ...ctx, authOk: false }) },
      {
        name: '재전송(같은 report_seq)',
        vin: 'ego-01',
        report: disabled.report,
        context: { ...ctx, lastReportSeq: disabled.report.report_seq },
        expected: checkStatusReport(disabled.report, { ...ctx, lastReportSeq: disabled.report.report_seq }),
      },
      { name: '재부팅 뒤 해제 없이 ACTIVE(정상 서명)', vin: 'ego-01', report: reboot.report, state_auth_canonical: reboot.canonical, context: ctx, expected: checkStatusReport(reboot.report, ctx) },
    ],
  };
}

describe('GLEO v2 교차 언어 시험 벡터', () => {
  it('파일이 재생성 결과와 같다(UPDATE_VECTORS=1이면 다시 쓴다)', () => {
    const fresh = JSON.stringify(build(), null, 2) + '\n';
    if (process.env.UPDATE_VECTORS === '1') writeFileSync(FILE, fresh);
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(fresh);
  });

  it('봉투는 v2 스키마에 맞고, 판정 기대값이 의도와 같다', () => {
    const v = build();
    expect(v.envelopes.every((e) => e.schema_errors.length === 0)).toBe(true);
    expect(v.guard_cases.map((c) => c.expected)).toEqual(['NONE', 'REPLAY', 'AUTH_FAILED', 'CLASS_MISMATCH', 'EXPIRED']);
    expect(v.status_cases.map((c) => (c.expected.violation ? `${c.expected.violation.step}:${c.expected.violation.code}` : 'ACCEPTED'))).toEqual([
      'ACCEPTED',
      'AUTH:AUTH_FAILED',
      'SEQUENCE:REPLAY',
      'HISTORY:ACTIVE_WITHOUT_RESTORE',
    ]);
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
  delete process.env.FF_HSM_VEHICLE_ROOT;
});

describe('FF_HSM_VEHICLE_ROOT — 모의 공장 주입', () => {
  it('주입한 루트면 플랫폼 HSM의 차량 키 CMAC이 벡터와 같다(FF_IMP 모의 차량과 같은 키)', async () => {
    process.env.FF_HSM_VEHICLE_ROOT = ROOT.toString('base64');
    const b = await bootApp({ at: '2026-10-13T00:00:00Z' });
    close = () => b.app.close();
    const hsm = b.get(HsmService);
    expect(hsm.epoch()).toBe(1);
    const v = build();
    for (const e of v.envelopes) expect(hsm.cmac(e.vin, 1, Buffer.from(e.auth_block_hex, 'hex'))).toBe(e.envelope.vehicle_auth.cmd_auth);
    const s = v.status_cases[0];
    expect(hsm.verifyCmac(s.vin, 1, Buffer.from(s.state_auth_canonical!), s.report.state_auth)).toBe(true);
  });
});
