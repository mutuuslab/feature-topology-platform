// 확대 판정 읽기(ADS-BE12) — 차량 보고 Active 노출량(미확인 분리)·감시 지표 신선도·조합별 근거·동결로 확대 가능·중단·확대 보류·동결을 낸다.
// 판정은 contracts expansionVerdict(순수 함수). 입력은 시드(가정값 — 텔레메트리 연동 TL-B01·B02 전). 동결 명령·자동 확대 거부는 이 작업 밖.
import { Controller, Get, Inject, Injectable, Param } from '@nestjs/common';
import { expansionVerdict, type ExpansionInput, type ExpansionView } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { PolicyRepo } from '../policy-repos';

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
    private readonly policies: PolicyRepo,
  ) {}

  view(policyId: string): ExpansionView {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}이(가) 없습니다.`);
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_expansion_input WHERE feature_id = ? AND version = ?', p.featureId, p.featureVersion);
    if (!r) throw new DomainError('NOT_FOUND', `${p.featureId} ${p.featureVersion}의 확대 판정 입력이 없습니다.`);
    const d = JSON.parse(r.doc) as ExpansionDoc;
    const result = expansionVerdict({ frozen: d.frozen, metrics: d.metrics, combos: d.combos, now: this.clock.now().getTime() });
    return {
      policyId,
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

@Controller('api/policies')
export class AdsExpansionController {
  constructor(private readonly svc: AdsExpansionService) {}

  @Get(':id/expansion')
  view(@Param('id') id: string) {
    return this.svc.view(id);
  }
}
