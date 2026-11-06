// 홈 '차량 정책 수신 현황' 요약 — 홈이 차량·회신·게시본 전체 목록(공개 데모 기준 압축 전 약 1 MB)을 받지 않게
// 서버가 화면과 같은 모델(contracts rules/operation-overview)로 거르지 않은 첫 화면만 계산한다. 건수는 전체 기준.
// 회신(SAFETY_OPERATION 범주)은 그 범주를 읽는 역할일 때만 센다 — 아니면 회신 칸은 비운다(FFG-TEL-001).
import { Controller, Get } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { adoptionEvaluations, DATA_CATEGORY_ACCESS, operationSummary, type OperationInput } from '@ff/contracts';
import { ExternalSystems } from '../../../adapters/if-mocks/external-systems';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { CurrentActor, type Actor } from '../../../kernel/actor';
import { PolicyService } from '../../d01-policy/policy-store/policy.service';
import { RegistryService } from '../../d01-policy/registry/registry.service';
import { TargetingService } from '../../d01-policy/targeting/targeting.service';
import { PipelineService } from '../../d04-ops/pipeline-link/pipeline.service';
import { TelemetryService } from '../../d04-ops/telemetry-ingest/telemetry.service';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { VehicleRuntimeService } from './vehicle-runtime.service';

@Controller('api/fleet')
export class OperationSummaryController {
  constructor(
    private readonly runtime: VehicleRuntimeService,
    private readonly telemetry: TelemetryService,
    private readonly deploy: SecureDeployService,
    private readonly pipeline: PipelineService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** 화면의 전체 목록과 같은 원천 — fleetRuntime·vehicles·listPolicies·listFeatures·publications·readbacks·integrationCalls(IF-04) */
  @Get('operation-summary')
  async summary(@CurrentActor() actor: Actor) {
    const get = <T>(t: new (...a: never[]) => T) => this.moduleRef.get(t, { strict: false });
    const readbacks = (DATA_CATEGORY_ACCESS.SAFETY_OPERATION as readonly string[]).includes(actor.role);
    const runtime = (await this.runtime.fleetStatus()).items as OperationInput['runtime'];
    // 'Feature 적용 현황'의 실제 사용 단계 — 최근 평가 span(IF-11 수집기, 최대 500건)을 가명 subject로 차량에 되짚는다
    //   수집기가 없는 구성(모듈 미등록)이면 그 단계는 비운다
    let spans: ReturnType<ExternalSystems['spans']> | null = null;
    try { spans = get(ExternalSystems).spans({ name: 'feature_flag.evaluation', limit: 500 }); } catch { spans = null; }
    const input: OperationInput = {
      runtime,
      vehicles: get(TargetingService).vehicles(),
      policies: get(PolicyService).list() as OperationInput['policies'],
      features: get(RegistryService).list().items as OperationInput['features'],
      publications: this.deploy.list({}) as unknown as OperationInput['publications'],
      readbacks: readbacks ? (this.telemetry.list({}) as OperationInput['readbacks']) : [],
      syncs: this.pipeline.calls({ ifId: 'IF-04' }) as unknown as OperationInput['syncs'],
      ...(spans ? { evaluations: adoptionEvaluations(spans, new Map(runtime.map((r) => [vehiclePseudonym(r.vin), r.vin]))) } : {}),
    };
    return operationSummary(input, new Date().toISOString(), readbacks);
  }
}
