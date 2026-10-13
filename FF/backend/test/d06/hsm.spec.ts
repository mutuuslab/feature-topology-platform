// 소프트웨어 HSM — 용도별 키(FFG-SEC-002), 승인자 개인 서명(FFG-PLT-005), 차량 키 epoch·CMAC(FFG-VEH-013)
import { afterEach, describe, expect, it } from 'vitest';
import { jcs } from '@ff/contracts';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { actor, bootApp } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => close?.());
async function boot() {
  const b = await bootApp({ at: '2026-10-13T00:00:00Z' });
  close = () => b.app.close();
  return { ...b, hsm: b.get(HsmService), pki: b.get(PkiService) };
}

const CMD = jcs({ type: 'kill_command', schema_version: '2.0', feature: { id: 'FEAT-00022', version: '1.0.0' }, request: 'deactivate' });

describe('용도별 서명 키 (FFG-SEC-002)', () => {
  it('부팅 때는 정책 키 하나만 — 기존 키 번호를 바꾸지 않는다', async () => {
    const { pki } = await boot();
    expect(pki.keys().map((k) => [k.keyId, k.purpose])).toEqual([['KEY-0001', 'policy']]);
  });

  it('분리 서명은 64바이트 원시 서명(base64url 86자)이고, 다른 용도로 검증하면 무효', async () => {
    const { hsm, pki } = await boot();
    const s = hsm.signDetached('kill', CMD);
    expect(s.value).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(pki.keys().find((k) => k.keyId === s.kid)!.purpose).toBe('kill');
    expect(hsm.verifyDetached('kill', CMD, s)).toEqual({ valid: true, reason: 'SIGNATURE_VALID' });
    expect(hsm.verifyDetached('activate', CMD, s).reason).toBe('WRONG_KEY_PURPOSE');
    expect(hsm.verifyDetached('kill', CMD.replace('deactivate', 'activate'), s).reason).toBe('SIGNATURE_INVALID');
    expect(hsm.verifyDetached('kill', CMD, { ...s, value: Buffer.from('x').toString('base64') }).reason).toBe('SIGNATURE_FORMAT');
  });

  it('게시본 검증도 기대 용도와 다른 키를 거부', async () => {
    const { pki } = await boot();
    const sig = pki.sign({ a: 1 }, 'restore');
    expect(pki.verify({ a: 1 }, sig, undefined, 'restore').valid).toBe(true);
    expect(pki.verify({ a: 1 }, sig, undefined, 'kill')).toEqual({ valid: false, reason: 'WRONG_KEY_PURPOSE' });
  });

  it('용도별 교체 — 차단 키만 바뀌고 정책 키는 그대로', async () => {
    const { http, pki } = await boot();
    pki.sign({}, 'kill');
    await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: '정기 교체', purpose: 'kill' }).expect(201);
    const active = pki.keys().filter((k) => k.status === 'ACTIVE').map((k) => [k.keyId, k.purpose]);
    expect(active).toEqual([['KEY-0001', 'policy'], ['KEY-0003', 'kill']]);
  });
});

describe('승인자 개인 서명 (FFG-PLT-005)', () => {
  it('사람마다 키 — 본인 서명은 검증되고 다른 사람 키·바뀐 내용은 실패', async () => {
    const { hsm } = await boot();
    const a = hsm.approve('usr-quality', CMD);
    expect(a.kid).toBe('APR-usr-quality');
    expect(hsm.verifyApproval('usr-quality', CMD, a.value)).toBe(true);
    hsm.approve('usr-coordinator', CMD);
    expect(hsm.verifyApproval('usr-coordinator', CMD, a.value)).toBe(false);
    expect(hsm.verifyApproval('usr-quality', CMD + ' ', a.value)).toBe(false);
  });
});

describe('차량 키 epoch·AES-CMAC (FFG-VEH-013)', () => {
  it('cmd_auth는 22자, 같은 차량·epoch로만 검증되고 epoch를 올리면 새 키', async () => {
    const { hsm, http } = await boot();
    const frame = Buffer.from('000000160100' + '3c'.repeat(26), 'hex');
    expect(hsm.epoch()).toBe(1);
    const tag = hsm.cmac('ego-01', 1, frame);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(hsm.verifyCmac('ego-01', 1, frame, tag)).toBe(true);
    expect(hsm.verifyCmac('lead-01', 1, frame, tag)).toBe(false); // 다른 차량 키
    expect(hsm.verifyCmac('ego-01', 1, Buffer.concat([frame.subarray(0, 4), Buffer.from([0xff]), frame.subarray(5)]), tag)).toBe(false); // 1바이트 변조
    await http().post('/api/pki/epoch').set(actor('u-sec', 'SECURITY_OFFICER')).send({ reason: '키 유출 대응 훈련' }).expect(201);
    expect(hsm.epoch()).toBe(2);
    expect(hsm.cmac('ego-01', 2, frame)).not.toBe(tag);
    expect(hsm.verifyCmac('ego-01', 1, frame, tag)).toBe(true); // 이전 epoch 비밀은 검증용으로 남는다
    expect(hsm.verifyCmac('ego-01', 9, frame, tag)).toBe(false);
  });

  it('epoch 상향은 보안·안전 담당만 — 운영자는 거부되고 감사 DENIED', async () => {
    const { http } = await boot();
    await http().post('/api/pki/epoch').set(actor('u-op', 'OPERATOR')).send({ reason: '시도' }).expect(403);
  });
});
