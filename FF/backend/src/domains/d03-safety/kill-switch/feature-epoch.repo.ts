// Feature epoch(ADS-BE07) — 정책 게시본 순번(flag:키)과 Feature 명령 순번을 하나로 묶는 Feature 단위 세대 번호. 명령 원장(command_ledger)에 둔다.
// 올리는 곳은 하나 — 긴급 차단 발행(KillService.approve). 게시본은 만들 때 지금 epoch를 싣고(0이면 싣지 않음), 차량은 본 epoch보다 낮은 게시본을 거부한다.
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';

@Injectable()
export class FeatureEpochRepo {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  current(featureId: string): number {
    return this.db.get<{ e: number }>('SELECT feature_epoch AS e FROM command_ledger WHERE feature_id = ?', featureId)?.e ?? 0;
  }

  /** 게시본에 실을 epoch — 0인 Feature는 뺀다(차단이 없던 Feature의 게시본은 그대로) */
  of(featureIds: readonly string[]): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const f of new Set(featureIds)) {
      const e = this.current(f);
      if (e > 0) out[f] = e;
    }
    return Object.keys(out).length ? out : null;
  }

  /** 긴급 차단 발행 — 대상 Feature(의존 포함)의 epoch를 하나씩 올린다. 호출자 트랜잭션 안 */
  bump(featureIds: readonly string[]) {
    if (!this.db.inTransaction) throw new Error('Feature epoch는 차단 발행과 같은 트랜잭션 안에서 올린다');
    for (const f of new Set(featureIds))
      this.db.run(
        "INSERT INTO command_ledger (feature_id, last_seq, last_kill_approvers, updated_at, feature_epoch) VALUES (?, 0, '[]', ?, 1) ON CONFLICT(feature_id) DO UPDATE SET feature_epoch = command_ledger.feature_epoch + 1",
        f,
        this.clock.iso(),
      );
  }
}
