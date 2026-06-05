import { Inject, Injectable } from '@nestjs/common';
import { GRAPH_PORT, GraphPort } from '../domain/graph.port';
import { EnginesService } from '../engines/engines.service';
import { ReadinessResult, Gate, GateStatus } from '../domain/types';

// 9 Release Readiness Gates (docs/40-70). BDC: 8 PASS / Verification PENDING → HOLD.
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(GRAPH_PORT) private readonly g: GraphPort,
    private readonly engines: EnginesService,
  ) {}

  evaluate(featureId: string): ReadinessResult {
    const f = this.g.getFeature(featureId);
    const rels = this.g.relationsOf(featureId);
    const verify = this.engines.verification(featureId);
    const has = (t: string) => rels.some((r) => r.type === t);

    const gates: Gate[] = [
      { id: 'G1', name: 'Feature', status: f?.ownerOrg ? 'PASS' : 'FAIL', detail: `Owner: ${f?.ownerOrg ?? '-'} / ${f?.lifecycle}` },
      { id: 'G2', name: 'Requirement', status: has('derives') ? 'PASS' : 'FAIL', detail: '요구사항 Trace' },
      { id: 'G3', name: 'Variant', status: has('applies_to') ? 'PASS' : 'PENDING', detail: 'Applicability Rule' },
      { id: 'G4', name: 'Control', status: this.g.edgesOf(featureId).some((e) => e.type === 'fallback_to') ? 'PASS' : 'PENDING', detail: 'Safe Default·Rollback·Kill' },
      { id: 'G5', name: 'Verification', status: verify.gateResult, detail: verify.missingEvidence.length ? `미완: ${verify.missingEvidence.join(', ')}` : '완료' },
      { id: 'G6', name: 'Supplier', status: has('realized_by') ? 'PASS' : 'PENDING', detail: 'Supplier 매핑' },
      { id: 'G7', name: 'Safety/Security', status: (f?.safety && f?.security) ? 'PASS' : 'PENDING', detail: `Safety ${f?.safety} / Sec ${f?.security}` },
      { id: 'G8', name: 'OTA', status: f?.deployType && f.deployType !== 'TBD' ? 'PASS' : 'PENDING', detail: `${f?.deployType}` },
      { id: 'G9', name: 'Operations', status: this.g.telemetryFor(featureId) ? 'PASS' : 'PENDING', detail: 'Telemetry·Audit·Alert' },
    ];
    const passCount = gates.filter((x) => x.status === 'PASS').length;
    const decision: ReadinessResult['decision'] = gates.every((x) => x.status === 'PASS') ? 'RELEASE' : 'HOLD';
    return { featureId, gates, passCount, decision };
  }
}
