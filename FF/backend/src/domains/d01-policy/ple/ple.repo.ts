// 26580 변이 프로필(feature_variability)·자동 채움 이력(feature_autofill, 추가만) 저장소 — 20-60 §5.1.
import { Inject, Injectable } from '@nestjs/common';
import type { AutofillDecision, AutofillDecisionRow, AutofillHistoryRow, AutofillSourceKind, FeatureVariability } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

export type VariabilitySource = 'AUTO' | 'EDITED' | 'SEED';

export interface StoredVariability {
  featureId: string;
  version: string;
  variability: FeatureVariability;
  source: VariabilitySource;
  updatedBy: string;
  updatedAt: string;
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parse = (s: string | null) => (s === null ? null : JSON.parse(s));

@Injectable()
export class PleRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  variability(featureId: string, version: string): StoredVariability | undefined {
    const r = this.db.get<{ doc: string; source: VariabilitySource; updated_by: string; updated_at: string }>('SELECT doc, source, updated_by, updated_at FROM feature_variability WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? { featureId, version, variability: JSON.parse(r.doc), source: r.source, updatedBy: r.updated_by, updatedAt: r.updated_at } : undefined;
  }

  /** `${featureId}@${version}` → 저장된 변이 프로필 */
  allVariabilities(): Map<string, FeatureVariability> {
    const rows = this.db.all<{ feature_id: string; version: string; doc: string }>('SELECT feature_id, version, doc FROM feature_variability');
    return new Map(rows.map((r) => [`${r.feature_id}@${r.version}`, JSON.parse(r.doc) as FeatureVariability]));
  }

  countVariabilities(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM feature_variability')?.n ?? 0;
  }

  putVariability(featureId: string, version: string, v: FeatureVariability, source: VariabilitySource, by: string, at: string) {
    const doc = JSON.stringify(v);
    if (this.db.get('SELECT 1 FROM feature_variability WHERE feature_id = ? AND version = ?', featureId, version))
      this.db.run('UPDATE feature_variability SET doc = ?, source = ?, updated_by = ?, updated_at = ? WHERE feature_id = ? AND version = ?', doc, source, by, at, featureId, version);
    else this.db.run('INSERT INTO feature_variability (feature_id, version, doc, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)', featureId, version, doc, source, by, at);
  }

  addDecisions(featureId: string, version: string, rows: readonly AutofillDecisionRow[], actorId: string, at: string) {
    for (const r of rows)
      this.db.run(
        'INSERT INTO feature_autofill (feature_id, version, field, source_kind, source_ref, suggested, final, decision, actor_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        featureId,
        version,
        r.field,
        r.sourceKind,
        r.sourceRef,
        json(r.suggested),
        json(r.final),
        r.decision,
        actorId,
        at,
      );
  }

  history(featureId: string, version: string): AutofillHistoryRow[] {
    return this.db
      .all<{ id: number; field: string; source_kind: AutofillSourceKind | null; source_ref: string | null; suggested: string | null; final: string | null; decision: AutofillDecision; actor_id: string; at: string }>(
        'SELECT id, field, source_kind, source_ref, suggested, final, decision, actor_id, at FROM feature_autofill WHERE feature_id = ? AND version = ? ORDER BY id',
        featureId,
        version,
      )
      .map((r) => ({ id: r.id, featureId, version, field: r.field, sourceKind: r.source_kind, sourceRef: r.source_ref, suggested: parse(r.suggested), final: parse(r.final), decision: r.decision, actorId: r.actor_id, at: r.at }));
  }

  /** Feature Version별 최신 결정 수(칸마다 마지막 줄) — 등록 현황 표 */
  decisionCounts(): Map<string, Record<AutofillDecision, number>> {
    const rows = this.db.all<{ feature_id: string; version: string; field: string; decision: AutofillDecision }>(
      'SELECT a.feature_id, a.version, a.field, a.decision FROM feature_autofill a JOIN (SELECT feature_id, version, field, MAX(id) AS id FROM feature_autofill GROUP BY feature_id, version, field) m ON a.id = m.id',
    );
    const out = new Map<string, Record<AutofillDecision, number>>();
    for (const r of rows) {
      const k = `${r.feature_id}@${r.version}`;
      const c = out.get(k) ?? { ACCEPTED: 0, EDITED: 0, ADDED: 0 };
      c[r.decision]++;
      out.set(k, c);
    }
    return out;
  }
}
