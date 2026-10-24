// 시험용 외부 승인자 키 (D-RD-5) — 긴급 차단 명령의 승인 서명은 그 승인자의 등록된 공개키로 검증된다.
// 보고서 예시 명령(harness/guide/schema/examples)의 approval_sig는 자리표시 값이라 어떤 등록 키로도 검증되지 않는다 —
// 시험은 승인자마다 Ed25519 키를 만들어 공개키만 플랫폼에 등록하고(외부 장치 승인자와 같은 길), 명령에서 다시 만든
// 승인 대상(commandApprovalSubject)에 서명해 기준선(PASS)을 만든다.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { b64url, commandApprovalSubject, jcs, type KillCommandV2 } from '@ff/contracts';
import type { Actor } from '../src/kernel/actor';
import type { HsmService } from '../src/domains/d06-qsec/pki-kms/hsm.service';

const keys = new Map<string, { publicKeyPem: string; privateKey: KeyObject }>();

/** 승인자별 시험 키 — 프로세스 안에서 같은 승인자는 같은 키 */
export function testApproverKey(userId: string) {
  let k = keys.get(userId);
  if (!k) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    k = { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
    keys.set(userId, k);
  }
  return k;
}

const SECURITY: Actor = { id: 'usr-csm', role: 'SECURITY_OFFICER', correlationId: 'test-approver-keys' };

/** 시험 승인자들의 공개키를 등록한다(이미 있으면 그대로) */
export function registerTestApprovers(hsm: HsmService, userIds: readonly string[]) {
  for (const userId of userIds)
    if (!hsm.hasApproverKey(userId)) hsm.registerApproverKey(SECURITY, { userId, publicKeyPem: testApproverKey(userId).publicKeyPem, reason: '시험 승인자 키 등록' });
}

/** 명령의 모든 승인 칸을 시험 키로 다시 서명한다 — 명령을 바꾼 뒤에도 부른다(서명 대상이 명령에서 나온다) */
export function signApprovals<T extends Pick<KillCommandV2, 'feature' | 'request' | 'reason' | 'scope' | 'approvals'>>(cmd: T): T {
  return {
    ...cmd,
    approvals: cmd.approvals.map((a) => ({ ...a, approval_sig: b64url(sign(null, Buffer.from(jcs(commandApprovalSubject(cmd, a))), testApproverKey(a.approver_id).privateKey)) })),
  };
}
