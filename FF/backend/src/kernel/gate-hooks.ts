// Gate 판정·Lifecycle 전이에 다른 도메인이 조건을 더하는 자리(80-50 A5 — codeBeamer 산출물·재판정 요청).
// d01(게이트·전이)이 d05(외부 연계)를 가져오지 않게 커널에 둔다. 앱마다 하나(전역 모듈 공급자) — 시험의 여러 앱이 섞이지 않는다.
import { Injectable } from '@nestjs/common';
import type { Blocker, FeatureVersionRow, GateId, Lifecycle } from '@ff/contracts';

export interface GateHook {
  /** PASS 판정을 막는 사유(비면 통과) — 판정 전에, 트랜잭션 밖에서 부른다 */
  gateBlockers?: (f: FeatureVersionRow, gate: GateId, inputResult: string) => string[];
  /** 전이(사람·자동)를 막는 사유 */
  transitionBlockers?: (f: FeatureVersionRow, to: Lifecycle) => Blocker[];
}

@Injectable()
export class GateHooks {
  private readonly hooks: GateHook[] = [];
  register(h: GateHook) {
    this.hooks.push(h);
  }
  gateBlockers(f: FeatureVersionRow, gate: GateId, inputResult: string): string[] {
    return this.hooks.flatMap((h) => h.gateBlockers?.(f, gate, inputResult) ?? []);
  }
  transitionBlockers(f: FeatureVersionRow, to: Lifecycle): Blocker[] {
    return this.hooks.flatMap((h) => h.transitionBlockers?.(f, to) ?? []);
  }
}
