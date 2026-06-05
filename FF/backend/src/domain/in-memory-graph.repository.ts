import { Injectable } from '@nestjs/common';
import { GraphPort } from './graph.port';
import * as seed from './seed';
import { Feature, Edge, ArtifactNode, Relation, TestEvidence, TelemetrySummary, ChangeSet } from './types';

// 기본 구현: 인메모리 BDC 시드. PostgreSQL+AGE 어댑터로 교체 가능(GraphPort 동일 계약).
@Injectable()
export class InMemoryGraphRepository implements GraphPort {
  listFeatures(): Feature[] { return seed.features; }
  getFeature(id: string) { return seed.features.find((f) => f.id === id); }
  allEdges(): Edge[] { return seed.edges; }
  edgesOf(id: string): Edge[] { return seed.edges.filter((e) => e.source === id || e.target === id); }
  relationsOf(id: string): Relation[] { return seed.relations.filter((r) => r.source === id || r.target === id); }
  artifact(id: string): ArtifactNode | undefined { return seed.artifacts.find((a) => a.id === id); }
  evidenceFor(_id: string): TestEvidence[] { return seed.evidence; }
  telemetryFor(id: string): TelemetrySummary | undefined { return seed.telemetry.find((t) => t.featureId === id); }
  changeSetsFor(id: string): ChangeSet[] { return seed.changeSets.filter((c) => c.featureId === id); }
  health(id: string): number { return seed.healthByFeature[id] ?? 0; }
}
