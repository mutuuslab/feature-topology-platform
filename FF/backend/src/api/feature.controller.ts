import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { GRAPH_PORT, GraphPort } from '../domain/graph.port';
import { EnginesService } from '../engines/engines.service';
import { ConsistencyService } from '../rules/consistency.service';
import { ReadinessService } from '../gates/readiness.service';

@Controller('api')
export class FeatureController {
  constructor(
    @Inject(GRAPH_PORT) private readonly g: GraphPort,
    private readonly engines: EnginesService,
    private readonly consistency: ConsistencyService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get('catalog')
  catalog() {
    const features = this.g.listFeatures().map((f) => ({ ...f, health: this.g.health(f.id) }));
    const by = (s: string) => features.filter((f) => f.lifecycle === s).length;
    return {
      features,
      stats: {
        total: features.length, approved: by('Approved'), developing: by('Developing'),
        released: by('Released'), missingTrace: features.filter((f) => f.health < 6).length,
      },
    };
  }

  @Get('features/:id')
  feature(@Param('id') id: string) {
    const f = this.g.getFeature(id);
    if (!f) return { error: 'not found' };
    const relations = this.g.relationsOf(id).map((r) => ({ ...r, node: this.g.artifact(r.target) || this.g.artifact(r.source) }));
    return {
      feature: { ...f, health: this.g.health(id) },
      relations,
      edges: this.g.edgesOf(id),
      evidence: this.g.evidenceFor(id),
      telemetry: this.g.telemetryFor(id),
      changeSets: this.g.changeSetsFor(id),
    };
  }

  @Get('features/:id/topology')
  topology(@Param('id') id: string) {
    const nodes: any[] = [];
    const seen = new Set<string>();
    const add = (nid: string, label: string, type: string) => { if (!seen.has(nid)) { seen.add(nid); nodes.push({ data: { id: nid, label, type } }); } };
    const f = this.g.getFeature(id);
    if (f) add(f.id, f.displayName, 'feature-center');
    const cyEdges: any[] = [];
    this.g.edgesOf(id).forEach((e) => {
      const s = this.g.getFeature(e.source), t = this.g.getFeature(e.target);
      add(e.source, s?.displayName || e.source, 'feature');
      add(e.target, t?.displayName || e.target, e.target.startsWith('FEAT') ? 'feature' : 'artifact');
      cyEdges.push({ data: { id: e.id, source: e.source, target: e.target, label: e.type } });
    });
    this.g.relationsOf(id).forEach((r) => {
      const node = this.g.artifact(r.target) || this.g.artifact(r.source);
      const other = r.source === id ? r.target : r.source;
      if (node) add(node.id, node.displayName, node.kind.toLowerCase());
      cyEdges.push({ data: { id: r.id, source: id, target: other, label: r.type } });
    });
    return { nodes, edges: cyEdges };
  }

  @Post('impact')
  impact(@Body() body: { changeTarget: string; changeType?: string }) {
    return this.engines.impact(body.changeTarget, body.changeType);
  }

  @Get('features/:id/verification')
  verification(@Param('id') id: string) { return this.engines.verification(id); }

  @Post('deploy')
  deploy(@Body() body: { changeTypes: string[] }) { return this.engines.deploy(body.changeTypes || []); }

  @Get('features/:id/supplier')
  supplier(@Param('id') id: string) { return this.engines.supplier(id); }

  @Get('features/:id/readiness')
  readinessGet(@Param('id') id: string) { return this.readiness.evaluate(id); }

  @Get('features/:id/decision-report')
  decisionReport(@Param('id') id: string) {
    return {
      impact: this.engines.impact(id),
      verification: this.engines.verification(id),
      deploy: this.engines.deploy(['Targeting/Policy Rule 변경']),
      supplier: this.engines.supplier(id),
    };
  }

  @Get('consistency')
  consistency2() { return { violations: this.consistency.evaluateAll() }; }
}
