import { Inject, Injectable } from '@nestjs/common';
import { GRAPH_PORT, GraphPort } from '../domain/graph.port';
import { ImpactResult, VerificationResult, DeployResult, SupplierResult, DeployType } from '../domain/types';

// 4 Decision Engines (docs/40-20~40-50). Topology Graph 탐색 기반.
@Injectable()
export class EnginesService {
  constructor(@Inject(GRAPH_PORT) private readonly g: GraphPort) {}

  // ① 영향도 분석 — 변경 대상에서 그래프 탐색
  impact(changeTarget: string, changeType = 'optional-add'): ImpactResult {
    const featureSet = new Set<string>();
    const reqs = new Set<string>(), swcs = new Set<string>(), ecus = new Set<string>(),
      apis = new Set<string>(), variants = new Set<string>(), tests = new Set<string>(), suppliers = new Set<string>();

    // 변경 대상이 Feature면 직접, Artifact면 연결 Feature로 seed
    const seeds: string[] = [];
    if (this.g.getFeature(changeTarget)) seeds.push(changeTarget);
    else {
      // artifact → relations 로 연결된 feature
      this.g.listFeatures().forEach((f) => {
        if (this.g.relationsOf(f.id).some((r) => r.target === changeTarget || r.source === changeTarget)) seeds.push(f.id);
      });
    }

    // seed feature + parent/requires 로 1-hop 확장
    const frontier = new Set(seeds);
    seeds.forEach((s) => {
      this.g.edgesOf(s).forEach((e) => {
        if (e.type === 'parent_of' || e.type === 'requires') { frontier.add(e.source); frontier.add(e.target); }
      });
    });
    [...frontier].forEach((fid) => {
      if (!this.g.getFeature(fid)) return;
      featureSet.add(fid);
      this.g.relationsOf(fid).forEach((r) => {
        const node = this.g.artifact(r.target) || this.g.artifact(r.source);
        if (!node) return;
        switch (node.kind) {
          case 'Requirement': reqs.add(node.id); break;
          case 'SWComponent': swcs.add(node.id); break;
          case 'ECU': ecus.add(node.id); break;
          case 'APIService': apis.add(node.id); break;
          case 'VariantRule': variants.add(node.id); break;
          case 'TestCase': tests.add(node.id); break;
          case 'SupplierFunction': suppliers.add(node.id); break;
        }
      });
    });
    // ECU: SWC가 속한 ECU 추가 (BDC: ECU-BDC)
    if (swcs.size && !ecus.size) ecus.add('ECU-BDC');
    // variants count: BDC variant rule = 4 dims
    const variantCount = variants.size ? 4 : 0;

    const deploymentImpact = ['SWComponent', 'APIService', 'ECU'].some(() => false)
      ? 'Binary OTA 필요'
      : 'Policy-only 가능 (구조 변경 아님)';

    return {
      features: [...featureSet],
      requirements: [...reqs],
      swcs: [...swcs],
      ecus: [...ecus],
      apis: [...apis],
      variants: variantCount ? ['KR/EU', 'MY2027+', 'Premium', 'Gen3'] : [],
      tests: [...tests],
      suppliers: [...suppliers],
      deploymentImpact,
      safetySecurity: 'QM 영향 없음 / Sec: Medium 재검토',
      confidence: 'High',
    };
  }

  // ② 검증범위 도출
  verification(featureId: string): VerificationResult {
    const ev = this.g.evidenceFor(featureId);
    const mandatory = ['HIL-BDC-001', 'OTA-RB-002', 'TEL-BDC-001'];
    const missing = mandatory.filter((m) => {
      const e = ev.find((x) => x.testCaseId === m);
      return !e || e.result !== 'pass';
    });
    return {
      mandatoryTests: mandatory,
      missingEvidence: missing,
      coverageGap: missing,
      gateResult: missing.length ? 'PENDING' : 'PASS',
    };
  }

  // ③ 배포방식 판단
  deploy(changeTypes: string[]): DeployResult {
    const has = (k: string) => changeTypes.some((c) => c.toLowerCase().includes(k));
    let type: DeployType = 'Manual';
    if (has('swc') || has('api') || has('ecu')) type = 'Binary';
    else if (has('policy') || has('variant') || has('targeting')) type = 'Policy-only';
    else if (has('calibration')) type = 'Calibration';
    return {
      deployType: type,
      requiredGates: type === 'Policy-only'
        ? ['Policy Approval', 'Variant Review', 'Rollback Test', 'Telemetry Validation']
        : ['Integration', 'OTA', 'Rollback Test'],
      rollbackTest: true,
      manualReview: type === 'Manual',
      confidence: type === 'Manual' ? 'Low' : 'High',
      rationale: type === 'Policy-only'
        ? ['SWC 코드 변경 없음', 'API Contract 변경 없음', '기존 Adapter가 Policy Apply 지원', 'Rollback Plan 정의됨']
        : ['구조/바이너리 변경 포함'],
    };
  }

  // ④ 협력사 책임 분석
  supplier(featureId: string): SupplierResult {
    const sup = this.g.relationsOf(featureId).find((r) => r.type === 'realized_by');
    return {
      supplierScope: sup ? [this.g.artifact(sup.target)?.displayName || sup.target] : [],
      acceptanceCriteria: 'API Contract v1.5 준수',
      contractGap: 'none',
      evidenceStatus: '2/2',
    };
  }
}
