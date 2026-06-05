// GraphPort — 그래프/저장소 추상화 (대안 A 원칙). 기본 구현=InMemory, opt-in=PostgreSQL+AGE.
import { Feature, Edge, ArtifactNode, Relation, TestEvidence, TelemetrySummary, ChangeSet } from './types';

export interface GraphPort {
  listFeatures(): Feature[];
  getFeature(id: string): Feature | undefined;
  edgesOf(featureId: string): Edge[];
  allEdges(): Edge[];
  relationsOf(featureId: string): Relation[];
  artifact(id: string): ArtifactNode | undefined;
  evidenceFor(featureId: string): TestEvidence[];
  telemetryFor(featureId: string): TelemetrySummary | undefined;
  changeSetsFor(featureId: string): ChangeSet[];
  health(featureId: string): number;
}

export const GRAPH_PORT = Symbol('GRAPH_PORT');
