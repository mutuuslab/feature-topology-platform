// 확대 판정의 축별 근거(ADS-BE12) — 차량 보고 Active 노출량(미확인 분리)·감시 지표 신선도·조합별 근거·동결을 읽어 contracts expansionVerdict(순수 함수)로 축 판정을 낸다.
// 입력은 시드(가정값 — 텔레메트리 연동 TL-B01·B02 전). Canary 관측과 합친 확대 판정·API는 expansion.service(통합 D-INT-4). 동결 명령은 이 작업 밖.
import { Inject, Injectable } from '@nestjs/common';
import { expansionVerdict, type ExpansionInput, type ExpansionView, type Policy } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';

interface ExpansionDoc extends Omit<ExpansionInput, 'now'> {
  featureId: string;
  version: string;
  policyAllowed: number;
  unconfirmed: number;
}

@Injectable()
@PlatformComponent('D01-08')
export class AdsExpansionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 정책 Feature Version의 축별 근거 — 판정 입력이 없으면 null */
  evidence(p: Policy): ExpansionView | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_expansion_input WHERE feature_id = ? AND version = ?', p.featureId, p.featureVersion);
    if (!r) return null;
    const d = JSON.parse(r.doc) as ExpansionDoc;
    const result = expansionVerdict({ frozen: d.frozen, metrics: d.metrics, combos: d.combos, now: this.clock.now().getTime() });
    return {
      policyId: p.policyId,
      featureId: p.featureId,
      featureVersion: p.featureVersion,
      result,
      vehicleActive: d.combos.reduce((a, c) => a + c.vehicleActive, 0),
      unconfirmed: d.unconfirmed,
      policyAllowed: d.policyAllowed,
      metrics: d.metrics,
      combos: d.combos,
      frozen: d.frozen,
      assumed: true,
    };
  }
}
