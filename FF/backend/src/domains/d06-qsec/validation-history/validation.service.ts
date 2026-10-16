// 검증 이력 관리 (D06-04) — 정책 하나에 대해 분야별 검증 8종을 병렬 실행하고 결과·근거를 이력으로 남긴다.
// 입력은 Registry(19속성·Gate)·Topology(REQUIRES·영향 상품)·Fleet(데모 차량)에서 모은다. 판단 규칙은 contracts.
import { Inject, Injectable } from '@nestjs/common';
import { GATES, virtualScenariosFor, type GateStatus, type Policy, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { VirtualRunRepo } from '../scenario-validation/virtual-run.repo';
import { PlatformComponent } from '../../../kernel/components';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from '../../d01-policy/repos';
import { FleetRepo, policyHash, PolicyRepo } from '../../d01-policy/policy-repos';
import { DomainError } from '../../../kernel/errors';

export interface PolicyValidator {
  readonly componentId: string;
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult;
}
export const POLICY_VALIDATORS = Symbol('POLICY_VALIDATORS');

/** PPT 슬라이드 4의 표시 순서 */
const ORDER = ['D06-01', 'D03-01', 'D06-03', 'D06-06', 'D06-02', 'D06-05', 'D04-02', 'D06-07'];

@Injectable()
@PlatformComponent('D06-04')
export class ValidationService {
  constructor(
    @Inject(POLICY_VALIDATORS) private readonly validators: PolicyValidator[],
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly topology: TopologyRepo,
    private readonly baselines: BaselineRepo,
    private readonly products: ProductRepo,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly virtualRuns: VirtualRunRepo,
  ) {}

  input(policy: Policy): ValidationInput {
    const feature = this.features.get(policy.featureId, policy.featureVersion);
    if (!feature) throw new DomainError('NOT_FOUND', `정책 대상 ${policy.featureId} ${policy.featureVersion}이(가) Registry에 없습니다.`);
    const latest = this.gates.latest(feature.featureId, feature.version);
    const gates = Object.fromEntries(GATES.filter((g) => latest[g]).map((g) => [g, latest[g]!.status])) as Partial<Record<(typeof GATES)[number], GateStatus>>;
    const requiresTargets = this.topology
      .outgoing(feature.featureId, feature.version)
      .filter((d) => d.type === 'REQUIRES')
      .map((d) => ({ dependencyId: d.dependencyId, targetFeatureId: d.targetFeatureId, targetVersion: d.targetVersion, targetLifecycle: d.targetVersion ? (this.features.get(d.targetFeatureId, d.targetVersion)?.lifecycle ?? null) : null }));
    const trace = feature.swIds.map((swId, i) => {
      const ver = feature.swVersions[i] ?? null;
      const ecu = feature.ecuPnos[i] ?? null;
      const e = ecu ? this.topology.ecu(ecu) : undefined;
      return { swId, swVersion: ver, ecuPno: ecu, swFound: !!ver && this.topology.sw(swId, ver).some((s) => s.ecuPno === ecu), ecuActive: !!e && e.lifecycle !== 'RETIRED' };
    });
    const bls = this.baselines.forFeature(feature.featureId).map((b) => b.baselineId);
    const affectedProducts = this.products
      .all()
      .filter((p) => p.baselineIds.some((b) => bls.includes(b)))
      .map((p) => ({ catalogId: p.catalogId, version: p.version, lifecycle: p.lifecycle }));
    let entitlementProductOk: boolean | null = true;
    if (policy.entitlementCatalogId) {
      const prods = this.products.all().filter((p) => p.catalogId === policy.entitlementCatalogId);
      entitlementProductOk = prods.length ? prods.some((p) => p.baselineIds.some((b) => bls.includes(b))) : null;
    }
    // 가상검증(CARLA) — 이 정책 내용으로 돌린 시나리오별 최신 실행 (시나리오가 없는 Feature는 빈 목록)
    const hash = policyHash(policy);
    const virtual = virtualScenariosFor(policy.featureId).map((scenario) => ({ scenario, run: this.virtualRuns.latest(policy.policyId, scenario.scenarioId, hash) ?? null }));
    return {
      virtual,
      policy,
      feature,
      gates,
      requiresTargets,
      trace,
      activePolicies: this.policies.forFeature(feature.featureId, feature.version).filter((p) => p.policyId !== policy.policyId && ['APPROVED', 'DEPLOYED'].includes(p.status)),
      flagKeyClash: this.policies.byFlag(policy.flagKey).filter((p) => p.featureId !== policy.featureId && p.status !== 'RETIRED'),
      fleet: this.fleet.vehicles(),
      affectedProducts,
      entitlementProductOk,
    };
  }

  /** 8종 병렬 실행 — 하나가 예외를 내도 나머지는 결과를 낸다(예외는 그 검증기의 FAIL) */
  async run(policy: Policy): Promise<ValidatorResult[]> {
    const input = this.input(policy);
    const settled = await Promise.allSettled(this.validators.map((v) => Promise.resolve().then(() => v.check(input))));
    const results = settled.map((s, i): ValidatorResult =>
      s.status === 'fulfilled'
        ? s.value
        : { componentId: this.validators[i].componentId, ko: this.validators[i].componentId, result: 'FAIL', summary: `검증기 오류: ${(s.reason as Error).message}`, findings: [{ result: 'FAIL', message: (s.reason as Error).message }] },
    );
    return results.sort((a, b) => ORDER.indexOf(a.componentId) - ORDER.indexOf(b.componentId));
  }

  history(policyId?: string) {
    return this.policies.runs(policyId);
  }
}
