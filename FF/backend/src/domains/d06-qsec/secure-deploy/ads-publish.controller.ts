// 발행 미리보기(ADS-BE09·BE10·BE16)와 캠페인 → 릴리스 역조회(ADS-BE17·FFP-F017) — 읽기 전용.
//  · GET /api/policies/:id/publish-preview: 정책 컴파일 검사(승인 상한) + 게시 후보(승인 조합·시장 기준선 제외 사유). ADS Feature만 강제(enforced)
//  · GET /api/campaigns/:id: 전송 campaign ID로 정책 게시본·정책 릴리스를 찾는다(게시본 → 캠페인은 기존 GET /api/publications/:id)
import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { Publication } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { AdsPublishGate } from '../../d02-runtime/variant-conditions/ads-publish-gate';
import { SecureDeployService } from './secure-deploy.service';

@Controller('api')
export class AdsPublishController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gate: AdsPublishGate,
    private readonly policies: PolicyRepo,
    private readonly deploy: SecureDeployService,
  ) {}

  @Get('policies/:id/publish-preview')
  preview(@Param('id') id: string) {
    const p = this.policies.get(id);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${id}을(를) 찾을 수 없습니다.`);
    const scope = this.deploy.targetsFor(p.featureId, p.featureVersion);
    const c = this.gate.candidates(p.featureId, p.featureVersion, scope);
    const compile = this.gate.compileBlockers(p);
    return {
      policyId: p.policyId,
      featureId: p.featureId,
      featureVersion: p.featureVersion,
      flagKey: p.flagKey,
      scope: scope.length,
      enforced: c.enforced,
      targets: c.targets,
      excluded: c.excluded,
      unverifiedCombo: c.unverifiedCombo,
      compile,
      blockers: [...compile, ...c.blockers],
      warnings: c.warnings,
      oddProfileRef: this.gate.approvedProfile(p.featureId, p.featureVersion)?.profileId ?? null,
    };
  }

  @Get('campaigns/:id')
  campaign(@Param('id') id: string) {
    const pubs = this.db
      .all<{ doc: string }>('SELECT doc FROM publication ORDER BY publication_id')
      .map((r) => JSON.parse(r.doc) as Publication)
      .filter((p) => p.campaignId === id);
    const known =
      pubs.length > 0 ||
      !!this.db.get('SELECT 1 FROM ota_job WHERE job_id = ? OR ota_job_id = ?', id, id) ||
      this.db.all<{ doc: string }>("SELECT doc FROM if_call WHERE if_id = 'IF-05'").some((r) => (JSON.parse(r.doc) as { response?: { campaignId?: string } }).response?.campaignId === id);
    if (!known) throw new DomainError('NOT_FOUND', `캠페인 ${id}을(를) 찾을 수 없습니다.`);
    const policyIds = [...new Set(pubs.map((p) => p.payload.policy?.policyId).filter((x): x is string => !!x))];
    return {
      campaignId: id,
      publications: pubs.map((p) => ({ publicationId: p.publicationId, kind: p.kind, status: p.status, featureId: p.payload.featureId, featureVersion: p.payload.featureVersion, flagKey: p.payload.flagKey, targets: p.payload.targets.length, createdAt: p.createdAt, bundleDigest: p.build?.bundleDigest ?? null })),
      policies: policyIds.map((pid) => {
        const pol = this.policies.get(pid);
        return { policyId: pid, flagKey: pol?.flagKey ?? null, featureId: pol?.featureId ?? null, featureVersion: pol?.featureVersion ?? null, status: pol?.status ?? null, contentHash: pol?.contentHash ?? null };
      }),
    };
  }
}
