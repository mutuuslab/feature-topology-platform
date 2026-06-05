import { Inject, Injectable } from '@nestjs/common';
import { GRAPH_PORT, GraphPort } from '../domain/graph.port';
import { RuleViolation } from '../domain/types';

// 12 Consistency Rules + Edge 품질룰 (docs/40-10). 위반 산출.
@Injectable()
export class ConsistencyService {
  constructor(@Inject(GRAPH_PORT) private readonly g: GraphPort) {}

  evaluateAll(): RuleViolation[] {
    const v: RuleViolation[] = [];
    for (const f of this.g.listFeatures()) {
      const rels = this.g.relationsOf(f.id);
      const hasReq = rels.some((r) => r.type === 'derives');
      const hasTest = rels.some((r) => r.type === 'verified_by');
      const hasSupplier = rels.some((r) => r.type === 'realized_by');
      const hasVariant = rels.some((r) => r.type === 'applies_to');

      if (f.level === 'L2' && !hasReq)
        v.push({ rule: 'R01', featureId: f.id, severity: 'blocking', message: 'L2 Feature는 최소 1개 Requirement 필요' });
      if (f.level === 'L2' && !f.ownerOrg)
        v.push({ rule: 'R02', featureId: f.id, severity: 'blocking', message: 'L2 Feature는 Owner 필수' });
      if (f.lifecycle === 'Released' && !hasTest)
        v.push({ rule: 'R03', featureId: f.id, severity: 'blocking', message: 'Released는 ≥1 Test Evidence 필요' });
      if (f.deployType === 'Policy-only' && !this.g.edgesOf(f.id).some((e) => e.type === 'fallback_to'))
        v.push({ rule: 'R05', featureId: f.id, severity: 'warning', message: 'Policy-only는 Rollback Plan 권장' });
      if ((f.deployType === 'Policy-only' || f.deployType !== 'TBD') && f.lifecycle !== 'Proposed' && !hasVariant && f.level === 'L2')
        v.push({ rule: 'R07', featureId: f.id, severity: 'warning', message: 'Variant Rule 없으면 Production 활성화 불가' });
      if (hasSupplier && !this.g.relationsOf(f.id).some((r) => r.type === 'realized_by'))
        v.push({ rule: 'R06', featureId: f.id, severity: 'blocking', message: 'Supplier 구현은 Supplier Function ID 필요' });
    }
    // Edge 품질: No Cycle (간단 검사, parent_of/requires)
    if (this.hasCycle()) v.push({ rule: 'EQ1', featureId: '*', severity: 'blocking', message: 'parent_of/requires 순환 감지' });
    return v;
  }

  private hasCycle(): boolean {
    const adj = new Map<string, string[]>();
    this.g.allEdges().filter((e) => e.type === 'parent_of' || e.type === 'requires')
      .forEach((e) => { (adj.get(e.source) || adj.set(e.source, []).get(e.source))!.push(e.target); });
    const seen = new Set<string>(), stack = new Set<string>();
    const dfs = (n: string): boolean => {
      if (stack.has(n)) return true;
      if (seen.has(n)) return false;
      seen.add(n); stack.add(n);
      for (const m of adj.get(n) || []) if (dfs(m)) return true;
      stack.delete(n); return false;
    };
    return [...adj.keys()].some(dfs);
  }
}
