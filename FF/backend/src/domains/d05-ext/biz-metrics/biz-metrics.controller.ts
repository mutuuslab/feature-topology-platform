// 사업 지표 모니터링 (D05-06) — 체험 전환 분석: 제안 → 수락 → 구매 깔때기, 성향 차원별 수락률·전환율, 주별 추이.
// 규칙(상태 판단·5대 미만 가림·주 경계)은 contracts/rules/trial.ts. 데모 차량과 통계용 합성 모집단은 source로 나눈다.
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { K_ANONYMITY, SEGMENT_DIMENSIONS, trialFunnel, trialTrend, type SegmentDimension } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { asSource, EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo } from '../../d01-policy/policy-repos';

@Injectable()
@PlatformComponent('D05-06')
export class BizMetricsService {
  constructor(
    private readonly fleet: FleetRepo,
    private readonly entitlements: EntitlementService,
  ) {}

  trials(q: { catalogId?: string; groupBy?: string; source?: string; weeks?: string }) {
    const catalogId = q.catalogId ?? 'CAT-00019';
    const groupBy = (q.groupBy || null) as SegmentDimension | null;
    if (groupBy && !SEGMENT_DIMENSIONS.includes(groupBy)) throw new DomainError('VALIDATION', `groupBy는 ${SEGMENT_DIMENSIONS.join('·')} 중 하나입니다.`);
    const weeks = Math.min(Math.max(Number(q.weeks ?? 26) || 26, 4), 52);
    const source = asSource(q.source ?? 'ALL');
    const today = this.entitlements.today();
    const grants = this.fleet.grantsForCatalog(catalogId, source);
    const profiles = this.fleet.profiles();
    const funnel = trialFunnel(grants.map((g) => ({ grant: g, profile: profiles.get(g.vin) })), groupBy, today);
    const trials = grants.filter((g) => g.kind === '체험');
    return {
      today,
      catalogId,
      source,
      groupBy,
      k: K_ANONYMITY,
      counts: { demo: trials.filter((g) => g.source === 'DEMO').length, synthetic: trials.filter((g) => g.source === 'SYNTHETIC').length },
      ...funnel,
      trend: trialTrend(grants, today, weeks),
    };
  }
}

@Controller('api/biz')
export class BizMetricsController {
  constructor(private readonly biz: BizMetricsService) {}

  @Get('trials')
  trials(@Query('catalogId') catalogId?: string, @Query('groupBy') groupBy?: string, @Query('source') source?: string, @Query('weeks') weeks?: string) {
    return this.biz.trials({ catalogId, groupBy, source, weeks });
  }
}
