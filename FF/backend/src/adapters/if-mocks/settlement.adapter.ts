// 정산 시스템 연계 모의 어댑터(D05-04, FR-BIL-001-002) — 실제 정산 시스템 대신 받은 사용량 묶음에 영수 번호를 돌려주고 if_call 'SETTLEMENT'에 남긴다.
// IF_MODE_SETTLEMENT=off면 요청을 보내지 않고 실패한다. 운영 모드에서 과금 연결이 실제가 아니면 보내지 않는다(모의 영수가 실제 정산처럼 남지 않게).
import { Injectable } from '@nestjs/common';
import type { SettlementLine } from '@ff/contracts';
import { connectionStatuses } from '../../kernel/connections';
import { DomainError } from '../../kernel/errors';
import { isProduction } from '../../kernel/runtime-config';
import { IfCallRepo } from '../if-call/if-call.repo';

export interface SettlementReceipt {
  receiptId: string;
  period: string;
  acceptedLines: number;
}

@Injectable()
export class SettlementSystem {
  constructor(private readonly calls: IfCallRepo) {}

  /** 사용량 묶음 보내기 — 같은 기간은 처음 영수를 돌려준다(멱등 키 = 기간) */
  send(period: string, lines: SettlementLine[]): SettlementReceipt {
    const billing = connectionStatuses(process.env).find((c) => c.key === 'billing');
    if (isProduction() && billing?.mode !== 'live') throw new DomainError('GUARD_FAILED', '정산 시스템이 아직 연결되지 않아 사용량을 보낼 수 없습니다. 연결 설정 뒤 다시 보내세요.', { connection: 'settlement', mode: billing?.mode, errorType: 'NOT_CONNECTED' });
    if (process.env.IF_MODE_SETTLEMENT === 'off') throw new DomainError('GUARD_FAILED', '정산 시스템 연계가 꺼져 있습니다 (IF_MODE_SETTLEMENT=off) — 사용량을 보내지 않았습니다.', { connection: 'settlement', mode: 'off', errorType: 'CONNECTION_OFF' });
    return this.calls.call('SETTLEMENT', `settlement:${period}`, { period, lines }, () => ({
      receiptId: `SETL-${period}-${String(this.calls.next('SETTLEMENT')).padStart(4, '0')}`,
      period,
      acceptedLines: lines.length,
    }));
  }
}
